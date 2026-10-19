import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchHourlyWeatherData, fetchOpenMeteoRainForecast } from '../services/api'

const RAIN_STOPS = [
  [0, [20, 90, 130]],
  [1.5, [48, 170, 190]],
  [3, [40, 168, 120]],
  [7, [72, 196, 64]],
  [10, [200, 210, 48]],
  [20, [236, 160, 36]],
  [30, [196, 48, 160]]
]

const RAIN_LABELS = [0, 1.5, 3, 7, 10, 20, 30]
const MAX_POINTS = 48
const WINDOW_HOURS = 3
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

const parseBackendSeries = (records) => {
  const series = []
  ;(records || []).forEach((record) => {
    const time = new Date(String(record.date || '').replace(' ', 'T')).getTime()
    if (Number.isNaN(time)) return
    const value = finiteOrNull(record.precipitation)
    if (value == null) return
    series.push({ time, rain: value })
  })
  series.sort((a, b) => a.time - b.time)
  return series
}

// Open-Meteo forecast: hourly.time + hourly.rain (UTC when timezone omitted).
const parseOpenMeteoSeries = (payload) => {
  const times = payload?.hourly?.time || []
  const rains = payload?.hourly?.rain || []
  const series = []
  const length = Math.min(times.length, rains.length)
  for (let index = 0; index < length; index += 1) {
    const stamp = String(times[index] || '')
    const time = new Date(stamp.endsWith('Z') ? stamp : `${stamp}:00Z`).getTime()
    if (Number.isNaN(time)) continue
    const value = finiteOrNull(rains[index])
    if (value == null) continue
    series.push({ time, rain: value })
  }
  return series
}

// Recent = last WINDOW_HOURS at/before now. Forecast = next WINDOW_HOURS after now.
const rainForMode = (series, mode) => {
  if (!series?.length) return 0
  const now = Date.now()
  const windowMs = WINDOW_HOURS * 60 * 60 * 1000
  let sum = 0
  let seen = false
  let fallback = null
  let fallbackDist = Infinity

  series.forEach((entry) => {
    const { time, rain } = entry
    if (mode === 'recent') {
      if (time > now) return
      const age = now - time
      if (age < fallbackDist) {
        fallback = rain
        fallbackDist = age
      }
      if (time >= now - windowMs) {
        sum += rain
        seen = true
      }
      return
    }

    if (time <= now) return
    const ahead = time - now
    if (ahead < fallbackDist) {
      fallback = rain
      fallbackDist = ahead
    }
    if (ahead <= windowMs) {
      sum += rain
      seen = true
    }
  })

  if (seen) return sum
  return fallback == null ? 0 : fallback
}

const rainColor = (rain) => {
  if (rain == null) return null
  const value = Math.max(0, Math.min(30, rain))
  let index = 1
  while (index < RAIN_STOPS.length && RAIN_STOPS[index][0] < value) index += 1
  const [startRain, start] = RAIN_STOPS[index - 1]
  const [endRain, end] = RAIN_STOPS[Math.min(index, RAIN_STOPS.length - 1)]
  const blend = endRain === startRain ? 0 : (value - startRain) / (endRain - startRain)
  return [
    Math.round(start[0] + (end[0] - start[0]) * blend),
    Math.round(start[1] + (end[1] - start[1]) * blend),
    Math.round(start[2] + (end[2] - start[2]) * blend)
  ]
}

const sampleField = (field, lat, lng, soft = 0.12) => {
  if (!field.length) return 0
  let rain = 0
  let weightTotal = 0
  const cos = Math.cos((lat * Math.PI) / 180)
  field.forEach((point) => {
    if (point.rain == null) return
    const dLat = lat - point.lat
    const dLng = (lng - point.lng) * cos
    const weight = 1 / (dLat * dLat + dLng * dLng + soft)
    rain += point.rain * weight
    weightTotal += weight
  })
  return weightTotal ? rain / weightTotal : 0
}

const cacheKey = (mode, lat, lng) => (
  mode === 'forecast'
    ? `forecast:${lat}:${lng}`
    : `recent:${todayDate()}:${lat}:${lng}`
)

