import { useEffect, useMemo, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchAQIData } from '../services/api'
import { fetchAqiSamplesForArea } from '../services/aqiInApi'
import { pointInGeometry } from '../utils/polygonIndex'
import './AQIGridMap.css'

const METERS_PER_DEG_LAT = 111320
const BATCH_SIZE = 12
const MAX_BBOX_SLOTS = 900
const MAX_FETCH_CELLS = 80
const CELL_SIZE_OPTIONS_M = [50, 70, 100, 125, 150, 200, 250, 300, 400, 500]

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
  for (const size of CELL_SIZE_OPTIONS_M) {
    const cols = Math.max(1, Math.ceil(widthM / size))
    const rows = Math.max(1, Math.ceil(heightM / size))
    if (cols * rows <= MAX_BBOX_SLOTS) return size
  }
  return CELL_SIZE_OPTIONS_M[CELL_SIZE_OPTIONS_M.length - 1]
}

const thinCells = (cells, limit) => {
  if (cells.length <= limit) return cells
  const stride = Math.ceil(cells.length / limit)
  const picked = []
  for (let i = 0; i < cells.length && picked.length < limit; i += stride) {
    picked.push(cells[i])
  }
  if (picked.length < limit) {
    for (let i = 0; i < cells.length && picked.length < limit; i += 1) {
      if (i % stride === 0) continue
      picked.push(cells[i])
    }
  }
  return picked
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

  return { cells: thinCells(cells, MAX_FETCH_CELLS), cellMeters, bbox }
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

/** Nearest sensor (for hover tip). */
const nearestSample = (field, lat, lng) => {
  if (!field.length) return null
  const cos = Math.cos((lat * Math.PI) / 180)
  let nearest = null
  let nearestDist = Infinity

  field.forEach((point) => {
    if (point.aqi == null) return
    const dLat = lat - point.lat
    const dLng = (lng - point.lng) * cos
    const dist = Math.sqrt(dLat * dLat + dLng * dLng)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = point
    }
  })

  return nearest
}

/** Typical spacing between sensors → controls how wide the color gradient is. */
const estimateBlendRadius = (field) => {
  if (!field?.length) return 0.02
  if (field.length === 1) return 0.04
  let sum = 0
  let count = 0
  for (let i = 0; i < field.length; i += 1) {
    const a = field[i]
    if (a.aqi == null) continue
    const cos = Math.cos((a.lat * Math.PI) / 180)
    let best = Infinity
    for (let j = 0; j < field.length; j += 1) {
      if (i === j) continue
      const b = field[j]
      if (b.aqi == null) continue
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
  const mean = count ? sum / count : 0.03
  // Blend across ~55% of neighbor spacing so side colors merge smoothly
  return Math.max(0.008, Math.min(0.12, mean * 0.55))
}

/**
 * Soft IDW blend of neighboring sensor AQI → smooth gradient between side colors.
 * Returns { aqi, nearest } for paint + tip.
 */
const sampleBlended = (field, lat, lng, soft) => {
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
    const dist = Math.sqrt(dLat * dLat + dLng * dLng)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = point
    }
    const weight = 1 / Math.pow(dist + soft, 2.2)
    sum += point.aqi * weight
    weightTotal += weight
  })

  if (!weightTotal || !nearest) return null
  return { aqi: sum / weightTotal, nearest }
}

const uniqueAqiCount = (field) => {
  const set = new Set()
  field.forEach((point) => {
    if (point.aqi == null) return
    set.add(Math.round(Number(point.aqi)))
  })
  return set.size
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

const AQIHeatLayer = ({ geometry, field, cellMeters, sourceLabel }) => {
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
    heat.width = 640
    heat.height = 440
    const heatCtx = heat.getContext('2d', { willReadFrequently: true })

    let alive = true
    let frameId = 0
    let dirty = true
    let pixelWidth = 0
    let pixelHeight = 0
    const fieldRef = field
    const soft = estimateBlendRadius(field)

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
      const width = heat.width
      const height = heat.height
      const image = heatCtx.createImageData(width, height)
      const pixels = image.data

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4
          const latLng = map.containerPointToLatLng([
            ((x + 0.5) * size.x) / width,
            ((y + 0.5) * size.y) / height
          ])
          if (!pointInGeometry([latLng.lng, latLng.lat], geometry)) {
            pixels[offset + 3] = 0
            continue
          }
          const blended = sampleBlended(fieldRef, latLng.lat, latLng.lng, soft)
          const color = aqiColor(blended?.aqi)
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
      // Soft upscale so neighboring zone colors melt into a gradient
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.globalAlpha = 0.88
      ctx.drawImage(heat, 0, 0, size.x, size.y)
      ctx.globalAlpha = 1
    }

    const markDirty = () => { dirty = true }

    const onMouseMove = (event) => {
      if (!pointInGeometry([event.latlng.lng, event.latlng.lat], geometry)) {
        tip.style.display = 'none'
        return
      }
      const blended = sampleBlended(fieldRef, event.latlng.lat, event.latlng.lng, soft)
      const nearest = blended?.nearest || nearestSample(fieldRef, event.latlng.lat, event.latlng.lng)
      if (blended?.aqi == null) {
        tip.style.display = 'none'
        return
      }
      const place = nearest?.name ? ` · ${nearest.name}` : ''
      tip.textContent = `AQI ${Math.round(blended.aqi)}${place}`
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
  }, [map, geometry, field, cellMeters, sourceLabel])

  return null
}

