import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { format, parseISO, subDays, addDays, isToday, startOfDay, subHours } from 'date-fns'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import * as XLSX from 'xlsx'
import { fetchHourlyAQIData, fetchHourlyWeatherData, fetchHourlyAQIDataRange, calculateGeometryCenter } from '../services/api'
import HourlyAQICards from './HourlyAQICards'
import './AQIDetailPage.css'

const AQIDetailPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { geometry, startDate, endDate, currentDate, showAnalysis, dailyMode } = location.state || {}
  
  const [selectedDate, setSelectedDate] = useState(currentDate || format(new Date(), 'yyyy-MM-dd'))
  const [hourlyAQIData, setHourlyAQIData] = useState([])
  const [hourlyWeatherData, setHourlyWeatherData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [coordinates, setCoordinates] = useState(null)
  const [chartType, setChartType] = useState('line') // 'line' or 'bar'
  const [selectedParameters, setSelectedParameters] = useState(['aqi', 'pm2_5', 'pm10']) // Default selected parameters
  const [selectionMode, setSelectionMode] = useState('multiple') // 'single' or 'multiple'
  const [viewMode, setViewMode] = useState('live') // 'live', 'daily', 'weekly', 'monthly'

  // Combined parameters: AQI + Weather
  const parameters = [
    // AQI Parameters
    { key: 'aqi', label: 'AQI', color: '#14b8a6', category: 'aqi' },
    { key: 'pm2_5', label: 'PM2.5 (µg/m³)', color: '#ef4444', category: 'aqi' },
    { key: 'pm10', label: 'PM10 (µg/m³)', color: '#f59e0b', category: 'aqi' },
    { key: 'co', label: 'CO (ppm)', color: '#8b5cf6', category: 'aqi' },
    { key: 'no2', label: 'NO₂ (µg/m³)', color: '#3b82f6', category: 'aqi' },
    { key: 'so2', label: 'SO₂ (µg/m³)', color: '#ec4899', category: 'aqi' },
    { key: 'o3', label: 'O₃ (µg/m³)', color: '#10b981', category: 'aqi' },
    // Weather Parameters
    { key: 'temperature', label: 'Temperature (°C)', color: '#ef4444', category: 'weather' },
    { key: 'feels_like', label: 'Feels Like (°C)', color: '#f97316', category: 'weather' },
    { key: 'humidity', label: 'Humidity (%)', color: '#3b82f6', category: 'weather' },
    { key: 'wind_speed', label: 'Wind Speed (km/h)', color: '#14b8a6', category: 'weather' },
    { key: 'wind_gusts', label: 'Wind Gusts (km/h)', color: '#06b6d4', category: 'weather' },
    { key: 'uv_index', label: 'UV Index', color: '#fbbf24', category: 'weather' },
    { key: 'precipitation', label: 'Precipitation (mm)', color: '#60a5fa', category: 'weather' },
    { key: 'cloud_cover', label: 'Cloud Cover (%)', color: '#9ca3af', category: 'weather' },
    { key: 'visibility', label: 'Visibility (km)', color: '#a855f7', category: 'weather' },
    { key: 'pressure', label: 'Pressure (mb)', color: '#8b5cf6', category: 'weather' }
  ]

  useEffect(() => {
    if (geometry) {
      const center = calculateGeometryCenter(geometry)
      if (center) {
        setCoordinates(center)
      }
    }
  }, [geometry])

  // Fetch data for selected date when it changes or view mode changes
  useEffect(() => {
    if (coordinates) {
      fetchHourlyData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, coordinates, viewMode])

  const fetchHourlyData = async () => {
    if (!coordinates) return
    
    setLoading(true)
    setError(null)
    
    try {
      const today = format(new Date(), 'yyyy-MM-dd')
      let aqiRecords = []
      let weatherRecords = []

      if (viewMode === 'live') {
        // Live: Current data (last hour)
        const now = new Date()
        const oneHourAgo = subHours(now, 1)
        const [aqiData, weatherData] = await Promise.all([
          fetchHourlyAQIData(coordinates.latitude, coordinates.longitude, today),
          fetchHourlyWeatherData(coordinates.latitude, coordinates.longitude, today)
        ])
        
        // Filter to last hour
        aqiRecords = (aqiData.hourly_records || []).filter(r => {
          if (!r || !r.date) return false
          const recordTime = parseISO(r.date)
          return recordTime >= oneHourAgo
        })
        
        weatherRecords = (weatherData.hourly_records || []).filter(r => {
          if (!r || !r.date) return false
          const recordTime = parseISO(r.date)
          return recordTime >= oneHourAgo
        })
      } else if (viewMode === 'daily') {
        // Daily: Last 24 hours (today's hourly data)
        const [aqiData, weatherData] = await Promise.all([
          fetchHourlyAQIData(coordinates.latitude, coordinates.longitude, today),
          fetchHourlyWeatherData(coordinates.latitude, coordinates.longitude, today)
        ])
        
        aqiRecords = aqiData.hourly_records || []
        weatherRecords = weatherData.hourly_records || []
      } else if (viewMode === 'weekly') {
        // Weekly: Last 7 days
        const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
        
        // Fetch AQI range
        const aqiRange = await fetchHourlyAQIDataRange(coordinates.latitude, coordinates.longitude, weekAgo, today)
        aqiRecords = aqiRange.hourly_records || []
        
        // Fetch weather data for each day (no range endpoint available)
        const weatherPromises = []
        for (let i = 0; i < 7; i++) {
          const date = format(subDays(new Date(), i), 'yyyy-MM-dd')
          weatherPromises.push(fetchHourlyWeatherData(coordinates.latitude, coordinates.longitude, date))
        }
        const weatherResults = await Promise.all(weatherPromises)
        weatherRecords = weatherResults.flatMap(r => r.hourly_records || [])
      } else if (viewMode === 'monthly') {
        // Monthly: Last 30 days
        const monthAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
        
        // Fetch AQI range
        const aqiRange = await fetchHourlyAQIDataRange(coordinates.latitude, coordinates.longitude, monthAgo, today)
        aqiRecords = aqiRange.hourly_records || []
        
        // Fetch weather data for each day (no range endpoint available)
        const weatherPromises = []
        for (let i = 0; i < 30; i++) {
          const date = format(subDays(new Date(), i), 'yyyy-MM-dd')
          weatherPromises.push(fetchHourlyWeatherData(coordinates.latitude, coordinates.longitude, date))
        }
        const weatherResults = await Promise.all(weatherPromises)
        weatherRecords = weatherResults.flatMap(r => r.hourly_records || [])
      }
      
      setHourlyAQIData(aqiRecords)
      setHourlyWeatherData(weatherRecords)
    } catch (err) {
      setError(err.message)
      console.error('Error fetching hourly data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDateChange = (direction) => {
    const current = parseISO(selectedDate)
    const start = startDate ? parseISO(startDate) : null
    const end = endDate ? parseISO(endDate) : null
    const today = startOfDay(new Date())
    const maxDate = end && end < today ? end : today
    
    if (direction === 'prev') {
      const prevDate = subDays(current, 1)
      if (start && prevDate >= startOfDay(start)) {
        setSelectedDate(format(prevDate, 'yyyy-MM-dd'))
      }
    } else if (direction === 'next') {
      const nextDate = addDays(current, 1)
      // Don't go beyond maxDate (allow going to maxDate itself)
      if (nextDate > maxDate) {
        // If we can't go to next, but we're not at maxDate, go to maxDate
        if (current < maxDate) {
          setSelectedDate(format(maxDate, 'yyyy-MM-dd'))
        }
        return
      }
      setSelectedDate(format(nextDate, 'yyyy-MM-dd'))
    }
  }

  const toggleParameter = (paramKey) => {
    if (selectionMode === 'single') {
      // Single selection mode: replace current selection
      setSelectedParameters([paramKey])
    } else {
      // Multiple selection mode: toggle
      setSelectedParameters(prev => 
        prev.includes(paramKey)
          ? prev.filter(p => p !== paramKey)
          : [...prev, paramKey]
      )
    }
  }

  const selectAllParameters = () => {
    setSelectedParameters(parameters.map(p => p.key))
  }

  const deselectAllParameters = () => {
    setSelectedParameters([])
  }

  // Handle chart refresh
  const handleRefreshChart = async () => {
    if (!coordinates) return
    await fetchHourlyData()
  }

  // Prepare chart data - merge AQI and Weather data by time
  const chartData = useMemo(() => {
    if (!hourlyAQIData.length && !hourlyWeatherData.length) return []
    
    // Create a map to merge data by time
    const dataMap = new Map()
    
    // Helper function to get time key based on view mode
    const getTimeKey = (date) => {
      const parsedDate = parseISO(date)
      if (viewMode === 'live') {
        // Live: Show time in HH:mm format for better readability
        return format(parsedDate, 'HH:mm')
      } else if (viewMode === 'daily') {
        // Daily: Show time in HH:mm format
        return format(parsedDate, 'HH:mm')
      } else if (viewMode === 'weekly') {
        // Weekly: Show actual dates (MMM dd format, e.g., "Jan 15")
        return format(parsedDate, 'MMM dd')
      } else if (viewMode === 'monthly') {
        // Monthly: Show actual dates (MMM dd format, e.g., "Jan 15")
        return format(parsedDate, 'MMM dd')
      }
      return format(parsedDate, 'HH:mm')
    }
    
    // Add AQI data - for weekly/monthly, we need to aggregate properly
    if (viewMode === 'weekly' || viewMode === 'monthly') {
      // Group records by day first
      const dailyGroups = new Map()
      
      hourlyAQIData.forEach(record => {
        try {
          const date = parseISO(record.date)
          const timeKey = getTimeKey(record.date)
          
          if (!dailyGroups.has(timeKey)) {
            dailyGroups.set(timeKey, [])
          }
          dailyGroups.get(timeKey).push({ ...record, date: record.date, parsedDate: date })
        } catch {
          // Skip invalid records
        }
      })
      
      // Process each day group
      dailyGroups.forEach((records, timeKey) => {
        // Sort records by date (most recent first)
        records.sort((a, b) => b.parsedDate - a.parsedDate)
        
        // Calculate average AQI and other values
        const validRecords = records.filter(r => r.aqi !== null && r.aqi !== undefined)
        if (validRecords.length === 0) return
        
        const avgAqi = validRecords.reduce((sum, r) => sum + r.aqi, 0) / validRecords.length
        const avgPm25 = validRecords.filter(r => r.pm2_5 !== null).reduce((sum, r) => sum + r.pm2_5, 0) / validRecords.filter(r => r.pm2_5 !== null).length || null
        const avgPm10 = validRecords.filter(r => r.pm10 !== null).reduce((sum, r) => sum + r.pm10, 0) / validRecords.filter(r => r.pm10 !== null).length || null
        const avgCo = validRecords.filter(r => r.co !== null).reduce((sum, r) => sum + r.co, 0) / validRecords.filter(r => r.co !== null).length || null
        const avgNo2 = validRecords.filter(r => r.no2 !== null).reduce((sum, r) => sum + r.no2, 0) / validRecords.filter(r => r.no2 !== null).length || null
        const avgSo2 = validRecords.filter(r => r.so2 !== null).reduce((sum, r) => sum + r.so2, 0) / validRecords.filter(r => r.so2 !== null).length || null
        const avgO3 = validRecords.filter(r => r.o3 !== null).reduce((sum, r) => sum + r.o3, 0) / validRecords.filter(r => r.o3 !== null).length || null
        
        // Use trend from most recent record, or calculate trend based on first and last AQI
        let trend = null
        let trendPercentage = null
        
        if (validRecords.length >= 2) {
          // Calculate trend: compare first (oldest) and last (newest) AQI values
          const sortedByDate = [...validRecords].sort((a, b) => a.parsedDate - b.parsedDate)
          const firstAqi = sortedByDate[0].aqi
          const lastAqi = sortedByDate[sortedByDate.length - 1].aqi
          
          if (firstAqi !== null && lastAqi !== null && firstAqi !== undefined && lastAqi !== undefined) {
            const diff = lastAqi - firstAqi
            const percentChange = firstAqi > 0 ? ((diff / firstAqi) * 100) : 0
            
            if (diff > 0) {
              trend = '↑'
            } else if (diff < 0) {
              trend = '↓'
            } else {
              trend = '→'
            }
            trendPercentage = Math.abs(percentChange)
          }
        } else if (validRecords.length === 1) {
          // Use trend from the single record if available
          trend = validRecords[0].trend
          trendPercentage = validRecords[0].trend_percentage
        }
        
        // Use data_source from most recent record
        const dataSource = records[0].data_source || null
        
        dataMap.set(timeKey, {
          time: timeKey,
          fullTime: format(records[0].parsedDate, 'HH:mm:ss'),
          date: records[0].date,
          originalDate: records[0].parsedDate,
          aqi: Math.round(avgAqi),
          pm2_5: avgPm25 !== null ? parseFloat(avgPm25.toFixed(2)) : null,
          pm10: avgPm10 !== null ? parseFloat(avgPm10.toFixed(2)) : null,
          co: avgCo !== null ? parseFloat(avgCo.toFixed(2)) : null,
          no2: avgNo2 !== null ? parseFloat(avgNo2.toFixed(2)) : null,
          so2: avgSo2 !== null ? parseFloat(avgSo2.toFixed(2)) : null,
          o3: avgO3 !== null ? parseFloat(avgO3.toFixed(2)) : null,
          trend: trend,
          trend_percentage: trendPercentage !== null ? parseFloat(trendPercentage.toFixed(1)) : null,
          data_source: dataSource
        })
      })
    } else {
      // For live and daily, use original logic
      hourlyAQIData.forEach(record => {
        try {
          const date = parseISO(record.date)
          const timeKey = getTimeKey(record.date)
          
          if (!dataMap.has(timeKey)) {
            dataMap.set(timeKey, {
              time: timeKey,
              fullTime: format(date, 'HH:mm:ss'),
              date: record.date,
              originalDate: date
            })
          }
          
          const entry = dataMap.get(timeKey)
          Object.assign(entry, {
            aqi: record.aqi,
            pm2_5: record.pm2_5,
            pm10: record.pm10,
            co: record.co,
            no2: record.no2,
            so2: record.so2,
            o3: record.o3,
            trend: record.trend,
            trend_percentage: record.trend_percentage,
            data_source: record.data_source
          })
        } catch {
          // Skip invalid records
        }
      })
    }
    
    // Add Weather data
    hourlyWeatherData.forEach(record => {
      try {
        const date = parseISO(record.date)
        const timeKey = getTimeKey(record.date)
        
        if (!dataMap.has(timeKey)) {
          dataMap.set(timeKey, {
            time: timeKey,
            fullTime: format(date, 'HH:mm:ss'),
            date: record.date,
            originalDate: date
          })
        }
        
        const entry = dataMap.get(timeKey)
        Object.assign(entry, {
          temperature: record.temperature,
          feels_like: record.feels_like,
          humidity: record.humidity,
          wind_speed: record.wind_speed,
          wind_gusts: record.wind_gusts,
          uv_index: record.uv_index,
          precipitation: record.precipitation,
          cloud_cover: record.cloud_cover,
          visibility: record.visibility,
          pressure: record.pressure
        })
      } catch {
        // Skip invalid records
      }
    })
    
    // Convert map to array and sort by original date
    return Array.from(dataMap.values())
      .sort((a, b) => {
        if (a.originalDate && b.originalDate) {
          return a.originalDate - b.originalDate
        }
        return a.time.localeCompare(b.time)
      })
  }, [hourlyAQIData, hourlyWeatherData, viewMode])

  // Calculate statistics for selected parameters (for tooltip)
  const calculateStats = (data, paramKey) => {
    const values = data
      .map(r => r[paramKey])
      .filter(v => v !== null && v !== undefined && !isNaN(v))
    
    if (values.length === 0) return null
    
    const sorted = [...values].sort((a, b) => a - b)
    return {
      min: Math.round(sorted[0] * 100) / 100,
      max: Math.round(sorted[sorted.length - 1] * 100) / 100,
      mean: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
      median: sorted.length % 2 === 0
        ? Math.round(((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) * 100) / 100
        : Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100
    }
  }

  // Calculate statistics for all selected parameters (for tooltip)
  const allStats = useMemo(() => {
    const stats = {}
    selectedParameters.forEach(paramKey => {
      const stat = calculateStats(chartData, paramKey)
      if (stat) {
        stats[paramKey] = stat
      }
    })
    return stats
  }, [chartData, selectedParameters])

  // Custom tooltip with statistics
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null
    
    return (
      <div className="custom-tooltip" >
        <div className="tooltip-header">
          <strong>Time: {label}</strong>
        </div>
        <div className="tooltip-values">
          {payload.map((entry, index) => {
            const param = parameters.find(p => p.key === entry.dataKey)
            if (!param) return null
            
            const stats = allStats[entry.dataKey]
            return (
              <div key={index} className="tooltip-item">
                <div className="tooltip-param">
                  <span 
                    className="tooltip-color-dot" 
                    style={{ backgroundColor: entry.color || param.color }}
                  ></span>
                  <strong>{param.label}:</strong> {entry.value !== null && entry.value !== undefined ? entry.value.toFixed(2) : 'N/A'}
                </div>
                {stats && (
                  <div className="tooltip-stats">
                    <span>Min: {stats.min}</span>
                    <span>Max: {stats.max}</span>
                    <span>Mean: {stats.mean}</span>
                    <span>Median: {stats.median}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const getAQICategory = (aqi) => {
    if (!aqi) return { label: 'N/A', color: '#6b7280' }
    if (aqi <= 50) return { label: 'Good', color: '#10b981' }
    if (aqi <= 100) return { label: 'Moderate', color: '#f59e0b' }
    if (aqi <= 150) return { label: 'Poor', color: '#f97316' }
    if (aqi <= 200) return { label: 'Unhealthy', color: '#ef4444' }
    if (aqi <= 300) return { label: 'Severe', color: '#8b5cf6' }
    return { label: 'Hazardous', color: '#7f1d1d' }
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

  const handleExportData = () => {
    if ((!hourlyAQIData || hourlyAQIData.length === 0) && (!hourlyWeatherData || hourlyWeatherData.length === 0)) {
      alert('No data available to export')
      return
    }

    try {
      // Merge AQI and Weather data for export
      const exportDataMap = new Map()
      
      // Add AQI data
      hourlyAQIData.forEach(record => {
        const { date: datePart, time } = formatDateTime(record.date)
        const key = `${datePart}_${time}`
        if (!exportDataMap.has(key)) {
          exportDataMap.set(key, {
            'Date': datePart,
            'Time': time,
            'Full DateTime': record.date
          })
        }
        const entry = exportDataMap.get(key)
        const category = getAQICategory(record.aqi)
        entry['AQI'] = record.aqi !== null && record.aqi !== undefined ? record.aqi : 'N/A'
        entry['AQI Category'] = category.label
        entry['PM2.5 (µg/m³)'] = record.pm2_5 !== null && record.pm2_5 !== undefined ? record.pm2_5.toFixed(2) : 'N/A'
        entry['PM10 (µg/m³)'] = record.pm10 !== null && record.pm10 !== undefined ? record.pm10.toFixed(2) : 'N/A'
        entry['CO (ppm)'] = record.co !== null && record.co !== undefined ? record.co.toFixed(2) : 'N/A'
        entry['NO₂ (µg/m³)'] = record.no2 !== null && record.no2 !== undefined ? record.no2.toFixed(2) : 'N/A'
        entry['SO₂ (µg/m³)'] = record.so2 !== null && record.so2 !== undefined ? record.so2.toFixed(2) : 'N/A'
        entry['O₃ (µg/m³)'] = record.o3 !== null && record.o3 !== undefined ? record.o3.toFixed(2) : 'N/A'
        entry['Trend'] = record.trend ? `${record.trend} ${record.trend_percentage !== null && record.trend_percentage !== undefined ? `${record.trend_percentage}%` : ''}` : 'N/A'
        entry['Data Source'] = record.data_source==="History/Estimate" ? "S" : "A" || 'N/A'
      })
      
      // Add Weather data
      hourlyWeatherData.forEach(record => {
        const { date: datePart, time } = formatDateTime(record.date)
        const key = `${datePart}_${time}`
        if (!exportDataMap.has(key)) {
          exportDataMap.set(key, {
            'Date': datePart,
            'Time': time,
            'Full DateTime': record.date
          })
        }
        const entry = exportDataMap.get(key)
        entry['Temperature (°C)'] = record.temperature !== null && record.temperature !== undefined ? record.temperature : 'N/A'
        entry['Feels Like (°C)'] = record.feels_like !== null && record.feels_like !== undefined ? record.feels_like : 'N/A'
        entry['Humidity (%)'] = record.humidity !== null && record.humidity !== undefined ? record.humidity : 'N/A'
        entry['Wind Speed (km/h)'] = record.wind_speed !== null && record.wind_speed !== undefined ? record.wind_speed : 'N/A'
        entry['Wind Gusts (km/h)'] = record.wind_gusts !== null && record.wind_gusts !== undefined ? record.wind_gusts : 'N/A'
        entry['UV Index'] = record.uv_index !== null && record.uv_index !== undefined ? record.uv_index : 'N/A'
        entry['Precipitation (mm)'] = record.precipitation !== null && record.precipitation !== undefined ? record.precipitation : 'N/A'
        entry['Cloud Cover (%)'] = record.cloud_cover !== null && record.cloud_cover !== undefined ? record.cloud_cover : 'N/A'
        entry['Visibility (km)'] = record.visibility !== null && record.visibility !== undefined ? record.visibility : 'N/A'
        entry['Pressure (mb)'] = record.pressure !== null && record.pressure !== undefined ? record.pressure : 'N/A'
      })
      
      // Prepare data for export
      const exportData = Array.from(exportDataMap.values()).map((record, index) => {
        const { date: datePart, time } = formatDateTime(record.date)
        const category = getAQICategory(record.aqi)
        
        return record
      })

      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(exportData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'AQI Data')

      // Set column widths for better formatting
      const colWidths = [
        { wch: 12 }, // Date
        { wch: 8 },  // Time
        { wch: 20 }, // Full DateTime
        { wch: 8 },  // AQI
        { wch: 15 }, // AQI Category
        { wch: 12 }, // PM2.5
        { wch: 12 }, // PM10
        { wch: 10 }, // CO
        { wch: 12 }, // NO₂
        { wch: 12 }, // SO₂
        { wch: 12 }, // O₃
        { wch: 12 }, // Trend
        { wch: 15 }, // Data Source
        { wch: 12 }, // Temperature
        { wch: 12 }, // Feels Like
        { wch: 12 }, // Humidity
        { wch: 12 }, // Wind Speed
        { wch: 12 }, // Wind Gusts
        { wch: 10 }, // UV Index
        { wch: 12 }, // Precipitation
        { wch: 12 }, // Cloud Cover
        { wch: 12 }, // Visibility
        { wch: 12 }  // Pressure
      ]
      ws['!cols'] = colWidths

      // Add metadata
      if (coordinates) {
        wb.Props = {
          Title: 'Climate Data Export',
          Subject: `Combined AQI and Weather Data for ${format(parseISO(selectedDate), 'MMMM dd, yyyy')}`,
          Author: 'Climate Eye',
          CreatedDate: new Date(),
          Location: `Lat: ${coordinates.latitude.toFixed(4)}, Lon: ${coordinates.longitude.toFixed(4)}`
        }
      }

      // Generate filename with date
      const dateStr = format(parseISO(selectedDate), 'yyyy-MM-dd')
      const filename = `Climate_Data_${dateStr}.xlsx`

      // Export file
      XLSX.writeFile(wb, filename)
    } catch (error) {
      console.error('Error exporting data:', error)
      alert('Error exporting data. Please try again.')
    }
  }

  if (!geometry || !coordinates) {
    return (
      <div className="aqi-detail-page">
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
    <div className="aqi-detail-page">
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
          <h1>Climate Analysis Results</h1>
          <p className="subtitle">Comprehensive analysis of selected parameters</p>
        </div>
        <div className="header-actions">
          <button className="export-button" onClick={handleExportData} disabled={(!hourlyAQIData || hourlyAQIData.length === 0) && (!hourlyWeatherData || hourlyWeatherData.length === 0)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Export Data
          </button>
        </div>
      </div>

      {/* Date Navigation */}
      <div className="date-navigation">
        <button 
          onClick={() => handleDateChange('prev')} 
          disabled={!canGoPrev()}
          className="nav-button"
        >
        ←z Previous
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

      {/* Hourly AQI Cards for Daily Mode */}
      {dailyMode && coordinates && (
        <HourlyAQICards 
          geometry={geometry} 
          date={selectedDate}
        />
      )}

      {/* Data Visualization Section - Only show when not in daily mode */}
      {!dailyMode && (
      <div className="visualization-section">
        <div className="section-header">
          <div className="section-title-with-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
            <span>Data Visualization</span>
          </div>
          <div className="chart-controls">
            <div className="chart-type-toggle">
              <button 
                className={chartType === 'line' ? 'active' : ''}
                onClick={() => setChartType('line')}
              >
                Line
              </button>
              <button 
                className={chartType === 'bar' ? 'active' : ''}
                onClick={() => setChartType('bar')}
              >
                Bar
              </button>
            </div>
            <button 
              className="chart-refresh-button"
              onClick={handleRefreshChart}
              disabled={loading || !coordinates}
              title="Refresh Chart Data"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                <path d="M3 21v-5h5"></path>
              </svg>
            </button>
          </div>
        </div>

       

        {/* Parameters Selection */}
        <div className="parameters-section">
          <div className="parameters-header">
            <span className="parameters-label">Parameters:</span>
            <div className="parameter-actions">
            <button
            className={`view-mode-button ${viewMode === 'live' ? 'active' : ''}`}
            onClick={() => setViewMode('live')}
            disabled={loading}
          >
            Live
          </button>
          <button
            className={`view-mode-button ${viewMode === 'daily' ? 'active' : ''}`}
            onClick={() => setViewMode('daily')}
            disabled={loading}
          >
            Last 24 Hrs Data
          </button>
          <button
            className={`view-mode-button ${viewMode === 'weekly' ? 'active' : ''}`}
            onClick={() => setViewMode('weekly')}
            disabled={loading}
          >
            Weekly
          </button>
          <button
            className={`view-mode-button ${viewMode === 'monthly' ? 'active' : ''}`}
            onClick={() => setViewMode('monthly')}
            disabled={loading}
          >
            Monthly
          </button>
              <div className="selection-mode-toggle">
                <button 
                  className={`mode-button ${selectionMode === 'single' ? 'active' : ''}`}
                  onClick={() => {
                    setSelectionMode('single')
                    if (selectedParameters.length > 0) {
                      setSelectedParameters([selectedParameters[0]])
                    }
                  }}
                  title="Select one parameter at a time"
                >
                  Single
                </button>
                <button 
                  className={`mode-button ${selectionMode === 'multiple' ? 'active' : ''}`}
                  onClick={() => setSelectionMode('multiple')}
                  title="Select multiple parameters"
                >
                  Multiple
                </button>
              </div>
              <button onClick={selectAllParameters} className="select-all-btn">All Parameters</button>
              <button onClick={deselectAllParameters} className="deselect-all-btn">Clear</button>
            </div>
          </div>
          
          {/* Dropdown for Parameter Selection */}
          <div className="parameter-dropdown-container">
            <select
              className="parameter-dropdown"
              value={selectionMode === 'single' ? (selectedParameters[0] || '') : ''}
              onChange={(e) => {
                const value = e.target.value
                if (!value) return
                
                if (selectionMode === 'single') {
                  setSelectedParameters([value])
                } else {
                  if (!selectedParameters.includes(value)) {
                    setSelectedParameters([...selectedParameters, value])
                  }
                  e.target.value = '' // Reset dropdown
                }
              }}
            >
              <option value="">{selectionMode === 'single' ? 'Select a parameter...' : 'Add parameter...'}</option>
              <optgroup label="Air Quality Parameters">
                {parameters.filter(p => p.category === 'aqi').map(param => (
                  <option key={param.key} value={param.key}>
                    {param.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Weather Parameters">
                {parameters.filter(p => p.category === 'weather').map(param => (
                  <option key={param.key} value={param.key}>
                    {param.label}
                  </option>
                ))}
              </optgroup>
            </select>
            {selectionMode === 'multiple' && selectedParameters.length > 0 && (
              <div className="selected-parameters-list">
                {selectedParameters.map(paramKey => {
                  const param = parameters.find(p => p.key === paramKey)
                  if (!param) return null
                  return (
                    <span key={paramKey} className="selected-param-tag" style={{ 
                      backgroundColor: param.color + '20', 
                      borderColor: param.color,
                      color: param.color
                    }}>
                      {param.label}
                      <button
                        onClick={() => toggleParameter(paramKey)}
                        className="remove-param-btn"
                        aria-label={`Remove ${param.label}`}
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Chart */}
        {loading && chartData.length === 0 ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>Loading data for visualization...</p>
          </div>
        ) : chartData.length > 0 && selectedParameters.length > 0 ? (
          <div className="chart-container">
            {chartType === 'line' ? (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: viewMode === 'weekly' || viewMode === 'monthly' ? 60 : 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(20, 184, 166, 0.2)" />
                  <XAxis 
                    dataKey="time" 
                    stroke="#9ca3af"
                    style={{ fontSize: '12px' }}
                    angle={viewMode === 'weekly' ? -45 : viewMode === 'monthly' ? -45 : 0}
                    textAnchor={viewMode === 'weekly' ? 'end' : viewMode === 'monthly' ? 'end' : 'middle'}
                    height={viewMode === 'weekly' ? 70 : viewMode === 'monthly' ? 60 : 40}
                    interval={viewMode === 'live' ? 4 : viewMode === 'daily' ? 2 : viewMode === 'weekly' ? 0 : viewMode === 'monthly' ? 2 : 0}
                    label={{ 
                      value: viewMode === 'live' ? 'Time (HH:mm)' : 
                             viewMode === 'daily' ? 'Time (HH:mm)' : 
                             viewMode === 'weekly' ? 'Days' : 
                             viewMode === 'monthly' ? 'Days' : 
                             'Time (HH:mm)', 
                      position: 'insideBottom', 
                      offset: -5, 
                      style: { fill: '#9ca3af' } 
                    }}
                  />
                  <YAxis 
                    stroke="#9ca3af"
                    style={{ fontSize: '12px' }}
                    label={{ value: 'Value', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
                  />
                  <Tooltip content={<CustomTooltip />}  />
                  <Legend 
                    wrapperStyle={{ color: '#e2e8f0' }}
                  />
                  {selectedParameters.map(paramKey => {
                    const param = parameters.find(p => p.key === paramKey)
                    return param ? (
                      <Line 
                        key={paramKey}
                        type="monotone" 
                        dataKey={paramKey} 
                        stroke={param.color}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        name={param.label}
                      />
                    ) : null
                  })}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: viewMode === 'weekly' || viewMode === 'monthly' ? 60 : 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(20, 184, 166, 0.2)" />
                  <XAxis 
                    dataKey="time" 
                    stroke="#9ca3af"
                    style={{ fontSize: '12px' }}
                    angle={viewMode === 'weekly' ? -45 : viewMode === 'monthly' ? -45 : 0}
                    textAnchor={viewMode === 'weekly' ? 'end' : viewMode === 'monthly' ? 'end' : 'middle'}
                    height={viewMode === 'weekly' ? 70 : viewMode === 'monthly' ? 60 : 40}
                    interval={viewMode === 'live' ? 4 : viewMode === 'daily' ? 2 : viewMode === 'weekly' ? 0 : viewMode === 'monthly' ? 2 : 0}
                    label={{ 
                      value: viewMode === 'live' ? 'Time (HH:mm)' : 
                             viewMode === 'daily' ? 'Time (HH:mm)' : 
                             viewMode === 'weekly' ? 'Days' : 
                             viewMode === 'monthly' ? 'Days' : 
                             'Time (HH:mm)', 
                      position: 'insideBottom', 
                      offset: -5, 
                      style: { fill: '#9ca3af' } 
                    }}
                  />
                  <YAxis 
                    stroke="#9ca3af"
                    style={{ fontSize: '12px' }}
                    label={{ value: 'Value', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend 
                    wrapperStyle={{ color: '#e2e8f0' }}
                  />
                  {selectedParameters.map(paramKey => {
                    const param = parameters.find(p => p.key === paramKey)
                    return param ? (
                      <Bar 
                        key={paramKey}
                        dataKey={paramKey} 
                        fill={param.color}
                        name={param.label}
                        style={{ zIndex: -10 }}
                      />
                    ) : null
                  })}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : (
          <div className="no-chart-data">
            <p>Select at least one parameter to view the chart</p>
          </div>
        )}
      </div>
      )}

      {/* Hourly Table - Only show when not in daily mode */}
      {!dailyMode && (
      <>
      {loading && hourlyAQIData.length === 0 && hourlyWeatherData.length === 0 ? (
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading hourly data...</p>
        </div>
      ) : error ? (
        <div className="error-message">
          <p>Error: {error}</p>
        </div>
      ) : (hourlyAQIData.length > 0 || hourlyWeatherData.length > 0) ? (
        <div className="table-container">
          <table className="hourly-aqi-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>AQI</th>
                <th>Category</th>
                <th>PM2.5</th>
                <th>PM10</th>
                <th>CO</th>
                <th>NO₂</th>
                <th>SO₂</th>
                <th>O₃</th>
                <th>Temperature</th>
                <th>Humidity</th>
                <th>Wind Speed</th>
                <th>UV Index</th>
                <th>Trend</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((record, index) => {
                const dateStr = record.date || record.fullTime
                const { date: datePart, time } = formatDateTime(dateStr)
                const category = getAQICategory(record.aqi)
                // Use trend and source from chartData (already merged from hourlyAQIData)
                const trend = record.trend
                const trendPercentage = record.trend_percentage
                const dataSource = record.data_source
                return (
                  <tr key={index} className={dataSource === 'Current' ? 'current-row' : ''}>
                    <td>{datePart}</td>
                    <td>{time}</td>
                    <td>
                      <span className="aqi-table-value" style={{ color: category.color }}>
                        {record.aqi || 'N/A'}
                      </span>
                    </td>
                    <td>
                      <span className="category-badge" style={{ backgroundColor: category.color + '20', color: category.color }}>
                        {category.label}
                      </span>
                    </td>
                    <td>{record.pm2_5 !== null && record.pm2_5 !== undefined ? record.pm2_5.toFixed(2) : 'N/A'}</td>
                    <td>{record.pm10 !== null && record.pm10 !== undefined ? record.pm10.toFixed(2) : 'N/A'}</td>
                    <td>{record.co !== null && record.co !== undefined ? record.co.toFixed(2) : 'N/A'}</td>
                    <td>{record.no2 !== null && record.no2 !== undefined ? record.no2.toFixed(2) : 'N/A'}</td>
                    <td>{record.so2 !== null && record.so2 !== undefined ? record.so2.toFixed(2) : 'N/A'}</td>
                    <td>{record.o3 !== null && record.o3 !== undefined ? record.o3.toFixed(2) : 'N/A'}</td>
                    <td>{record.temperature !== null && record.temperature !== undefined ? `${record.temperature.toFixed(1)}°C` : 'N/A'}</td>
                    <td>{record.humidity !== null && record.humidity !== undefined ? `${record.humidity.toFixed(1)}%` : 'N/A'}</td>
                    <td>{record.wind_speed !== null && record.wind_speed !== undefined ? `${record.wind_speed.toFixed(1)} km/h` : 'N/A'}</td>
                    <td>{record.uv_index !== null && record.uv_index !== undefined ? record.uv_index.toFixed(1) : 'N/A'}</td>
                    <td>
                      {trend && (
                        <span className={`trend-arrow ${trend === '↑' ? 'trend-up' : trend === '↓' ? 'trend-down' : 'trend-same'}`}>
                          {trend} {trendPercentage !== null && trendPercentage !== undefined ? `${trendPercentage}%` : ''}
                        </span>
                      )}
                    </td>
                    <td>
                      {dataSource && (
                        <span className={`source-badge ${dataSource.toLowerCase().replace('/', '-')}`}>
                          {/* {dataSource} */}
                          {dataSource=="History/Estimate"? "S":"A"}
                        </span>
                      )}
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
      </>
      )}
    </div>
  )
}


export default AQIDetailPage
