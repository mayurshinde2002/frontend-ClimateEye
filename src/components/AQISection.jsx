import React from 'react'
import { useNavigate } from 'react-router-dom'
import './AQISection.css'

const AQISection = ({ date, data, isLive = false, loading = false, geometry, startDate, endDate, onClick, viewMode }) => {
  const navigate = useNavigate()
  
  const handleClick = () => {
    if (onClick) {
      onClick()
    } else {
      // Navigate to detail page with state (include showAnalysis flag)
      // If viewMode is 'daily', pass dailyMode flag
      const isDailyMode = viewMode === 'daily'
      
      navigate('/aqi-detail', {
        state: {
          geometry,
          startDate,
          endDate,
          currentDate: date,
          showAnalysis: true, // Indicate we're coming from analysis view
          dailyMode: isDailyMode // Pass daily mode flag
        }
      })
    }
  }
  // Transform API data to component format
  const aqiData = data ? {
    aqi: data.aqi || null,
    pm25: data.pm2_5 || null,
    pm10: data.pm10 || null,
    co: data.co || null,
    so2: data.so2 || null,
    no2: data.no2 || null,
    o3: data.o3 || null,
    date: data.date || date
  } : null

  const getAQICategory = (aqi) => {
    if (aqi <= 50) return { 
      label: 'Good', 
      color: '#10b981', 
      bgColor: 'rgba(16, 185, 129, 0.2)'
    }
    if (aqi <= 100) return { 
      label: 'Moderate', 
      color: '#f59e0b', 
      bgColor: 'rgba(245, 158, 11, 0.2)'
    }
    if (aqi <= 150) return { 
      label: 'Poor', 
      color: '#f97316', 
      bgColor: 'rgba(249, 115, 22, 0.2)'
    }
    if (aqi <= 200) return { 
      label: 'Unhealthy', 
      color: '#ef4444', 
      bgColor: 'rgba(239, 68, 68, 0.2)'
    }
    if (aqi <= 300) return { 
      label: 'Severe', 
      color: '#8b5cf6', 
      bgColor: 'rgba(139, 92, 246, 0.2)'
    }
    return { 
      label: 'Hazardous', 
      color: '#7f1d1d', 
      bgColor: 'rgba(127, 29, 29, 0.2)'
    }
  }

  if (loading || !aqiData || !aqiData.aqi) {
    return (
      <div className="aqi-section">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading AQI data...</p>
          {!isLive && <p className="loading-subtext">Calculating daily averages...</p>}
        </div>
      </div>
    )
  }

  const category = getAQICategory(aqiData.aqi)

  return (
    <div className="aqi-section clickable" onClick={handleClick}>
      <div className="section-header">
        <h2 className="section-title">Air Quality Index</h2>
        {isLive && (
          <div className="live-indicator">
            <span className="live-dot"></span>
            <span>LIVE</span>
          </div>
        )}
        {!isLive && aqiData && (
          <div className="daily-indicator">
            <span>DAILY AVERAGE</span>
          </div>
        )}
      </div>

      <div className="aqi-content">
        <div className="aqi-main-display">
          <div className="aqi-value-container">
            <div className="aqi-value" style={{ color: category.color }}>
              {aqiData.aqi}
            </div>
            {/* <div className="aqi-label">AQI-US</div> */}
          </div>
          <div className="aqi-status-box" style={{ backgroundColor: category.bgColor, borderColor: category.color }}>
            <span style={{ color: category.color }}>Air Quality is {category.label}</span>
          </div>
        </div>

        <div className="pollutant-levels">
          <div className="pollutant-item">
            <span className="pollutant-label">PM2.5</span>
            <span className="pollutant-value">{aqiData.pm25.toFixed(2)} µg/m³</span>
          </div>
          <div className="pollutant-item">
            <span className="pollutant-label">PM10</span>
            <span className="pollutant-value">{aqiData.pm10.toFixed(2)  } µg/m³</span>
          </div>
          <div className="pollutant-item">
            <span className="pollutant-label">CO</span>
            <span className="pollutant-value">{aqiData.co.toFixed(2)} ppm</span>
          </div>
          <div className="pollutant-item">
            <span className="pollutant-label">SO₂</span>
            <span className="pollutant-value">{aqiData.so2.toFixed(2)} µg/m³</span>
          </div>
          <div className="pollutant-item">
            <span className="pollutant-label">NO₂</span>
            <span className="pollutant-value">{aqiData.no2.toFixed(2)} µg/m³</span>
          </div>
          <div className="pollutant-item">
            <span className="pollutant-label">O₃</span>
            <span className="pollutant-value">{aqiData.o3.toFixed(2)} µg/m³</span>
          </div>
        </div>

        <div className="aqi-scale">
          <div className="scale-bar">
            <div className="scale-segment" style={{ backgroundColor: '#10b981', width: '16.67%' }}>
              <span className="scale-label">Good</span>
              <span className="scale-range">0-50</span>
            </div>
            <div className="scale-segment" style={{ backgroundColor: '#f59e0b', width: '16.67%' }}>
              <span className="scale-label">Moderate</span>
              <span className="scale-range">51-100</span>
            </div>
            <div className="scale-segment" style={{ backgroundColor: '#f97316', width: '16.67%' }}>
              <span className="scale-label">Poor</span>
              <span className="scale-range">101-150</span>
            </div>
            <div className="scale-segment" style={{ backgroundColor: '#ef4444', width: '16.67%' }}>
              <span className="scale-label">Unhealthy</span>
              <span className="scale-range">151-200</span>
            </div>
            <div className="scale-segment" style={{ backgroundColor: '#8b5cf6', width: '16.67%' }}>
              <span className="scale-label">Severe</span>
              <span className="scale-range">201-300</span>
            </div>
            <div className="scale-segment" style={{ backgroundColor: '#7f1d1d', width: '16.67%' }}>
              <span className="scale-label">Hazardous</span>
              <span className="scale-range">301+</span>
            </div>
          </div>
          <div className="scale-indicator" style={{ left: `${Math.min((aqiData.aqi / 300) * 100, 100)}%` }}>
            <div className="indicator-dot" style={{ backgroundColor: category.color }}></div>
          </div>
        </div>
      </div>

      <div className="last-updated">
        {isLive ? (
          <>Last Updated: {new Date().toLocaleString()}</>
        ) : (
          <>Date: {date ? new Date(date).toLocaleDateString() : 'N/A'}</>
        )}
      </div>
    </div>
  )
}

export default AQISection

