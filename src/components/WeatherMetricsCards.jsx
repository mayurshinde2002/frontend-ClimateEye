import React, { useState, useEffect } from 'react'
import { format, parseISO, isToday } from 'date-fns'
import { fetchHourlyWeatherData, calculateGeometryCenter } from '../services/api'
import './WeatherMetricsCards.css'

const WeatherMetricsCards = ({ geometry, date, isLive = false }) => {
  const [metricsData, setMetricsData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [location, setLocation] = useState(null)
  const [coordinates, setCoordinates] = useState(null)

  useEffect(() => {
    if (geometry) {
      const center = calculateGeometryCenter(geometry)
      if (center) {
        setCoordinates(center)
        // Get location name from coordinates using reverse geocoding
        fetchLocationName(center.latitude, center.longitude)
      }
    }
  }, [geometry])

  const fetchLocationName = async (lat, lng) => {
    try {
      // Using Open-Meteo geocoding API (free, no key required)
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=&latitude=${lat}&longitude=${lng}&count=1`)
      const data = await response.json()
      if (data.results && data.results.length > 0) {
        setLocation(data.results[0].name || 'Location')
      } else {
        setLocation('Location')
      }
    } catch (error) {
      console.error('Error fetching location:', error)
      setLocation('Location')
    }
  }

  useEffect(() => {
    if (coordinates && date) {
      fetchMetrics()
    }
  }, [coordinates, date, isLive])

  const fetchMetrics = async () => {
    if (!coordinates) return

    setLoading(true)
    try {
      const data = await fetchHourlyWeatherData(coordinates.latitude, coordinates.longitude, date)
      
      if (data && data.hourly_records && data.hourly_records.length > 0) {
        const records = data.hourly_records.filter(r => r !== null && r !== undefined)
        
        if (records.length === 0) {
          setLoading(false)
          return
        }
        
        // Check if the date is today
        const selectedDate = parseISO(date)
        const today = new Date()
        const isTodayDate = isToday(selectedDate) && 
                           selectedDate.getDate() === today.getDate() &&
                           selectedDate.getMonth() === today.getMonth() &&
                           selectedDate.getFullYear() === today.getFullYear()
        
        if (isTodayDate || isLive) {
          // For today: use the most recent (latest) value from Open Meteo API
          const latest = records[records.length - 1]
          setMetricsData({
            windSpeed: latest.wind_speed || 0,
            windGusts: latest.wind_gusts || 0,
            windDirection: latest.wind_direction || 0,
            cloudCover: latest.cloud_cover || 0,
            visibility: latest.visibility || 0,
            pressure: latest.pressure || 0,
            precipitation: latest.precipitation || 0,
            uvIndex: latest.uv_index || 0,
            temperature: latest.temperature || 0
          })
        } else {
          // For previous days: calculate average values from all hourly records
          const validRecords = records.filter(r => 
            (r.wind_speed !== null && r.wind_speed !== undefined) ||
            (r.wind_gusts !== null && r.wind_gusts !== undefined) ||
            (r.cloud_cover !== null && r.cloud_cover !== undefined) ||
            (r.visibility !== null && r.visibility !== undefined) ||
            (r.pressure !== null && r.pressure !== undefined) ||
            (r.precipitation !== null && r.precipitation !== undefined) ||
            (r.uv_index !== null && r.uv_index !== undefined) ||
            (r.temperature !== null && r.temperature !== undefined)
          )
          
          if (validRecords.length > 0) {
            // Calculate averages for all metrics
            const windSpeeds = validRecords.map(r => r.wind_speed).filter(v => v !== null && v !== undefined)
            const windGusts = validRecords.map(r => r.wind_gusts).filter(v => v !== null && v !== undefined)
            const cloudCovers = validRecords.map(r => r.cloud_cover).filter(v => v !== null && v !== undefined)
            const visibilities = validRecords.map(r => r.visibility).filter(v => v !== null && v !== undefined)
            const pressures = validRecords.map(r => r.pressure).filter(v => v !== null && v !== undefined)
            const precipitations = validRecords.map(r => r.precipitation).filter(v => v !== null && v !== undefined)
            const uvIndices = validRecords.map(r => r.uv_index).filter(v => v !== null && v !== undefined)
            const temperatures = validRecords.map(r => r.temperature).filter(v => v !== null && v !== undefined)
            
            // Use first record's wind direction (most representative)
            const windDirection = validRecords[0]?.wind_direction || 0
            
            setMetricsData({
              windSpeed: windSpeeds.length > 0 ? windSpeeds.reduce((sum, v) => sum + v, 0) / windSpeeds.length : 0,
              windGusts: windGusts.length > 0 ? windGusts.reduce((sum, v) => sum + v, 0) / windGusts.length : 0,
              windDirection: windDirection,
              cloudCover: cloudCovers.length > 0 ? cloudCovers.reduce((sum, v) => sum + v, 0) / cloudCovers.length : 0,
              visibility: visibilities.length > 0 ? visibilities.reduce((sum, v) => sum + v, 0) / visibilities.length : 0,
              pressure: pressures.length > 0 ? pressures.reduce((sum, v) => sum + v, 0) / pressures.length : 0,
              precipitation: precipitations.length > 0 ? precipitations.reduce((sum, v) => sum + v, 0) / precipitations.length : 0,
              uvIndex: uvIndices.length > 0 ? uvIndices.reduce((sum, v) => sum + v, 0) / uvIndices.length : 0,
              temperature: temperatures.length > 0 ? temperatures.reduce((sum, v) => sum + v, 0) / temperatures.length : 0
            })
          }
        }
      }
    } catch (error) {
      console.error('Error fetching metrics from Open Meteo API:', error)
      setMetricsData(null)
    } finally {
      setLoading(false)
    }
  }

  const getWindSpeedLabel = (speed) => {
    if (speed < 5) return 'Calm'
    if (speed < 12) return 'Light breeze'
    if (speed < 20) return 'Gentle breeze'
    if (speed < 30) return 'Moderate breeze'
    return 'Strong breeze'
  }

  const getPressureLabel = (pressure) => {
    if (pressure < 1000) return 'Low'
    if (pressure < 1013) return 'Normal'
    return 'High'
  }

  const getUVLabel = (uv) => {
    if (uv < 3) return 'Low'
    if (uv < 6) return 'Moderate'
    if (uv < 8) return 'High'
    return 'Very High'
  }

  const getWindDirection = (degrees) => {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    const index = Math.round(degrees / 22.5) % 16
    return directions[index]
  }

  if (!coordinates) {
    return null
  }

  if (loading) {
    return (
      <div className="weather-metrics-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading weather metrics...</p>
        </div>
      </div>
    )
  }

  if (!metricsData) {
    return (
      <div className="weather-metrics-container">
        <div className="error-message">
          <p>No weather data available for this date.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="weather-metrics-container">
      <div className="metrics-grid">
        {/* Wind Speed Card */}
        <div className="metric-card wind-card" style={{ gridColumn: '1', gridRow: '1' }}>
          <div className="metric-icon">
            <span className="metric-emoji">🌪️</span>
          </div>
          <div className="metric-content">
            <div className="metric-header">
              <span className="metric-label">Wind Speed</span>
              <span className="metric-value">{Math.round(metricsData.windSpeed)} km/h</span>
            </div>
            <button className="metric-badge light-blue">{getWindSpeedLabel(metricsData.windSpeed)}</button>
            <div className="metric-details">
              <div className="detail-item">
                <span className="detail-label">Gust Speed</span>
                <span className="detail-value">{Math.round(metricsData.windGusts * 0.277778)} m/s</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Direction</span>
                <span className="detail-value">{Math.round(metricsData.windDirection)}° {getWindDirection(metricsData.windDirection)}</span>
              </div>
            </div>
            <p className="metric-summary">Current wind speed is {Math.round(metricsData.windSpeed)} km/h, with gusts at {Math.round(metricsData.windGusts * 0.277778)} m/s</p>
          </div>
        </div>

        {/* Cloud Cover & Visibility Card */}
        <div className="metric-card cloud-card" style={{ gridColumn: '2', gridRow: '1' }}>
          <div className="metric-icon">
            <span className="metric-emoji">☁️</span>
          </div>
          <div className="metric-content">
            <div className="metric-header">
              <span className="metric-label">Cloud Cover</span>
              <span className="metric-value">{Math.round(metricsData.cloudCover)}%</span>
            </div>
            <div className="metric-header">
              <span className="metric-label">Visibility</span>
              <span className="metric-value">{Math.round(metricsData.visibility)} km</span>
            </div>
            <p className="metric-summary">Recent visibility is {Math.round(metricsData.visibility)}km with {Math.round(metricsData.cloudCover)}% cloud coverage, so plan accordingly!</p>
          </div>
        </div>

        {/* Pressure Card */}
        <div className="metric-card pressure-card" style={{ gridColumn: '3', gridRow: '1' }}>
          <div className="metric-icon">
            <span className="metric-emoji">🌡️</span>
          </div>
          <div className="metric-content">
            <div className="metric-header">
              <span className="metric-label">Pressure</span>
              <span className="metric-value">{Math.round(metricsData.pressure)} mb</span>
            </div>
            <button className="metric-badge purple">{getPressureLabel(metricsData.pressure)}</button>
            <div className="pressure-bar">
              <div className="pressure-scale">
                <div className="pressure-indicator" style={{ left: `${((metricsData.pressure - 1000) / 20) * 100}%` }}></div>
              </div>
            </div>
            <p className="metric-summary">Current pressure level is {Math.round(metricsData.pressure)} mb.</p>
          </div>
        </div>

        {/* Precipitation Card */}
        <div className="metric-card precipitation-card" style={{ gridColumn: '4', gridRow: '1' }}>
          <div className="metric-icon">
            <span className="metric-emoji">⛈️</span>
          </div>
          <div className="metric-content">
            <div className="metric-header">
              <span className="metric-label">Precipitation</span>
              <span className="metric-value">{metricsData.precipitation.toFixed(1)} mm</span>
            </div>
            <p className="metric-summary">Current precipitation chances sit at {metricsData.precipitation.toFixed(1)}mm</p>
          </div>
        </div>

        {/* UV Index Card */}
        <div className="metric-card uv-card" style={{ gridColumn: '5', gridRow: '1' }}>
          <div className="metric-icon">
            <span className="metric-emoji">☀️</span>
          </div>
          <div className="metric-content">
            <div className="metric-header">
              <span className="metric-label">UV Index</span>
              <span className="metric-value">{Math.round(metricsData.uvIndex)}</span>
            </div>
            <div className="uv-bar">
              <div className="uv-scale">
                <div className="uv-indicator" style={{ left: `${Math.min((metricsData.uvIndex / 11) * 100, 100)}%` }}></div>
              </div>
            </div>
            <p className="metric-summary">The present UV index is {Math.round(metricsData.uvIndex)}, consider suggestions for the same!</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WeatherMetricsCards

