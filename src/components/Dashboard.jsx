import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { format, subDays, startOfDay, isAfter, addDays, isBefore, isEqual, isToday, subHours, parseISO } from 'date-fns'
import { LineChart, Line, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, Cell, Dot } from 'recharts'
import MapComponent from './MapComponent'
import WeatherSection from './WeatherSection'
import AQISection from './AQISection'
import LiveDashboardCards from './LiveDashboardCards'
import { calculateGeometryCenter, fetchAQIData, fetchWeatherData, fetchHourlyAQIDataRange, fetchHourlyWeatherData, fetchHourlyAQIData } from '../services/api'
import './Dashboard.css'
import './DatePicker.css'

const Dashboard = () => {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const today = startOfDay(new Date())
  const oneWeekAgo = startOfDay(subDays(today, 7))

  const [startDate, setStartDate] = useState(format(oneWeekAgo, 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'))
  const [viewType, setViewType] = useState('map') // 'map' or 'satellite'
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawnGeometry, setDrawnGeometry] = useState(null)
  const [uploadedKML, setUploadedKML] = useState(null)
  const [showAnalysis, setShowAnalysis] = useState(false) 
  const [currentViewDate, setCurrentViewDate] = useState(null) // Currently viewing date
  const [weatherData, setWeatherData] = useState(null)
  const [aqiData, setAqiData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false) // For mobile sidebar toggle
  const [viewMode, setViewMode] = useState('live') // 'live', 'daily', 'weekly', 'monthly'
  const [aqiChartData, setAqiChartData] = useState([]) // For AQI chart
  const [loadingChart, setLoadingChart] = useState(false)
  const [timeChartData, setTimeChartData] = useState([]) // For Time chart
  const [loadingTimeChart, setLoadingTimeChart] = useState(false)

  useEffect(() => {
    // Update dates daily - recalculate one week ago from today
    const updateDates = () => {
      const currentToday = startOfDay(new Date())
      const currentOneWeekAgo = startOfDay(subDays(currentToday, 7))
      setStartDate(format(currentOneWeekAgo, 'yyyy-MM-dd'))
      setEndDate(format(currentToday, 'yyyy-MM-dd'))
    }

    // Update on mount and set interval to check daily
    updateDates()
    const interval = setInterval(updateDates, 60000) // Check every minute

    return () => clearInterval(interval)
  }, [])

  // Restore analysis view when navigating back from detail page
  useEffect(() => {
    if (location.state?.restoreAnalysis) {
      // Restore the analysis state
      if (location.state.geometry) {
        // If geometry is provided, restore it
        if (location.state.geometry.type === 'Polygon') {
          setDrawnGeometry(location.state.geometry)
        }
      }
      if (location.state.startDate) {
        setStartDate(location.state.startDate)
      }
      if (location.state.endDate) {
        setEndDate(location.state.endDate)
      }
      if (location.state.currentDate) {
        setCurrentViewDate(location.state.currentDate)
      }
      // Show analysis view
      setShowAnalysis(true)
      
      // Fetch data if we have geometry and date
      if (location.state.geometry && location.state.currentDate) {
        const center = calculateGeometryCenter(location.state.geometry)
        if (center) {
          fetchDataForDate(center.latitude, center.longitude, location.state.currentDate)
        }
      }
      
      // Clear the state to prevent re-triggering
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state, navigate])

  const handleStartDateChange = (e) => {
    const selectedDate = new Date(e.target.value)
    const selectedStartOfDay = startOfDay(selectedDate)
    const currentEndDate = new Date(endDate)
    
    // Can't select a date after end date
    if (isAfter(selectedStartOfDay, currentEndDate)) {
      return
    }
    
    setStartDate(format(selectedStartOfDay, 'yyyy-MM-dd'))
  }

  const handleEndDateChange = (e) => {
    const selectedDate = new Date(e.target.value)
    const selectedStartOfDay = startOfDay(selectedDate)
    const currentToday = startOfDay(new Date())
    const currentStartDate = new Date(startDate)
    
    // Can't select a date beyond today
    if (isAfter(selectedStartOfDay, currentToday)) {
      return
    }
    
    // Can't select a date before start date
    if (isAfter(currentStartDate, selectedStartOfDay)) {
      return
    }
    
    setEndDate(format(selectedStartOfDay, 'yyyy-MM-dd'))
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleDrawArea = () => {
    setIsDrawing(true)
    setUploadedKML(null) // Clear KML when drawing
  }

  const handleGeometryComplete = (geometry) => {
    setDrawnGeometry(geometry)
    setIsDrawing(false)
  }

  const handleCancelDrawing = () => {
    setIsDrawing(false)
  }

  const handleKMLUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.kml') && !file.name.toLowerCase().endsWith('.kmz')) {
      alert('Please upload a KML or KMZ file')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      setUploadedKML({
        name: file.name,
        content: event.target.result
      })
      setDrawnGeometry(null) // Clear drawn geometry when KML is uploaded
      setIsDrawing(false)
    }
    reader.readAsText(file)
    e.target.value = '' // Reset file input
  }

  const handleClearGeometry = () => {
    setDrawnGeometry(null)
    setUploadedKML(null)
    setIsDrawing(false)
  }

  const toggleView = () => {
    setViewType(prev => prev === 'map' ? 'satellite' : 'map')
  }

  const getMaxDate = () => {
    return format(today, 'yyyy-MM-dd')
  }

  // Date navigation functions
  const handlePreviousDate = () => {
    if (!currentViewDate || loading) return
    
    const current = new Date(currentViewDate)
    const prev = subDays(current, 1)
    const start = new Date(startDate)
    
    // Don't go before start date
    if (isBefore(prev, start) && !isEqual(prev, start)) {
      return
    }
    
    setCurrentViewDate(format(prev, 'yyyy-MM-dd'))
  }

  const handleNextDate = () => {
    if (!currentViewDate || loading) return
    
    const current = startOfDay(new Date(currentViewDate))
    const next = startOfDay(addDays(current, 1))
    const end = startOfDay(new Date(endDate))
    const todayDate = startOfDay(new Date())
    
    // The maximum date we can navigate to is the earlier of endDate or today
    const maxDate = isBefore(end, todayDate) ? end : todayDate
    
    // Don't go beyond the maximum date (allow going to maxDate itself)
    if (isAfter(next, maxDate)) {
      // If we can't go to next, but we're not at maxDate, go to maxDate
      if (isBefore(current, maxDate)) {
        setCurrentViewDate(format(maxDate, 'yyyy-MM-dd'))
      }
      return
    }
    
    // Allow navigation if next date is equal to or before maxDate
    setCurrentViewDate(format(next, 'yyyy-MM-dd'))
  }

  const canGoPrevious = () => {
    if (!currentViewDate) return false
    const current = startOfDay(new Date(currentViewDate))
    const start = startOfDay(new Date(startDate))
    return isAfter(current, start)
  }

  const canGoNext = () => {
    if (!currentViewDate) return false
    const current = startOfDay(new Date(currentViewDate))
    const end = startOfDay(new Date(endDate))
    const todayDate = startOfDay(new Date())
    const maxDate = isBefore(end, todayDate) ? end : todayDate
    // Can go next if current date is before or equal to maxDate (allow going to most recent date)
    return isBefore(current, maxDate) || isEqual(current, maxDate)
  }

  // Parse KML to geometry
  const parseKMLToGeometry = (kmlContent) => {
    try {
      const parser = new DOMParser()
      const kmlDoc = parser.parseFromString(kmlContent, 'text/xml')
      const errorNode = kmlDoc.querySelector('parsererror')
      
      if (errorNode) {
        console.error('KML parsing error:', errorNode.textContent)
        return null
      }

      const coordinatesElements = kmlDoc.querySelectorAll('coordinates')
      if (coordinatesElements.length > 0) {
        const coordsText = coordinatesElements[0].textContent.trim()
        const coordPairs = coordsText.split(/\s+/).filter(c => c.trim())
        
        const coordinates = coordPairs.map(coord => {
          const [lng, lat] = coord.split(',').map(Number)
          return [lng, lat] // GeoJSON format [lng, lat]
        })
        
        return {
          type: 'Polygon',
          coordinates: [coordinates]
        }
      }
    } catch (error) {
      console.error('Error parsing KML:', error)
    }
    return null
  }

  // Helper function to aggregate hourly data
  const aggregateHourlyData = (hourlyRecords, type) => {
    if (!hourlyRecords || hourlyRecords.length === 0) return null

    if (type === 'aqi') {
      const validRecords = hourlyRecords.filter(r => r.aqi !== null && r.aqi !== undefined)
      if (validRecords.length === 0) return null

      return {
        aqi: Math.round(validRecords.reduce((sum, r) => sum + r.aqi, 0) / validRecords.length),
        pm2_5: validRecords.reduce((sum, r) => sum + (r.pm2_5 || 0), 0) / validRecords.length,
        pm10: validRecords.reduce((sum, r) => sum + (r.pm10 || 0), 0) / validRecords.length,
        co: validRecords.reduce((sum, r) => sum + (r.co || 0), 0) / validRecords.length,
        so2: validRecords.reduce((sum, r) => sum + (r.so2 || 0), 0) / validRecords.length,
        no2: validRecords.reduce((sum, r) => sum + (r.no2 || 0), 0) / validRecords.length,
        o3: validRecords.reduce((sum, r) => sum + (r.o3 || 0), 0) / validRecords.length,
        date: hourlyRecords[hourlyRecords.length - 1]?.date || new Date().toISOString()
      }
    } else {
      const validRecords = hourlyRecords.filter(r => r.temperature !== null && r.temperature !== undefined)
      if (validRecords.length === 0) return null

      return {
        temperature: Math.round(validRecords.reduce((sum, r) => sum + r.temperature, 0) / validRecords.length),
        feels_like: validRecords.reduce((sum, r) => sum + (r.feels_like || r.temperature), 0) / validRecords.length,
        humidity: validRecords.reduce((sum, r) => sum + (r.humidity || 0), 0) / validRecords.length,
        wind_speed: validRecords.reduce((sum, r) => sum + (r.wind_speed || 0), 0) / validRecords.length,
        uv_index: validRecords.reduce((sum, r) => sum + (r.uv_index || 0), 0) / validRecords.length,
        condition: validRecords[validRecords.length - 1]?.condition || 'Unknown',
        icon: validRecords[validRecords.length - 1]?.icon || 'cloud',
        date: hourlyRecords[hourlyRecords.length - 1]?.date || new Date().toISOString()
      }
    }
  }

  // Fetch data based on view mode
  const fetchDataForMode = async (latitude, longitude) => {
    setLoading(true)
    setError(null)
    setWeatherData(null)
    setAqiData(null)

    try {
      const today = format(new Date(), 'yyyy-MM-dd')
      
      if (viewMode === 'live') {
        // Live: Current data (no date parameter)
        const [weather, aqi] = await Promise.all([
          fetchWeatherData(latitude, longitude),
          fetchAQIData(latitude, longitude)
        ])
        setWeatherData(weather)
        setAqiData(aqi)
      } else if (viewMode === 'daily') {
        // Daily: Last 24 hours (today's hourly data)
        const [weatherHourly, aqiHourly] = await Promise.all([
          fetchHourlyWeatherData(latitude, longitude, today),
          fetchHourlyAQIData(latitude, longitude, today)
        ])
        
        const weatherAggregated = aggregateHourlyData(weatherHourly.hourly_records || [], 'weather')
        const aqiAggregated = aggregateHourlyData(aqiHourly.hourly_records || [], 'aqi')
        
        setWeatherData(weatherAggregated)
        setAqiData(aqiAggregated)
      } else if (viewMode === 'weekly') {
        // Weekly: Past 7 days
        const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
        
        // Fetch weather data for each day in the week
        const weatherPromises = []
        for (let i = 0; i < 7; i++) {
          const date = format(subDays(new Date(), i), 'yyyy-MM-dd')
          weatherPromises.push(fetchHourlyWeatherData(latitude, longitude, date))
        }
        
        const [weatherResults, aqiRange] = await Promise.all([
          Promise.all(weatherPromises),
          fetchHourlyAQIDataRange(latitude, longitude, weekAgo, today)
        ])
        
        const allWeatherRecords = weatherResults.flatMap(r => r.hourly_records || [])
        const weatherAggregated = aggregateHourlyData(allWeatherRecords, 'weather')
        const aqiAggregated = aggregateHourlyData(aqiRange.hourly_records || [], 'aqi')
        
        setWeatherData(weatherAggregated)
        setAqiData(aqiAggregated)
      } else if (viewMode === 'monthly') {
        // Monthly: Past 30 days
        const monthAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
        
        // Fetch weather data for each day in the month (limit to 30 days to avoid too many requests)
        const weatherPromises = []
        for (let i = 0; i < 30; i++) {
          const date = format(subDays(new Date(), i), 'yyyy-MM-dd')
          weatherPromises.push(fetchHourlyWeatherData(latitude, longitude, date))
        }
        
        const [weatherResults, aqiRange] = await Promise.all([
          Promise.all(weatherPromises),
          fetchHourlyAQIDataRange(latitude, longitude, monthAgo, today)
        ])
        
        const allWeatherRecords = weatherResults.flatMap(r => r.hourly_records || [])
        const weatherAggregated = aggregateHourlyData(allWeatherRecords, 'weather')
        const aqiAggregated = aggregateHourlyData(aqiRange.hourly_records || [], 'aqi')
        
        setWeatherData(weatherAggregated)
        setAqiData(aqiAggregated)
      }
    } catch (err) {
      setError(err.message)
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Fetch data for a specific date (legacy function for date navigation)
  const fetchDataForDate = async (latitude, longitude, date) => {
    setLoading(true)
    setError(null)
    setWeatherData(null)
    setAqiData(null)

    try {
      const [weather, aqi] = await Promise.all([
        fetchWeatherData(latitude, longitude, date),
        fetchAQIData(latitude, longitude, date)
      ])

      setWeatherData(weather)
      setAqiData(aqi)
    } catch (err) {
      setError(err.message)
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Handle view mode change
  const handleViewModeChange = async (mode) => {
    setViewMode(mode)
    // Set loading state immediately when mode changes
    setLoadingChart(true)
    
    if (showAnalysis && (drawnGeometry || uploadedKML)) {
      let geometry = drawnGeometry
      if (!geometry && uploadedKML) {
        geometry = parseKMLToGeometry(uploadedKML.content)
      }

      if (geometry) {
        const center = calculateGeometryCenter(geometry)
        if (center) {
          setLoadingTimeChart(true)
          await Promise.all([
            fetchDataForMode(center.latitude, center.longitude),
            fetchAQIChartData(center.latitude, center.longitude),
            fetchTimeChartData(center.latitude, center.longitude)
          ])
        }
      }
    } else {
      // If not in analysis mode, still reset loading
      setLoadingChart(false)
      setLoadingTimeChart(false)
    }
  }

  // Handle AQI Trend chart refresh
  const handleRefreshAQIChart = async () => {
    if (!showAnalysis || (!drawnGeometry && !uploadedKML)) return
    
    let geometry = drawnGeometry
    if (!geometry && uploadedKML) {
      geometry = parseKMLToGeometry(uploadedKML.content)
    }

    if (geometry) {
      const center = calculateGeometryCenter(geometry)
      if (center) {
        setLoadingChart(true)
        await fetchAQIChartData(center.latitude, center.longitude)
      }
    }
  }

  // Handle Time chart refresh
  const handleRefreshTimeChart = async () => {
    if (!showAnalysis || (!drawnGeometry && !uploadedKML)) return
    
    let geometry = drawnGeometry
    if (!geometry && uploadedKML) {
      geometry = parseKMLToGeometry(uploadedKML.content)
    }

    if (geometry) {
      const center = calculateGeometryCenter(geometry)
      if (center) {
        setLoadingTimeChart(true)
        await fetchTimeChartData(center.latitude, center.longitude)
      }
    }
  }

  // Handle analyse button click
  const handleAnalyse = async () => {
    if (!drawnGeometry && !uploadedKML) {
      alert('Please draw an area or upload a KML file first')
      return
    }

    // Close sidebar on mobile when analyzing
    setSidebarOpen(false)

    setLoading(true)
    setError(null)

    try {
      // Get geometry (from drawing or KML)
      let geometry = drawnGeometry
      if (!geometry && uploadedKML) {
        geometry = parseKMLToGeometry(uploadedKML.content)
      }

      if (!geometry) {
        throw new Error('Could not parse geometry')
      }

      // Calculate center coordinates
      const center = calculateGeometryCenter(geometry)
      if (!center) {
        throw new Error('Could not calculate center coordinates')
      }

      // Set current view date to end date (last date)
      const viewDate = endDate
      setCurrentViewDate(viewDate)
      setShowAnalysis(true)
      // Reset to live mode when starting new analysis
      const initialMode = 'live'
      setViewMode(initialMode)

      // Fetch live data for initial analysis
      const [weather, aqi] = await Promise.all([
        fetchWeatherData(center.latitude, center.longitude),
        fetchAQIData(center.latitude, center.longitude)
      ])
      setWeatherData(weather)
      setAqiData(aqi)
      
      // Fetch chart data
      await Promise.all([
        fetchAQIChartData(center.latitude, center.longitude),
        fetchTimeChartData(center.latitude, center.longitude)
      ])
    } catch (err) {
      setError(err.message)
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // Handle date navigation - fetch data when date changes (only for date-based navigation, not view modes)
  useEffect(() => {
    if (showAnalysis && currentViewDate && (drawnGeometry || uploadedKML) && viewMode === 'live') {
      let geometry = drawnGeometry
      if (!geometry && uploadedKML) {
        geometry = parseKMLToGeometry(uploadedKML.content)
      }

      if (geometry) {
        const center = calculateGeometryCenter(geometry)
        if (center) {
          fetchDataForDate(center.latitude, center.longitude, currentViewDate)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentViewDate, showAnalysis])

  // Fetch AQI chart data based on view mode
  const fetchAQIChartData = async (latitude, longitude) => {
    setLoadingChart(true)
    try {
      const today = format(new Date(), 'yyyy-MM-dd')
      const now = new Date()
      let chartData = []

      if (viewMode === 'live') {
        // Live: Last 60 minutes - X-axis shows 1, 5, 10, ..., 60
        const aqiHourly = await fetchHourlyAQIData(latitude, longitude, today)
        const records = aqiHourly.hourly_records || []
        
        // Get records from the last hour (60 minutes)
        const oneHourAgo = subHours(now, 1)
        const lastHourRecords = records
          .filter(r => {
            if (!r || r.aqi === null || r.aqi === undefined) return false
            const recordTime = parseISO(r.date)
            return recordTime >= oneHourAgo
          })
          .sort((a, b) => parseISO(a.date) - parseISO(b.date))
        
        // Create minute buckets (1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60)
        const minuteBuckets = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
        
        if (lastHourRecords.length > 0) {
          // Map records to closest minute bucket
          chartData = minuteBuckets.map(minute => {
            const targetTime = subHours(now, 1).getTime() + (60 - minute) * 60 * 1000
            const closestRecord = lastHourRecords.reduce((closest, record) => {
              const recordTime = parseISO(record.date).getTime()
              const closestTime = closest ? parseISO(closest.date).getTime() : null
              if (!closestTime) return record
              return Math.abs(recordTime - targetTime) < Math.abs(closestTime - targetTime) ? record : closest
            }, null)
            
            return {
              time: minute.toString(),
              aqi: closestRecord ? closestRecord.aqi : (lastHourRecords[0]?.aqi || 0),
              fullTime: closestRecord ? closestRecord.date : now.toISOString(),
              minute: minute
            }
          })
        } else {
          // Fallback: use last few records and map to minute positions
          const fallbackRecords = records.slice(-12).filter(r => r && r.aqi !== null && r.aqi !== undefined)
          chartData = minuteBuckets.map((minute, idx) => ({
            time: minute.toString(),
            aqi: fallbackRecords[idx]?.aqi || fallbackRecords[0]?.aqi || 0,
            fullTime: fallbackRecords[idx]?.date || now.toISOString(),
            minute: minute
          }))
        }
      } else if (viewMode === 'daily') {
        // Daily: Last 24 hours from current time - X-axis shows 1, 2, 3, ..., 24
        const twentyFourHoursAgo = subHours(now, 24)
        const startDate = format(twentyFourHoursAgo, 'yyyy-MM-dd')
        const endDate = today
        
        // Fetch data from 24 hours ago to today (may span 2 calendar days)
        const aqiRange = await fetchHourlyAQIDataRange(latitude, longitude, startDate, endDate)
        const records = aqiRange.hourly_records || []
        
        // Get last 24 hours of records from current time
        const last24HoursRecords = records
          .filter(r => {
            if (!r || r.aqi === null || r.aqi === undefined) return false
            const recordTime = parseISO(r.date)
            return recordTime >= twentyFourHoursAgo && recordTime <= now
          })
          .sort((a, b) => parseISO(a.date) - parseISO(b.date))
        
        // Create hour buckets (1-24) representing hours from 24 hours ago to now
        const hourBuckets = Array.from({ length: 24 }, (_, i) => i + 1)
        
        if (last24HoursRecords.length > 0) {
          // Map records to hour positions (1 = 24 hours ago, 24 = current hour)
          const hourMap = new Map()
          last24HoursRecords.forEach(record => {
            const recordTime = parseISO(record.date)
            const hoursDiff = Math.floor((now - recordTime) / (1000 * 60 * 60))
            const hourPosition = 24 - hoursDiff
            if (hourPosition >= 1 && hourPosition <= 24) {
              if (!hourMap.has(hourPosition)) {
                hourMap.set(hourPosition, [])
              }
              hourMap.get(hourPosition).push(record.aqi)
            }
          })
          
          chartData = hourBuckets.map(hour => {
            const aqis = hourMap.get(hour) || []
            const avgAqi = aqis.length > 0 
              ? Math.round(aqis.reduce((sum, val) => sum + val, 0) / aqis.length)
              : (last24HoursRecords[0]?.aqi || 0)
            
            // Calculate the actual time for this hour bucket
            const bucketTime = subHours(now, 24 - hour)
            const timeLabel = format(bucketTime, 'HH:mm')
            
            return {
              time: timeLabel,
              aqi: avgAqi,
              fullTime: bucketTime.toISOString(),
              hour: hour
            }
          })
        } else {
          // Fallback: use available records
          chartData = hourBuckets.map((hour, idx) => {
            const bucketTime = subHours(now, 24 - hour)
            const timeLabel = format(bucketTime, 'HH:mm')
            return {
              time: timeLabel,
              aqi: records[idx]?.aqi || records[0]?.aqi || 0,
              fullTime: records[idx]?.date || bucketTime.toISOString(),
              hour: hour
            }
          })
        }
      } else if (viewMode === 'weekly') {
        // Weekly: Last 7 days - X-axis shows 1st day, 2nd day, ..., 7th day
        const weekAgo = format(subDays(now, 6), 'yyyy-MM-dd') // 6 days ago + today = 7 days
        const aqiRange = await fetchHourlyAQIDataRange(latitude, longitude, weekAgo, today)
        console.log("7 Days data fetched", aqiRange)
        const records = aqiRange.hourly_records || []
        
        // Group by date and calculate daily averages
        const dailyData = {}
        records
          .filter(r => r && r.aqi !== null && r.aqi !== undefined)
          .forEach(record => {
            const date = parseISO(record.date)
            const dateKey = format(date, 'yyyy-MM-dd')
            if (!dailyData[dateKey]) {
              dailyData[dateKey] = { aqis: [], date: date }
            }
            dailyData[dateKey].aqis.push(record.aqi)
          })
        
        // Sort dates and map to actual dates
        const sortedDates = Object.keys(dailyData).sort()
        chartData = sortedDates.map((dateKey, index) => {
          const dayData = dailyData[dateKey]
          const avgAqi = Math.round(dayData.aqis.reduce((sum, val) => sum + val, 0) / dayData.aqis.length)
          const dayNumber = index + 1
          // Format date as "MMM dd" (e.g., "Jan 15")
          const dateLabel = format(dayData.date, 'MMM dd')
          
          return {
            time: dateLabel,
            aqi: avgAqi,
            fullTime: dateKey,
            day: dayNumber
          }
        })
      } else if (viewMode === 'monthly') {
        // Monthly: Last 30/31 days - X-axis shows 1, 2, 3, ..., 30/31
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        const daysToShow = Math.min(31, daysInMonth)
        const monthAgo = format(subDays(now, daysToShow - 1), 'yyyy-MM-dd')
        const aqiRange = await fetchHourlyAQIDataRange(latitude, longitude, monthAgo, today)
        console.log("30 Days data fetched", aqiRange)
        const records = aqiRange.hourly_records || []
        
        // Group by date and calculate daily averages
        const dailyData = {}
        records
          .filter(r => r && r.aqi !== null && r.aqi !== undefined)
          .forEach(record => {
            const date = parseISO(record.date)
            const dateKey = format(date, 'yyyy-MM-dd')
            if (!dailyData[dateKey]) {
              dailyData[dateKey] = { aqis: [], date: date }
            }
            dailyData[dateKey].aqis.push(record.aqi)
          })
        
        // Sort dates and map to actual dates
        const sortedDates = Object.keys(dailyData).sort()
        chartData = sortedDates.map((dateKey, index) => {
          const dayData = dailyData[dateKey]
          const avgAqi = Math.round(dayData.aqis.reduce((sum, val) => sum + val, 0) / dayData.aqis.length)
          // Format date as "MMM dd" (e.g., "Jan 15")
          const dateLabel = format(dayData.date, 'MMM dd')
          
          return {
            time: dateLabel,
            aqi: avgAqi,
            fullTime: dateKey,
            day: index + 1
          }
        })
        
        // Ensure we have data points for all days with dates
        if (chartData.length < daysToShow) {
          const dateMap = new Map()
          chartData.forEach(d => dateMap.set(d.fullTime, d.aqi))
          
          const allDays = Array.from({ length: daysToShow }, (_, i) => {
            const dayDate = subDays(now, daysToShow - i - 1)
            const dateKey = format(dayDate, 'yyyy-MM-dd')
            const dateLabel = format(dayDate, 'MMM dd')
            return {
              time: dateLabel,
              aqi: dateMap.get(dateKey) || (chartData[0]?.aqi || 0),
              fullTime: dateKey,
              day: i + 1
            }
          })
          chartData = allDays
        }
      }

      setAqiChartData(chartData)
    } catch (err) {
      console.error('Error fetching AQI chart data:', err)
      setAqiChartData([])
    } finally {
      setLoadingChart(false)
    }
  }

  // Helper function to get day suffix (1st, 2nd, 3rd, etc.)
  const getDaySuffix = (day) => {
    if (day >= 11 && day <= 13) return 'th'
    switch (day % 10) {
      case 1: return 'st'
      case 2: return 'nd'
      case 3: return 'rd'
      default: return 'th'
    }
  }

  // Helper function to convert time string (HH:mm) to minutes for Y-axis
  const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number)
    return hours * 60 + minutes
  }

  // Helper function to convert minutes to time string (HH:mm)
  const minutesToTime = (minutes) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
  }

  // Fetch Time chart data based on view mode
  const fetchTimeChartData = async (latitude, longitude) => {
    setLoadingTimeChart(true)
    try {
      const today = format(new Date(), 'yyyy-MM-dd')
      const now = new Date()
      let chartData = []

      if (viewMode === 'live') {
        // Live: Last 60 minutes - X-axis: minutes (1-60), Y-axis: time (HH:mm)
        const aqiHourly = await fetchHourlyAQIData(latitude, longitude, today)
        const records = aqiHourly.hourly_records || []
        
        const oneHourAgo = subHours(now, 1)
        const lastHourRecords = records
          .filter(r => {
            if (!r || r.aqi === null || r.aqi === undefined) return false
            const recordTime = parseISO(r.date)
            return recordTime >= oneHourAgo
          })
          .sort((a, b) => parseISO(a.date) - parseISO(b.date))
        
        const minuteBuckets = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
        
        chartData = minuteBuckets.map(minute => {
          const targetTime = subHours(now, 1).getTime() + (60 - minute) * 60 * 1000
          const closestRecord = lastHourRecords.reduce((closest, record) => {
            const recordTime = parseISO(record.date).getTime()
            const closestTime = closest ? parseISO(closest.date).getTime() : null
            if (!closestTime) return record
            return Math.abs(recordTime - targetTime) < Math.abs(closestTime - targetTime) ? record : closest
          }, null)
          
          const recordTime = closestRecord ? parseISO(closestRecord.date) : now
          const timeStr = format(recordTime, 'HH:mm')
          
          return {
            day: minute.toString(),
            time: timeStr,
            timeMinutes: timeToMinutes(timeStr),
            aqi: closestRecord ? closestRecord.aqi : 0,
            fullTime: closestRecord ? closestRecord.date : now.toISOString()
          }
        })
      } else if (viewMode === 'daily') {
        // Daily: Last 24 hours from current time - X-axis: hours (1-24), Y-axis: time (HH:mm)
        const twentyFourHoursAgo = subHours(now, 24)
        const startDate = format(twentyFourHoursAgo, 'yyyy-MM-dd')
        const endDate = today
        
        // Fetch data from 24 hours ago to today (may span 2 calendar days)
        const aqiRange = await fetchHourlyAQIDataRange(latitude, longitude, startDate, endDate)
        const records = aqiRange.hourly_records || []
        
        // Get last 24 hours of records from current time
        const last24HoursRecords = records
          .filter(r => {
            if (!r || r.aqi === null || r.aqi === undefined) return false
            const recordTime = parseISO(r.date)
            return recordTime >= twentyFourHoursAgo && recordTime <= now
          })
          .sort((a, b) => parseISO(a.date) - parseISO(b.date))
        
        const hourBuckets = Array.from({ length: 24 }, (_, i) => i + 1)
        
        chartData = hourBuckets.map(hour => {
          // Calculate the target time for this hour bucket (hour 1 = 24 hours ago, hour 24 = now)
          const targetTime = subHours(now, 24 - hour)
          const targetTimeMs = targetTime.getTime()
          
          // Find the closest record to this target time
          const closestRecord = last24HoursRecords.reduce((closest, record) => {
            const recordTime = parseISO(record.date).getTime()
            const closestTime = closest ? parseISO(closest.date).getTime() : null
            if (!closestTime) return record
            return Math.abs(recordTime - targetTimeMs) < Math.abs(closestTime - targetTimeMs) ? record : closest
          }, null)
          
          // Use the actual time of the record, or the target time if no record found
          const recordTime = closestRecord ? parseISO(closestRecord.date) : targetTime
          const timeStr = format(recordTime, 'HH:mm')
          
          return {
            day: hour.toString(),
            time: timeStr,
            timeMinutes: timeToMinutes(timeStr),
            aqi: closestRecord ? closestRecord.aqi : 0,
            fullTime: closestRecord ? closestRecord.date : targetTime.toISOString()
          }
        })
      } else if (viewMode === 'weekly') {
        // Weekly: Last 7 days - X-axis: days (1-7), Y-axis: AQI values
        const weekAgo = format(subDays(now, 6), 'yyyy-MM-dd')
        const aqiRange = await fetchHourlyAQIDataRange(latitude, longitude, weekAgo, today)
        const records = aqiRange.hourly_records || []
        
        // Group by date and get all records with their times
        const dailyData = {}
        records
          .filter(r => r && r.aqi !== null && r.aqi !== undefined)
          .forEach(record => {
            const date = parseISO(record.date)
            const dateKey = format(date, 'yyyy-MM-dd')
            if (!dailyData[dateKey]) {
              dailyData[dateKey] = { records: [], date: date }
            }
            dailyData[dateKey].records.push({
              aqi: record.aqi,
              time: format(date, 'HH:mm'),
              fullTime: record.date
            })
          })
        
        const sortedDates = Object.keys(dailyData).sort()
        chartData = sortedDates.map((dateKey, index) => {
          const dayData = dailyData[dateKey]
          const dayNumber = index + 1
          // Get day name (Monday, Tuesday, etc.)
          const dayName = format(dayData.date, 'EEEE')
          
          // Get average AQI for this day
          const avgAqi = dayData.records.length > 0
            ? Math.round(dayData.records.reduce((sum, r) => sum + r.aqi, 0) / dayData.records.length)
            : 0
          
          // Get the time when AQI was recorded (use the record with closest AQI to average, or first record)
          const closestRecord = dayData.records.reduce((closest, record) => {
            if (!closest) return record
            return Math.abs(record.aqi - avgAqi) < Math.abs(closest.aqi - avgAqi) ? record : closest
          }, null)
          
          const timeStr = closestRecord ? closestRecord.time : format(dayData.date, 'HH:mm')
          
          return {
            day: dayName,
            time: timeStr,
            timeMinutes: timeToMinutes(timeStr),
            aqi: avgAqi,
            fullTime: dateKey,
            dayNumber: dayNumber
          }
        })
      } else if (viewMode === 'monthly') {
        // Monthly: Last 30/31 days - X-axis: days (1-30/31), Y-axis: AQI values
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        const daysToShow = Math.min(31, daysInMonth)
        const monthAgo = format(subDays(now, daysToShow - 1), 'yyyy-MM-dd')
        const aqiRange = await fetchHourlyAQIDataRange(latitude, longitude, monthAgo, today)
        const records = aqiRange.hourly_records || []
        
        // Group by date and get all records with their times
        const dailyData = {}
        records
          .filter(r => r && r.aqi !== null && r.aqi !== undefined)
          .forEach(record => {
            const date = parseISO(record.date)
            const dateKey = format(date, 'yyyy-MM-dd')
            if (!dailyData[dateKey]) {
              dailyData[dateKey] = { records: [], date: date }
            }
            dailyData[dateKey].records.push({
              aqi: record.aqi,
              time: format(date, 'HH:mm'),
              fullTime: record.date
            })
          })
        
        const sortedDates = Object.keys(dailyData).sort()
        chartData = sortedDates.map((dateKey, index) => {
          const dayData = dailyData[dateKey]
          
          // Get average AQI for this day
          const avgAqi = dayData.records.length > 0
            ? Math.round(dayData.records.reduce((sum, r) => sum + r.aqi, 0) / dayData.records.length)
            : 0
          
          // Get the time when AQI was recorded (use the record with closest AQI to average, or first record)
          const closestRecord = dayData.records.reduce((closest, record) => {
            if (!closest) return record
            return Math.abs(record.aqi - avgAqi) < Math.abs(closest.aqi - avgAqi) ? record : closest
          }, null)
          
          const timeStr = closestRecord ? closestRecord.time : format(dayData.date, 'HH:mm')
          
          return {
            day: (index + 1).toString(),
            time: timeStr,
            timeMinutes: timeToMinutes(timeStr),
            aqi: avgAqi,
            fullTime: dateKey,
            dayNumber: index + 1
          }
        })
      }

      setTimeChartData(chartData)
    } catch (err) {
      console.error('Error fetching time chart data:', err)
      setTimeChartData([])
    } finally {
      setLoadingTimeChart(false)
    }
  }

  // Fetch data when view mode changes
  useEffect(() => {
    if (showAnalysis && (drawnGeometry || uploadedKML)) {
      let geometry = drawnGeometry
      if (!geometry && uploadedKML) {
        geometry = parseKMLToGeometry(uploadedKML.content)
      }

      if (geometry) {
        const center = calculateGeometryCenter(geometry)
        if (center) {
          // Set loading state when view mode changes
          setLoadingChart(true)
          setLoadingTimeChart(true)
          Promise.all([
            fetchDataForMode(center.latitude, center.longitude),
            fetchAQIChartData(center.latitude, center.longitude),
            fetchTimeChartData(center.latitude, center.longitude)
          ])
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <div className="logo-container">
            <div className="logo-icon">
              <div className="logo-eye">
                <div className="eye-pupil"></div>
                <div className="eye-shine"></div>
              </div>
              <div className="logo-ring"></div>
            </div>
            <h1 className="logo-text">Climate Eye</h1>
          </div>
        </div>
        
        <div className="header-right">
          <button className="logout-button" onClick={handleLogout}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        {/* Mobile sidebar toggle button */}
        {!showAnalysis && (
          <button 
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
        )}
        
        {/* Sidebar overlay for mobile */}
        {!showAnalysis && sidebarOpen && (
          <div 
            className="sidebar-overlay"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        
        <aside className={`sidebar ${showAnalysis ? 'analysis-mode' : ''} ${sidebarOpen ? 'open' : ''}`}>
          {!showAnalysis ? (
            <>
              <div className="kml-section">
                <div className="sidebar-header-mobile">
                  <h2 className="sidebar-title">AREA SELECTION</h2>
                  <button 
                    className="sidebar-close-mobile"
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Close sidebar"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                <div className="kml-buttons">
                  <button 
                    className="action-button draw-button"
                    onClick={handleDrawArea}
                    disabled={isDrawing}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                      <path d="M2 17l10 5 10-5"></path>
                      <path d="M2 12l10 5 10-5"></path>
                    </svg>
                    Draw Area
                  </button>
                  
                  <label className="action-button upload-button">
                    <input
                      type="file"
                      accept=".kml,.kmz"
                      onChange={handleKMLUpload}
                      style={{ display: 'none' }}
                    />
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="17 8 12 3 7 8"></polyline>
                      <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                    Upload KML
                  </label>
                </div>

                {(drawnGeometry || uploadedKML) && (
                  <div className="geometry-info">
                    <p className="info-text">
                      {uploadedKML ? `KML: ${uploadedKML.name}` : 'Area drawn on map'}
                    </p>
                    <button className="clear-button" onClick={handleClearGeometry}>
                      Clear
                    </button>
                  </div>
                )}
              </div>

              <div className="date-range-section">
                <h2 className="sidebar-title">DATE RANGE</h2>
                
                <div className="date-input-group">
                  <label htmlFor="start-date" className="date-label">
                    Start Date
                  </label>
                  <input
                    type="date"
                    id="start-date"
                    value={startDate}
                    onChange={handleStartDateChange}
                    max={endDate}
                    className="date-input"
                  />
                </div>

                <div className="date-input-group">
                  <label htmlFor="end-date" className="date-label">
                    End Date
                  </label>
                  <input
                    type="date"
                    id="end-date"
                    value={endDate}
                    onChange={handleEndDateChange}
                    max={getMaxDate()}
                    className="date-input"
                  />
                </div>

                <button 
                  className="update-button" 
                  onClick={handleAnalyse}
                  disabled={loading}
                >
                  {loading ? 'LOADING...' : 'ANALYSE'}
                </button>
              </div>
            </>
          ) : (
            <div className="back-to-map-section">
              <button 
                className="back-to-map-button"
                onClick={() => {
                  setShowAnalysis(false)
                  setSidebarOpen(false) // Close sidebar on mobile when going back to map
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
                <span>Back to Map</span>
              </button>
            </div>
          )}
        </aside>

        <main className="main-content">
          {!showAnalysis ? (
            <div className="map-wrapper">
              <div className="view-toggle-container">
                <button 
                  className={`view-toggle-button ${viewType === 'map' ? 'active' : ''}`}
                  onClick={toggleView}
                  title={viewType === 'map' ? 'Switch to Satellite View' : 'Switch to Map View'}
                >
                  {viewType === 'map' ? (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                      </svg>
                      <span>Map</span>
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                        <line x1="7" y1="2" x2="7" y2="22"></line>
                        <line x1="17" y1="2" x2="17" y2="22"></line>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                        <line x1="2" y1="7" x2="7" y2="7"></line>
                        <line x1="2" y1="17" x2="7" y2="17"></line>
                        <line x1="17" y1="17" x2="22" y2="17"></line>
                        <line x1="17" y1="7" x2="22" y2="7"></line>
                      </svg>
                      <span>Satellite</span>
                    </>
                  )}
                </button>
              </div>
              <MapComponent 
                viewType={viewType}
                drawnGeometry={drawnGeometry}
                uploadedKML={uploadedKML}
                isDrawing={isDrawing}
                onGeometryComplete={handleGeometryComplete}
                onCancelDrawing={handleCancelDrawing}
              />
            </div>
          ) : (
            <div className="analysis-content">
              <div className="date-navigation-header">
                <button 
                  className="nav-arrow-button"
                  onClick={handlePreviousDate}
                  disabled={!canGoPrevious() || viewMode !== 'live'}
                  title="Previous Date"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                </button>
                
                <div className="current-date-display">
                  <div className="date-label">Viewing Date</div>
                  <div className="date-value">
                    {viewMode === 'live' && currentViewDate 
                      ? format(new Date(currentViewDate), 'MMM dd, yyyy') 
                      : viewMode === 'daily' 
                        ? 'Last 24 Hours'
                        : viewMode === 'weekly'
                          ? 'Past 7 Days'
                          : viewMode === 'monthly'
                            ? 'Past 30 Days'
                            : 'N/A'}
                  </div>
                </div>
                
                <button 
                  className="nav-arrow-button"
                  onClick={handleNextDate}
                  disabled={!canGoNext() || viewMode !== 'live'}
                  title="Next Date"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              </div>

              {/* View Mode Buttons */}
              <div className="view-mode-buttons">
                <button
                  className={`view-mode-button ${viewMode === 'live' ? 'active' : ''}`}
                  onClick={() => handleViewModeChange('live')}
                  disabled={loading}
                >
                  Live
                </button>
                <button
                  className={`view-mode-button ${viewMode === 'daily' ? 'active' : ''}`}
                  onClick={() => handleViewModeChange('daily')}
                  disabled={loading}
                >
                  Last 24 Hrs Data
                </button>
                <button
                  className={`view-mode-button ${viewMode === 'weekly' ? 'active' : ''}`}
                  onClick={() => handleViewModeChange('weekly')}
                  disabled={loading}
                >
                  Weekly
                </button>
                <button
                  className={`view-mode-button ${viewMode === 'monthly' ? 'active' : ''}`}
                  onClick={() => handleViewModeChange('monthly')}
                  disabled={loading}
                >
                  Monthly
                </button>
              </div>

              {error && (
                <div className="error-banner">
                  <p>Error: {error}</p>
                </div>
              )}

              {viewMode === 'live' ? (
                <LiveDashboardCards 
                  aqiData={aqiData}
                  weatherData={weatherData}
                  geometry={drawnGeometry || (uploadedKML ? parseKMLToGeometry(uploadedKML.content) : null)}
                  date={format(new Date(), 'yyyy-MM-dd')}
                />
              ) : (
                <div className="analysis-sections">
                  <WeatherSection 
                    geometry={drawnGeometry || (uploadedKML ? parseKMLToGeometry(uploadedKML.content) : null)}
                    startDate={startDate}
                    endDate={endDate}
                    date={currentViewDate} 
                    data={weatherData}
                    isLive={viewMode === 'live'}
                    loading={loading}
                    viewMode={viewMode}
                  />
                  <AQISection
                    geometry={drawnGeometry || (uploadedKML ? parseKMLToGeometry(uploadedKML.content) : null)}
                    startDate={startDate}
                    endDate={endDate} 
                    date={currentViewDate} 
                    data={aqiData}
                    isLive={viewMode === 'live'}
                    loading={loading}
                    viewMode={viewMode}
                  />
                </div>
              )}

              {viewMode !== 'live' && (
                <>
                {/* AQI Chart */}
                <div className="aqi-chart-container">
                  <div className="chart-header">
                    <h3 className="chart-title">AQI Trend</h3>
                    <div className="chart-header-right">
                      <div className="chart-mode-indicator">
                        {viewMode === 'live' && <span>Last 1 Hour</span>}
                        {viewMode === 'daily' && <span>Last 24 Hours</span>}
                        {viewMode === 'weekly' && <span>Last 7 Days</span>}
                        {viewMode === 'monthly' && <span>Last 30 Days</span>}
                      </div>
                      <button 
                        className="chart-refresh-button"
                        onClick={handleRefreshAQIChart}
                        disabled={loadingChart || !showAnalysis}
                        title="Refresh AQI Trend Chart"
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
                  
                  {loadingChart ? (
                    <div className="chart-loading">
                      <div className="loading-spinner"></div>
                      <p className="loading-message">Please wait, data is loading...</p>
                    </div>
                  ) : aqiChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart 
                        data={aqiChartData} 
                        margin={{ top: 10, right: 30, left: 0, bottom: viewMode === 'weekly' ? 60 : 40 }}
                      >
                        {/* AQI Category Background Sections - Render before grid so they appear behind */}
                        {/* Good: 0-50 (Green) */}
                        <ReferenceArea 
                          y1={0} 
                          y2={50} 
                          fill="#10B981" 
                          fillOpacity={0.6}
                          stroke="none"
                        />
                        {/* Moderate: 51-100 (Orange) */}
                        <ReferenceArea 
                          y1={50} 
                          y2={100} 
                          fill="#F59E0B" 
                          fillOpacity={0.6}
                          stroke="none"
                        />
                        {/* Poor: 101-150 (Dark Orange/Brown) */}
                        <ReferenceArea 
                          y1={100} 
                          y2={150} 
                          fill="#F97316" 
                          fillOpacity={0.6}
                          stroke="none"
                        />
                        {/* Unhealthy: 151-200 (Red) */}
                        <ReferenceArea 
                          y1={150} 
                          y2={200} 
                          fill="#EF4444" 
                          fillOpacity={0.6}
                          stroke="none"
                        />
                        {/* Severe: 201-300 (Purple) */}
                        <ReferenceArea 
                          y1={200} 
                          y2={300} 
                          fill="#8B5CF6" 
                          fillOpacity={0.6}
                          stroke="none"
                        />
                        {/* Hazardous: 301+ (Dark Red) */}
                        <ReferenceArea 
                          y1={300} 
                          y2={400} 
                          fill="#7F1D1D" 
                          fillOpacity={0.6}
                          stroke="none"
                        />
                        
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(20, 184, 166, 0.2)" />
                        
                        <XAxis 
                          dataKey="time" 
                          stroke="#9ca3af"
                          style={{ fontSize: '11px' }}
                          angle={viewMode === 'weekly' ? -45 : viewMode === 'monthly' ? -45 : 0}
                          textAnchor={viewMode === 'weekly' ? 'end' : viewMode === 'monthly' ? 'end' : 'middle'}
                          height={viewMode === 'weekly' ? 70 : viewMode === 'monthly' ? 60 : 40}
                          interval={viewMode === 'live' ? 4 : viewMode === 'daily' ? 2 : viewMode === 'weekly' ? 0 : viewMode === 'monthly' ? 2 : 0}
                        />
                        <YAxis 
                          stroke="#9ca3af"
                          style={{ fontSize: '12px' }}
                          label={{ value: 'AQI', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
                          domain={[0, 400]}
                          ticks={[0, 50, 100, 150, 200, 300, 400]}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'rgba(26, 31, 58, 0.95)', 
                            border: '1px solid rgba(20, 184, 166, 0.4)',
                            borderRadius: '8px',
                            color: '#ffffff'
                          }}
                          labelStyle={{ color: '#14b8a6', fontWeight: 'bold' }}
                          formatter={(value) => [`AQI: ${value}`, '']}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="aqi" 
                          stroke="#14b8a6"
                          strokeWidth={2}
                          dot={{ r: 4, fill: '#14b8a6' }}
                          activeDot={{ r: 6, fill: '#14b8a6' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="chart-no-data">
                      <p>No chart data available</p>
                    </div>
                  )}
                </div>

                {/* Time Chart */}
                <div className="aqi-chart-container">
                  <div className="chart-header">
                    <h3 className="chart-title">Time Chart</h3>
                    <div className="chart-header-right">
                      <div className="chart-mode-indicator">
                        {viewMode === 'live' && <span>Last 1 Hour</span>}
                        {viewMode === 'daily' && <span>Last 24 Hours</span>}
                        {viewMode === 'weekly' && <span>Last 7 Days</span>}
                        {viewMode === 'monthly' && <span>Last 30 Days</span>}
                      </div>
                      <button 
                        className="chart-refresh-button"
                        onClick={handleRefreshTimeChart}
                        disabled={loadingTimeChart || !showAnalysis}
                        title="Refresh Time Chart"
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
                  
                  
                  {loadingTimeChart ? (
                    <div className="chart-loading">
                      <div className="loading-spinner"></div>
                      <p className="loading-message">Please wait, data is loading...</p>
                    </div>
                  ) : timeChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <BarChart 
                        data={timeChartData} 
                        margin={{ top: 10, right: 30, left: 0, bottom: viewMode === 'weekly' ? 60 : 40 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(20, 184, 166, 0.2)" />
                        <XAxis 
                          type="category"
                          dataKey="day" 
                          stroke="#9ca3af"
                          style={{ fontSize: '11px' }}
                          angle={viewMode === 'weekly' ? -45 : viewMode === 'monthly' ? -45 : 0}
                          textAnchor={viewMode === 'weekly' ? 'end' : viewMode === 'monthly' ? 'end' : 'middle'}
                          height={viewMode === 'weekly' ? 70 : viewMode === 'monthly' ? 60 : 40}
                          interval={viewMode === 'live' ? 4 : viewMode === 'daily' ? 2 : viewMode === 'weekly' ? 0 : viewMode === 'monthly' ? 2 : 0}
                          label={{ 
                            value: viewMode === 'live' ? 'Minutes' : viewMode === 'daily' ? 'Hours' : viewMode === 'weekly' ? 'Days' : viewMode === 'monthly' ? 'Days' : 'Hours', 
                            position: 'insideBottom', 
                            offset: -5, 
                            style: { fill: '#9ca3af' } 
                          }}
                        />
                        <YAxis 
                          type="number"
                          dataKey="aqi"
                          stroke="#9ca3af"
                          style={{ fontSize: '12px' }}
                          label={{ 
                            value: 'AQI', 
                            angle: -90, 
                            position: 'insideLeft', 
                            style: { fill: '#9ca3af' } 
                          }}
                          domain={[0, 400]}
                          ticks={[0, 50, 100, 150, 200, 300, 400]}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'rgba(26, 31, 58, 0.95)', 
                            border: '1px solid rgba(20, 184, 166, 0.4)',
                            borderRadius: '8px',
                            color: '#ffffff'
                          }}
                          labelStyle={{ color: '#14b8a6', fontWeight: 'bold' }}
                          formatter={(value) => [`AQI: ${value}`, '']}
                          labelFormatter={(label) => {
                            if (viewMode === 'live') return `Minute: ${label}`
                            if (viewMode === 'daily') return `Hour: ${label}`
                            if (viewMode === 'weekly') return `Day: ${label}`
                            if (viewMode === 'monthly') return `Day: ${label}`
                            return `Day: ${label}`
                          }}
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload
                              let labelText = ''
                              if (viewMode === 'live') {
                                labelText = `Minute: ${label}`
                              } else if (viewMode === 'daily') {
                                labelText = `Hour: ${label}`
                              } else if (viewMode === 'weekly' || viewMode === 'monthly') {
                                labelText = `Day: ${label}`
                              } else {
                                labelText = `Day: ${label}`
                              }
                              
                              return (
                                <div style={{
                                  backgroundColor: 'rgba(26, 31, 58, 0.95)',
                                  border: '1px solid rgba(20, 184, 166, 0.4)',
                                  borderRadius: '8px',
                                  padding: '12px',
                                  color: '#ffffff'
                                }}>
                                  <p style={{ margin: '4px 0', color: '#14b8a6' }}>AQI: {data.aqi}</p>
                                  <p style={{ margin: '4px 0' }}>Time: {data.time}</p>
                                </div>
                              )
                            }
                            return null
                          }}
                        />
                        <Bar 
                          dataKey="aqi"
                          radius={[4, 4, 0, 0]}
                        >
                          {timeChartData.map((entry, index) => {
                            const getAQIColor = (aqi) => {
                              if (aqi <= 50) return '#10b981' // Green - Excellent
                              if (aqi <= 100) return '#f59e0b' // Orange - Good
                              if (aqi <= 150) return '#f97316' // Orange - Fair
                              if (aqi <= 200) return '#ef4444' // Red - Poor
                              if (aqi <= 300) return '#8b5cf6' // Purple - Very Poor
                              return '#7f1d1d' // Dark Red - Hazardous
                            }
                            return (
                              <Cell key={`cell-${index}`} fill={getAQIColor(entry.aqi || 0)} />
                            )
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="chart-no-data">
                      <p>No time chart data available</p>
                    </div>
                  )}
                </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default Dashboard

