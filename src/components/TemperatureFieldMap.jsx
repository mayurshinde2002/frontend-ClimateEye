import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchHourlyWeatherData } from '../services/api'

// Windy-style temperature ramp: deep blue → cyan → green → yellow → orange → burnt red
const TEMP_STOPS = [
  [-20, [18, 40, 150]],
  [-10, [36, 100, 210]],
  [0, [48, 170, 230]],
  [5, [40, 200, 195]],
  [10, [55, 205, 95]],
  [15, [150, 220, 45]],
  [20, [235, 225, 40]],
  [24, [245, 185, 30]],
  [28, [240, 130, 28]],
  [32, [230, 80, 28]],
  [36, [200, 40, 32]],
  [40, [145, 28, 38]]
]

const TEMP_LABELS = [-20, -10, 0, 10, 20, 30, 40]
const MAX_POINTS = 56
const sampleCache = new Map()

const todayDate = () => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const snap = (value, step) => Math.round(value / step) * step

const stepForZoom = (zoom) => {
  if (zoom < 5) return 2
  if (zoom < 7) return 1
  if (zoom < 9) return 0.5
  return 0.25
}

const gridPoints = (bounds, zoom) => {
  let step = stepForZoom(zoom)
  const build = (cell) => {
    const south = snap(bounds.getSouth(), cell) - cell
    const north = snap(bounds.getNorth(), cell) + cell
    const west = snap(bounds.getWest(), cell) - cell
    const east = snap(bounds.getEast(), cell) + cell
    const points = []
    const seen = new Set()
    for (let lat = south; lat <= north + cell * 0.01; lat += cell) {
      for (let lng = west; lng <= east + cell * 0.01; lng += cell) {
        const point = {
          lat: Math.round(lat * 1000) / 1000,
          lng: Math.round(lng * 1000) / 1000
        }
        const key = `${point.lat}:${point.lng}`
        if (seen.has(key)) continue
        seen.add(key)
        points.push(point)
      }
    }
    return points
  }

  let points = build(step)
  while (points.length > MAX_POINTS && step < 4) {
    step *= 2
    points = build(step)
  }
  if (points.length > MAX_POINTS) {
    const stride = Math.ceil(points.length / MAX_POINTS)
    points = points.filter((_, index) => index % stride === 0).slice(0, MAX_POINTS)
  }
  return { points, step }
}

// Backend hourly dates are UTC without a Z suffix — parse as UTC, not local.
const parseHourTime = (value) => {
  const text = String(value || '').trim().replace(' ', 'T')
  if (!text) return NaN
  if (/Z$/i.test(text) || /[+-]\d{2}:?\d{2}$/.test(text)) return new Date(text).getTime()
  return new Date(`${text}Z`).getTime()
}

const currentTemperature = (records) => {
  const now = Date.now()
  let best = null
  ;(records || []).forEach((record) => {
    const time = parseHourTime(record.date)
    if (Number.isNaN(time) || time > now + 30 * 60 * 1000) return
    const temp = finiteOrNull(record.temperature)
    if (temp == null) return
    // Prefer the hour closest to now (current / just-past), not an old cool morning hour.
    const distance = Math.abs(now - time)
    if (!best || distance < best.distance) best = { temp, time, distance }
  })
  return best?.temp ?? null
}

const temperatureColor = (temperature) => {
  if (temperature == null) return null
  const value = Math.max(-20, Math.min(40, temperature))
  let index = 1
  while (index < TEMP_STOPS.length && TEMP_STOPS[index][0] < value) index += 1
  const [startTemp, start] = TEMP_STOPS[index - 1]
  const [endTemp, end] = TEMP_STOPS[Math.min(index, TEMP_STOPS.length - 1)]
  const t = endTemp === startTemp ? 0 : (value - startTemp) / (endTemp - startTemp)
  const blend = t * t * (3 - 2 * t)
  return [
    Math.round(start[0] + (end[0] - start[0]) * blend),
    Math.round(start[1] + (end[1] - start[1]) * blend),
    Math.round(start[2] + (end[2] - start[2]) * blend)
  ]
}

