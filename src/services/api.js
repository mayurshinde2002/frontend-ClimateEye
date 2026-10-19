import { ringCentroid } from '../utils/polygonIndex'

const API_BASE_URL = import.meta.env.DEV ? '/api' : 'https://climateye-apis.up.railway.app/api'

/**
 * Calculate the center point (centroid) of a polygon geometry
 */
export const calculateGeometryCenter = (geometry) => {
  if (!geometry || !geometry.coordinates || !geometry.coordinates[0]) {
    return null
  }

  const coordinates = geometry.coordinates[0] 
  let sumLat = 0
  let sumLng = 0

  coordinates.forEach(coord => {
    sumLng += coord[0] // Longitude
    sumLat += coord[1] // Latitude
  })

  return {
    latitude: sumLat / coordinates.length,
    longitude: sumLng / coordinates.length
  }
}

/**
 * Fetch AQI data from backend
 */
export const fetchAQIData = async (latitude, longitude, date = null) => {
  try {
    const response = await fetch(`${API_BASE_URL}/aqi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude,
        longitude,
        date: date || undefined
      })
    })

    if (!response.ok) {
      throw new Error(`AQI API error: ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('Error fetching AQI data:', error)
    throw error
  }
}

/**
 * Fetch Weather data from backend
 */
export const fetchWeatherData = async (latitude, longitude, date = null) => {
  try {
    const response = await fetch(`${API_BASE_URL}/weather`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude,
        longitude,
        date: date || undefined
      })
    })

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('Error fetching weather data:', error)
    throw error
  }
}

/**
 * Fetch hourly AQI data from backend
 */
export const fetchHourlyAQIData = async (latitude, longitude, date) => {
  try {
    const response = await fetch(`${API_BASE_URL}/aqi/hourly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude,
        longitude,
        date
      })
    })

    if (!response.ok) {
      throw new Error(`Hourly AQI API error: ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('Error fetching hourly AQI data:', error)
    throw error
  }
}

/**
 * Fetch hourly AQI data for a date range
 */
export const fetchHourlyAQIDataRange = async (latitude, longitude, startDate, endDate) => {
  try {
    const response = await fetch(`${API_BASE_URL}/aqi/hourly/range`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude,
        longitude,
        start_date: startDate,
        end_date: endDate
      })
    })

    if (!response.ok) {
      throw new Error(`Hourly AQI Range API error: ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('Error fetching hourly AQI data range:', error)
    throw error
  }
}

/**
 * Fetch hourly Weather data from backend
 */
export const fetchHourlyWeatherData = async (latitude, longitude, date) => {
  try {
    const response = await fetch(`${API_BASE_URL}/weather/hourly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude,
        longitude,
        date
      })
    })

    if (!response.ok) {
      throw new Error(`Hourly Weather API error: ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('Error fetching hourly weather data:', error)
    throw error
  }
}

/**
 * Hourly rain forecast via backend → Open-Meteo
 * https://api.open-meteo.com/v1/forecast?hourly=rain
 * Dev falls back to Vite /open-meteo proxy if the Railway route is not deployed yet.
 */
export const fetchOpenMeteoRainForecast = async (latitude, longitude) => {
  const body = JSON.stringify({ latitude, longitude })
  try {
    const response = await fetch(`${API_BASE_URL}/weather/rain-forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    })
    if (response.ok) return response.json()
  } catch (error) {
    if (!import.meta.env.DEV) {
      console.error('Error fetching rain forecast:', error)
      throw error
    }
  }

  if (!import.meta.env.DEV) {
    throw new Error('Rain forecast API error')
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: 'rain'
  })
  const response = await fetch(`/open-meteo/v1/forecast?${params}`)
  if (!response.ok) {
    throw new Error(`Open-Meteo rain forecast error: ${response.statusText}`)
  }
  return response.json()
}

/**
 * Fetch monthly weather forecast data from backend
 */
