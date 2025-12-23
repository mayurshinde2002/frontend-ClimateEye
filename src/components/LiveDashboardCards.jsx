import React from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts'
import './LiveDashboardCards.css'

const LiveDashboardCards = ({ aqiData, weatherData }) => {
  const getAQICategory = (aqi) => {
    if (aqi <= 50) return { label: 'Good', color: '#1abc9c', bgColor: 'rgba(26, 188, 156, 0.2)' }
    if (aqi <= 100) return { label: 'Moderate', color: '#f39c12', bgColor: 'rgba(243, 156, 18, 0.2)' }
    if (aqi <= 150) return { label: 'Poor', color: '#e67e22', bgColor: 'rgba(230, 126, 34, 0.2)' }
    if (aqi <= 200) return { label: 'Unhealthy', color: '#e74c3c', bgColor: 'rgba(231, 76, 60, 0.2)' }
    if (aqi <= 300) return { label: 'Severe', color: '#9b59b6', bgColor: 'rgba(155, 89, 182, 0.2)' }
    return { label: 'Hazardous', color: '#c0392b', bgColor: 'rgba(192, 57, 43, 0.2)' }
  }

  const getGaugeAngle = (aqi) => {
    // AQI ranges from 0-400, map to semi-circle (180 degrees)
    // 0 AQI (EXCELLENT) = 0° (pointing right), 400 AQI (VERY POOR) = 180° (pointing left)
    // Needle rotates from right (0°) to left (180°)
    const maxAQI = 400
    const normalizedAQI = Math.min(Math.max(aqi, 0), maxAQI)
    // Convert AQI to angle: 0 AQI = 0°, 400 AQI = 180°
    return (normalizedAQI / maxAQI) * 180
  }

  const getSegmentInfo = () => {
    // Semi-circle gauge: 180° arc from right (0°) to left (180°)
    // Segments ordered from left (Hazardous) to right (Good)
    // Each segment covers 30° (180/6 = 30)
    // Matching the horizontal bar: Good (0-50), Moderate (51-100), Poor (101-150), 
    // Unhealthy (151-200), Severe (201-300), Hazardous (301+)
    return [
      { label: 'HAZARDOUS', color: '#c0392b', start: 301, end: 400, angleStart: 150, angleEnd: 180 },
      { label: 'SEVERE', color: '#9b59b6', start: 201, end: 300, angleStart: 120, angleEnd: 150 },
      { label: 'UNHEALTHY', color: '#e74c3c', start: 151, end: 200, angleStart: 90, angleEnd: 120 },
      { label: 'POOR', color: '#e67e22', start: 101, end: 150, angleStart: 60, angleEnd: 90 },
      { label: 'MODERATE', color: '#f39c12', start: 51, end: 100, angleStart: 30, angleEnd: 60 },
      { label: 'GOOD', color: '#1abc9c', start: 0, end: 50, angleStart: 0, angleEnd: 30 }
    ]
  }

  if (!aqiData || !weatherData) {
    return (
      <div className="live-dashboard-cards">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading dashboard data...</p>
        </div>
      </div>
    )
  }

  const aqi = aqiData.aqi || 0
  const category = getAQICategory(aqi)
  const gaugeAngle = getGaugeAngle(aqi)

  // Pollutant data for stacked bar chart
  const pollutantData = [
    {
      name: 'PM2.5',
      value: aqiData.pm2_5 || aqiData.pm25 || 0,
      color: '#1e40af'
    },
    {
      name: 'PM10',
      value: aqiData.pm10 || 0,
      color: '#10b981'
    },
    {
      name: 'NO2',
      value: aqiData.no2 || 0,
      color: '#84cc16'
    },
    {
      name: 'SO2',
      value: aqiData.so2 || 0,
      color: '#f97316'
    },
    {
      name: 'O3',
      value: aqiData.o3 || 0,
      color: '#94a3b8'
    }
  ]

  // Calculate percentages for AQI metrics
  const aqiPercentage = aqi > 0 ? Math.min((aqi / 300) * 100, 100) : 0
  const pm10Percentage = pollutantData[1].value > 0 ? Math.min((pollutantData[1].value / 100) * 100, 100) : 0
  const precipitation = weatherData.precipitation || weatherData.precipitation_mm || 0
  const precipitationPercentage = precipitation > 0 ? Math.min((precipitation / 50) * 100, 100) : 0

  // UV & Visibility data - using current data and estimated values
  const currentUV = weatherData.uv_index || weatherData.uv_index_max || 0
  const currentVisibility = weatherData.visibility || 10
  const uvVisibilityData = [
    { time: '00:00', uv: 0, visibility: Math.max(5, currentVisibility - 5) },
    { time: '04:00', uv: 0, visibility: Math.max(5, currentVisibility - 3) },
    { time: '08:00', uv: Math.max(0, currentUV - 2), visibility: Math.max(5, currentVisibility - 2) },
    { time: '12:00', uv: currentUV, visibility: currentVisibility },
    { time: '16:00', uv: Math.max(0, currentUV - 1), visibility: Math.max(5, currentVisibility - 1) },
    { time: '20:00', uv: 0, visibility: Math.max(5, currentVisibility - 2) }
  ]

  // Weather forecast data (mock 5-day forecast, can be enhanced with actual API)
  const forecastData = [
    { day: 'MON', icon: 'rain', temp: 25 },
    { day: 'TUE', icon: 'rain', temp: 26 },
    { day: 'WED', icon: 'rain', temp: 27 },
    { day: 'THU', icon: 'sun', temp: 28 },
    { day: 'FRI', icon: 'rain', temp: 29 }
  ]

  return (
    <div className="live-dashboard-cards">
      {/* Air Quality Index Card */}
      <div className="dashboard-card aqi-gauge-card">
        <div className="card-header">
          <h3 className="card-title">Air Quality Index</h3>
          {/* <div className="card-menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </div> */}
        </div>
        <div className="card-content">
          <div className="aqi-gauge-container">
            <svg width="350" height="180" viewBox="0 0 350 180" className="aqi-gauge">
              <defs>
                <filter id="gauge-shadow">
                  <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.4"/>
                </filter>
              </defs>
              
              {/* Semi-circle arc segments */}
              {getSegmentInfo().map((segment, index) => {
                const centerX = 175
                const centerY = 160
                const radius = 110
                const innerRadius = 88
                
                // Convert angles: 0° = right, 180° = left
                // For semi-circle going from right to left
                const startAngle = segment.angleStart
                const endAngle = segment.angleEnd
                
                const startRad = (startAngle * Math.PI) / 180
                const endRad = (endAngle * Math.PI) / 180
                
                // Calculate outer arc points
                const outerX1 = centerX + radius * Math.cos(Math.PI - startRad)
                const outerY1 = centerY - radius * Math.sin(Math.PI - startRad)
                const outerX2 = centerX + radius * Math.cos(Math.PI - endRad)
                const outerY2 = centerY - radius * Math.sin(Math.PI - endRad)
                
                // Calculate inner arc points
                const innerX1 = centerX + innerRadius * Math.cos(Math.PI - startRad)
                const innerY1 = centerY - innerRadius * Math.sin(Math.PI - startRad)
                const innerX2 = centerX + innerRadius * Math.cos(Math.PI - endRad)
                const innerY2 = centerY - innerRadius * Math.sin(Math.PI - endRad)
                
                const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0
                const midAngle = (startAngle + endAngle) / 2
                const midRad = (midAngle * Math.PI) / 180
                
                return (
                  <g key={index}>
                    {/* Segment arc */}
                    <path
                      d={`M ${outerX1} ${outerY1} 
                          A ${radius} ${radius} 0 ${largeArc} 1 ${outerX2} ${outerY2}
                          L ${innerX2} ${innerY2}
                          A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerX1} ${innerY1}
                          Z`}
                      fill={segment.color}
                      filter="url(#gauge-shadow)"
                      opacity="0.9"
                    />
                    {/* Segment label */}
                    <text
                      x={centerX + (radius + 25) * Math.cos(Math.PI - midRad)}
                      y={centerY - (radius + 25) * Math.sin(Math.PI - midRad)}
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="700"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="segment-label"
                      style={{ 
                        textShadow: '0 2px 4px rgba(0, 0, 0, 0.9)',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {segment.label}
                    </text>
                  </g>
                )
              })}
              
              {/* Needle */}
              <g>
                <line
                  x1="175"
                  y1="160"
                  x2={175 + 95 * Math.cos(Math.PI - (gaugeAngle * Math.PI / 180))}
                  y2={160 - 95 * Math.sin(Math.PI - (gaugeAngle * Math.PI / 180))}
                  stroke="#1e40af"
                  strokeWidth="3"
                  strokeLinecap="round"
                  filter="url(#gauge-shadow)"
                />
                {/* Center hub - white circle with blue outline */}
                <circle 
                  cx="175" 
                  cy="160" 
                  r="10" 
                  fill="#ffffff" 
                  stroke="#1e40af" 
                  strokeWidth="2"
                  filter="url(#gauge-shadow)"
                />
              </g>
            </svg>
            <div className="aqi-gauge-label">
              <div className="aqi-category" style={{ color: category.color }}>
                {category.label.toUpperCase()} ({aqi})
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pollutant Levels Card */}
      <div className="dashboard-card pollutant-card">
        <div className="card-header">
          <h3 className="card-title">Pollutant Levels</h3>
        </div>
        <div className="card-content">
          <div className="pollutant-legend">
            {pollutantData.map((pollutant, index) => (
              <div key={index} className="legend-item">
                <div className="legend-color" style={{ backgroundColor: pollutant.color }}></div>
                <span>{pollutant.name}</span>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pollutantData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(20, 184, 166, 0.2)" />
              <XAxis dataKey="name" stroke="rgba(255, 255, 255, 0.7)" style={{ fontSize: '12px' }} />
              <YAxis stroke="rgba(255, 255, 255, 0.7)" style={{ fontSize: '12px' }} domain={[0, 100]} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(26, 31, 58, 0.95)', 
                  border: '1px solid rgba(20, 184, 166, 0.4)',
                  borderRadius: '8px',
                  color: '#ffffff'
                }}
                labelStyle={{ color: '#ffffff', fontWeight: 'bold' }}
                formatter={(value) => [`${value.toFixed(2)} µg/m³`, '']}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {pollutantData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weather Card */}
      <div className="dashboard-card weather-card">
        <div className="card-header">
          <h3 className="card-title">Weather</h3>
        </div>
        <div className="card-content">
          <div className="weather-current">
            <div className="weather-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              <span>{weatherData.temperature || 0}°C</span>
            </div>
            <div className="weather-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
              </svg>
              <span>{weatherData.humidity.toFixed(2) || 0}%</span>
            </div>
            <div className="weather-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"></path>
              </svg>
              <span>Wind Speed {weatherData.wind_speed.toFixed(2) || 0}</span>
            </div>
            <div className="weather-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
              </svg>
              <span>Precipitation {precipitation.toFixed(1)} mm</span>
            </div>
          </div>
          <div className="weather-forecast">
            {forecastData.map((day, index) => (
              <div key={index} className="forecast-item">
                {day.icon === 'rain' ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                    <line x1="7" y1="20" x2="7" y2="22"></line>
                    <line x1="11" y1="20" x2="11" y2="22"></line>
                    <line x1="15" y1="20" x2="15" y2="22"></line>
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                <div className="forecast-day">{day.day}</div>
                <div className="forecast-temp">{day.temp}°</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AQI Metrics Card */}
      <div className="dashboard-card aqi-metrics-card">
        <div className="card-header">
          <h3 className="card-title">AQI Index</h3>
        </div>
        <div className="card-content">
          <div className="metrics-list">
            <div className="metric-item active">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <div className="metric-info">
                <div className="metric-label">AQI Index</div>
                <div className="metric-value">{aqi}</div>
              </div>
              <div className="metric-chart">
                <div className="metric-bar" style={{ width: `${aqiPercentage}%`, backgroundColor: category.color }}></div>
              </div>
            </div>
            <div className="metric-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
              </svg>
              <div className="metric-info">
                <div className="metric-label">PM10</div>
                <div className="metric-value">{pollutantData[1].value.toFixed(2)}</div>
              </div>
              <div className="metric-chart">
                <div className="metric-bar" style={{ width: `${pm10Percentage}%`, backgroundColor: '#10b981' }}></div>
              </div>
            </div>
            <div className="metric-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                <line x1="7" y1="20" x2="7" y2="22"></line>
                <line x1="11" y1="20" x2="11" y2="22"></line>
                <line x1="15" y1="20" x2="15" y2="22"></line>
              </svg>
              <div className="metric-info">
                <div className="metric-label">Precipitation</div>
                <div className="metric-value">{precipitation.toFixed(2)}</div>
              </div>
              <div className="metric-chart">
                <div className="metric-bar" style={{ width: `${precipitationPercentage}%`, backgroundColor: '#3b82f6' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* UV & Visibility Card */}
      <div className="dashboard-card uv-visibility-card">
        <div className="card-header">
          <h3 className="card-title">UV & Visibility</h3>
        </div>
        <div className="card-content">
          <div className="chart-legend">
            <div className="legend-item">
              <div className="legend-line" style={{ backgroundColor: '#3b82f6' }}></div>
              <span>UV</span>
            </div>
            <div className="legend-item">
              <div className="legend-line" style={{ backgroundColor: '#f97316' }}></div>
              <span>Visibility</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={uvVisibilityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(20, 184, 166, 0.2)" />
              <XAxis dataKey="time" stroke="rgba(255, 255, 255, 0.7)" style={{ fontSize: '12px' }} />
              <YAxis stroke="rgba(255, 255, 255, 0.7)" style={{ fontSize: '12px' }} domain={[0, 125]} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(26, 31, 58, 0.95)', 
                  border: '1px solid rgba(20, 184, 166, 0.4)',
                  borderRadius: '8px',
                  color: '#ffffff'
                }}
                labelStyle={{ color: '#14b8a6', fontWeight: 'bold' }}
              />
              <Line type="monotone" dataKey="uv" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: '#3b82f6' }} />
              <Line type="monotone" dataKey="visibility" stroke="#f97316" strokeWidth={2} dot={{ r: 4, fill: '#f97316' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default LiveDashboardCards

