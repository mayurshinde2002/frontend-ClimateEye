import React from 'react'
import { useNavigate } from 'react-router-dom'
import './WeatherSection.css'

const WeatherSection = ({ date, data, isLive = false, loading = false, geometry, startDate, endDate, onClick, viewMode }) => {
  const navigate = useNavigate()
  // Transform API data to component format
  const weatherData = data ? {
    temperature: data.temperature || data.daily?.temp_max || null,
    feelsLike: data.feels_like || null,
    condition: data.condition || 'Unknown',
    humidity: data.humidity || data.daily?.humidity_max || null,
    windSpeed: data.wind_speed || data.daily?.wind_speed_max || null,
    uvIndex: data.uv_index || data.uv_index_max || data.daily?.uv_index_max || null,
    icon: data.icon || 'cloud',
    date: data.date || date
  } : null

  const getTemperatureColor = (temp) => {
    if (temp >= 35) return '#ef4444' // Red for hot
    if (temp >= 25) return '#f59e0b' // Orange for warm
    if (temp >= 15) return '#14b8a6' // Teal for moderate
    return '#60a5fa' // Blue for cool
  }

  const getTemperatureLabel = (temp) => {
    if (temp >= 35) return 'Hot'
    if (temp >= 25) return 'Warm'
    if (temp >= 15) return 'Moderate'
    return 'Cool'
  }

  if (loading || !weatherData) {
    return (
      <div className="weather-section">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading weather data...</p>
          {!isLive && <p className="loading-subtext">Calculating daily averages...</p>}
        </div>
      </div>
    )
  }

  const tempColor = getTemperatureColor(weatherData.temperature || 0)
  const tempLabel = getTemperatureLabel(weatherData.temperature || 0)

  const handleClick = () => {
    if (onClick) {
      onClick()
    } else {
      // Navigate to detail page with state
      // If viewMode is 'weekly', pass weeklyMode flag and calculate last 7 days
      // If viewMode is 'daily', pass dailyMode flag
      const isWeeklyMode = viewMode === 'weekly'
      const isDailyMode = viewMode === 'daily'
      let weeklyStartDate = startDate
      let weeklyEndDate = endDate
      
      if (isWeeklyMode) {
        // Calculate last 7 days from today
        const today = new Date()
        const sevenDaysAgo = new Date(today)
        sevenDaysAgo.setDate(today.getDate() - 6) // 6 days ago + today = 7 days
        weeklyStartDate = sevenDaysAgo.toISOString().split('T')[0]
        weeklyEndDate = today.toISOString().split('T')[0]
      }
      
      navigate('/weather-detail', {
        state: {
          geometry,
          startDate: isWeeklyMode ? weeklyStartDate : startDate,
          endDate: isWeeklyMode ? weeklyEndDate : endDate,
          currentDate: date,
          showAnalysis: true, // Indicate that analysis view should be restored
          weeklyMode: isWeeklyMode, // Pass weekly mode flag
          dailyMode: isDailyMode // Pass daily mode flag
        }
      })
    }
  }

  return (
    <div className="weather-section" onClick={handleClick} style={{ cursor: 'pointer' }}>
      <div className="section-header">
        <h2 className="section-title">Weather Conditions</h2>
        {isLive && (
          <div className="live-indicator">
            <span className="live-dot"></span>
            <span>LIVE</span>
          </div>
        )}
        {!isLive && weatherData && (
          <div className="daily-indicator">
            <span>DAILY AVERAGE</span>
          </div>
        )}
      </div>

      <div className="weather-content">
        <div className="temperature-display">
          <div className="temp-main">
            <span className="temp-value" style={{ color: tempColor }}>
              {weatherData.temperature}
            </span>
            <span className="temp-unit">°C</span>
          </div>
          <button className="temp-label-button" style={{ backgroundColor: tempColor }}>
            {tempLabel}
          </button>
        </div>

        <div className="weather-details">
          <div className="weather-condition">
            <div className="condition-icon">
              {weatherData.icon === 'cloud' ? (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                </svg>
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5"></circle>
                  <line x1="12" y1="1" x2="12" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="23"></line>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                  <line x1="1" y1="12" x2="3" y2="12"></line>
                  <line x1="21" y1="12" x2="23" y2="12"></line>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
              )}
            </div>
            <span className="condition-text">{weatherData.condition}</span>
          </div>

          <div className="weather-metrics">
            <div className="metric-item">
              <div className="metric-label">Feels Like</div>
              <div className="metric-value">{weatherData.feelsLike.toFixed(2)}°C</div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Humidity</div>
              <div className="metric-value">{weatherData.humidity.toFixed(2)}%</div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Wind Speed</div>
              <div className="metric-value">{weatherData.windSpeed.toFixed(2)} km/h</div>
            </div>
            <div className="metric-item">
              <div className="metric-label">UV Index</div>
              <div className="metric-value">{weatherData.uvIndex.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="last-updated">
        {isLive ? (
          <>Last Updated: {weatherData?.date ? new Date(weatherData.date).toLocaleString() : 'N/A'}</>
        ) : (
          <>Date: {date ? new Date(date).toLocaleDateString() : 'N/A'}</>
        )}
      </div>
    </div>
  )
}

export default WeatherSection

