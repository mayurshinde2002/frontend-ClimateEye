import React, { useState, useEffect } from 'react'
import { format, parseISO, getHours } from 'date-fns'
import { fetchHourlyAQIData, calculateGeometryCenter } from '../services/api'
import './HourlyAQICards.css'

const HourlyAQICards = ({ geometry, date }) => {
  const [hourlyData, setHourlyData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [coordinates, setCoordinates] = useState(null)

  useEffect(() => {
    if (geometry) {
      const center = calculateGeometryCenter(geometry)
      if (center) {
        setCoordinates(center)
      }
    }
  }, [geometry])

  useEffect(() => {
    if (coordinates && date) {
      fetchHourlyAQIDataForDay()
    }
  }, [coordinates, date])

  const fetchHourlyAQIDataForDay = async () => {
    if (!coordinates || !date) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetchHourlyAQIData(coordinates.latitude, coordinates.longitude, date)
      const records = response.hourly_records || []
      
      // Create 24 hour slots (0-23)
      const hourlySlots = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        hourLabel: `${i.toString().padStart(2, '0')}:00`,
        aqi: null,
        records: [] // Store all records for this hour
      }))

      // Map records to their respective hours
      records.forEach(record => {
        if (record && record.aqi !== null && record.aqi !== undefined) {
          try {
            const recordDate = parseISO(record.date)
            const hour = getHours(recordDate)
            
            if (hour >= 0 && hour < 24) {
              hourlySlots[hour].records.push(record)
            }
          } catch (e) {
            console.warn('Error parsing record date:', record.date, e)
          }
        }
      })

      // For each hour, use the average AQI if multiple records exist, or the single record
      hourlySlots.forEach(slot => {
        if (slot.records.length > 0) {
          // Calculate average AQI for this hour
          const avgAqi = slot.records.reduce((sum, r) => sum + (r.aqi || 0), 0) / slot.records.length
          slot.aqi = Math.round(avgAqi)
        }
      })

      setHourlyData(hourlySlots)
    } catch (err) {
      setError(err.message)
      console.error('Error fetching hourly AQI data:', err)
    } finally {
      setLoading(false)
    }
  }

  const getAQICategory = (aqi) => {
    if (!aqi || aqi === null) return { label: 'N/A', color: '#6b7280', bgColor: 'rgba(107, 114, 128, 0.2)' }
    if (aqi <= 50) return { label: 'Good', color: '#1abc9c', bgColor: 'rgba(26, 188, 156, 0.2)' }
    if (aqi <= 100) return { label: 'Moderate', color: '#f39c12', bgColor: 'rgba(243, 156, 18, 0.2)' }
    if (aqi <= 150) return { label: 'Poor', color: '#e67e22', bgColor: 'rgba(230, 126, 34, 0.2)' }
    if (aqi <= 200) return { label: 'Unhealthy', color: '#e74c3c', bgColor: 'rgba(231, 76, 60, 0.2)' }
    if (aqi <= 300) return { label: 'Severe', color: '#9b59b6', bgColor: 'rgba(155, 89, 182, 0.2)' }
    return { label: 'Hazardous', color: '#c0392b', bgColor: 'rgba(192, 57, 43, 0.2)' }
  }

  if (loading) {
    return (
      <div className="hourly-aqi-cards-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading hourly AQI data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="hourly-aqi-cards-container">
        <div className="error-state">
          <p>Error: {error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="hourly-aqi-cards-container">
      <div className="hourly-aqi-header">
        <h2 className="hourly-aqi-title">24-Hour AQI Overview</h2>
        <p className="hourly-aqi-subtitle">Air Quality Index for each hour of the day - {format(parseISO(date), 'MMMM dd, yyyy')}</p>
      </div>
      <div className="hourly-aqi-cards-grid">
        {hourlyData.map((slot, index) => {
          const category = getAQICategory(slot.aqi)
          return (
            <div 
              key={index} 
              className="hourly-aqi-card"
              style={{ 
                borderColor: category.color,
                backgroundColor: slot.aqi !== null ? category.bgColor : 'rgba(107, 114, 128, 0.1)'
              }}
            >
              <div className="hourly-aqi-card-header">
                <span className="hour-label">{slot.hourLabel}</span>
              </div>
              <div className="hourly-aqi-card-content">
                {slot.aqi !== null ? (
                  <>
                    <div className="aqi-value" style={{ color: category.color }}>
                      {slot.aqi}
                    </div>
                    <div className="aqi-category" style={{ color: category.color }}>
                      {category.label}
                    </div>
                  </>
                ) : (
                  <div className="aqi-no-data">No Data</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default HourlyAQICards

