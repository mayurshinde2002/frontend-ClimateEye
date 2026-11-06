/**
 * aqi.in via ClimateEye backend (token stays server-side).
 *
 * Backend routes:
 * - GET /api/aqi-in/nearest
 * - GET /api/aqi-in/ranklist
 * - GET /api/aqi-in/history?range=24h|7d|30d
 * - GET /api/aqi-in/calendar
 */

const API_BASE = import.meta.env.DEV ? '/api' : 'https://climateye-apis.up.railway.app/api'
const AQI_IN_BASE = `${API_BASE}/aqi-in`

export const AQI_IN_TYPES = {
  STATION: 1,
  CITY: 2
}

const jsonHeaders = () => ({ Accept: 'application/json' })

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
    `${AQI_IN_BASE}/nearest?${params.toString()}`,
    { method: 'GET', headers: jsonHeaders() }
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
    `${AQI_IN_BASE}/ranklist?${params.toString()}`,
    { method: 'GET', headers: jsonHeaders() }
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

/** Numeric AQI from an aqi.in station / city payload. */
export const stationAqiValue = (station) => {
  const value = Number(
    station?.iaqi?.['AQI-IN']
    ?? station?.iaqi?.aqi
    ?? station?.aqi
    ?? station?.AQI
  )
  return Number.isFinite(value) ? value : null
}

/**
 * Leaflet-like bounds from a { west, south, east, north } bbox
 * (for reuse with fetchSensorsInView without a map instance).
 */
export const boundsFromBbox = (bbox, padRatio = 0.12) => {
  if (!bbox) return null
  const latPad = Math.max(0.01, (bbox.north - bbox.south) * padRatio)
  const lngPad = Math.max(0.01, (bbox.east - bbox.west) * padRatio)
  const south = bbox.south - latPad
  const north = bbox.north + latPad
  const west = bbox.west - lngPad
  const east = bbox.east + lngPad
  return {
    getSouth: () => south,
    getNorth: () => north,
    getWest: () => west,
    getEast: () => east
  }
}

/**
 * Discover aqi.in stations around a drawn area bbox and return paint samples.
 * Uses real per-sensor AQI (varies by location) instead of a single city reading.
 */
export const fetchAqiSamplesForArea = async (bbox, onProgress) => {
  const bounds = boundsFromBbox(bbox, 0.15)
  if (!bounds) throw new Error('Area bounds are required')

  const latSpan = bounds.getNorth() - bounds.getSouth()
  const lngSpan = bounds.getEast() - bounds.getWest()
  // City / neighborhood draws → denser discovery zoom
  const span = Math.max(latSpan, lngSpan)
  const zoom = span < 0.08 ? 12 : span < 0.2 ? 11 : span < 0.5 ? 10 : 8

  const result = await fetchSensorsInView(bounds, zoom, (progress) => {
    const samples = (progress.stations || [])
      .map((station) => {
        const lat = Number(station.latitude)
        const lng = Number(station.longitude)
        const aqi = stationAqiValue(station)
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || aqi == null) return null
        return {
          lat,
          lng,
          aqi,
          name: station.location || station.city || station.location_slug || 'Sensor'
        }
      })
      .filter(Boolean)
    onProgress?.({
      samples,
      done: Boolean(progress.done),
      fetched: progress.fetched || 0,
      sampleCount: progress.sampleCount || 0
    })
  })

  const samples = (result.stations || [])
    .map((station) => {
      const lat = Number(station.latitude)
      const lng = Number(station.longitude)
      const aqi = stationAqiValue(station)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || aqi == null) return null
      return {
        lat,
        lng,
        aqi,
        name: station.location || station.city || station.location_slug || 'Sensor'
      }
    })
    .filter(Boolean)

  return { samples, zoom }
}

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
    label: '24 Hours'
  },
  '7d': {
    id: '7d',
    label: '7 Days'
  },
  '30d': {
    id: '30d',
    label: '30 Days'
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

/**
 * Resolve nearest aqi.in city (slug + display name) from map coordinates.
 * Used when the user draws an AOI and opens the AQI calendar.
 */
export const resolveCityFromCoords = async (latitude, longitude) => {
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Valid coordinates are required to resolve a city')
  }

  const [cityResult, stationResult] = await Promise.all([
    fetchNearestLocation(lat, lng, AQI_IN_TYPES.CITY).catch(() => ({ items: [] })),
    fetchNearestLocation(lat, lng, AQI_IN_TYPES.STATION).catch(() => ({ items: [] }))
  ])

  const city = cityResult.items?.[0] || null
  const station = stationResult.items?.[0] || null
  const resolved = resolveHistorySlug(city) || resolveHistorySlug(station)
  if (!resolved?.slug) {
    throw new Error('No aqi.in city found near the drawn area')
  }

  const cityName = String(city?.city || city?.location || resolved.title || '')
    .trim()
    .toLowerCase()

  return {
    ...resolved,
    title: String(resolved.title || cityName).trim().toLowerCase(),
    latitude: Number(city?.latitude ?? station?.latitude ?? lat),
    longitude: Number(city?.longitude ?? station?.longitude ?? lng),
    cityName,
    raw: city || station
  }
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
    range: String(rangeId),
    slug: String(slug),
    sensorname: String(sensorname),
    slugType: String(slugType),
    source: String(source)
  })

  const response = await fetch(
    `${AQI_IN_BASE}/history?${params.toString()}`,
    { method: 'GET', headers: jsonHeaders() }
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const monthIndexFromKey = (key) => {
  const raw = String(key || '').trim()
  const asNum = Number(raw)
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 12) return asNum - 1
  if (Number.isFinite(asNum) && asNum >= 0 && asNum <= 11 && String(raw) === String(asNum)) {
    // 0-based month index
    return asNum
  }
  const lower = raw.toLowerCase()
  return MONTH_NAMES.findIndex((name) => lower.startsWith(name.slice(0, 3).toLowerCase()))
}

