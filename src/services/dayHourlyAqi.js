/**
 * Hourly AQI for a selected calendar day.
 * Primary: ClimateEye backend POST /aqi/hourly
 * Fallback (recent days): aqi.in getLast24HourHistory / getLast7DaysHistory
 */

import { fetchHourlyAQIData } from './api'
import { aqiInColor, aqiInLabel, fetchAqiHistory } from './aqiInApi'

const dayKey = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const formatHourLabel = (isoOrDate) => {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(date.getTime())) return '—'
  const hour = date.getHours()
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h12 = hour % 12 || 12
  return `${h12}${ampm}`
}

const summarize = (points) => {
  const values = points.map((p) => p.aqi).filter(Number.isFinite)
  if (!values.length) {
    return { avg: null, min: null, max: null, count: 0 }
  }
  const sum = values.reduce((a, b) => a + b, 0)
  return {
    avg: Math.round(sum / values.length),
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length
  }
}

const normalizeBackendRecords = (records, dateStr) => {
  const points = []
  ;(records || []).forEach((row, index) => {
    const aqi = Number(row?.aqi)
    if (!Number.isFinite(aqi)) return
    const rawTime = row.date || row.time || row.timestamp || row.datetime
    const parsed = rawTime ? new Date(rawTime) : null
    const time = parsed && !Number.isNaN(parsed.getTime())
      ? parsed
      : new Date(`${dateStr}T${String(index).padStart(2, '0')}:00:00`)

    // Keep only rows that belong to the requested calendar day when a timestamp exists
    if (rawTime && dayKey(time) && dayKey(time) !== dateStr) return

    points.push({
      index,
      time: time.toISOString(),
      hour: time.getHours(),
      label: formatHourLabel(time),
      aqi: Math.round(aqi),
      pm25: row.pm2_5 == null ? null : Number(row.pm2_5),
      pm10: row.pm10 == null ? null : Number(row.pm10),
      color: aqiInColor(aqi),
      band: aqiInLabel(aqi)
    })
  })

  points.sort((a, b) => a.hour - b.hour || String(a.time).localeCompare(String(b.time)))
  return points
}

const normalizeAqiInPoints = (historyPoints, dateStr) => {
  const points = []
  ;(historyPoints || []).forEach((point, index) => {
    const aqi = Number(point.aqi)
    if (!Number.isFinite(aqi)) return
    const time = new Date(point.time)
    if (Number.isNaN(time.getTime())) return
    if (dayKey(time) !== dateStr) return
    points.push({
      index,
      time: time.toISOString(),
      hour: time.getHours(),
      label: formatHourLabel(time),
      aqi: Math.round(aqi),
      pm25: null,
      pm10: null,
      color: point.color || aqiInColor(aqi),
      band: aqiInLabel(aqi)
    })
  })
  points.sort((a, b) => a.hour - b.hour)
  return points
}

const daysBetween = (dateStr) => {
  const target = new Date(`${dateStr}T12:00:00`)
  const now = new Date()
  if (Number.isNaN(target.getTime())) return Infinity
  return Math.floor((now.setHours(12, 0, 0, 0) - target.getTime()) / 86400000)
}

/**
 * @param {{ latitude: number, longitude: number, date: string, slug?: string, slugType?: string }} args
 */
export const fetchDayHourlyAqi = async ({
  latitude,
  longitude,
  date,
  slug,
  slugType = 'cityId'
}) => {
  const dateStr = String(date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('A valid date (YYYY-MM-DD) is required')
  }

  const lat = Number(latitude)
  const lng = Number(longitude)
  let backendError = null

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    try {
      const payload = await fetchHourlyAQIData(lat, lng, dateStr)
      const points = normalizeBackendRecords(payload?.hourly_records, dateStr)
      if (points.length) {
        return {
          date: dateStr,
          source: 'ClimateEye',
          points,
          ...summarize(points)
        }
      }
      backendError = 'No hourly records returned for this date'
    } catch (err) {
      backendError = err.message || 'Hourly AQI request failed'
    }
  } else {
    backendError = 'Missing coordinates for hourly lookup'
  }

  // aqi.in only covers a rolling recent window (no arbitrary date param)
  const age = daysBetween(dateStr)
  if (slug && age >= 0 && age <= 7) {
    const rangeId = age <= 1 ? '24h' : '7d'
    try {
      const history = await fetchAqiHistory(rangeId, {
        slug,
        slugType,
        sensorname: 'AQI-IN'
      })
      const points = normalizeAqiInPoints(history.points, dateStr)
      if (points.length) {
        return {
          date: dateStr,
          source: 'aqi.in',
          points,
          ...summarize(points)
        }
      }
    } catch {
      // fall through to combined error
    }
  }

  throw new Error(
    backendError
      || 'No hourly AQI available for this date. Try a more recent day or redraw the area.'
  )
}
