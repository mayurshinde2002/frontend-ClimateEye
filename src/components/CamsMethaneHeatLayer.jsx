import { useEffect, useMemo } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { pointInGeometry } from '../utils/polygonIndex'

const HEAT_W = 640
const HEAT_H = 440

const DEFAULT_PALETTE = [
  '#000004',
  '#1b0c41',
  '#4a0c6b',
  '#781c6d',
  '#a52c60',
  '#cf4446',
  '#ed6925',
  '#fb9b06',
  '#fcffa4'
]

const hexToRgb = (hex) => {
  const raw = String(hex || '').replace('#', '')
  if (raw.length !== 6) return [27, 12, 65]
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16)
  ]
}

const lerpColor = (a, b, t) => ([
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t)
])

const colorAt = (value, legend, paletteRgb) => {
  if (!Number.isFinite(value)) return null
  const min = Number(legend?.min) || 0
  const max = Number(legend?.max) || 3000
  if (max <= min) return paletteRgb[Math.floor(paletteRgb.length / 2)]
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const scaled = t * (paletteRgb.length - 1)
  const i = Math.floor(scaled)
  const j = Math.min(paletteRgb.length - 1, i + 1)
  const local = scaled - i
  const smooth = local * local * (3 - 2 * local)
  return lerpColor(paletteRgb[i], paletteRgb[j], smooth)
}

const estimateSoft = (field) => {
  if (!field?.length) return 0.08
  if (field.length === 1) return 0.18
  let sum = 0
  let count = 0
  for (let i = 0; i < field.length; i += 1) {
    const a = field[i]
    const cos = Math.cos((a.lat * Math.PI) / 180)
    let best = Infinity
    for (let j = 0; j < field.length; j += 1) {
      if (i === j) continue
      const b = field[j]
      const dLat = a.lat - b.lat
      const dLng = (a.lng - b.lng) * cos
      const dist = Math.sqrt(dLat * dLat + dLng * dLng)
      if (dist > 0 && dist < best) best = dist
    }
    if (Number.isFinite(best)) {
      sum += best
      count += 1
    }
  }
  const mean = count ? sum / count : 0.2
  return Math.max(0.08, Math.min(0.35, mean * 0.9))
}

/**
 * IDW blend across CAMS samples. With one sample, paints a continuous field
 * over the whole AOI (CAMS cell is large; AOI is the coverage we show).
 */
const sampleBlended = (field, lat, lng, soft) => {
  if (!field.length) return null
  if (field.length === 1) {
    return { value: field[0].value, nearest: field[0] }
  }

  const cos = Math.cos((lat * Math.PI) / 180)
  let nearest = null
  let nearestDist = Infinity
  let sum = 0
  let weightTotal = 0

  field.forEach((point) => {
    const dLat = lat - point.lat
    const dLng = (lng - point.lng) * cos
    const dist = Math.sqrt(dLat * dLat + dLng * dLng)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = point
    }
    const weight = 1 / (dist + soft) ** 2
    sum += point.value * weight
    weightTotal += weight
  })

  if (!weightTotal || !nearest) return null
  return { value: sum / weightTotal, nearest }
}

const CamsHeatCanvas = ({ geometry, field, legend }) => {
  const map = useMap()

  useEffect(() => {
    if (!geometry || !field?.length) return undefined

    const pane = map.getPane('camsMethaneHeat') || map.createPane('camsMethaneHeat')
    pane.style.zIndex = '455'
    pane.style.pointerEvents = 'none'

    const canvas = L.DomUtil.create('canvas', 'methane-heat-canvas', pane)
    const tip = L.DomUtil.create('div', 'regional-wind-tip methane-heat-tip', map.getContainer())
    tip.style.display = 'none'
    const ctx = canvas.getContext('2d')
    const heat = document.createElement('canvas')
    heat.width = HEAT_W
    heat.height = HEAT_H
    const heatCtx = heat.getContext('2d', { willReadFrequently: true })

    let alive = true
    let frameId = 0
    let dirty = true
    let pixelWidth = 0
    let pixelHeight = 0
    const soft = estimateSoft(field)
    const paletteRgb = (legend?.palette?.length ? legend.palette : DEFAULT_PALETTE).map(hexToRgb)

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
      const image = heatCtx.createImageData(HEAT_W, HEAT_H)
      const pixels = image.data

      for (let y = 0; y < HEAT_H; y += 1) {
        for (let x = 0; x < HEAT_W; x += 1) {
          const offset = (y * HEAT_W + x) * 4
          const latLng = map.containerPointToLatLng([
            ((x + 0.5) * size.x) / HEAT_W,
            ((y + 0.5) * size.y) / HEAT_H
          ])
          if (!pointInGeometry([latLng.lng, latLng.lat], geometry)) {
            pixels[offset + 3] = 0
            continue
          }
          const blended = sampleBlended(field, latLng.lat, latLng.lng, soft)
          const color = colorAt(blended?.value, legend, paletteRgb)
          if (!color) {
            pixels[offset + 3] = 0
            continue
          }
          pixels[offset] = color[0]
          pixels[offset + 1] = color[1]
          pixels[offset + 2] = color[2]
          pixels[offset + 3] = 175
        }
      }
      heatCtx.putImageData(image, 0, 0)
    }

    const tick = () => {
      if (!alive) return
      frameId = requestAnimationFrame(tick)
      const size = syncCanvas()
      ctx.clearRect(0, 0, size.x, size.y)
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

    const onMouseMove = (event) => {
      if (!pointInGeometry([event.latlng.lng, event.latlng.lat], geometry)) {
        tip.style.display = 'none'
        return
      }
      const blended = sampleBlended(field, event.latlng.lat, event.latlng.lng, soft)
      if (blended?.value == null) {
        tip.style.display = 'none'
        return
      }
      const unit = legend?.unit || 'μg/m³'
      tip.textContent = `CH₄ ${blended.value.toFixed(1)} ${unit}`
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
    map.on('mousemove', onMouseMove)
    map.on('mouseout', onMouseOut)

    return () => {
      alive = false
      cancelAnimationFrame(frameId)
      map.off('move', markDirty)
      map.off('zoom', markDirty)
      map.off('resize', markDirty)
      map.off('mousemove', onMouseMove)
      map.off('mouseout', onMouseOut)
      tip.remove()
      canvas.remove()
    }
  }, [map, geometry, field, legend])

  return null
}

/**
 * Fills the drawn AOI with a continuous CAMS methane gradient only (no sample markers).
 */
const CamsMethaneHeatLayer = ({ methaneOverlay, geometry }) => {
  const field = useMemo(() => {
    const features = methaneOverlay?.features || []
    return features
      .map((feature, index) => {
        const props = feature.properties || {}
        const value = Number(props.methane_ug_m3 ?? props.methane_enhancement_ppm_m)
        const [lng, lat] = feature.geometry?.coordinates || []
        if (!Number.isFinite(value) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
        return {
          id: feature.id || `cams-${index}`,
          lat,
          lng,
          value,
          unit: props.unit || 'μg/m³',
          observed_at: props.observed_at,
          elevation_m: props.elevation_m
        }
      })
      .filter(Boolean)
  }, [methaneOverlay])

  if (!geometry || !field.length) return null

  return (
    <CamsHeatCanvas
      geometry={geometry}
      field={field}
      legend={methaneOverlay?.legend}
    />
  )
}

export default CamsMethaneHeatLayer
