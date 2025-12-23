import React, { useState, useEffect } from 'react'
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isToday, isSameMonth, getMonth, getYear, startOfDay, subDays } from 'date-fns'
import { fetchMonthlyWeatherData, calculateGeometryCenter, fetchHourlyAQIDataRange, fetchHourlyAQIData } from '../services/api'
import './MonthlyWeatherCalendar.css'

const MonthlyWeatherCalendar = ({ geometry, selectedDate }) => {
  const [monthlyData, setMonthlyData] = useState(null)
  const [aqiData, setAqiData] = useState(null)
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

  // Fetch data only when coordinates or month/year changes (not on every date change)
  useEffect(() => {
    if (coordinates && selectedDate) {
      fetchData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinates, selectedDate ? getMonth(parseISO(selectedDate)) : null, selectedDate ? getYear(parseISO(selectedDate)) : null])

  const fetchData = async () => {
    if (!coordinates || !selectedDate) return

    setLoading(true)
    setError(null)

    try {
      const date = parseISO(selectedDate)
      const year = date.getFullYear()
      const month = date.getMonth() + 1

      // Fetch weather data first
      const weatherData = await fetchMonthlyWeatherData(coordinates.latitude, coordinates.longitude, year, month)
      setMonthlyData(weatherData)

      // Try to fetch AQI data - first try range endpoint, then fallback to day-by-day
      const monthStart = startOfMonth(date)
      const monthEnd = endOfMonth(date)
      const today = new Date()
      const todayStr = format(today, 'yyyy-MM-dd')
      
      // Only fetch up to today (don't fetch future dates)
      const endDate = today < monthEnd ? today : monthEnd
      const startDateStr = format(monthStart, 'yyyy-MM-dd')
      const endDateStr = format(endDate, 'yyyy-MM-dd')

      let aqiRangeData = null
      try {
        // Try range endpoint first
        aqiRangeData = await fetchHourlyAQIDataRange(coordinates.latitude, coordinates.longitude, startDateStr, endDateStr)
        console.log('AQI Range endpoint succeeded, records:', aqiRangeData?.hourly_records?.length || 0)
      } catch (err) {
        console.warn('AQI Range endpoint failed (500 error), trying day-by-day fetch:', err.message)
        // Fallback: Fetch day by day for days in the month up to today
        const allDays = eachDayOfInterval({ start: monthStart, end: endDate })
        const aqiPromises = []
        
        console.log(`Fetching AQI for ${allDays.length} days (from ${startDateStr} to ${endDateStr})...`)
        
        // Fetch for each day in the month (up to today)
        for (const dayDate of allDays) {
          const dayStr = format(dayDate, 'yyyy-MM-dd')
          // Don't fetch future dates
          if (dayDate <= today) {
            aqiPromises.push(
              fetchHourlyAQIData(coordinates.latitude, coordinates.longitude, dayStr)
                .then(result => {
                  if (result && result.hourly_records && result.hourly_records.length > 0) {
                    console.log(`✓ Successfully fetched ${result.hourly_records.length} records for ${dayStr}`)
                    return { date: dayStr, records: result.hourly_records }
                  } else {
                    console.log(`⚠ No records returned for ${dayStr}`)
                    return null
                  }
                })
                .catch(e => {
                  console.warn(`✗ Failed to fetch AQI for ${dayStr}:`, e.message)
                  return null
                })
            )
          }
        }
        
        const aqiResults = await Promise.all(aqiPromises)
        // Combine all hourly records
        const allRecords = []
        let successCount = 0
        aqiResults.forEach((result, index) => {
          if (result && result.records && result.records.length > 0) {
            allRecords.push(...result.records)
            successCount++
          }
        })
        
        console.log(`Day-by-day fetch: ${successCount} days succeeded, ${allRecords.length} total records`)
        
        if (allRecords.length > 0) {
          aqiRangeData = { hourly_records: allRecords }
          console.log('AQI Day-by-day fetch succeeded, total records:', allRecords.length)
        } else {
          console.log('No AQI records found in day-by-day fetch. Check if API has data for these dates.')
        }
      }
      
      // Process AQI data to find highest AQI for each day
      if (aqiRangeData && aqiRangeData.hourly_records) {
        console.log('AQI Records received:', aqiRangeData.hourly_records.length)
        const dailyMaxAQI = {}
        aqiRangeData.hourly_records.forEach(record => {
          if (record && record.aqi !== null && record.aqi !== undefined) {
            try {
              const recordDate = parseISO(record.date)
              const normalizedDate = startOfDay(recordDate)
              const dateKey = format(normalizedDate, 'yyyy-MM-dd')
              
              if (!dailyMaxAQI[dateKey] || record.aqi > dailyMaxAQI[dateKey]) {
                dailyMaxAQI[dateKey] = record.aqi
              }
            } catch (e) {
              console.error('Error parsing date:', record.date, e)
            }
          }
        })
        console.log('Daily Max AQI processed:', dailyMaxAQI)
        console.log('Sample dates:', Object.keys(dailyMaxAQI).slice(0, 5))
        setAqiData(dailyMaxAQI)
      } else {
        console.log('No AQI data available')
        setAqiData(null)
      }
    } catch (err) {
      setError(err.message)
      console.error('Error fetching monthly weather data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Get AQI color based on value
  const getAQIColor = (aqi) => {
    if (aqi <= 50) return '#1abc9c' // Good - Teal Green
    if (aqi <= 100) return '#f39c12' // Moderate - Orange
    if (aqi <= 150) return '#e67e22' // Poor - Darker Orange
    if (aqi <= 200) return '#e74c3c' // Unhealthy - Red
    if (aqi <= 300) return '#9b59b6' // Severe - Purple
    return '#c0392b' // Hazardous - Dark Red
  }

  // Get AQI background color (lighter version)
  const getAQIBgColor = (aqi) => {
    if (aqi <= 50) return 'rgba(26, 188, 156, 0.25)' // Good
    if (aqi <= 100) return 'rgba(243, 156, 18, 0.25)' // Moderate
    if (aqi <= 150) return 'rgba(230, 126, 34, 0.25)' // Poor
    if (aqi <= 200) return 'rgba(231, 76, 60, 0.25)' // Unhealthy
    if (aqi <= 300) return 'rgba(155, 89, 182, 0.25)' // Severe
    return 'rgba(192, 57, 43, 0.25)' // Hazardous
  }

  const getWeatherIcon = (icon) => {
    switch (icon) {
      case 'sun':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="5" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.5"></circle>
            <line x1="12" y1="1" x2="12" y2="3" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"></line>
            <line x1="12" y1="21" x2="12" y2="23" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"></line>
            <line x1="1" y1="12" x2="3" y2="12" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"></line>
            <line x1="21" y1="12" x2="23" y2="12" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"></line>
          </svg>
        )
      case 'partly-cloudy':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="10" cy="10" r="4" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1"></circle>
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="1.5"></path>
          </svg>
        )
      case 'rain':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#94a3b8" stroke="#64748b" strokeWidth="1.5"></path>
            <line x1="8" y1="20" x2="8" y2="22" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"></line>
            <line x1="12" y1="20" x2="12" y2="22" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"></line>
            <line x1="16" y1="20" x2="16" y2="22" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"></line>
          </svg>
        )
      case 'snow':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#e0e7ff" stroke="#a5b4fc" strokeWidth="1.5"></path>
            <circle cx="8" cy="20" r="1.5" fill="#bfdbfe"></circle>
            <circle cx="12" cy="20" r="1.5" fill="#bfdbfe"></circle>
            <circle cx="16" cy="20" r="1.5" fill="#bfdbfe"></circle>
            <path d="M7 19l2-2M11 19l2-2M15 19l2-2" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round"></path>
          </svg>
        )
      default:
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#9ca3af" stroke="#6b7280" strokeWidth="1.5"></path>
          </svg>
        )
    }
  }

  if (!coordinates) {
    return null
  }

  if (loading) {
    return (
      <div className="monthly-weather-calendar">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading monthly forecast...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="monthly-weather-calendar">
        <div className="error-message">
          <p>Error loading monthly forecast: {error}</p>
        </div>
      </div>
    )
  }

  if (!monthlyData || !monthlyData.daily_records) {
    return null
  }

  const date = parseISO(selectedDate)
  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd })
  
  // Get first day of week for the month start
  const firstDayOfWeek = monthStart.getDay()
  
  // Create calendar grid
  const calendarDays = []
  
  // Add empty cells for days before month starts
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarDays.push(null)
  }
  
  // Find the last day that has data
  let lastDayWithData = null
  if (monthlyData.daily_records && monthlyData.daily_records.length > 0) {
    const datesWithData = monthlyData.daily_records
      .map(r => parseISO(r.date))
      .filter(d => isSameMonth(d, date))
      .sort((a, b) => b - a) // Sort descending
    if (datesWithData.length > 0) {
      lastDayWithData = datesWithData[0]
    }
  }
  
  // Add all days of the month, but stop at the last day with data (removes trailing empty days like 30)
  allDays.forEach(day => {
    // If we've found a last day with data and this day is after it, skip it
    if (lastDayWithData && day > lastDayWithData) {
      return
    }
    
    const dayStr = format(day, 'yyyy-MM-dd')
    const record = monthlyData.daily_records.find(r => r.date === dayStr)
    calendarDays.push({
      date: day,
      record: record || null
    })
  })

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const monthName = format(date, 'MMMM yyyy')

  // Remove trailing empty cells after the last day of the month
  // Find the index of the last day that belongs to the current month
  let lastValidIndex = -1
  for (let i = calendarDays.length - 1; i >= 0; i--) {
    if (calendarDays[i] && isSameMonth(calendarDays[i].date, date)) {
      lastValidIndex = i
      break
    }
  }
  
  // Only include days up to the last day of the month (no empty cells after)
  // Slice to include only up to the last valid day
  let trimmedCalendarDays = lastValidIndex >= 0 
    ? calendarDays.slice(0, lastValidIndex + 1)
    : calendarDays
  
  // Calculate which cells should be hidden (empty cells after the last day)
  // Find the position of the last day in the grid (0-indexed)
  const lastDayPosition = trimmedCalendarDays.length - 1
  const lastDayRow = Math.floor(lastDayPosition / 7)
  const lastDayCol = lastDayPosition % 7
  
  // Calculate how many cells are in the last row after the last day
  const cellsToHide = 6 - lastDayCol // 6 because we want to hide cells after the last day (0-6 columns)

  return (
    <div className="monthly-weather-calendar">
      <div className="calendar-grid">
        <div className="calendar-weekdays">
          {weekDays.map(day => (
            <div key={day} className="weekday-header">{day}</div>
          ))}
        </div>
        
        <div className="calendar-days">
          {trimmedCalendarDays.map((dayData, index) => {
            const isLastRow = Math.floor(index / 7) === lastDayRow
            const isAfterLastDay = isLastRow && (index % 7) > lastDayCol
            
            // Don't render empty cells after the last day of the month
            if (isAfterLastDay) {
              return null
            }
            
            // Render empty cells for days before month starts
            if (!dayData) {
              return <div key={`empty-${index}`} className="calendar-day empty"></div>
            }
            
            const { date: dayDate, record } = dayData
            const isTodayDate = isToday(dayDate)
            const dayStr = format(startOfDay(dayDate), 'yyyy-MM-dd')
            const dayAQI = aqiData && aqiData[dayStr] !== undefined ? aqiData[dayStr] : null
            
            // Debug: log first few days
            if (dayDate.getDate() <= 3 && aqiData) {
              console.log('Looking up AQI for day:', {
                day: dayDate.getDate(),
                dayStr: dayStr,
                dayAQI: dayAQI,
                availableKeys: Object.keys(aqiData).slice(0, 5),
                matchFound: aqiData[dayStr] !== undefined
              })
            }
            
            // Only render if it's a valid day of the current month
            if (!isSameMonth(dayDate, date)) {
              return null
            }
            
            // Get background color based on AQI
            const aqiBgColor = dayAQI !== null ? getAQIBgColor(dayAQI) : null
            const aqiColor = dayAQI !== null ? getAQIColor(dayAQI) : null
            
            return (
              <div 
                key={format(dayDate, 'yyyy-MM-dd')} 
                className={`calendar-day ${isTodayDate ? 'today' : ''}`}
                style={aqiBgColor ? { backgroundColor: aqiBgColor, borderColor: aqiColor } : {}}
              >
                <div className="day-number">{dayDate.getDate()}</div>
                {dayAQI !== null && dayAQI !== undefined ? (
                  <div className="aqi-value" style={{ color: aqiColor , fontSize: '1rem'}}>
                    AQI: {Math.round(dayAQI)}
                  </div>
                ) : (
                  <div className="aqi-value" style={{ color: '#9ca3af', opacity: 0.6 , fontSize: '1rem'}}>
                    AQI: -
                  </div>
                )}
                {record ? (
                  <>
                    <div className="weather-icon">
                      {getWeatherIcon(record.icon)}
                    </div>
                    <div className="temperatures">
                      <span className="temp-high">{record.temperature_max}°</span>
                      <span className="temp-low">/{record.temperature_min}°</span>
                    </div>
                  </>
                ) : (
                  <div className="no-data">-</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      
      <div className="calendar-footer">
        <h2 className="calendar-title">{monthName} Weather Forecast</h2>
        {monthlyData.summary && (
          <div className="month-summary">
            <span className="summary-item sunny">{monthlyData.summary.sunny} Sunny</span>
            <span className="summary-item cloudy">{monthlyData.summary.cloudy} Cloudy</span>
            <span className="summary-item rainy">{monthlyData.summary.rainy} Rainy</span>
            <span className="summary-item snowy">{monthlyData.summary.snowy} Snowy</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default MonthlyWeatherCalendar

