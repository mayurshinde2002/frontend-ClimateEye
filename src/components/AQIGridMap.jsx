import { useEffect, useMemo, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchAQIData } from '../services/api'
import { pointInGeometry } from '../utils/polygonIndex'
import './AQIGridMap.css'

const METERS_PER_DEG_LAT = 111320
const BATCH_SIZE = 8
const MAX_CELLS = 200

// Smooth AQI ramp (matches category bands, blended for heatmap)
const AQI_STOPS = [
  [0, [16, 185, 129]],
  [50, [16, 185, 129]],
  [75, [245, 158, 11]],
  [100, [245, 158, 11]],
  [125, [249, 115, 22]],
  [150, [249, 115, 22]],
  [175, [239, 68, 68]],
  [200, [239, 68, 68]],
  [250, [139, 92, 246]],
  [300, [139, 92, 246]],
  [400, [127, 29, 29]],
  [500, [127, 29, 29]]
]

const AQI_LEGEND = [
  { label: 'Good', color: '#10b981' },
  { label: 'Moderate', color: '#f59e0b' },
  { label: 'Poor', color: '#f97316' },
  { label: 'Unhealthy', color: '#ef4444' },
  { label: 'Severe', color: '#8b5cf6' },
  { label: 'Hazardous', color: '#7f1d1d' }
]

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const bboxOfGeometry = (geometry) => {
  const ring = geometry?.type === 'Polygon'
    ? geometry.coordinates?.[0]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates?.[0]?.[0]
      : null
  if (!ring?.length) return null

  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  ring.forEach(([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  })
  if (!Number.isFinite(west)) return null
  return { west, south, east, north }
}

const pickCellMeters = (widthM, heightM) => {
  for (const size of [50, 70, 100, 150, 200, 250]) {
    const cols = Math.max(1, Math.ceil(widthM / size))
    const rows = Math.max(1, Math.ceil(heightM / size))
    if (cols * rows <= MAX_CELLS) return size
  }
  return 300
}

export const buildAqiGridCells = (geometry) => {
  const bbox = bboxOfGeometry(geometry)
  if (!bbox) return { cells: [], cellMeters: 50 }

  const midLat = (bbox.south + bbox.north) / 2
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.max(0.2, Math.cos((midLat * Math.PI) / 180))
  const widthM = Math.max(0, (bbox.east - bbox.west) * metersPerDegLng)
  const heightM = Math.max(0, (bbox.north - bbox.south) * METERS_PER_DEG_LAT)
  const cellMeters = pickCellMeters(widthM, heightM)
  const dLat = cellMeters / METERS_PER_DEG_LAT
  const dLng = cellMeters / metersPerDegLng

  const cells = []
  for (let lat = bbox.south; lat < bbox.north - dLat * 0.01; lat += dLat) {
    for (let lng = bbox.west; lng < bbox.east - dLng * 0.01; lng += dLng) {
      const centerLng = lng + dLng / 2
      const centerLat = lat + dLat / 2
      if (!pointInGeometry([centerLng, centerLat], geometry)) continue
      cells.push({
        id: `${centerLat.toFixed(5)},${centerLng.toFixed(5)}`,
        lat: centerLat,
        lng: centerLng
      })
    }
  }

  return { cells, cellMeters, bbox }
}

const aqiColor = (aqi) => {
  if (aqi == null) return null
  const value = Math.max(0, Math.min(500, aqi))
  let index = 1
  while (index < AQI_STOPS.length && AQI_STOPS[index][0] < value) index += 1
  const [startAqi, start] = AQI_STOPS[index - 1]
  const [endAqi, end] = AQI_STOPS[Math.min(index, AQI_STOPS.length - 1)]
  const t = endAqi === startAqi ? 0 : (value - startAqi) / (endAqi - startAqi)
  const blend = t * t * (3 - 2 * t)
  return [
    Math.round(start[0] + (end[0] - start[0]) * blend),
    Math.round(start[1] + (end[1] - start[1]) * blend),
    Math.round(start[2] + (end[2] - start[2]) * blend)
  ]
}

// Soft IDW so neighboring cells fuse into one continuous field
const sampleField = (field, lat, lng, soft) => {
  if (!field.length) return null
  const cos = Math.cos((lat * Math.PI) / 180)
  let nearest = null
  let nearestDist = Infinity
  let sum = 0
  let weightTotal = 0

  field.forEach((point) => {
    if (point.aqi == null) return
    const dLat = lat - point.lat
    const dLng = (lng - point.lng) * cos
    const dist2 = dLat * dLat + dLng * dLng
    const dist = Math.sqrt(dist2)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = point.aqi
    }
    const weight = 1 / Math.pow(dist + soft, 2)
    sum += point.aqi * weight
    weightTotal += weight
  })

  if (!weightTotal) return null
  if (nearest != null && nearestDist < soft * 1.2) return nearest
  return sum / weightTotal
}