export const fetchMonthlyWeatherData = async (latitude, longitude, year, month) => {
  try {
    const response = await fetch(`${API_BASE_URL}/weather/monthly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude,
        longitude,
        year,
        month
      })
    })

    
    // Get response as text first to handle NaN values and error messages
    const text = await response.text()
    
    // If response is not ok, try to parse error message from response
    if (!response.ok) {
      let errorMessage = `Monthly Weather API error: ${response.status} ${response.statusText}`
      try {
        const errorData = JSON.parse(text)
        if (errorData.message || errorData.error) {
          errorMessage = errorData.message || errorData.error || errorMessage
        }
      } catch (e) {
        // If we can't parse error, use the text or default message
        if (text && text.length < 200) {
          errorMessage = text
        }
      }
      
      // Provide more specific error messages based on status code
      if (response.status === 404) {
        errorMessage = `No weather data available for ${month}/${year}`
      } else if (response.status === 400) {
        errorMessage = `Invalid request for ${month}/${year}. Please check the date.`
      } else if (response.status === 500) {
        errorMessage = `Server error while fetching data for ${month}/${year}. Please try again later.`
      } else if (response.status === 503) {
        errorMessage = `Service temporarily unavailable for ${month}/${year}. Please try again later.`
      }
      
      throw new Error(errorMessage)
    }

    // Replace NaN values with null to make valid JSON
    const sanitizedText = text.replace(/:\s*NaN/g, ': null').replace(/:\s*-?Infinity/g, ': null')
    
    let data
    try {
      data = JSON.parse(sanitizedText)
    } catch (parseError) {
      console.error('Error parsing JSON response:', parseError)
      console.error('Response text:', text.substring(0, 500))
      throw new Error(`Invalid JSON response from API: ${parseError.message}`)
    }

    // Recursively clean any remaining NaN or Infinity values in the parsed data
    const cleanData = (obj) => {
      if (obj === null || obj === undefined) return obj
      if (typeof obj === 'number' && (isNaN(obj) || !isFinite(obj))) return null
      if (Array.isArray(obj)) return obj.map(cleanData)
      if (typeof obj === 'object') {
        const cleaned = {}
        for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
            cleaned[key] = cleanData(obj[key])
          }
        }
        return cleaned
      }
      return obj
    }

    return cleanData(data)
  } catch (error) {
    console.error(`Error fetching monthly weather data for ${month}/${year}:`, error)
    // Re-throw with more context if it's not already a formatted error
    if (error.message && !error.message.includes('Monthly Weather API error')) {
      throw new Error(`Failed to fetch weather data for ${month}/${year}: ${error.message}`)
    }
    throw error
  }
}

/**
 * Fetch AQI analysis from backend
 */
export const fetchAQIAnalysis = async (latitude, longitude, date) => {
  try {
    const response = await fetch(`${API_BASE_URL}/aqi/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude,
        longitude,
        date
      })
    })

    if (!response.ok) {
      throw new Error(`AQI Analysis API error: ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('Error fetching AQI analysis:', error)
    throw error
  }
}

const METHANE_ARCHIVE_START = '2022-08-10'
const METHANE_ARCHIVE_END = '2026-06-09'

const readApiJson = async (response) => {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`)
  }
  return data
}

/**
 * Keep a date range inside the published methane archive.
 * Ranges that do not overlap fall back to the latest 90 archive days.
 */
export const resolveMethaneDateRange = (startDate, endDate) => {
  if (!startDate || !endDate || endDate < METHANE_ARCHIVE_START || startDate > METHANE_ARCHIVE_END) {
    const end = new Date(`${METHANE_ARCHIVE_END}T00:00:00`)
    const start = new Date(end)
    start.setDate(start.getDate() - 90)
    const startStr = start.toISOString().slice(0, 10)
    return {
      startDate: startStr < METHANE_ARCHIVE_START ? METHANE_ARCHIVE_START : startStr,
      endDate: METHANE_ARCHIVE_END,
      note: `Selected dates are outside the methane archive (${METHANE_ARCHIVE_START} to ${METHANE_ARCHIVE_END}). Showing the latest available period.`
    }
  }

  const clampedStart = startDate < METHANE_ARCHIVE_START ? METHANE_ARCHIVE_START : startDate
  const clampedEnd = endDate > METHANE_ARCHIVE_END ? METHANE_ARCHIVE_END : endDate
  return {
    startDate: clampedStart,
    endDate: clampedEnd,
    note: clampedStart !== startDate || clampedEnd !== endDate
      ? `Methane archive covers ${METHANE_ARCHIVE_START} to ${METHANE_ARCHIVE_END}. Showing ${clampedStart} to ${clampedEnd}.`
      : null
  }
}

