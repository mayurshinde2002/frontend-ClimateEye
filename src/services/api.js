const API_BASE_URL = 'https://aqi-weather-api.onrender.com/api'

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

    if (!response.ok) {
      throw new Error(`Monthly Weather API error: ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('Error fetching monthly weather data:', error)
    throw error
  }
}