const FitToGeometry = ({ geometry }) => {
  const map = useMap()
  useEffect(() => {
    const bbox = bboxOfGeometry(geometry)
    if (!bbox || !map) return
    map.fitBounds(
      [[bbox.south, bbox.west], [bbox.north, bbox.east]],
      { padding: [48, 48], maxZoom: 17, animate: true }
    )
  }, [geometry, map])
  return null
}

const AQIHeatLayer = ({ geometry, field, cellMeters, soft }) => {
  const map = useMap()

  useEffect(() => {
    if (!geometry || !field?.length) return undefined

    const pane = map.getPane('aqiGrid') || map.createPane('aqiGrid')
    pane.style.zIndex = '460'
    pane.style.pointerEvents = 'none'

    const canvas = L.DomUtil.create('canvas', 'aqi-heat-canvas', pane)
    const tip = L.DomUtil.create('div', 'regional-wind-tip', map.getContainer())
    tip.style.display = 'none'
    const ctx = canvas.getContext('2d')
    const heat = document.createElement('canvas')
    heat.width = 320
    heat.height = 220
    const heatCtx = heat.getContext('2d', { willReadFrequently: true })

    let alive = true
    let frameId = 0
    let dirty = true
    let pixelWidth = 0
    let pixelHeight = 0
    const fieldRef = field
    const softRef = soft

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
      const image = heatCtx.createImageData(heat.width, heat.height)
      const pixels = image.data
      for (let y = 0; y < heat.height; y += 1) {
        for (let x = 0; x < heat.width; x += 1) {
          const latLng = map.containerPointToLatLng([
            ((x + 0.5) * size.x) / heat.width,
            ((y + 0.5) * size.y) / heat.height
          ])
          const offset = (y * heat.width + x) * 4
          if (!pointInGeometry([latLng.lng, latLng.lat], geometry)) {
            pixels[offset + 3] = 0
            continue
          }
          const aqi = sampleField(fieldRef, latLng.lat, latLng.lng, softRef)
          const color = aqiColor(aqi)
          if (!color) {
            pixels[offset + 3] = 0
            continue
          }
          pixels[offset] = color[0]
          pixels[offset + 1] = color[1]
          pixels[offset + 2] = color[2]
          pixels[offset + 3] = 200
        }
      }
      heatCtx.putImageData(image, 0, 0)
    }

    const tick = () => {
      if (!alive) return
      frameId = requestAnimationFrame(tick)
      const size = syncCanvas()
      ctx.clearRect(0, 0, size.x, size.y)
      if (!fieldRef.length) return
      if (dirty) {
        paintHeat(size)
        dirty = false
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.globalAlpha = 0.9
      ctx.drawImage(heat, 0, 0, size.x, size.y)
      ctx.globalAlpha = 1
    }

    const markDirty = () => { dirty = true }

    const onMouseMove = (event) => {
      if (!pointInGeometry([event.latlng.lng, event.latlng.lat], geometry)) {
        tip.style.display = 'none'
        return
      }
      const aqi = sampleField(fieldRef, event.latlng.lat, event.latlng.lng, softRef)
      if (aqi == null) {
        tip.style.display = 'none'
        return
      }
      tip.textContent = `AQI ${Math.round(aqi)} · ~${cellMeters} m`
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
  }, [map, geometry, field, cellMeters, soft])

  return null
}

const AQIGridMap = ({ geometry }) => {
  const [samples, setSamples] = useState([])
  const [cellMeters, setCellMeters] = useState(50)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(null)

  const gridKey = useMemo(() => {
    if (!geometry) return ''
    try {
      return JSON.stringify(geometry.coordinates)
    } catch {
      return String(Date.now())
    }
  }, [geometry])

  const soft = useMemo(() => {
    // Fuse cells: soft radius ~0.6× cell size in degrees latitude
    return Math.max(0.00015, (cellMeters / METERS_PER_DEG_LAT) * 0.65)
  }, [cellMeters])

  useEffect(() => {
    if (!geometry) {
      setSamples([])
      setTotal(0)
      setDone(0)
      setError(null)
      return undefined
    }

    let cancelled = false
    const { cells: grid, cellMeters: size } = buildAqiGridCells(geometry)
    setCellMeters(size)
    setTotal(grid.length)
    setDone(0)
    setError(null)
    setSamples([])

    if (!grid.length) {
      setLoading(false)
      setError('No sample points inside this area. Try a larger draw.')
      return undefined
    }

    setLoading(true)

    const run = async () => {
      const next = []
      for (let i = 0; i < grid.length; i += BATCH_SIZE) {
        if (cancelled) return
        const batch = grid.slice(i, i + BATCH_SIZE)
        const results = await Promise.all(
          batch.map(async (cell) => {
            try {
              const data = await fetchAQIData(cell.lat, cell.lng)
              return { lat: cell.lat, lng: cell.lng, aqi: finiteOrNull(data?.aqi) }
            } catch {
              return { lat: cell.lat, lng: cell.lng, aqi: null }
            }
          })
        )
        if (cancelled) return
        results.forEach((sample) => {
          if (sample.aqi != null) next.push(sample)
        })
        setSamples([...next])
        setDone(Math.min(grid.length, i + batch.length))
      }
      if (!cancelled) {
        setLoading(false)
        if (!next.length) setError('No AQI values returned for this area')
      }
    }

    run().catch((err) => {
      if (!cancelled) {
        setLoading(false)
        setError(err.message || 'AQI heatmap failed to load')
      }
    })

    return () => { cancelled = true }
  }, [gridKey, geometry])

  if (!geometry) {
    return (
      <div className="aqi-grid-banner">
        Draw or upload an area to show the AQI heatmap
      </div>
    )
  }

  return (
    <>
      <FitToGeometry geometry={geometry} />
      {samples.length > 0 && (
        <AQIHeatLayer
          geometry={geometry}
          field={samples}
          cellMeters={cellMeters}
          soft={soft}
        />
      )}

      <div className="aqi-grid-legend">
        <div className="aqi-grid-legend-title">
          AQI heatmap · ~{cellMeters} m
        </div>
        {loading && (
          <div className="aqi-grid-legend-status">
            Loading {done}/{total} samples…
          </div>
        )}
        {!loading && samples.length > 0 && (
          <div className="aqi-grid-legend-status">
            {samples.length} samples fused · null skipped
          </div>
        )}
        {error && <div className="aqi-grid-legend-error">{error}</div>}
        <div className="aqi-grid-legend-bar" />
        <div className="aqi-grid-legend-scale">
          {AQI_LEGEND.map((entry) => (
            <div key={entry.label} className="aqi-grid-legend-item">
              <span className="aqi-grid-swatch" style={{ background: entry.color }} />
              <span>{entry.label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default AQIGridMap
