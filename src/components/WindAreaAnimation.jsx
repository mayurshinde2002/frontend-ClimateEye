import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { pointInGeometry } from '../utils/polygonIndex'

const boundsOf = (ring) => {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  ring.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  })
  return { minLng, minLat, maxLng, maxLat }
}

const spawnParticle = (geometry, ring, box) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const lng = box.minLng + Math.random() * (box.maxLng - box.minLng)
    const lat = box.minLat + Math.random() * (box.maxLat - box.minLat)
    if (!pointInGeometry([lng, lat], geometry)) continue
    return {
      lng,
      lat,
      age: Math.random(),
      jitter: (Math.random() - 0.5) * 12,
      speedScale: 0.72 + Math.random() * 0.55,
      length: 0.65 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
      tone: Math.random()
    }
  }
  if (!ring?.length) return null
  const [lng, lat] = ring[0]
  return { lng, lat, age: 0, jitter: 0, speedScale: 1, length: 1, phase: 0, tone: 0.5 }
}

const clipToGeometry = (ctx, map, geometry) => {
  const rings = geometry?.coordinates
  if (!rings?.[0]?.length) return false
  ctx.beginPath()
  rings.forEach((ring) => {
    ring.forEach(([lng, lat], index) => {
      const point = map.latLngToContainerPoint([lat, lng])
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.closePath()
  })
  ctx.clip('evenodd')
  return true
}

const WindAreaAnimation = ({ geometry, speedKmh, directionFrom }) => {
  const map = useMap()
  const latest = useRef({ geometry, speedKmh, directionFrom })
  latest.current = { geometry, speedKmh, directionFrom }

  useEffect(() => {
    const paneName = 'windAnimation'
    if (!map.getPane(paneName)) {
      const pane = map.createPane(paneName)
      pane.style.zIndex = '450'
      pane.style.pointerEvents = 'none'
    }

    const canvas = L.DomUtil.create('canvas', 'wind-animation-canvas', map.getPane(paneName))
    const ctx = canvas.getContext('2d')
    const particles = []
    let alive = true
    let frameId = 0
    let lastTime = performance.now()
    let pixelWidth = 0
    let pixelHeight = 0

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
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
      return size
    }

    const tick = (now) => {
      if (!alive) return
      frameId = requestAnimationFrame(tick)
      const size = syncCanvas()
      const dt = Math.min(2.2, (now - lastTime) / 16.67)
      lastTime = now
      ctx.clearRect(0, 0, size.x, size.y)

      const { geometry: area, speedKmh: speed, directionFrom: from } = latest.current
      const ring = area?.coordinates?.[0]
      if (!ring?.length || speed == null || from == null || speed <= 0) {
        particles.length = 0
        return
      }
      if (document.hidden) return

      const box = boundsOf(ring)
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      ring.forEach(([lng, lat]) => {
        const point = map.latLngToContainerPoint([lat, lng])
        if (point.x < minX) minX = point.x
        if (point.y < minY) minY = point.y
        if (point.x > maxX) maxX = point.x
        if (point.y > maxY) maxY = point.y
      })
      const visibleArea = Math.max(0, maxX - minX) * Math.max(0, maxY - minY)
      const desired = Math.round(Math.min(380, Math.max(48, visibleArea / 1600)))
      if (particles.length > desired) particles.length = desired
      while (particles.length < desired) {
        const particle = spawnParticle(area, ring, box)
        if (!particle) break
        particles.push(particle)
      }

      const toward = ((from + 180) % 360) * (Math.PI / 180)
      const flow = Math.max(0.42, Math.min(2.15, 0.28 + speed / 26))
      const streak = Math.max(14, Math.min(34, 12 + speed * 0.32))

      ctx.save()
      if (!clipToGeometry(ctx, map, area)) {
        ctx.restore()
        return
      }
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      particles.forEach((particle) => {
        const angle = toward + particle.jitter * (Math.PI / 180)
        const head = map.latLngToContainerPoint([particle.lat, particle.lng])
        const step = flow * particle.speedScale * dt
        const nextPoint = map.containerPointToLatLng([
          head.x + Math.sin(angle) * step,
          head.y - Math.cos(angle) * step
        ])
        particle.lat = nextPoint.lat
        particle.lng = nextPoint.lng
        particle.age += 0.008 * dt

        if (particle.age >= 1 || !pointInGeometry([particle.lng, particle.lat], area)) {
          const fresh = spawnParticle(area, ring, box)
          if (fresh) Object.assign(particle, fresh, { age: 0 })
          return
        }

        const drawnHead = map.latLngToContainerPoint([particle.lat, particle.lng])
        const length = streak * particle.length
        const tailX = drawnHead.x - Math.sin(angle) * length
        const tailY = drawnHead.y + Math.cos(angle) * length
        const wobble = Math.sin(particle.age * 5 + particle.phase) * 1.6
        const midX = (drawnHead.x + tailX) / 2 - Math.cos(angle) * wobble
        const midY = (drawnHead.y + tailY) / 2 - Math.sin(angle) * wobble
        const alpha = Math.sin(particle.age * Math.PI)
        const core = particle.tone > 0.72 ? '255, 255, 255' : '186, 250, 240'

        ctx.beginPath()
        ctx.moveTo(tailX, tailY)
        ctx.quadraticCurveTo(midX, midY, drawnHead.x, drawnHead.y)
        ctx.strokeStyle = `rgba(15, 118, 110, ${alpha * 0.28})`
        ctx.lineWidth = 2.4
        ctx.stroke()

        const gradient = ctx.createLinearGradient(tailX, tailY, drawnHead.x, drawnHead.y)
        gradient.addColorStop(0, `rgba(${core}, 0)`)
        gradient.addColorStop(0.55, `rgba(${core}, ${alpha * 0.45})`)
        gradient.addColorStop(1, `rgba(${core}, ${alpha * 0.95})`)
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.25
        ctx.stroke()
      })

      ctx.restore()
    }

    frameId = requestAnimationFrame(tick)

    return () => {
      alive = false
      cancelAnimationFrame(frameId)
      canvas.remove()
    }
  }, [map])

  return null
}

export default WindAreaAnimation