/** Parse date-like values into { year, monthIndex 0-11, day }. */
const parseCalendarDate = (value) => {
  if (value == null || value === '') return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    // unix seconds vs ms
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : null
    if (ms) {
      const d = new Date(ms)
      if (!Number.isNaN(d.getTime())) {
        return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth(), day: d.getUTCDate() }
      }
    }
  }

  const text = String(value).trim()
  // YYYY-MM-DD or YYYY/MM/DD
  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (match) {
    return {
      year: Number(match[1]),
      monthIndex: Number(match[2]) - 1,
      day: Number(match[3])
    }
  }
  // DD-MM-YYYY or DD/MM/YYYY
  match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (match) {
    return {
      year: Number(match[3]),
      monthIndex: Number(match[2]) - 1,
      day: Number(match[1])
    }
  }

  const d = new Date(text)
  if (!Number.isNaN(d.getTime())) {
    return { year: d.getFullYear(), monthIndex: d.getMonth(), day: d.getDate() }
  }
  return null
}

const emptyMonthBuckets = () => (
  MONTH_NAMES.map((name, index) => ({
    month: index + 1,
    name,
    days: []
  }))
)

const pushDay = (buckets, monthIndex, entry) => {
  if (monthIndex < 0 || monthIndex > 11 || !entry) return
  buckets[monthIndex].days.push(entry)
}

/**
 * Build one calendar day. Month must come from a real date / month field —
 * never dump unknown rows into January.
 */
