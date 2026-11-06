const API_BASE = import.meta.env.DEV ? '/api' : 'https://climateye-apis.up.railway.app/api'
// Results are biased towards India but places elsewhere are still found
const BIAS_CENTER = { lat: 22.5, lon: 79 }

const PLACE_ZOOM = {
  city: 12,
  town: 13,
  village: 14,
  hamlet: 15,
  suburb: 14,
  quarter: 15,
  neighbourhood: 15,
  locality: 15,
  isolated_dwelling: 16,
  farm: 16,
  county: 10,
  district: 10,
  state: 7,
  region: 7,
  country: 5
}

const PLACE_LABELS = {
  isolated_dwelling: 'Dwelling',
  neighbourhood: 'Neighbourhood'
}

const formatType = (value) => (
  PLACE_LABELS[value] || (value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : 'Place')
)

const toPlace = (feature) => {
  const props = feature.properties || {}
  const [lng, lat] = feature.geometry?.coordinates || []
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !props.name) return null
  const context = [props.district || props.county, props.state, props.country]
    .filter((part, index, parts) => part && part !== props.name && parts.indexOf(part) === index)
  // Photon extent is [minLng, maxLat, maxLng, minLat]
  const bounds = Array.isArray(props.extent) && props.extent.length === 4
    ? [[props.extent[3], props.extent[0]], [props.extent[1], props.extent[2]]]
    : null
  return {
    id: `${props.osm_type}${props.osm_id}`,
    name: props.name,
    type: formatType(props.osm_value),
    context: context.join(', '),
    lat,
    lng,
    bounds,
    zoom: PLACE_ZOOM[props.osm_value] || 13
  }
}

/**
 * Search cities, towns, villages and other named places (via ClimateEye → Photon)
 */
export const searchPlaces = async (query, signal) => {
  const params = new URLSearchParams({
    q: query,
    limit: '8',
    lang: 'en',
    lat: String(BIAS_CENTER.lat),
    lon: String(BIAS_CENTER.lon),
    osm_tag: 'place'
  })
  const response = await fetch(`${API_BASE}/geocode/search?${params}`, { signal })
  if (!response.ok) throw new Error(`Search failed (${response.status})`)
  const data = await response.json()
  const seen = new Set()
  return (data.features || [])
    .map(toPlace)
    .filter((place) => {
      if (!place || seen.has(place.id)) return false
      seen.add(place.id)
      return true
    })
}

/** Reverse geocode via ClimateEye → Nominatim (raw payload) */
export const reverseGeocode = async (latitude, longitude, { zoom = 10, signal } = {}) => {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    zoom: String(zoom),
    addressdetails: '1'
  })
  const response = await fetch(`${API_BASE}/geocode/reverse?${params}`, {
    headers: { Accept: 'application/json' },
    signal
  })
  if (!response.ok) return null
  return response.json()
}

/** Reverse geocode → { city, state, country } */
export const reverseGeocodePlace = async (latitude, longitude) => {
  try {
    const data = await reverseGeocode(latitude, longitude)
    if (!data) return null
    const a = data.address || {}
    return {
      city: a.city || a.town || a.village || a.suburb || a.county || 'Your area',
      state: a.state || a.region || '',
      country: a.country || ''
    }
  } catch {
    return null
  }
}
