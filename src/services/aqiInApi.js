/**
 * aqi.in public API (apiserver.aqi.in)
 *
 * Confirmed working (Bearer JWT):
 * - GET /aqi/v2/getNearestLocation?lat=&long=&type=1&source=web  → nearest stations
 * - GET /aqi/v2/getNearestLocation?lat=&long=&type=2&source=web  → nearest city
 * - GET /aqi/getNearestLocation?...                              → v1 (Locations key)
 * - GET /aqi/getAirQualityRanklistCountryAndCity?sensorname=aqi&type=2&limit=30&source=web
 * - GET /aqi/v2/getLast24HourHistory?slug=&sensorname=AQI-IN&slugType=cityId&source=web
 * - GET /aqi/getLast7DaysHistory?slug=&sensorname=AQI-IN&slugType=cityId|locationId&source=web
 * - GET /aqi/getLast30DaysHistory?slug=&sensorname=AQI-IN&slugType=cityId&source=web
 *
 * type=0 / type=3 on nearest → 400. Many other guessed paths → 404.
 */

const AQI_IN_BASE = import.meta.env.DEV
  ? '/aqi-in'
  : (import.meta.env.VITE_AQI_IN_BASE || 'https://apiserver.aqi.in')

const AQI_IN_TOKEN = import.meta.env.VITE_AQI_IN_TOKEN || ''

export const AQI_IN_TYPES = {
  STATION: 1,
  CITY: 2
}

