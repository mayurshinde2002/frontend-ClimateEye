/**
 * aqi.in public API (apiserver.aqi.in)
 *
 * Confirmed working (Bearer JWT):
 * - GET /aqi/v2/getNearestLocation?lat=&long=&type=1&source=web  → nearest stations
 * - GET /aqi/v2/getNearestLocation?lat=&long=&type=2&source=web  → nearest city
 * - GET /aqi/getNearestLocation?...                              → v1 (Locations key)
 * - GET /aqi/getAirQualityRanklistCountryAndCity?sensorname=aqi&type=2&limit=30&source=web
 *     → city AQI ranking (type=2 = cities)
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
