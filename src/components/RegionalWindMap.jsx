import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchHourlyWeatherData } from '../services/api'
import { fieldViewKey, fixedGridPoints, softFromStep } from '../utils/weatherFieldGrid'

// Windy-like wind speed ramp (km/h)
const WIND_STOPS = [
  [0, [122, 46, 158]],
  [8, [58, 74, 204]],
  [16, [32, 186, 214]],
  [28, [54, 196, 96]],
  [40, [230, 214, 48]],
  [55, [236, 132, 32]],
  [75, [220, 60, 40]],
  [100, [180, 28, 48]]
]

const WIND_LABELS = [0, 10, 20, 35, 55, 75, 100]
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

const currentRecord = (records) => {
  const now = Date.now()
  let best = null
  ;(records || []).forEach((record) => {
    const time = new Date(String(record.date || '').replace(' ', 'T').replace(/Z$/i, '') + 'Z').getTime()
    const localFallback = new Date(String(record.date || '').replace(' ', 'T')).getTime()
    const stamp = Number.isNaN(time) ? localFallback : time
    if (Number.isNaN(stamp) || stamp > now + 30 * 60 * 1000) return
    if (!best || stamp >= best.time) best = { record, time: stamp }
  })
  return best?.record || null
}

const windSpeedColor = (speed) => {
  const value = Math.max(0, Math.min(100, speed))
  let index = 1
  while (index < WIND_STOPS.length && WIND_STOPS[index][0] < value) index += 1
  const [startSpeed, start] = WIND_STOPS[index - 1]
  const [endSpeed, end] = WIND_STOPS[Math.min(index, WIND_STOPS.length - 1)]
  const t = endSpeed === startSpeed ? 0 : (value - startSpeed) / (endSpeed - startSpeed)
  const blend = t * t * (3 - 2 * t)
  return [
    Math.round(start[0] + (end[0] - start[0]) * blend),
    Math.round(start[1] + (end[1] - start[1]) * blend),
    Math.round(start[2] + (end[2] - start[2]) * blend)
  ]
}

const sampleField = (field, lat, lng, soft = 0.2) => {
  let east = 0
  let north = 0
  let speedTotal = 0
  let windWeight = 0
  let speedWeight = 0
  const cos = Math.cos((lat * Math.PI) / 180)
  field.forEach((point) => {
    const dLat = lat - point.lat
    const dLng = (lng - point.lng) * cos
    const weight = 1 / (dLat * dLat + dLng * dLng + soft * soft)
    const speed = point.speed != null
      ? point.speed
      : (point.u != null && point.v != null ? Math.hypot(point.u, point.v) : null)
    if (point.u != null && point.v != null) {
      east += point.u * weight
      north += point.v * weight
      windWeight += weight
    }
    if (speed != null) {
      speedTotal += speed * weight
      speedWeight += weight
    }
  })
  return {
    u: windWeight ? east / windWeight : null,
    v: windWeight ? north / windWeight : null,
    speed: speedWeight ? speedTotal / speedWeight : null
  }
}

const toSample = (point, data) => {
  const record = currentRecord(data?.hourly_records)
  if (!record) return null
  const speed = finiteOrNull(record.wind_speed)
  const direction = finiteOrNull(record.wind_direction)
  if (speed == null) return null
  const toward = direction == null ? null : (((direction + 180) % 360) * Math.PI) / 180
  return {
    lat: point.lat,
    lng: point.lng,
    speed,
    u: toward != null ? speed * Math.sin(toward) : null,
    v: toward != null ? speed * Math.cos(toward) : null
  }
}

const ensurePanes = (map) => {
  const ensure = (name, zIndex) => {
    const pane = map.getPane(name) || map.createPane(name)
    pane.style.zIndex = String(zIndex)
    pane.style.pointerEvents = 'none'
  }
  ensure('weatherField', 420)
  ensure('placeLabels', 640)
}