const AQIGridMap = ({ geometry }) => {
  const [samples, setSamples] = useState([])
  const [cellMeters, setCellMeters] = useState(50)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(null)
  const [source, setSource] = useState('sensors')
  const [note, setNote] = useState(null)

  const gridKey = useMemo(() => {
    if (!geometry) return ''
    try {
      return JSON.stringify(geometry.coordinates)
    } catch {
      return String(Date.now())
    }
  }, [geometry])

  const distinctCount = useMemo(() => uniqueAqiCount(samples), [samples])

  useEffect(() => {
    if (!geometry) {
      setSamples([])
      setTotal(0)
      setDone(0)
      setError(null)
      setNote(null)
      return undefined
    }

    let cancelled = false
    const bbox = bboxOfGeometry(geometry)
    const { cellMeters: size } = buildAqiGridCells(geometry)
    setCellMeters(size)
    setDone(0)
    setTotal(0)
    setError(null)
    setNote(null)
    setSamples([])
    setSource('sensors')
    setLoading(true)

    const loadBackendFallback = async () => {
      const { cells: grid } = buildAqiGridCells(geometry)
      if (!grid.length) {
        setError('No sample points inside this area. Try a larger draw.')
        setLoading(false)
        return
      }
      setSource('model')
      setTotal(grid.length)
      setNote('Using model AQI (few local sensors). Values may look similar.')
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

    const run = async () => {
      try {
        const { samples: sensorSamples } = await fetchAqiSamplesForArea(
          bbox,
          (progress) => {
            if (cancelled) return
            setTotal(progress.sampleCount || 0)
            setDone(progress.fetched || 0)
            if (progress.samples?.length) {
              setSamples(progress.samples)
            }
          }
        )
        if (cancelled) return

        if (sensorSamples.length >= 2) {
          setSamples(sensorSamples)
          setSource('sensors')
          setTotal(sensorSamples.length)
          setDone(sensorSamples.length)
          setLoading(false)
          if (uniqueAqiCount(sensorSamples) < 2) {
            setNote('Local sensors report similar AQI right now.')
          } else {
            setNote(`${sensorSamples.length} sensors · ${uniqueAqiCount(sensorSamples)} AQI levels`)
          }
          return
        }

        if (sensorSamples.length === 1) {
          setSamples(sensorSamples)
          setSource('sensors')
          setNote('Only one local sensor found — whole area uses that reading.')
          setLoading(false)
          return
        }

        await loadBackendFallback()
      } catch (err) {
        if (cancelled) return
        // Missing token or aqi.in failure → model fallback
        try {
          await loadBackendFallback()
        } catch (fallbackErr) {
          if (!cancelled) {
            setLoading(false)
            setError(fallbackErr.message || err.message || 'AQI heatmap failed to load')
          }
        }
      }
    }

    run()

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
          sourceLabel={source}
        />
      )}

      <div className="weather-scale aqi-weather-scale">
        <span className="weather-scale-title">AQI</span>
        {loading && (
          <span className="weather-scale-note">
            {source === 'sensors' ? `Finding sensors ${done}/${total || '…'}` : `Loading ${done}/${total}…`}
          </span>
        )}
        {error && <span className="weather-scale-note" style={{ color: '#fca5a5' }}>{error}</span>}
        {!loading && !error && (
          <>
            <span className="weather-scale-unit">
              {source === 'sensors'
                ? `${samples.length} sensor${samples.length === 1 ? '' : 's'}`
                : `~${cellMeters} m`}
              {distinctCount > 1 ? ` · ${distinctCount} levels` : ''}
            </span>
            {note && <span className="weather-scale-note">{note}</span>}
            <div
              className="weather-scale-bar"
              style={{
                background: 'linear-gradient(90deg, #10b981 0%, #f59e0b 20%, #f97316 40%, #ef4444 60%, #8b5cf6 80%, #7f1d1d 100%)'
              }}
            />
          </>
        )}
      </div>
    </>
  )
}

export default AQIGridMap
