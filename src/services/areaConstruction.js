import { pointInGeometry, ringCentroid } from '../utils/polygonIndex'

// Live OpenStreetMap construction for whatever area was drawn. Public servers are often busy,
// so each box tries the next mirror. Results are cached for the session.
// These mirrors answered a construction query in a few seconds. The main overpass-api.de server
// often returns 504, and overpass.osm.ch answers quickly with an empty list, so neither is used.
const OVERPASS_URLS = [
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter'
]
const SERVER_TIMEOUT_MS = 25000
const CELL_KM2 = 8
const MAX_CELLS = 12
const FLOOR_HEIGHT = 3

const cache = new Map()

const parsePositive = (value) => {
  const number = parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? number : null
}

const boundsOf = (geometry) => {
  const ring = geometry?.coordinates?.[0]
  if (!ring?.length) return null
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  ring.forEach(([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  })
  if (!Number.isFinite(minLng) || minLng >= maxLng || minLat >= maxLat) return null
  return { minLng, minLat, maxLng, maxLat }
}

const areaKm2 = (box) => {
  const midLat = ((box.minLat + box.maxLat) / 2) * Math.PI / 180
  return Math.abs((box.maxLng - box.minLng) * 111.32 * Math.cos(midLat) * (box.maxLat - box.minLat) * 110.574)
}

const cellsFor = (box) => {
  const area = areaKm2(box)
  if (area <= CELL_KM2) return { cells: [box], truncated: false }
  const cellKm = Math.sqrt(Math.max(CELL_KM2, area / MAX_CELLS))
  const midLat = ((box.minLat + box.maxLat) / 2) * Math.PI / 180
  const cols = Math.max(1, Math.ceil(Math.abs((box.maxLng - box.minLng) * 111.32 * Math.cos(midLat)) / cellKm))
  const rows = Math.max(1, Math.ceil(Math.abs((box.maxLat - box.minLat) * 110.574) / cellKm))
  const cells = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        minLng: box.minLng + ((box.maxLng - box.minLng) * col) / cols,
        maxLng: box.minLng + ((box.maxLng - box.minLng) * (col + 1)) / cols,
        minLat: box.minLat + ((box.maxLat - box.minLat) * row) / rows,
        maxLat: box.minLat + ((box.maxLat - box.minLat) * (row + 1)) / rows
      })
    }
  }
  const truncated = cells.length > MAX_CELLS
  return { cells: cells.slice(0, MAX_CELLS), truncated }
}

const toFeature = (element) => {
  const tags = element.tags || {}
  const ring = (element.geometry || []).map(point => [point.lon, point.lat])
  if (ring.length < 4) return null
  const [first, last] = [ring[0], ring[ring.length - 1]]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first)

  const isBuilding = tags.building === 'construction' ||
    Boolean(tags['building:construction']) ||
    (Boolean(tags.building) && Boolean(tags.construction))
  const isSite = tags.landuse === 'construction'
  if (!isBuilding && !isSite) return null

  const levels = parsePositive(tags['building:levels'])
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      id: `osm-${element.type || 'way'}-${element.id}`,
      kind: isBuilding ? 'building' : 'site',
      status: 'construction',
      class: tags['building:construction'] || tags.construction || (isSite ? 'construction' : tags.building) || 'construction',
      type: tags['building:construction'] || tags.construction || null,
      height: parsePositive(tags.height) ?? (levels ? levels * FLOOR_HEIGHT : null),
      num_floors: levels,
      levels,
      name: tags.name || null,
      updated: element.timestamp || null
    }
  }
}

const splitBox = (box) => {
  const midLng = (box.minLng + box.maxLng) / 2
  const midLat = (box.minLat + box.maxLat) / 2
  return [
    { minLng: box.minLng, minLat: box.minLat, maxLng: midLng, maxLat: midLat },
    { minLng: midLng, minLat: box.minLat, maxLng: box.maxLng, maxLat: midLat },
    { minLng: box.minLng, minLat: midLat, maxLng: midLng, maxLat: box.maxLat },
    { minLng: midLng, minLat: midLat, maxLng: box.maxLng, maxLat: box.maxLat }
  ]
}

const queryOnce = async (box) => {
  const query = `[out:json][timeout:25];(
    way["building"="construction"](${box.minLat},${box.minLng},${box.maxLat},${box.maxLng});
    way["landuse"="construction"](${box.minLat},${box.minLng},${box.maxLat},${box.maxLng});
    way["building:construction"](${box.minLat},${box.minLng},${box.maxLat},${box.maxLng});
    way["building"]["construction"](${box.minLat},${box.minLng},${box.maxLat},${box.maxLng});
  );out geom tags;`
  const body = `data=${encodeURIComponent(query)}`
  const failures = []
  let empty = null
  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(SERVER_TIMEOUT_MS)
      })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json()
      if ((data.elements || []).length > 0) return data
      empty = data
    } catch (err) {
      failures.push(`${new URL(url).host} ${err.name === 'TimeoutError' ? 'timeout' : err.message}`)
    }
  }
  if (empty) return empty
  throw new Error(failures.join('; ') || 'all servers busy')
}

const queryBox = async (box, depth = 0) => {
  try {
    return await queryOnce(box)
  } catch (err) {
    if (depth < 2 && areaKm2(box) > 1.5) {
      const elements = []
      const failures = []
      for (const part of splitBox(box)) {
        try {
          const data = await queryBox(part, depth + 1)
          elements.push(...(data.elements || []))
        } catch (partErr) {
          failures.push(partErr.message)
        }
      }
      if (elements.length || !failures.length) return { elements }
    }
    throw err
  }
}

/**
 * Under-construction buildings and sites from OpenStreetMap inside the drawn geometry.
 * Resolves to { features, note }. The lookup itself is not cancelled when the caller aborts,
 * so a remount (React Strict Mode) still receives the result.
 */
export const fetchAreaConstruction = (geometry, { signal } = {}) => {
  const box = boundsOf(geometry)
  if (!box) return Promise.resolve({ features: [], note: null })
  const key = [box.minLng, box.minLat, box.maxLng, box.maxLat].map(value => value.toFixed(4)).join(',')
  if (!cache.has(key)) {
    const pending = load(box, geometry)
      .then((value) => {
        cache.set(key, Promise.resolve(value))
        return value
      })
      .catch((err) => {
        cache.delete(key)
        throw err
      })
    cache.set(key, pending)
  }
  const pending = cache.get(key)
  if (!signal) return pending
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

const load = async (box, geometry) => {
  const { cells, truncated } = cellsFor(box)
  const seen = new Set()
  const features = []
  const failures = []

  for (const cell of cells) {
    try {
      const data = await queryBox(cell)
      ;(data.elements || []).forEach((element) => {
        const feature = toFeature(element)
        if (!feature || seen.has(feature.properties.id)) return
        const centroid = ringCentroid(feature.geometry)
        if (centroid && geometry && !pointInGeometry(centroid, geometry)) return
        seen.add(feature.properties.id)
        features.push(feature)
      })
    } catch (err) {
      failures.push(err.message)
    }
  }

  if (!features.length && failures.length) {
    throw new Error('OpenStreetMap is busy right now. Draw the area again in a moment.')
  }
  let note = null
  if (failures.length) note = 'Some of this area could not be checked. Draw that part again to retry.'
  else if (truncated) note = 'This area is very large, so only part of it was checked for construction.'
  else if (!features.length) note = 'No under-construction buildings are mapped in this area.'
  return { features, note }
}