const RegionalWindMap = () => {
  const map = useMap()
  const [status, setStatus] = useState('loading')
  ensurePanes(map)

  useEffect(() => {
    const canvas = L.DomUtil.create('canvas', 'regional-wind-canvas', map.getPane('weatherField'))
    const tip = L.DomUtil.create('div', 'regional-wind-tip', map.getContainer())
    tip.style.display = 'none'
    const ctx = canvas.getContext('2d')
    const heat = document.createElement('canvas')
    heat.width = 180
    heat.height = 110
    const heatCtx = heat.getContext('2d', { willReadFrequently: true })
    // Persistent particle layer — fade each frame for smooth silk streaks (Windy-style)
    const trails = document.createElement('canvas')
    const tctx = trails.getContext('2d')
    const fieldRef = { current: [] }
    const particles = []
    let alive = true
    let frameId = 0
    let timer = 0
    let generation = 0
    let dirty = true
    let pixelWidth = 0
    let pixelHeight = 0
    let cssWidth = 0
    let cssHeight = 0
    let lastTime = performance.now()
    let lastViewKey = ''
    let soft = 0.2

    const clearTrails = () => {
      if (trails.width && trails.height) tctx.clearRect(0, 0, trails.width, trails.height)
    }

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
      if (size.x !== cssWidth || size.y !== cssHeight) {
        cssWidth = size.x
        cssHeight = size.y
        trails.width = Math.max(1, size.x)
        trails.height = Math.max(1, size.y)
        clearTrails()
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
          const sample = sampleField(field, latLng.lat, latLng.lng, soft)
          const color = sample.speed == null ? null : windSpeedColor(sample.speed)
          const offset = (y * heat.width + x) * 4
          if (!color) {
            pixels[offset + 3] = 0
            continue
          }
          pixels[offset] = color[0]
          pixels[offset + 1] = color[1]
          pixels[offset + 2] = color[2]
          // Slightly softer heat so particle streaks stay readable
          pixels[offset + 3] = 168
        }
      }
      heatCtx.putImageData(image, 0, 0)
    }

    const spawn = (bounds) => {
      const lat = bounds.getSouth() + Math.random() * (bounds.getNorth() - bounds.getSouth())
      const lng = bounds.getWest() + Math.random() * (bounds.getEast() - bounds.getWest())
      const point = map.latLngToContainerPoint([lat, lng])
      return {
        lat,
        lng,
        x: point.x,
        y: point.y,
        px: point.x,
        py: point.y,
        age: Math.random() * 0.35,
        life: 1.4 + Math.random() * 2.2,
        scale: 0.75 + Math.random() * 0.55,
        u: 0,
        v: 0,
        speed: 0
      }
    }

    const remapParticles = () => {
      clearTrails()
      particles.forEach((particle) => {
        const point = map.latLngToContainerPoint([particle.lat, particle.lng])
        particle.x = point.x
        particle.y = point.y
        particle.px = point.x
        particle.py = point.y
      })
    }

    const pointsNearView = (bounds, pad, date) => {
      const south = bounds.getSouth() - pad
      const north = bounds.getNorth() + pad
      const west = bounds.getWest() - pad
      const east = bounds.getEast() + pad
      const samples = []
      sampleCache.forEach((sample, key) => {
        if (!sample || !key.startsWith(`w3:${date}:`)) return
        if (sample.lat < south || sample.lat > north || sample.lng < west || sample.lng > east) return
        samples.push(sample)
      })
      return samples
    }

    const loadField = async (force = false) => {
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      const { points, step } = fixedGridPoints(bounds, zoom, 48)
      const viewKey = fieldViewKey(bounds, zoom, step)
      if (!force && viewKey === lastViewKey && fieldRef.current.length) {
        soft = softFromStep(step)
        dirty = true
        return
      }
      lastViewKey = viewKey

      const id = generation + 1
      generation = id
      const date = todayDate()
      soft = softFromStep(step)
      if (!fieldRef.current.length) setStatus('loading')

      const unique = []
      const seen = new Set()
      points.forEach((point) => {
        const key = `w3:${date}:${point.lat}:${point.lng}`
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
            const sample = toSample(point, data)
            if (!sample) continue
            if (sampleCache.size > 280) sampleCache.delete(sampleCache.keys().next().value)
            sampleCache.set(point.key, sample)
          } catch {
            // keep empty cell
          }
        }
      }

      await Promise.all([worker(), worker(), worker(), worker(), worker()])
      if (!alive || generation !== id) return
      const ready = pointsNearView(bounds, Math.max(step * 2.5, 1), date)
      if (ready.length) {
        fieldRef.current = ready
        dirty = true
        setStatus('ready')
      } else if (!fieldRef.current.length) {
        setStatus('empty')
      }
    }

    const tick = (now) => {
      if (!alive) return
      frameId = requestAnimationFrame(tick)
      const size = syncCanvas()
      const seconds = Math.min(0.05, Math.max(0.008, (now - lastTime) / 1000))
      lastTime = now
      const field = fieldRef.current
      ctx.clearRect(0, 0, size.x, size.y)
      if (!field.length) return

      if (dirty) {
        paintHeat(size)
        dirty = false
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.globalAlpha = 0.78
      ctx.drawImage(heat, 0, 0, size.x, size.y)
      ctx.globalAlpha = 1

      if (document.hidden) {
        ctx.drawImage(trails, 0, 0)
        return
      }

      // Soft fade leaves continuous silk trails instead of discrete segments
      tctx.globalCompositeOperation = 'destination-out'
      tctx.fillStyle = 'rgba(0, 0, 0, 0.065)'
      tctx.fillRect(0, 0, size.x, size.y)
      tctx.globalCompositeOperation = 'source-over'
      tctx.lineCap = 'round'
      tctx.lineJoin = 'round'

      const bounds = map.getBounds()
      const desired = Math.round(Math.min(2200, Math.max(900, (size.x * size.y) / 720)))
      if (particles.length > desired) particles.length = desired
      while (particles.length < desired) particles.push(spawn(bounds))

      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i]
        const wind = sampleField(field, particle.lat, particle.lng, soft)
        if (wind.u == null || wind.v == null) {
          Object.assign(particle, spawn(bounds))
          continue
        }

        const blend = 1 - Math.exp(-seconds * 6.5)
        particle.u += (wind.u - particle.u) * blend
        particle.v += (wind.v - particle.v) * blend
        const speed = Math.hypot(particle.u, particle.v)
        particle.speed = speed
        if (speed < 0.05) {
          Object.assign(particle, spawn(bounds))
          continue
        }

        particle.px = particle.x
        particle.py = particle.y
        const flow = Math.max(36, Math.min(130, 30 + speed * 2.1)) * particle.scale
        particle.x += (particle.u / speed) * flow * seconds
        particle.y -= (particle.v / speed) * flow * seconds
        particle.age += seconds / particle.life

        const outside =
          particle.x < -40 ||
          particle.y < -40 ||
          particle.x > size.x + 40 ||
          particle.y > size.y + 40
        if (outside || particle.age >= 1) {
          Object.assign(particle, spawn(bounds))
          continue
        }

        const latLng = map.containerPointToLatLng([particle.x, particle.y])
        particle.lat = latLng.lat
        particle.lng = latLng.lng

        const move = Math.hypot(particle.x - particle.px, particle.y - particle.py)
        if (move < 0.35) continue

        const alpha = Math.sin(Math.min(1, particle.age) * Math.PI) * 0.9
        const width = 0.7 + Math.min(1.8, speed / 55)

        // Dark under-stroke for contrast on bright yellow/green cells
        tctx.beginPath()
        tctx.moveTo(particle.px, particle.py)
        tctx.lineTo(particle.x, particle.y)
        tctx.strokeStyle = `rgba(10, 16, 36, ${alpha * 0.45})`
        tctx.lineWidth = width + 1.35
        tctx.stroke()

        // Bright head streak
        tctx.beginPath()
        tctx.moveTo(particle.px, particle.py)
        tctx.lineTo(particle.x, particle.y)
        tctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
        tctx.lineWidth = width
        tctx.stroke()
      }

      ctx.drawImage(trails, 0, 0)
    }

    const markDirty = () => {
      dirty = true
      remapParticles()
    }
    const scheduleLoad = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => loadField(false), 400)
    }
    const onMouseMove = (event) => {
      const field = fieldRef.current
      if (!field.length) {
        tip.style.display = 'none'
        return
      }
      const sample = sampleField(field, event.latlng.lat, event.latlng.lng, soft)
      const speed = sample.speed != null
        ? sample.speed
        : (sample.u != null && sample.v != null ? Math.hypot(sample.u, sample.v) : null)
      if (speed == null) {
        tip.style.display = 'none'
        return
      }
      tip.textContent = `${speed.toFixed(1)} km/h`
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
    map.on('resize', markDirty) // paint only — no API reload
    map.on('moveend', scheduleLoad)
    map.on('zoomend', scheduleLoad)
    map.on('mousemove', onMouseMove)
    map.on('mouseout', onMouseOut)
    loadField(true)

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
    <div className="weather-scale regional-wind-scale">
      {status === 'loading' && <span className="weather-scale-note">Loading wind…</span>}
      {status === 'empty' && <span className="weather-scale-note">Wind unavailable</span>}
      {status === 'ready' && (
        <>
          <span className="weather-scale-title">Wind</span>
          <span className="weather-scale-unit">km/h</span>
          <div
            className="weather-scale-bar regional-wind-scale-bar"
            style={{
              background: 'linear-gradient(90deg, #7a2e9e 0%, #3a4acc 14%, #20bad6 28%, #36c460 48%, #e6d630 68%, #ec8418 84%, #c6242a 100%)'
            }}
          >
            {WIND_LABELS.map((value) => (
              <span key={value} style={{ left: `${value}%` }}>{value}</span>
            ))}
          </div>
        </>
      )}
    </div>,
    map.getContainer()
  )
}

export default RegionalWindMap
