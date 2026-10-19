import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchHourlyWeatherData } from '../services/api'

const WIND_STOPS = [
  [0, [122, 46, 158]],
  [10, [58, 74, 204]],
  [20, [32, 186, 214]],
  [35, [54, 196, 96]],
  [55, [230, 214, 48]],
  [70, [236, 132, 32]],
  [100, [198, 36, 42]]
]

const WIND_LABELS = [0, 10, 20, 35, 55, 70, 100]

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
    const time = new Date(String(record.date || '').replace(' ', 'T')).getTime()
    if (Number.isNaN(time) || time > now) return
    if (!best || time >= best.time) best = { record, time }
  })
  return best?.record || null
}

const windSpeedColor = (speed) => {
  const value = Math.max(0, Math.min(100, speed))
  let index = 1
  while (index < WIND_STOPS.length && WIND_STOPS[index][0] < value) index += 1
  const [startSpeed, start] = WIND_STOPS[index - 1]
  const [endSpeed, end] = WIND_STOPS[Math.min(index, WIND_STOPS.length - 1)]
  const blend = endSpeed === startSpeed ? 0 : (value - startSpeed) / (endSpeed - startSpeed)
  return [
    Math.round(start[0] + (end[0] - start[0]) * blend),
    Math.round(start[1] + (end[1] - start[1]) * blend),
    Math.round(start[2] + (end[2] - start[2]) * blend)
  ]
}

