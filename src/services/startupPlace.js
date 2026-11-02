import { resolveCityFromCoords } from './aqiInApi'

/** Default fallback when geolocation is unavailable or denied. */
export const MUMBAI_PLACE = {
  city: 'Mumbai',
  state: 'Maharashtra',
  country: 'India',
  latitude: 19.076,
  longitude: 72.8777
}

const reverseGeocode = async (latitude, longitude) => {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    const a = data.address || {}
    return {
      city: a.city || a.town || a.village || a.suburb || a.county || 'Your area',
      state: a.state || a.region || '',
      country: a.country || 'India'
    }
  } catch {
    return null
  }
}

const readGeolocation = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60000
    })
  })

/**
 * Prefer the device's current location; fall back to Mumbai.
 * @returns {Promise<{ place: object, source: 'geolocation' | 'mumbai', error?: string }>}
 */
export const resolveStartupPlace = async () => {
  try {
    const pos = await readGeolocation()
    const latitude = pos.coords.latitude
    const longitude = pos.coords.longitude
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { place: MUMBAI_PLACE, source: 'mumbai', error: 'Invalid coordinates' }
    }

    const [geo, city] = await Promise.all([
      reverseGeocode(latitude, longitude),
      resolveCityFromCoords(latitude, longitude).catch(() => null)
    ])

    return {
      place: {
        city: geo?.city || city?.cityName || city?.title || 'Your location',
        state: geo?.state || '',
        country: geo?.country || 'India',
        latitude,
        longitude
      },
      source: 'geolocation'
    }
  } catch (err) {
    return {
      place: MUMBAI_PLACE,
      source: 'mumbai',
      error: err?.message || 'Location unavailable'
    }
  }
}
