import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { format, parseISO, isToday, startOfDay } from 'date-fns'
import * as XLSX from 'xlsx'
import { fetchHourlyWeatherData, calculateGeometryCenter } from '../services/api'
import MonthlyWeatherCalendar from './MonthlyWeatherCalendar'
import WeatherMetricsCards from './WeatherMetricsCards'
import './WeatherDetailPage.css'

const WeatherDetailPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { geometry, startDate, endDate, currentDate, showAnalysis } = location.state || {}
  
  const [selectedDate, setSelectedDate] = useState(currentDate || format(new Date(), 'yyyy-MM-dd'))
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

  // Fetch data for selected date when it changes
  useEffect(() => {
    if (coordinates) {
      fetchHourlyData()
    }
  }, [selectedDate, coordinates])

  const fetchHourlyData = async () => {
    if (!coordinates) return

    setLoading(true)
    setError(null)

    try {
      const data = await fetchHourlyWeatherData(
        coordinates.latitude,
        coordinates.longitude,
        selectedDate
      )
      setHourlyData(data.hourly_records || [])
    } catch (err) {
      setError(err.message)
      console.error('Error fetching hourly weather data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDateChange = (direction) => {
    const current = parseISO(selectedDate)
    const today = startOfDay(new Date())
    const end = endDate ? parseISO(endDate) : today
    const maxDate = end < today ? end : today
    
    let newDate
    
    if (direction === 'prev') {
      newDate = new Date(startOfDay(current).getTime() - 86400000) // Subtract one day
    } else {
      const nextDate = new Date(startOfDay(current).getTime() + 86400000) // Add one day
      // Don't go beyond maxDate
      if (nextDate > maxDate) {
        // If we can't go to next, but we're not at maxDate, go to maxDate
        if (current < maxDate) {
          setSelectedDate(format(maxDate, 'yyyy-MM-dd'))
        }
        return
      }
      newDate = nextDate
    }
    
    setSelectedDate(format(newDate, 'yyyy-MM-dd'))
  }

  const canGoPrev = () => {
    if (!startDate) return true
    const current = parseISO(selectedDate)
    const start = parseISO(startDate)
    return current > startOfDay(start)
  }

  const canGoNext = () => {
    const current = parseISO(selectedDate)
    const today = startOfDay(new Date())
    const end = endDate ? parseISO(endDate) : today
    const maxDate = end < today ? end : today
    // Can go next if current date is before or equal to maxDate (allow going to most recent date)
    return current <= maxDate
  }

  const formatDateTime = (dateString) => {
    try {
      const date = parseISO(dateString)
      return {
        date: format(date, 'MMM-dd'),
        time: format(date, 'HH:mm')
      }
    } catch {
      return { date: dateString, time: '' }
    }
  }

  const handleExportData = () => {
    if (!hourlyData || hourlyData.length === 0) {
      alert('No data available to export')
      return
    }

    try {
      // Prepare data for export
      const exportData = hourlyData.map((record) => {
        const { date: datePart, time } = formatDateTime(record.date)
        
        return {
          'Date': datePart,
          'Time': time,
          'Full DateTime': record.date,
          'Temperature (°C)': record.temperature !== null && record.temperature !== undefined ? record.temperature : 'N/A',
          'Feels Like (°C)': record.feels_like !== null && record.feels_like !== undefined ? record.feels_like : 'N/A',
          'Humidity (%)': record.humidity !== null && record.humidity !== undefined ? record.humidity : 'N/A',
          'Wind Speed (km/h)': record.wind_speed !== null && record.wind_speed !== undefined ? record.wind_speed : 'N/A',
          'Wind Direction': record.wind_direction_cardinal || 'N/A',
          'Wind Direction (°)': record.wind_direction !== null && record.wind_direction !== undefined ? record.wind_direction.toFixed(2) : 'N/A',
          'Wind Gusts (km/h)': record.wind_gusts !== null && record.wind_gusts !== undefined ? record.wind_gusts : 'N/A',
          'UV Index': record.uv_index !== null && record.uv_index !== undefined ? record.uv_index : 'N/A',
          'Precipitation (mm)': record.precipitation !== null && record.precipitation !== undefined ? record.precipitation : 'N/A',
          'Cloud Cover (%)': record.cloud_cover !== null && record.cloud_cover !== undefined ? record.cloud_cover : 'N/A',
          'Visibility (km)': record.visibility !== null && record.visibility !== undefined ? record.visibility : 'N/A',
          'Condition': record.condition || 'N/A',
          'Data Source': record.data_source || 'N/A'
        }
      })

      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(exportData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Weather Data')

      // Set column widths
      const colWidths = [
        { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
        { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 15 }
      ]
      ws['!cols'] = colWidths

      // Add metadata
      if (coordinates) {
        wb.Props = {
          Title: 'Weather Hourly Data Export',
          Subject: `Weather Data for ${format(parseISO(selectedDate), 'MMMM dd, yyyy')}`,
          Author: 'Climate Eye',
          CreatedDate: new Date(),
          Location: `Lat: ${coordinates.latitude.toFixed(4)}, Lon: ${coordinates.longitude.toFixed(4)}`
        }
      }

      // Generate filename
      const dateStr = format(parseISO(selectedDate), 'yyyy-MM-dd')
      const filename = `Weather_Data_${dateStr}.xlsx`

      // Export file
      XLSX.writeFile(wb, filename)
    } catch (error) {
      console.error('Error exporting data:', error)
      alert('Error exporting data. Please try again.')
    }
  }

  if (!geometry || !coordinates) {
    return (
      <div className="weather-detail-page">
        <div className="error-message">
          <p>No location data available. Please go back and analyze an area first.</p>
          <button 
            onClick={() => navigate('/dashboard', { state: { restoreAnalysis: showAnalysis || false } })} 
            className="back-button"
          >
            Go Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="weather-detail-page">
      <div className="page-header">
        <button 
          onClick={() => {
            navigate('/dashboard', { 
              state: { 
                restoreAnalysis: true,
                geometry,
                startDate,
                endDate,
                currentDate: currentDate || selectedDate
              } 
            })
          }} 
          className="back-button"
        >
          ← Back to Dashboard
        </button>
        <div className="header-title">
          <h1>Weather Analysis Results</h1>
          <p className="subtitle">Comprehensive analysis of weather parameters</p>
        </div>
        <div className="header-actions">
          <button className="export-button" onClick={handleExportData} disabled={!hourlyData || hourlyData.length === 0}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Export Data
          </button>
        </div>
      </div>

      {/* Monthly Weather Calendar */}
      {coordinates && (
        <MonthlyWeatherCalendar geometry={geometry} selectedDate={selectedDate} />
      )}

      {/* Date Navigation */}
      <div className="date-navigation">
        <button 
          onClick={() => handleDateChange('prev')} 
          disabled={!canGoPrev()}
          className="nav-button"
        >
          ← Previous
        </button>
        <div className="date-display">
          <span className="selected-date">{format(parseISO(selectedDate), 'MMMM dd, yyyy')}</span>
          {isToday(parseISO(selectedDate)) && (
            <span className="today-badge">Today</span>
          )}
        </div>
        <button 
          onClick={() => handleDateChange('next')} 
          disabled={!canGoNext()}
          className="nav-button"
        >
          Next →
        </button>
      </div>

      {/* Weather Metrics Cards */}
      {coordinates && (
        <WeatherMetricsCards
          geometry={geometry}
          date={selectedDate}
          isLive={isToday(parseISO(selectedDate))}
        />
      )}

      {/* Hourly Table */}
      {loading && hourlyData.length === 0 ? (
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading hourly weather data...</p>
        </div>
      ) : error ? (
        <div className="error-message">
          <p>Error: {error}</p>
        </div>
      ) : hourlyData.length > 0 ? (
        <div className="table-container">
          <table className="hourly-weather-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Temperature</th>
                <th>Feels Like</th>
                <th>Humidity</th>
                <th>Wind Speed</th>
                <th>Wind Direction</th>
                <th>Wind Gusts</th>
                <th>UV Index</th>
                <th>Precipitation</th>
                <th>Cloud Cover</th>
                <th>Visibility</th>
                <th>Condition</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {hourlyData.map((record, index) => {
                const { date: datePart, time } = formatDateTime(record.date)
                const isCurrentHour = isToday(parseISO(selectedDate)) &&
                  parseISO(record.date).getHours() === new Date().getHours() &&
                  parseISO(record.date).getMinutes() === 0

                return (
                  <tr key={index} className={isCurrentHour ? 'current-row' : ''}>
                    <td>{datePart}</td>
                    <td>{time}</td>
                    <td>{record.temperature !== null && record.temperature !== undefined ? `${record.temperature}°C` : 'N/A'}</td>
                    <td>{record.feels_like !== null && record.feels_like !== undefined ? `${record.feels_like}°C` : 'N/A'}</td>
                    <td>{record.humidity !== null && record.humidity !== undefined ? `${record.humidity}%` : 'N/A'}</td>
                    <td>{record.wind_speed !== null && record.wind_speed !== undefined ? `${record.wind_speed} km/h` : 'N/A'}</td>
                    <td>{record.wind_direction_cardinal ? `${record.wind_direction !== null && record.wind_direction !== undefined ? record.wind_direction.toFixed(2) : 'N/A'}° ${record.wind_direction_cardinal}` : 'N/A'}</td>
                    <td>{record.wind_gusts !== null && record.wind_gusts !== undefined ? `${record.wind_gusts} km/h` : 'N/A'}</td>
                    <td>{record.uv_index !== null && record.uv_index !== undefined ? record.uv_index : 'N/A'}</td>
                    <td>{record.precipitation !== null && record.precipitation !== undefined ? `${record.precipitation} mm` : 'N/A'}</td>
                    <td>{record.cloud_cover !== null && record.cloud_cover !== undefined ? `${record.cloud_cover}%` : 'N/A'}</td>
                    <td>{record.visibility !== null && record.visibility !== undefined ? `${record.visibility} km` : 'N/A'}</td>
                    <td>{record.condition || 'N/A'}</td>
                    <td>
                      <span className={`source-badge ${record.data_source.toLowerCase().replace('/', '-')}`}>
                        {record.data_source == "History/Estimate" ? "S" : "A"}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="no-data">
          <p>No hourly data available for this date.</p>
        </div>
      )}
    </div>
  )
}

export default WeatherDetailPage