export const boundsFromGeometry = (geometry) => {
  const ring = geometry?.coordinates?.[0]
  if (!ring || ring.length === 0) return null

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  ring.forEach(([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  })

  if (!Number.isFinite(minLng)) return null
  return `${minLng},${minLat},${maxLng},${maxLat}`
}

const methaneQuery = ({ bounds, latitude, longitude, startDate, endDate }) => {
  const params = new URLSearchParams()
  if (bounds) {
    params.set('bounds', bounds)
  } else {
    params.set('latitude', String(latitude))
    params.set('longitude', String(longitude))
  }
  if (startDate) params.set('start_date', startDate)
  if (endDate) params.set('end_date', endDate)
  return params.toString()
}

// Earth Engine returns at most 5000 buildings per call, so a drawn area is cut into boxes of about
// 2 km² and each box is requested on its own. A full box is split again.
const BUILDINGS_CELL_KM2 = 2
const BUILDINGS_MAX_CELL_KM2 = 20
const BUILDINGS_MAX_REQUESTS = 60
const BUILDINGS_MAX_SPLIT_DEPTH = 6
const BUILDINGS_MIN_CELL_KM2 = 0.05
const BUILDINGS_CONCURRENCY = 4

const parseBoundsBox = (bounds) => {
  const [minLng, minLat, maxLng, maxLat] = String(bounds).split(',').map(Number)
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null
  if (minLng >= maxLng || minLat >= maxLat) return null
  return { minLng, minLat, maxLng, maxLat }
}

const formatBoundsBox = (box) => `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`

const boxAreaKm2 = (box) => {
  const midLat = ((box.minLat + box.maxLat) / 2) * Math.PI / 180
  const widthKm = (box.maxLng - box.minLng) * 111.32 * Math.cos(midLat)
  const heightKm = (box.maxLat - box.minLat) * 110.574
  return Math.abs(widthKm * heightKm)
}

const splitBoundsBox = (box) => {
  const midLng = (box.minLng + box.maxLng) / 2
  const midLat = (box.minLat + box.maxLat) / 2
  return [
    { minLng: box.minLng, minLat: box.minLat, maxLng: midLng, maxLat: midLat },
    { minLng: midLng, minLat: box.minLat, maxLng: box.maxLng, maxLat: midLat },
    { minLng: box.minLng, minLat: midLat, maxLng: midLng, maxLat: box.maxLat },
    { minLng: midLng, minLat: midLat, maxLng: box.maxLng, maxLat: box.maxLat }
  ]
}

const buildingCells = (box) => {
  const area = boxAreaKm2(box)
  const cellArea = Math.min(
    BUILDINGS_MAX_CELL_KM2,
    Math.max(BUILDINGS_CELL_KM2, area / BUILDINGS_MAX_REQUESTS)
  )
  const midLat = ((box.minLat + box.maxLat) / 2) * Math.PI / 180
  const widthKm = Math.abs((box.maxLng - box.minLng) * 111.32 * Math.cos(midLat))
  const heightKm = Math.abs((box.maxLat - box.minLat) * 110.574)
  const cellKm = Math.sqrt(cellArea)
  const cols = Math.max(1, Math.ceil(widthKm / cellKm))
  const rows = Math.max(1, Math.ceil(heightKm / cellKm))
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
  return cells
}

const createRequestPool = (concurrency) => {
  let active = 0
  const waiting = []
  return (task) => new Promise((resolve, reject) => {
    const start = () => {
      active += 1
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1
          if (waiting.length) waiting.shift()()
        })
    }
    if (active < concurrency) start()
    else waiting.push(start)
  })
}