const authHeaders = () => {
  if (!AQI_IN_TOKEN) {
    throw new Error('Missing VITE_AQI_IN_TOKEN. Add it to .env.local and restart the dev server.')
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${AQI_IN_TOKEN}`
  }
}

const toList = (payload) => {
  if (!payload) return []
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.Locations)) return payload.Locations
  if (Array.isArray(payload.locations)) return payload.locations
  return []
}

/**
 * Nearest sensors / city for a dynamic lat/lng.
 * @param {number} latitude
 * @param {number} longitude
 * @param {1|2} type 1 = stations, 2 = city
 * @param {string} source web | app
 */
export const fetchNearestLocation = async (
  latitude,
  longitude,
  type = AQI_IN_TYPES.STATION,
  source = 'web'
) => {
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Valid latitude and longitude are required')
  }

  const params = new URLSearchParams({
    lat: String(lat),
    long: String(lng),
    type: String(type),
    source
  })

  const response = await fetch(
    `${AQI_IN_BASE}/aqi/v2/getNearestLocation?${params.toString()}`,
    { method: 'GET', headers: authHeaders() }
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `aqi.in error ${response.status}`)
  }

  const payload = await response.json()
  return {
    status: payload.status,
    message: payload.message,
    items: toList(payload)
  }
}

/** Stations + city in parallel for the same point. */
export const fetchSensorBundle = async (latitude, longitude) => {
  const [stations, city] = await Promise.all([
    fetchNearestLocation(latitude, longitude, AQI_IN_TYPES.STATION),
    fetchNearestLocation(latitude, longitude, AQI_IN_TYPES.CITY).catch(() => ({ items: [] }))
  ])
  return {
    stations: stations.items || [],
    city: city.items?.[0] || null,
    fetchedAt: new Date().toISOString()
  }
}

// Persist discovered sensors across pan/zoom so the view fills over time
const sensorStationCache = new Map()
const queriedSampleCells = new Set()

const stationUid = (station) => (
  station?.uid
  || station?.locationId
  || (Number.isFinite(Number(station?.latitude)) && Number.isFinite(Number(station?.longitude))
    ? `${Number(station.latitude).toFixed(4)}:${Number(station.longitude).toFixed(4)}`
    : null)
)

const sampleCellKey = (lat, lng, cell) => (
  `${Math.round(lat / cell) * cell}:${Math.round(lng / cell) * cell}`
)

/**
 * Dense sample lattice sized to the visible span (capped) so nearest-station
 * queries can discover sensors across the whole screen, not one cluster.
 */
const sampleGridInBounds = (bounds, zoom) => {
  const south = bounds.getSouth()
  const north = bounds.getNorth()
  const west = bounds.getWest()
  const east = bounds.getEast()
  const latSpan = Math.max(0.05, north - south)
  const lngSpan = Math.max(0.05, east - west)

  // Geographic step: finer when zoomed in / smaller view
  let cell = 2.4
  if (zoom >= 11) cell = 0.12
  else if (zoom >= 9) cell = 0.25
  else if (zoom >= 7) cell = 0.55
  else if (zoom >= 6) cell = 0.9
  else if (zoom >= 5) cell = 1.4
  else if (zoom >= 4) cell = 2.0

  let cols = Math.ceil(lngSpan / cell) + 1
  let rows = Math.ceil(latSpan / cell) + 1
  // Hard cap request count (still much denser than 3×3)
  const maxPoints = zoom >= 8 ? 64 : zoom >= 6 ? 49 : 36
  while (cols * rows > maxPoints) {
    if (cols >= rows) cols -= 1
    else rows -= 1
  }
  cols = Math.max(3, cols)
  rows = Math.max(3, rows)

  const points = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      // Slight row stagger improves discovery vs perfect grid
      const stagger = (r % 2) * (0.5 / cols)
      const lat = south + ((r + 0.5) / rows) * latSpan
      const lng = west + ((c + 0.5 + stagger) / cols) * lngSpan
      const point = {
        lat: Math.round(lat * 10000) / 10000,
        lng: Math.round(lng * 10000) / 10000,
        cell
      }
      const key = sampleCellKey(point.lat, point.lng, cell)
      point.key = key
      points.push(point)
    }
  }
  return points
}

const inBounds = (lat, lng, bounds, padRatio = 0.08) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  const south = bounds.getSouth()
  const north = bounds.getNorth()
  const west = bounds.getWest()
  const east = bounds.getEast()
  const padLat = (north - south) * padRatio
  const padLng = (east - west) * padRatio
  return (
    lat >= south - padLat &&
    lat <= north + padLat &&
    lng >= west - padLng &&
    lng <= east + padLng
  )
}

const stationsInBounds = (bounds) => (
  [...sensorStationCache.values()]
    .filter((station) => inBounds(
      Number(station.latitude),
      Number(station.longitude),
      bounds,
      0.08
    ))
    .sort((a, b) => {
      const aqiA = Number(a?.iaqi?.['AQI-IN'] ?? a?.iaqi?.aqi ?? a?.aqi) || 0
      const aqiB = Number(b?.iaqi?.['AQI-IN'] ?? b?.iaqi?.aqi ?? b?.aqi) || 0
      return aqiB - aqiA
    })
)

const rememberStations = (items) => {
  let added = 0
  ;(items || []).forEach((station) => {
    const uid = stationUid(station)
    if (!uid) return
    if (!sensorStationCache.has(uid)) added += 1
    sensorStationCache.set(uid, station)
  })
  return added
}

/**
 * Discover sensors for the visible map by dense nearest-location sampling.
 * aqi.in has no bbox station API — cache + dense grid approximates full coverage.
 * @param {(payload: { stations: any[], done: boolean, sampleCount: number, fetched: number }) => void} [onProgress]
 */
export const fetchSensorsInView = async (bounds, zoom = 5, onProgress) => {
  if (!bounds?.getSouth) {
    throw new Error('Map bounds are required')
  }

  // Immediately paint anything already cached in this view
  const initial = stationsInBounds(bounds)
  onProgress?.({
    stations: initial,
    done: false,
    sampleCount: 0,
    fetched: 0
  })

  const samples = sampleGridInBounds(bounds, zoom)
  // Prefer cells not queried yet so pan/zoom discovers new areas first
  const ordered = [
    ...samples.filter((point) => !queriedSampleCells.has(point.key)),
    ...samples.filter((point) => queriedSampleCells.has(point.key))
  ]

  let cursor = 0
  let fetched = 0
  const workers = Math.min(6, Math.max(3, ordered.length))

  const worker = async () => {
    while (cursor < ordered.length) {
      const index = cursor
      cursor += 1
      const point = ordered[index]
      try {
        const result = await fetchNearestLocation(
          point.lat,
          point.lng,
          AQI_IN_TYPES.STATION
        )
        queriedSampleCells.add(point.key)
        rememberStations(result.items)
        fetched += 1
        onProgress?.({
          stations: stationsInBounds(bounds),
          done: false,
          sampleCount: ordered.length,
          fetched
        })
      } catch {
        fetched += 1
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))

  const stations = stationsInBounds(bounds)
  onProgress?.({
    stations,
    done: true,
    sampleCount: ordered.length,
    fetched
  })

  return {
    stations,
    sampleCount: ordered.length,
    cacheSize: sensorStationCache.size,
    fetchedAt: new Date().toISOString()
  }
}

/**
 * City / country AQI ranking list.
 * Query (GET): sensorname, type (2 = cities), limit, source
 */
export const fetchAirQualityRanklist = async ({
  sensorname = 'aqi',
  type = AQI_IN_TYPES.CITY,
  limit = 30,
  source = 'web'
} = {}) => {
  const params = new URLSearchParams({
    sensorname: String(sensorname),
    type: String(type),
    limit: String(limit),
    source: String(source)
  })

  const response = await fetch(
    `${AQI_IN_BASE}/aqi/getAirQualityRanklistCountryAndCity?${params.toString()}`,
    { method: 'GET', headers: authHeaders() }
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `aqi.in ranklist error ${response.status}`)
  }

  const payload = await response.json()
  const items = toList(payload)
    .map((row, index) => ({
      ...row,
      rank: Number(row.rank) || index + 1,
      aqi: Number(row.aqi),
      pm25: row.pm25 == null ? null : Number(row.pm25),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude)
    }))
    .sort((a, b) => a.rank - b.rank)

  return {
    status: payload.status,
    message: payload.message,
    items,
    fetchedAt: new Date().toISOString()
  }
}

const isIndiaRow = (row) => {
  const country = String(row?.country || '').trim().toLowerCase()
  const slug = String(row?.slug || row?.country_slug || '').trim().toLowerCase()
  return country === 'india' || slug.startsWith('india/') || slug === 'india'
}

/**
 * Top N Indian cities by AQI.
 * API returns a global list — fetch a wider window, keep India only, renumber ranks.
 */
export const fetchIndiaCityRanklist = async (limit = 30) => {
  const fetchLimit = Math.max(limit * 4, 120)
  const data = await fetchAirQualityRanklist({
    sensorname: 'aqi',
    type: AQI_IN_TYPES.CITY,
    limit: fetchLimit,
    source: 'web'
  })
  const india = (data.items || [])
    .filter(isIndiaRow)
    .sort((a, b) => (Number(b.aqi) || 0) - (Number(a.aqi) || 0))
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }))

  return {
    ...data,
    items: india
  }
}

/** Top N cities worldwide from the ranklist endpoint. */
export const fetchTopCitiesRanklist = (limit = 30) => (
  fetchAirQualityRanklist({
    sensorname: 'aqi',
    type: AQI_IN_TYPES.CITY,
    limit,
    source: 'web'
  })
)

export const aqiInColor = (aqi) => {
  const value = Number(aqi)
  if (!Number.isFinite(value)) return '#94a3b8'
  if (value <= 50) return '#10b981'
  if (value <= 100) return '#f59e0b'
  if (value <= 150) return '#f97316'
  if (value <= 200) return '#ef4444'
  if (value <= 300) return '#8b5cf6'
  return '#7f1d1d'
}

export const aqiInLabel = (aqi) => {
  const value = Number(aqi)
  if (!Number.isFinite(value)) return '—'
  if (value <= 50) return 'Good'
  if (value <= 100) return 'Moderate'
  if (value <= 150) return 'Poor'
  if (value <= 200) return 'Unhealthy'
  if (value <= 300) return 'Severe'
  return 'Hazardous'
}

export const HISTORY_RANGES = {
  '24h': {
    id: '24h',
    label: '24 Hours',
    path: '/aqi/v2/getLast24HourHistory'
  },
  '7d': {
    id: '7d',
    label: '7 Days',
    path: '/aqi/getLast7DaysHistory'
  },
  '30d': {
    id: '30d',
    label: '30 Days',
    path: '/aqi/getLast30DaysHistory'
  }
}

/** Resolve aqi.in slug + slugType from a nearest-location / ranklist station. */
export const resolveHistorySlug = (place) => {
  if (!place) return null
  const citySlug = place.city_slug || place.citySlug
  const locationSlug = place.location_slug || place.locationSlug || place.slug
  const parts = String(locationSlug || '').split('/').filter(Boolean)

  if (citySlug) {
    return { slug: citySlug, slugType: 'cityId', title: place.city || place.location || citySlug }
  }
  // india/state/city → cityId
  if (parts.length === 3) {
    return {
      slug: parts.join('/'),
      slugType: 'cityId',
      title: place.city || place.location || parts[2]
    }
  }
  // india/state/city/area → locationId
  if (parts.length >= 4) {
    return {
      slug: parts.join('/'),
      slugType: 'locationId',
      title: place.location || place.city || parts[parts.length - 1]
    }
  }
  if (locationSlug) {
    return {
      slug: locationSlug,
      slugType: 'cityId',
      title: place.city || place.location || locationSlug
    }
  }
  return null
}

const formatHistoryTick = (iso, rangeId) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  if (rangeId === '30d') {
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }
  const hour = date.getHours()
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h12 = hour % 12 || 12
  const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  if (rangeId === '24h') return `${h12}${ampm}`
  return `${h12}${ampm} ${day}`
}

/**
 * Historical AQI series for a place slug.
 * @param {'24h'|'7d'|'30d'} rangeId
 */
export const fetchAqiHistory = async (
  rangeId,
  { slug, slugType = 'cityId', sensorname = 'AQI-IN', source = 'web' } = {}
) => {
  const range = HISTORY_RANGES[rangeId]
  if (!range) throw new Error(`Unsupported history range: ${rangeId}`)
  if (!slug) throw new Error('History slug is required')

  const params = new URLSearchParams({
    slug: String(slug),
    sensorname: String(sensorname),
    slugType: String(slugType),
    source: String(source)
  })

  const response = await fetch(
    `${AQI_IN_BASE}${range.path}?${params.toString()}`,
    { method: 'GET', headers: authHeaders() }
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `aqi.in history error ${response.status}`)
  }

  const payload = await response.json()
  const block = payload?.data || {}
  const values = Array.isArray(block.averageArray) ? block.averageArray : []
  const times = Array.isArray(block.timeArray) ? block.timeArray : []
  const length = Math.min(values.length, times.length)

  const points = []
  for (let i = 0; i < length; i += 1) {
    const aqi = Number(values[i])
    if (!Number.isFinite(aqi)) continue
    const time = times[i]
    points.push({
      index: i,
      time,
      aqi,
      label: formatHistoryTick(time, rangeId),
      color: aqiInColor(aqi)
    })
  }

  let minPoint = null
  let maxPoint = null
  points.forEach((point) => {
    if (!minPoint || point.aqi < minPoint.aqi) minPoint = point
    if (!maxPoint || point.aqi > maxPoint.aqi) maxPoint = point
  })

  return {
    status: payload.status,
    message: payload.message,
    rangeId,
    slug,
    slugType,
    minValue: Number(block.minValue) || minPoint?.aqi || null,
    maxValue: Number(block.maxValue) || maxPoint?.aqi || null,
    avgValue: Number(block.avgValue) || null,
    minPoint,
    maxPoint,
    points,
    startLabel: points[0]
      ? new Date(points[0].time).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '',
    endLabel: points.length
      ? new Date(points[points.length - 1].time).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '',
    fetchedAt: new Date().toISOString()
  }
}