const calendarDayFromItem = (raw, yearHint, forcedMonthIndex = null) => {
  if (raw == null) return null

  if (typeof raw === 'number' || (typeof raw === 'string' && raw !== '' && Number.isFinite(Number(raw)))) {
    if (forcedMonthIndex == null) return null
    const aqi = Number(raw)
    if (!Number.isFinite(aqi)) return null
    return {
      monthIndex: forcedMonthIndex,
      day: null,
      aqi,
      color: aqiInColor(aqi),
      date: null
    }
  }

  if (typeof raw !== 'object') return null

  const aqi = Number(
    raw.aqi ?? raw.AQI ?? raw.value ?? raw.avg ?? raw.average ?? raw['AQI-IN'] ?? raw.aqiValue
  )
  if (!Number.isFinite(aqi)) return null

  // aqi.in calendar rows look like: { day: "2026-01-01", value: 219 }
  const dateInfo = parseCalendarDate(
    raw.dateString
    ?? raw.fullDate
    ?? raw.timestamp
    ?? raw.time
    ?? raw.datetime
    ?? raw.created_at
    ?? (typeof raw.day === 'string' ? raw.day : null)
    ?? (typeof raw.date === 'string' || (typeof raw.date === 'number' && raw.date > 31) ? raw.date : null)
  )

  let monthIndex = forcedMonthIndex
  if (monthIndex == null && dateInfo) monthIndex = dateInfo.monthIndex
  if (monthIndex == null) {
    const fromField = monthIndexFromKey(raw.month ?? raw.Month ?? raw.monthIndex ?? raw.mon)
    if (fromField >= 0) monthIndex = fromField
  }
  if (monthIndex == null || monthIndex < 0 || monthIndex > 11) return null

  let day = dateInfo?.day ?? null
  if (!Number.isFinite(day) && typeof raw.day === 'number' && raw.day >= 1 && raw.day <= 31) {
    day = raw.day
  }
  if (!Number.isFinite(day) && typeof raw.Day === 'number') day = raw.Day
  if (!Number.isFinite(day) && typeof raw.date === 'number' && raw.date >= 1 && raw.date <= 31) {
    day = raw.date
  }

  const year = dateInfo?.year || yearHint
  const dateLabel = dateInfo
    ? `${dateInfo.year}-${String(dateInfo.monthIndex + 1).padStart(2, '0')}-${String(dateInfo.day).padStart(2, '0')}`
    : (Number.isFinite(day)
      ? `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null)

  return {
    monthIndex,
    day: Number.isFinite(day) ? day : null,
    aqi,
    color: aqiInColor(aqi),
    date: dateLabel
  }
}

const finalizeMonthBuckets = (buckets) => (
  buckets.map((month) => ({
    ...month,
    days: [...month.days]
      .map((d, index) => ({
        day: d.day ?? index + 1,
        aqi: d.aqi,
        color: d.color,
        date: d.date
      }))
      .sort((a, b) => (a.day || 0) - (b.day || 0))
  }))
)

/** Collect day rows from common aqi.in calendar payload shapes. */
const collectCalendarItems = (block, yearNum) => {
  const items = []

  // Parallel arrays (same pattern as history endpoints)
  const values = block?.averageArray || block?.aqiArray || block?.values || block?.aqi
  const times = block?.timeArray || block?.dateArray || block?.dates || block?.times
  if (Array.isArray(values) && Array.isArray(times) && values.length && times.length) {
    const length = Math.min(values.length, times.length)
    for (let i = 0; i < length; i += 1) {
      items.push({ aqi: values[i], date: times[i], time: times[i] })
    }
    return items
  }

  if (Array.isArray(block)) {
    return block
  }

  if (!block || typeof block !== 'object') return items

  // Explicit month maps: { January: [...], "1": [...], ... }
  let foundMonthMap = false
  MONTH_NAMES.forEach((name, index) => {
    const keyCandidates = [
      name,
      name.toLowerCase(),
      name.slice(0, 3),
      name.slice(0, 3).toLowerCase(),
      String(index + 1),
      String(index + 1).padStart(2, '0')
    ]
    const source = block.months || block.Months || block.calendar || block
    for (const key of keyCandidates) {
      const list = source?.[key]
      if (Array.isArray(list)) {
        foundMonthMap = true
        list.forEach((row) => {
          items.push(
            typeof row === 'object' && row
              ? { ...row, month: row.month ?? index + 1 }
              : { aqi: row, month: index + 1, day: undefined }
          )
        })
        break
      }
      if (list && typeof list === 'object') {
        const nested = list.days || list.data || list.values
        if (Array.isArray(nested)) {
          foundMonthMap = true
          nested.forEach((row) => {
            items.push(
              typeof row === 'object' && row
                ? { ...row, month: row.month ?? index + 1 }
                : { aqi: row, month: index + 1 }
            )
          })
          break
        }
      }
    }
  })
  if (foundMonthMap) return items

  // Flat list under a known key
  const flat = block.days || block.data || block.records || block.list || block.calendarData
  if (Array.isArray(flat)) return flat

  return items
}

/**
 * Yearly AQI calendar for a city slug (aqi.in path spelling: getAqiCalender).
 */
export const fetchAqiCalendar = async ({
  slug,
  year,
  slugType = 'cityId',
  sensorname = 'AQI-IN',
  source = 'web'
} = {}) => {
  if (!slug) throw new Error('Calendar slug is required')
  const yearNum = Number(year) || new Date().getFullYear()

  const params = new URLSearchParams({
    slug: String(slug),
    slugType: String(slugType),
    sensorname: String(sensorname),
    year: String(yearNum),
    source: String(source)
  })

  const response = await fetch(
    `${AQI_IN_BASE}/calendar?${params.toString()}`,
    { method: 'GET', headers: jsonHeaders() }
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `aqi.in calendar error ${response.status}`)
  }

  const payload = await response.json()
  const block = payload?.data ?? payload?.Data ?? payload
  const buckets = emptyMonthBuckets()
  const rows = collectCalendarItems(block, yearNum)

  rows.forEach((row) => {
    const forcedMonth = monthIndexFromKey(row?.month ?? row?.Month)
    const entry = calendarDayFromItem(
      row,
      yearNum,
      forcedMonth >= 0 ? forcedMonth : null
    )
    if (!entry) return
    // Keep rows for the requested year when a date year is present
    if (entry.date) {
      const parsed = parseCalendarDate(entry.date)
      if (parsed && parsed.year !== yearNum) return
    }
    pushDay(buckets, entry.monthIndex, entry)
  })

  const months = finalizeMonthBuckets(buckets)
  const allDays = months.flatMap((m) => m.days)
  let minAqi = null
  let maxAqi = null
  let sum = 0
  allDays.forEach((d) => {
    if (!Number.isFinite(d.aqi)) return
    if (minAqi == null || d.aqi < minAqi) minAqi = d.aqi
    if (maxAqi == null || d.aqi > maxAqi) maxAqi = d.aqi
    sum += d.aqi
  })

  return {
    status: payload.status,
    message: payload.message,
    year: yearNum,
    slug,
    slugType,
    months,
    dayCount: allDays.length,
    minAqi,
    maxAqi,
    avgAqi: allDays.length ? Math.round(sum / allDays.length) : null,
    fetchedAt: new Date().toISOString()
  }
}