const buildingFeatureKey = (feature) => {
  const centroid = ringCentroid(feature.geometry)
  const kind = feature.properties?.detection || ''
  if (!centroid) return `${kind}:${JSON.stringify(feature.geometry?.coordinates || []).slice(0, 120)}`
  return `${kind}:${centroid[0].toFixed(5)},${centroid[1].toFixed(5)}`
}

const mergeBuildingPayloads = (parts, truncated) => {
  const seen = new Set()
  const features = []
  parts.forEach((part) => {
    ;(part.geojson?.features || []).forEach((feature) => {
      const key = buildingFeatureKey(feature)
      if (seen.has(key)) return
      seen.add(key)
      features.push(feature)
    })
  })
  const detectedCount = features.filter(feature => feature.properties?.detection === 'imagery').length
  return {
    count: features.length,
    footprint_count: features.length - detectedCount,
    detected_count: detectedCount,
    truncated: truncated || parts.some(part => part.truncated),
    attribution: parts.find(part => part.attribution)?.attribution,
    geojson: { type: 'FeatureCollection', features }
  }
}

const fetchBuildingsBox = async (box) => {
  const response = await fetch(`${API_BASE_URL}/buildings?bounds=${encodeURIComponent(formatBoundsBox(box))}`)
  if (response.status === 404) {
    const error = new Error('Estimated building heights are not available yet')
    error.status = 404
    throw error
  }
  return readApiJson(response)
}

/**
 * Fetch Google Open Buildings footprints with estimated heights for "minLng,minLat,maxLng,maxLat".
 * Large areas are requested as several smaller boxes. onChunk is called as each box arrives.
 */
export const fetchBuildings = async (bounds, { onChunk } = {}) => {
  const root = parseBoundsBox(bounds)
  if (!root) throw new Error('Invalid area bounds')

  const schedule = createRequestPool(BUILDINGS_CONCURRENCY)
  const leaves = []
  let requests = 0
  let capped = false

  const publish = () => {
    if (onChunk && leaves.length) onChunk(mergeBuildingPayloads(leaves, capped))
  }

  const fetchBox = async (box, depth) => {
    let data
    try {
      data = await schedule(() => {
        if (requests >= BUILDINGS_MAX_REQUESTS) {
          capped = true
          return null
        }
        requests += 1
        return fetchBuildingsBox(box)
      })
    } catch (err) {
      if (err.status === 404) throw err
      const canSplit = depth < BUILDINGS_MAX_SPLIT_DEPTH &&
        /5000 elements|Area too large/i.test(err.message || '')
      if (!canSplit) throw err
      await Promise.all(splitBoundsBox(box).map(child => fetchBox(child, depth + 1)))
      return
    }
    if (!data) return
    const canSplit = data.truncated &&
      depth < BUILDINGS_MAX_SPLIT_DEPTH &&
      boxAreaKm2(box) > BUILDINGS_MIN_CELL_KM2
    if (canSplit) {
      await Promise.all(splitBoundsBox(box).map(child => fetchBox(child, depth + 1)))
      return
    }
    leaves.push(data)
    publish()
  }

  const errors = []
  await Promise.all(buildingCells(root).map(cell => (
    fetchBox(cell, 0).catch((err) => {
      if (err.status === 404) throw err
      errors.push(err)
    })
  )))

  if (!leaves.length && errors.length) throw errors[0]
  const merged = mergeBuildingPayloads(leaves, capped || errors.length > 0)
  if (!leaves.length) {
    merged.note = 'No building heights were returned for this area.'
  } else if (errors.length) {
    merged.note = 'Some parts of this area could not be loaded. Draw that part again to retry.'
  } else if (merged.truncated) {
    merged.note = 'This area is very large, so some buildings were left out. Draw a smaller area for full coverage.'
  }
  return merged
}

export const fetchMethaneCatalog = async () => {
  const response = await fetch(`${API_BASE_URL}/methane`)
  return readApiJson(response)
}

export const fetchMethanePlumes = async (query) => {
  const response = await fetch(`${API_BASE_URL}/methane/plumes?${methaneQuery(query)}`)
  return readApiJson(response)
}

export const fetchMethaneTiles = async (query) => {
  const response = await fetch(`${API_BASE_URL}/methane/tiles?${methaneQuery(query)}`)
  return readApiJson(response)
}

