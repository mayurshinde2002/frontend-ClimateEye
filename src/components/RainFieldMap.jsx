import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchHourlyWeatherData, fetchOpenMeteoRainForecast } from '../services/api'
import { fieldViewKey, fixedGridPoints, softFromStep } from '../utils/weatherFieldGrid'

// Windy-like "Rain, thunder" ramp (mm / 3h) — dry stays transparent
const DRY_MM = 0.15
const RAIN_STOPS = [
  [0.15, [140, 200, 255]],
  [0.5, [70, 170, 255]],
  [1, [20, 200, 210]],
  [2, [30, 210, 120]],
  [4, [150, 230, 50]],
  [8, [255, 220, 40]],
  [15, [255, 140, 30]],
  [25, [230, 45, 55]],
  [40, [170, 40, 200]]
]

const RAIN_LABELS = [0.15, 1, 2, 4, 8, 15, 25]
// Higher budget than temp/wind so world zoom keeps enough cells to form a sheet
const MAX_POINTS = 96
const WINDOW_HOURS = 3
const HEAT_W = 420
const HEAT_H = 260
const sampleCache = new Map()

const smoothstep = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const rainColor = (rain) => {
  if (rain == null || rain < DRY_MM) return null
  const value = Math.max(DRY_MM, Math.min(40, rain))
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

const sampleField = (field, lat, lng, soft = 0.14) => {
  if (!field.length) return 0
  let rain = 0
  let weightTotal = 0
  const cos = Math.cos((lat * Math.PI) / 180)
  // Wider reach than one cell so coarse (world) lattices merge into a sheet
  const sigma = Math.max(0.1, soft)
  const reach = sigma * 4.8
  field.forEach((point) => {
    if (point.rain == null) return
    const dLat = lat - point.lat
    const dLng = (lng - point.lng) * cos
    const dist2 = dLat * dLat + dLng * dLng
    if (dist2 > reach * reach) return
    const weight = Math.exp(-dist2 / (2 * sigma * sigma))
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
    heat.width = HEAT_W
    heat.height = HEAT_H
    const heatCtx = heat.getContext('2d', { willReadFrequently: true })
    const fieldRef = { current: [] }
    let alive = true
    let frameId = 0
    let timer = 0
    let generation = 0
    let dirty = true
    let pixelWidth = 0
    let pixelHeight = 0
    let soft = 0.14
    let latticeStep = 0.5
    let lastViewKey = ''

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

    // After maxPoints thinning, neighbors can be far apart — use real spacing,
    // not latticeStep, or world view paints isolated circles around each cell.
    const spacingFromField = (field) => {
      if (field.length < 3) return Math.max(latticeStep, 1)
      let total = 0
      let count = 0
      const probes = Math.min(field.length, 28)
      for (let i = 0; i < probes; i += 1) {
        const a = field[(i * 11) % field.length]
        let best = Infinity
        for (let j = 0; j < field.length; j += 1) {
          const b = field[j]
          if (a === b) continue
          const dLat = a.lat - b.lat
          const dLng = (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180)
          const dist = Math.hypot(dLat, dLng)
          if (dist > 0.05 && dist < best) best = dist
        }
        if (best < Infinity) {
          total += best
          count += 1
        }
      }
      return count ? total / count : Math.max(latticeStep, 1)
    }

    const paintSoftForField = (field) => {
      const spacing = spacingFromField(field)
      // ~0.7× neighbor distance → cells merge into a continuous sheet
      return Math.max(0.2, Math.min(8, spacing * 0.72))
    }

    let paintSoft = 0.3

    const paintHeat = (size) => {
      const field = fieldRef.current
      const image = heatCtx.createImageData(HEAT_W, HEAT_H)
      const pixels = image.data
      paintSoft = paintSoftForField(field)

      for (let y = 0; y < HEAT_H; y += 1) {
        for (let x = 0; x < HEAT_W; x += 1) {
          const latLng = map.containerPointToLatLng([
            ((x + 0.5) * size.x) / HEAT_W,
            ((y + 0.5) * size.y) / HEAT_H
          ])
          const rain = sampleField(field, latLng.lat, latLng.lng, paintSoft)
          const offset = (y * HEAT_W + x) * 4
          const color = rainColor(rain)
          if (!color) {
            pixels[offset + 3] = 0
            continue
          }
          const edge = smoothstep(DRY_MM, DRY_MM + 1.1, rain)
          const body = 0.3 + smoothstep(DRY_MM, 18, rain) * 0.4
          pixels[offset] = color[0]
          pixels[offset + 1] = color[1]
          pixels[offset + 2] = color[2]
          pixels[offset + 3] = Math.round(edge * body * 255)
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

    const mergeField = (bounds, step) => {
      const pad = Math.max(step * 2.5, 1)
      const samples = buildField(bounds, pad)
      if (!samples.length) return false
      const south = bounds.getSouth() - pad
      const north = bounds.getNorth() + pad
      const west = bounds.getWest() - pad
      const east = bounds.getEast() + pad
      const byKey = new Map()
      // Keep prior samples that still sit near the view (resize must not drop them)
      fieldRef.current.forEach((point) => {
        if (point.lat < south || point.lat > north || point.lng < west || point.lng > east) return
        byKey.set(`${point.lat}:${point.lng}`, point)
      })
      samples.forEach((point) => {
        byKey.set(`${point.lat}:${point.lng}`, point)
      })
      fieldRef.current = [...byKey.values()]
      dirty = true
      setStatus('ready')
      return fieldRef.current.length > 0
    }

    const applyField = (bounds, step) => {
      if (mergeField(bounds, step)) return true
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

    const loadField = async (force = false) => {
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      const { points, step } = fixedGridPoints(bounds, zoom, MAX_POINTS)
      const viewKey = `${modeRef.current}:${fieldViewKey(bounds, zoom, step)}`
      // Same center/zoom (e.g. window resize): keep lattice, only refresh paint.
      if (!force && viewKey === lastViewKey && fieldRef.current.length) {
        latticeStep = step
        soft = Math.max(0.1, softFromStep(step))
        mergeField(bounds, step)
        dirty = true
        return
      }
      lastViewKey = viewKey

      const id = generation + 1
      generation = id
      latticeStep = step
      soft = Math.max(0.1, softFromStep(step))
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
      lastViewKey = ''
      setStatus('loading')
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      const { step } = fixedGridPoints(bounds, zoom, MAX_POINTS)
      latticeStep = step
      soft = Math.max(0.1, softFromStep(step))
      if (applyField(bounds, step)) {
        lastViewKey = `${modeRef.current}:${fieldViewKey(bounds, zoom, step)}`
        return
      }
      loadField(true)
    }

    const tick = () => {
      if (!alive) return
      frameId = requestAnimationFrame(tick)
      const size = syncCanvas()
      const field = fieldRef.current
      ctx.clearRect(0, 0, size.x, size.y)
      if (!field.length) return

      if (dirty) {
        paintHeat(size)
        dirty = false
      }

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      // More blur when samples are sparse (world load) so circles fuse visually
      const blurPx = paintSoft >= 3 ? 3.2 : paintSoft >= 1.2 ? 2 : 0.7
      ctx.filter = `blur(${blurPx}px)`
      ctx.globalAlpha = 0.92
      ctx.drawImage(heat, 0, 0, size.x, size.y)
      ctx.filter = 'none'
      ctx.globalAlpha = 1
    }

    // Pan/zoom animation: repaint only. Resize must not rebuild the sample set.
    const markDirty = () => { dirty = true }
    const onResize = () => { dirty = true }
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
      const rain = sampleField(field, event.latlng.lat, event.latlng.lng, paintSoft || soft)
      tip.textContent = rain < DRY_MM
        ? `Dry · ${unitLabel()}`
        : `${rain.toFixed(1)} ${unitLabel()}`
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
    map.on('resize', onResize)
    map.on('moveend', scheduleLoad)
    map.on('zoomend', scheduleLoad)
    map.on('mousemove', onMouseMove)
    map.on('mouseout', onMouseOut)
    map.getContainer().addEventListener('rain-mode', onModeChange)
    loadField(true)

    return () => {
      alive = false
      generation += 1
      clearTimeout(timer)
      cancelAnimationFrame(frameId)
      map.off('move', markDirty)
      map.off('zoom', markDirty)
      map.off('resize', onResize)
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
    <div className="weather-scale rain-scale">
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
      {status === 'loading' && <span className="weather-scale-note">Loading rain…</span>}
      {status === 'empty' && <span className="weather-scale-note">Rain unavailable</span>}
      {status === 'ready' && (
        <>
          <span className="weather-scale-title">Rain</span>
          <span className="weather-scale-unit rain-scale-unit">
            {mode === 'forecast' ? 'mm · 3h' : 'mm · 3h'}
          </span>
          <div
            className="weather-scale-bar rain-scale-bar"
            style={{
              background: 'linear-gradient(90deg, #8cc8ff 0%, #46aaff 12%, #14c8d2 26%, #1ed278 40%, #96e632 55%, #ffdc28 70%, #ff8c1e 85%, #e62d37 100%)'
            }}
          >
            {RAIN_LABELS.map((value) => (
              <span key={value} style={{ left: `${((value - DRY_MM) / (25 - DRY_MM)) * 100}%` }}>
                {value}
              </span>
            ))}
          </div>
        </>
      )}
    </div>,
    map.getContainer()
  )
}

export default RainFieldMap