const sampleField = (field, lat, lng) => {
  let east = 0
  let north = 0
  let speedTotal = 0
  let windWeight = 0
  let speedWeight = 0
  const cos = Math.cos((lat * Math.PI) / 180)
  field.forEach((point) => {
    const dLat = lat - point.lat
    const dLng = (lng - point.lng) * cos
    const weight = 1 / (dLat * dLat + dLng * dLng + 0.25)
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

const gridPoints = (bounds) => {
  const south = bounds.getSouth()
  const north = bounds.getNorth()
  const west = bounds.getWest()
  const east = bounds.getEast()
  const step = Math.max(north - south, east - west) > 20 ? 2 : 1
  const points = []
  const seen = new Set()
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const lat = Math.round((south + ((row + 0.5) * (north - south)) / 3) / step) * step
      const lng = Math.round((west + ((col + 0.5) * (east - west)) / 4) / step) * step
      const key = `${lat}:${lng}`
      if (seen.has(key)) continue
      seen.add(key)
      points.push({ lat, lng })
    }
  }
  return points
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
    heat.width = 110
    heat.height = 64
    const heatCtx = heat.getContext('2d', { willReadFrequently: true })
    const fieldRef = { current: [] }
    const particles = []
    let alive = true
    let frameId = 0
    let timer = 0
    let generation = 0
    let dirty = true
    let pixelWidth = 0
    let pixelHeight = 0
    let lastTime = performance.now()

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
          const sample = sampleField(field, latLng.lat, latLng.lng)
          const color = sample.speed == null ? null : windSpeedColor(sample.speed)
          const offset = (y * heat.width + x) * 4
          if (!color) {
            pixels[offset + 3] = 0
            continue
          }
          pixels[offset] = color[0]
          pixels[offset + 1] = color[1]
          pixels[offset + 2] = color[2]
          pixels[offset + 3] = 214
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
        age: Math.random(),
        life: 0.55 + Math.random() * 0.7,
        scale: 0.7 + Math.random() * 0.55,
        u: 0,
        v: 0,
        trail: []
      }
    }

    const remapParticles = () => {
      particles.forEach((particle) => {
        const point = map.latLngToContainerPoint([particle.lat, particle.lng])
        particle.x = point.x
        particle.y = point.y
        particle.trail = []
      })
    }

    const loadField = async () => {
      const id = generation + 1
      generation = id
      const date = todayDate()
      const points = gridPoints(map.getBounds())
      const unique = []
      const seen = new Set()
      points.forEach((point) => {
        const key = `${date}:${point.lat}:${point.lng}`
        if (seen.has(key)) return
        seen.add(key)
        unique.push({ ...point, key })
      })

      const samples = []
      let cursor = 0
      const worker = async () => {
        while (cursor < unique.length) {
          const point = unique[cursor]
          cursor += 1
          if (generation !== id) return
          if (sampleCache.has(point.key)) {
            samples.push(sampleCache.get(point.key))
            continue
          }
          try {
            const data = await fetchHourlyWeatherData(point.lat, point.lng, date)
            if (generation !== id) return
            const sample = toSample(point, data)
            if (!sample) continue
            if (sampleCache.size > 120) sampleCache.delete(sampleCache.keys().next().value)
            sampleCache.set(point.key, sample)
            samples.push(sample)
          } catch {
            // A missing cell stays empty; neighboring samples still draw the field.
          }
        }
      }

      await Promise.all([worker(), worker(), worker(), worker()])
      if (!alive || generation !== id) return
      const ready = samples.filter(Boolean)
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
      const seconds = Math.min(0.33, Math.max(0.008, (now - lastTime) / 1000))
      lastTime = now
      const field = fieldRef.current
      ctx.clearRect(0, 0, size.x, size.y)
      if (!field.length) return

      if (dirty) {
        paintHeat(size)
        dirty = false
      }
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(heat, 0, 0, size.x, size.y)

      if (document.hidden) return
      const bounds = map.getBounds()
      const desired = Math.round(Math.min(720, Math.max(320, (size.x * size.y) / 2200)))
      if (particles.length > desired) particles.length = desired
      while (particles.length < desired) particles.push(spawn(bounds))

      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      particles.forEach((particle) => {
        const wind = sampleField(field, particle.lat, particle.lng)
        if (wind.u == null || wind.v == null) {
          Object.assign(particle, spawn(bounds))
          return
        }

        const blend = 1 - Math.exp(-seconds * 4.5)
        particle.u += (wind.u - particle.u) * blend
        particle.v += (wind.v - particle.v) * blend
        const speed = Math.hypot(particle.u, particle.v)
        if (speed < 0.08) {
          Object.assign(particle, spawn(bounds))
          return
        }

        const flow = Math.max(24, Math.min(72, 18 + speed * 1.35)) * particle.scale
        const dx = (particle.u / speed) * flow * seconds
        const dy = -(particle.v / speed) * flow * seconds
        particle.x += dx
        particle.y += dy
        particle.age += seconds / particle.life

        const outside = particle.x < -20 || particle.y < -20 || particle.x > size.x + 20 || particle.y > size.y + 20
        if (outside || particle.age >= 1) {
          Object.assign(particle, spawn(bounds))
          return
        }

        const latLng = map.containerPointToLatLng([particle.x, particle.y])
        particle.lat = latLng.lat
        particle.lng = latLng.lng
        particle.trail.push({ x: particle.x, y: particle.y })
        if (particle.trail.length > 28) particle.trail.shift()
        if (particle.trail.length < 2) return

        const alpha = Math.sin(particle.age * Math.PI) * 0.7
        const trail = particle.trail
        for (let index = 1; index < trail.length; index += 1) {
          const start = trail[index - 1]
          const end = trail[index]
          const fade = (index / trail.length) * alpha
          ctx.beginPath()
          ctx.moveTo(start.x, start.y)
          ctx.lineTo(end.x, end.y)
          ctx.strokeStyle = `rgba(255, 255, 255, ${fade})`
          ctx.lineWidth = 1 + (index / trail.length) * 1.50
          ctx.stroke()
        }
      })
    }

    const markDirty = () => {
      dirty = true
      remapParticles()
    }
    const scheduleLoad = () => {
      clearTimeout(timer)
      timer = window.setTimeout(loadField, 700)
    }
    const onMouseMove = (event) => {
      const field = fieldRef.current
      if (!field.length) {
        tip.style.display = 'none'
        return
      }
      const sample = sampleField(field, event.latlng.lat, event.latlng.lng)
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
    map.on('moveend', scheduleLoad)
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
      map.off('moveend', scheduleLoad)
      map.off('mousemove', onMouseMove)
      map.off('mouseout', onMouseOut)
      tip.remove()
      canvas.remove()
    }
  }, [map])

  return createPortal(
    <div className="regional-wind-scale">
      {status === 'loading' && <span className="regional-wind-scale-note">Loading regional wind…</span>}
      {status === 'empty' && <span className="regional-wind-scale-note">Regional wind is unavailable</span>}
      {status === 'ready' && (
        <>
          <span className="regional-wind-scale-unit">km/h</span>
          <div className="regional-wind-scale-bar">
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
