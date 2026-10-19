import { useEffect, useMemo, useState } from 'react'
import { fetchHourlyWeatherData, fetchMonthlyWeatherData, fetchWeatherData } from '../services/api'
import './TemperaturePanel.css'

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const formatTemp = (value) => {
  const number = finiteOrNull(value)
  return number === null ? '—' : `${number.toFixed(1)}°`
}

const SUMMARY_LABELS = [
  ['sunny', 'Sunny'],
  ['partly-cloudy', 'Partly cloudy'],
  ['cloudy', 'Cloudy'],
  ['rainy', 'Rainy'],
  ['snowy', 'Snowy']
]

const dateKey = (value) => {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

const categoryFromCondition = (condition) => {
  const text = String(condition || '').toLowerCase()
  if (text.includes('snow')) return 'snowy'
  if (text.includes('rain') || text.includes('drizzle') || text.includes('thunder')) return 'rainy'
  if (text.includes('partly') || text.includes('mainly')) return 'partly-cloudy'
  if (text.includes('clear') || text.includes('sun')) return 'sunny'
  return 'cloudy'
}

const shortWeekday = (dayOfWeek, date) => {
  if (dayOfWeek) return String(dayOfWeek).slice(0, 3)
  if (!date) return ''
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
}

const monthFromHourly = async (latitude, longitude, year, monthNumber) => {
  const today = new Date()
  const latest = new Date(today)
  latest.setDate(today.getDate() + 15)
  const start = new Date(year, monthNumber - 1, 1)
  const monthEnd = new Date(year, monthNumber, 0)
  const end = monthEnd < latest ? monthEnd : latest
  const days = []
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(dateKey(cursor))
  }

  const records = []
  let cursor = 0
  const worker = async () => {
    while (cursor < days.length) {
      const day = days[cursor]
      cursor += 1
      try {
        const data = await fetchHourlyWeatherData(latitude, longitude, day)
        const hourly = data?.hourly_records || []
        const temperatures = hourly.map((record) => finiteOrNull(record.temperature)).filter((value) => value !== null)
        if (!temperatures.length) continue
        const midday = hourly.find((record) => String(record.date || '').includes('12:00')) || hourly[0]
        const parsed = new Date(`${day}T00:00:00`)
        records.push({
          date: day,
          day: parsed.getDate(),
          day_of_week: parsed.toLocaleDateString('en-US', { weekday: 'short' }),
          temperature_max: Math.max(...temperatures),
          temperature_min: Math.min(...temperatures),
          condition: midday?.condition || null,
          category: categoryFromCondition(midday?.condition)
        })
      } catch {
        // A day outside the forecast window is left out of the month.
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  records.sort((a, b) => a.date.localeCompare(b.date))
  const summary = { sunny: 0, 'partly-cloudy': 0, cloudy: 0, rainy: 0, snowy: 0 }
  records.forEach((record) => {
    if (summary[record.category] != null) summary[record.category] += 1
  })
  return { year, month: monthNumber, daily_records: records, summary }
}

const panelCache = new Map()

const loadTemperaturePanel = (latitude, longitude, date) => {
  const key = `${date}:${latitude}:${longitude}`
  if (panelCache.has(key)) return panelCache.get(key)
  const [year, monthNumber] = date.split('-').map(Number)
  const todayKey = dateKey(new Date())
  const task = Promise.all([
    fetchWeatherData(latitude, longitude, date === todayKey ? null : date),
    fetchMonthlyWeatherData(latitude, longitude, year, monthNumber)
      .catch(() => monthFromHourly(latitude, longitude, year, monthNumber))
  ]).then(([weather, monthly]) => ({
    current: weather || null,
    month: monthly || null
  })).catch((error) => {
    panelCache.delete(key)
    throw error
  })
  panelCache.set(key, task)
  return task
}

const TemperaturePanel = ({ latitude, longitude, date }) => {
  const [selectedDate, setSelectedDate] = useState(date)
  const [current, setCurrent] = useState(null)
  const [month, setMonth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [monthNote, setMonthNote] = useState(null)
  const [monthLoading, setMonthLoading] = useState(true)

  useEffect(() => {
    setSelectedDate(date)
  }, [date])

  useEffect(() => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !selectedDate) return
    let cancelled = false
    const cached = panelCache.get(`${selectedDate}:${latitude}:${longitude}`)
    if (!cached) {
      setLoading(true)
      setMonthLoading(true)
    }
    setError(null)
    setMonthNote(null)
    loadTemperaturePanel(latitude, longitude, selectedDate)
      .then((data) => {
        if (cancelled) return
        setCurrent(data.current)
        setMonth(data.month)
        if (!data.month?.daily_records?.length) setMonthNote('Monthly temperature is unavailable')
      })
      .catch((err) => {
        if (cancelled) return
        setCurrent(null)
        setMonth(null)
        setError(err.message || 'Temperature could not be loaded')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setMonthLoading(false)
      })
    return () => { cancelled = true }
  }, [latitude, longitude, selectedDate])

  const todayKey = useMemo(() => dateKey(new Date()), [])
  const summary = month?.summary || null
  const dailyRecords = month?.daily_records || []

  return (
    <>
      <aside className="temperature-panel">
        <div className="temperature-panel-title">Temperature</div>
        {loading && <div className="temperature-panel-note">Loading temperature…</div>}
        {!loading && error && <div className="temperature-panel-note">{error}</div>}

        {!loading && !error && (
          <>
            <div className="temperature-now">
              <div className="temperature-now-main">{formatTemp(current?.temperature)}</div>
              <div className="temperature-now-side">
                <div>Feels like {formatTemp(current?.feels_like)}</div>
                <div className="temperature-now-range">
                  High {formatTemp(current?.daily?.temp_max)} · Low {formatTemp(current?.daily?.temp_min)}
                </div>
                {current?.condition && <div className="temperature-now-condition">{current.condition}</div>}
              </div>
            </div>

            <div className="temperature-section-label">
              Month{month?.month ? ` · ${month.month}/${month.year}` : ''}
            </div>
            {monthLoading && <div className="temperature-panel-note">Loading month…</div>}
            {!monthLoading && monthNote && <div className="temperature-panel-note">{monthNote}</div>}
            {summary && (
              <div className="temperature-summary">
                {SUMMARY_LABELS.map(([key, label]) => (
                  <span key={key}>{label} {finiteOrNull(summary[key]) === null ? '—' : summary[key]}</span>
                ))}
              </div>
            )}
            {!monthLoading && !dailyRecords.length && !monthNote && (
              <div className="temperature-panel-note">No monthly temperature</div>
            )}
          </>
        )}
      </aside>

      {!loading && !error && dailyRecords.length > 0 && (
        <div className="temperature-day-strip temperature-day-strip--bottom" role="listbox" aria-label="Month days">
          {dailyRecords.map((day) => {
            const dayDate = day.date || ''
            const forecast = dayDate > todayKey
            const selected = dayDate === selectedDate
            const label = `${shortWeekday(day.day_of_week, dayDate)} ${day.day ?? ''}`.trim()
            return (
              <button
                key={dayDate || day.day}
                type="button"
                role="option"
                aria-selected={selected}
                className={`temperature-day-cell${selected ? ' selected' : ''}${forecast ? ' forecast' : ''}`}
                onClick={() => dayDate && setSelectedDate(dayDate)}
                title={forecast ? `${label} · forecast` : label}
              >
                <span className="temperature-day-label">
                  {label}
                  {forecast && <span className="temperature-day-forecast-mark" aria-hidden="true">M</span>}
                </span>
                <strong>{formatTemp(day.temperature_max)}</strong>
                <span className="temperature-day-low">{formatTemp(day.temperature_min)}</span>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

export default TemperaturePanel
