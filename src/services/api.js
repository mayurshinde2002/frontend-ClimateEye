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