const RainFieldMap = () => {
  const map = useMap()
  const [status, setStatus] = useState('loading')
  const [mode, setMode] = useState('recent')
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    const canvas = L.DomUtil.create('canvas', 'regional-wind-canvas', map.getPane('weatherField'))
    const tip = L.DomUtil.create('div', 'regional-wind-tip', map.getContainer())
    tip.style.display = 'none'
    const ctx = canvas.getContext('2d')
    const heat = document.createElement('canvas')
    heat.width = 220
    heat.height = 140
    const heatCtx = heat.getContext('2d', { willReadFrequently: true })
    const fieldRef = { current: [] }
    let alive = true
    let frameId = 0
    let timer = 0
    let generation = 0
    let dirty = true
    let pixelWidth = 0
    let pixelHeight = 0
    let soft = 0.12

    const unitLabel = () => (
      modeRef.current === 'forecast' ? 'mm · next 3h' : 'mm · last 3h'
    )

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
          const rain = sampleField(field, latLng.lat, latLng.lng, soft)
          const color = rainColor(rain)
          const offset = (y * heat.width + x) * 4
          if (!color) {
            pixels[offset + 3] = 0
            continue
          }
          const strength = Math.min(1, rain / 8)
          pixels[offset] = color[0]
          pixels[offset + 1] = color[1]
          pixels[offset + 2] = color[2]
          pixels[offset + 3] = Math.round(185 + strength * 60)
        }
      }
      heatCtx.putImageData(image, 0, 0)
    }

    const buildField = (bounds, pad = 1.5) => {
      const mode = modeRef.current
      const prefix = mode === 'forecast' ? 'forecast:' : `recent:${todayDate()}:`
      const south = bounds.getSouth() - pad
      const north = bounds.getNorth() + pad
      const west = bounds.getWest() - pad
      const east = bounds.getEast() + pad
      const field = []

      sampleCache.forEach((entry, key) => {
        if (!entry?.series || !key.startsWith(prefix)) return
        if (entry.lat < south || entry.lat > north || entry.lng < west || entry.lng > east) return
        field.push({
          lat: entry.lat,
          lng: entry.lng,
          rain: rainForMode(entry.series, mode)
        })
      })
      return field
    }

    const applyField = (bounds, step) => {
      const samples = buildField(bounds, Math.max(step * 2, 1))
      if (samples.length) {
        fieldRef.current = samples
        dirty = true
        setStatus('ready')
        return true
      }
      if (!fieldRef.current.length) setStatus('empty')
      return false
    }

    const ensureSeries = async (lat, lng, id) => {
      const mode = modeRef.current
      const key = cacheKey(mode, lat, lng)
      if (sampleCache.has(key)) return
      try {
        let series = []
        if (mode === 'forecast') {
          const data = await fetchOpenMeteoRainForecast(lat, lng)
          if (generation !== id) return
          series = parseOpenMeteoSeries(data)
        } else {
          const data = await fetchHourlyWeatherData(lat, lng, todayDate())
          if (generation !== id) return
          series = parseBackendSeries(data?.hourly_records)
        }
        if (sampleCache.size > 320) sampleCache.delete(sampleCache.keys().next().value)
        sampleCache.set(key, { lat, lng, series })
      } catch {
        if (generation !== id) return
        sampleCache.set(key, { lat, lng, series: [] })
      }
    }

    const loadField = async () => {
      const id = generation + 1
      generation = id
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      const { points, step } = gridPoints(bounds, zoom)
      soft = Math.max(0.04, (step * step) / 8)
      if (!fieldRef.current.length) setStatus('loading')

      const jobs = []
      const seen = new Set()
      points.forEach((point) => {
        const key = cacheKey(modeRef.current, point.lat, point.lng)
        if (seen.has(key)) return
        seen.add(key)
        jobs.push(point)
      })

      let cursor = 0
      const worker = async () => {
        while (cursor < jobs.length) {
          const point = jobs[cursor]
          cursor += 1
          if (generation !== id) return
          await ensureSeries(point.lat, point.lng, id)
        }
      }

      await Promise.all([worker(), worker(), worker(), worker()])
      if (!alive || generation !== id) return
      applyField(bounds, step)
    }

    const rebuildFromCache = () => {
      fieldRef.current = []
      dirty = true
      setStatus('loading')
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      const { step } = gridPoints(bounds, zoom)
      soft = Math.max(0.04, (step * step) / 8)
      if (applyField(bounds, step)) return
      loadField()
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
      ctx.drawImage(heat, 0, 0, size.x, size.y)
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
      const rain = sampleField(field, event.latlng.lat, event.latlng.lng, soft)
      tip.textContent = `${rain.toFixed(1)} ${unitLabel()}`
      tip.style.display = 'block'
      const point = map.mouseEventToContainerPoint(event.originalEvent)
      tip.style.left = `${point.x + 14}px`
      tip.style.top = `${point.y + 14}px`
    }
    const onMouseOut = () => {
      tip.style.display = 'none'
    }

    const onModeChange = (event) => {
      if (event.detail?.mode !== 'recent' && event.detail?.mode !== 'forecast') return
      modeRef.current = event.detail.mode
      rebuildFromCache()
    }

    frameId = requestAnimationFrame(tick)
    map.on('move', markDirty)
    map.on('zoom', markDirty)
    map.on('resize', markDirty)
    map.on('moveend', scheduleLoad)
    map.on('zoomend', scheduleLoad)
    map.on('mousemove', onMouseMove)
    map.on('mouseout', onMouseOut)
    map.getContainer().addEventListener('rain-mode', onModeChange)
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
      map.getContainer().removeEventListener('rain-mode', onModeChange)
      tip.remove()
      canvas.remove()
    }
  }, [map])

  useEffect(() => {
    map.getContainer().dispatchEvent(
      new CustomEvent('rain-mode', { detail: { mode } })
    )
  }, [map, mode])

  return createPortal(
    <div className="rain-scale">
      <div className="rain-mode-toggle" role="group" aria-label="Rain time mode">
        <button
          type="button"
          className={`rain-mode-button ${mode === 'recent' ? 'active' : ''}`}
          onClick={() => setMode('recent')}
        >
          Recent
        </button>
        <button
          type="button"
          className={`rain-mode-button ${mode === 'forecast' ? 'active' : ''}`}
          onClick={() => setMode('forecast')}
        >
          Forecast
        </button>
      </div>
      {status === 'loading' && <span className="regional-wind-scale-note">Loading rain…</span>}
      {status === 'empty' && <span className="regional-wind-scale-note">Rain is unavailable</span>}
      {status === 'ready' && (
        <>
          <span className="rain-scale-unit">
            {mode === 'forecast' ? 'mm · next 3h' : 'mm · last 3h'}
          </span>
          <div className="rain-scale-bar">
            {RAIN_LABELS.map((value) => (
              <span key={value} style={{ left: `${(value / 30) * 100}%` }}>{value}</span>
            ))}
          </div>
        </>
      )}
    </div>,
    map.getContainer()
  )
}

export default RainFieldMap