// Sharp IDW: keep local highs (land heat) instead of averaging down toward cooler neighbors.
const sampleField = (field, lat, lng, soft = 0.03) => {
  if (!field.length) return null
  const cos = Math.cos((lat * Math.PI) / 180)
  let nearest = null
  let nearestDist = Infinity
  let temperature = 0
  let weightTotal = 0

  field.forEach((point) => {
    if (point.temp == null) return
    const dLat = lat - point.lat
    const dLng = (lng - point.lng) * cos
    const dist2 = dLat * dLat + dLng * dLng
    const dist = Math.sqrt(dist2)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = point.temp
    }
    // Power-3 falloff so distant (often cooler ocean) points barely pull the value down.
    const weight = 1 / (Math.pow(dist + soft, 3))
    temperature += point.temp * weight
    weightTotal += weight
  })

  if (!weightTotal) return null
  // Snap to nearest sample when very close so hover matches the station value.
  if (nearest != null && nearestDist < soft * 2.5) return nearest
  return temperature / weightTotal
}

const TemperatureFieldMap = () => {
  const map = useMap()
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    const canvas = L.DomUtil.create('canvas', 'regional-wind-canvas temperature-field-canvas', map.getPane('weatherField'))
    const tip = L.DomUtil.create('div', 'regional-wind-tip', map.getContainer())
    tip.style.display = 'none'
    const ctx = canvas.getContext('2d')
    const heat = document.createElement('canvas')
    heat.width = 360
    heat.height = 220
    const heatCtx = heat.getContext('2d', { willReadFrequently: true })
    const fieldRef = { current: [] }
    let alive = true
    let frameId = 0
    let timer = 0
    let generation = 0
    let dirty = true
    let pixelWidth = 0
    let pixelHeight = 0
    let soft = 0.03

    const syncCanvas = () => {
      const size = map.getSize()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(size.x * ratio))
      const height = Math.max(1, Math.round(size.y * ratio))
      if (width !== pixelWidth || height !== pixelHeight) {
        pixelWidth = width
        pixelHeight = height
        canvas.width = width
        canvas.height = height
        canvas.style.width = `${size.x}px`
        canvas.style.height = `${size.y}px`
        dirty = true
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
      return size
    }

    const paintHeat = (size) => {
      const field = fieldRef.current
      const image = heatCtx.createImageData(heat.width, heat.height)
      const pixels = image.data
      for (let y = 0; y < heat.height; y += 1) {
        for (let x = 0; x < heat.width; x += 1) {
          const latLng = map.containerPointToLatLng([
            ((x + 0.5) * size.x) / heat.width,
            ((y + 0.5) * size.y) / heat.height
          ])
          const temperature = sampleField(field, latLng.lat, latLng.lng, soft)
          const color = temperatureColor(temperature)
          const offset = (y * heat.width + x) * 4
          if (!color) {
            pixels[offset + 3] = 0
            continue
          }
          pixels[offset] = color[0]
          pixels[offset + 1] = color[1]
          pixels[offset + 2] = color[2]
          pixels[offset + 3] = 210
        }
      }
      heatCtx.putImageData(image, 0, 0)
    }

    const pointsNearView = (bounds, pad = 1.5) => {
      const date = todayDate()
      const south = bounds.getSouth() - pad
      const north = bounds.getNorth() + pad
      const west = bounds.getWest() - pad
      const east = bounds.getEast() + pad
      const samples = []
      sampleCache.forEach((sample, key) => {
        if (!sample || !key.startsWith(`v2:${date}:`)) return
        if (sample.lat < south || sample.lat > north || sample.lng < west || sample.lng > east) return
        if (sample.temp == null) return
        samples.push(sample)
      })
      return samples
    }

    const loadField = async () => {
      const id = generation + 1
      generation = id
      const date = todayDate()
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      const { points, step } = gridPoints(bounds, zoom)
      soft = Math.max(0.012, step * 0.08)
      if (!fieldRef.current.length) setStatus('loading')

      const unique = []
      const seen = new Set()
      points.forEach((point) => {
        const key = `v2:${date}:${point.lat}:${point.lng}`
        if (seen.has(key)) return
        seen.add(key)
        unique.push({ ...point, key })
      })

      let cursor = 0
      const worker = async () => {
        while (cursor < unique.length) {
          const point = unique[cursor]
          cursor += 1
          if (generation !== id) return
          if (sampleCache.has(point.key)) continue
          try {
            const data = await fetchHourlyWeatherData(point.lat, point.lng, date)
            if (generation !== id) return
            const temp = currentTemperature(data?.hourly_records)
            if (sampleCache.size > 280) sampleCache.delete(sampleCache.keys().next().value)
            sampleCache.set(point.key, { lat: point.lat, lng: point.lng, temp })
          } catch {
            sampleCache.set(point.key, { lat: point.lat, lng: point.lng, temp: null })
          }
        }
      }

      await Promise.all([worker(), worker(), worker(), worker()])
      if (!alive || generation !== id) return
      const samples = pointsNearView(bounds, Math.max(step * 2, 1))
      if (samples.length) {
        fieldRef.current = samples
        dirty = true
        setStatus('ready')
      } else if (!fieldRef.current.length) {
        setStatus('empty')
      }
    }

    const tick = () => {
      if (!alive) return
      frameId = requestAnimationFrame(tick)
      const size = syncCanvas()
      ctx.clearRect(0, 0, size.x, size.y)
      if (!fieldRef.current.length) return
      if (dirty) {
        paintHeat(size)
        dirty = false
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.globalAlpha = 0.92
      ctx.drawImage(heat, 0, 0, size.x, size.y)
      ctx.globalAlpha = 1
    }

    const markDirty = () => { dirty = true }
    const scheduleLoad = () => {
      clearTimeout(timer)
      timer = window.setTimeout(loadField, 450)
    }

    const onMouseMove = (event) => {
      const field = fieldRef.current
      if (!field.length) {
        tip.style.display = 'none'
        return
      }
      const temperature = sampleField(field, event.latlng.lat, event.latlng.lng, soft)
      if (temperature == null) {
        tip.style.display = 'none'
        return
      }
      tip.textContent = `${temperature.toFixed(1)} °C · now`
      tip.style.display = 'block'
      const point = map.mouseEventToContainerPoint(event.originalEvent)
      tip.style.left = `${point.x + 14}px`
      tip.style.top = `${point.y + 14}px`
    }
    const onMouseOut = () => {
      tip.style.display = 'none'
    }

    frameId = requestAnimationFrame(tick)
    map.on('move', markDirty)
    map.on('zoom', markDirty)
    map.on('resize', markDirty)
    map.on('moveend', scheduleLoad)
    map.on('zoomend', scheduleLoad)
    map.on('mousemove', onMouseMove)
    map.on('mouseout', onMouseOut)
    loadField()

    return () => {
      alive = false
      generation += 1
      clearTimeout(timer)
      cancelAnimationFrame(frameId)
      map.off('move', markDirty)
      map.off('zoom', markDirty)
      map.off('resize', markDirty)
      map.off('moveend', scheduleLoad)
      map.off('zoomend', scheduleLoad)
      map.off('mousemove', onMouseMove)
      map.off('mouseout', onMouseOut)
      tip.remove()
      canvas.remove()
    }
  }, [map])

  return createPortal(
    <div className="temperature-scale">
      {status === 'loading' && <span className="regional-wind-scale-note">Loading temperature…</span>}
      {status === 'empty' && <span className="regional-wind-scale-note">Temperature is unavailable</span>}
      {status === 'ready' && (
        <>
          <span className="temperature-scale-unit">°C · now</span>
          <div className="temperature-scale-bar">
            {TEMP_LABELS.map((value) => (
              <span key={value} style={{ left: `${((value + 20) / 60) * 100}%` }}>{value}</span>
            ))}
          </div>
        </>
      )}
    </div>,
    map.getContainer()
  )
}

export default TemperatureFieldMap
