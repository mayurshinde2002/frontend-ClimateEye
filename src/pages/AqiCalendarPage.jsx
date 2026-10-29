import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import AoiMiniMap from '../components/AoiMiniMap'
import { aqiInColor, aqiInLabel, fetchAqiCalendar } from '../services/aqiInApi'
import { fetchDayHourlyAqi } from '../services/dayHourlyAqi'
import './AqiCalendarPage.css'

const AOI_STORAGE_KEY = 'climateeye-aqi-calendar-aoi'

const readStoredAoi = () => {
  try {
    const raw = sessionStorage.getItem(AOI_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // New payload: { geometry, source, kml }
    if (parsed?.geometry?.type && parsed?.geometry?.coordinates) return parsed
    // Legacy: raw GeoJSON geometry
    if (parsed?.type && parsed?.coordinates) {
      return { geometry: parsed, source: 'draw', kml: null }
    }
  } catch {
    // ignore
  }
  return null
}

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i)
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const AQI_LEGEND = [
  { max: 50, label: 'Good' },
  { max: 100, label: 'Moderate' },
  { max: 150, label: 'Poor' },
  { max: 200, label: 'Unhealthy' },
  { max: 300, label: 'Severe' },
  { max: Infinity, label: 'Hazardous' }
]

const titleCase = (value) => String(value || '')
  .split(/[\s_/.-]+/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
  .join(' ')

const pad2 = (n) => String(n).padStart(2, '0')

const dateForCell = (year, monthNumber, day, data) => {
  if (data?.date && /^\d{4}-\d{2}-\d{2}/.test(String(data.date))) {
    return String(data.date).slice(0, 10)
  }
  return `${year}-${pad2(monthNumber)}-${pad2(day)}`
}

const buildMonthCells = (year, monthNumber, days) => {
  const byDay = new Map(
    (days || [])
      .filter((d) => Number.isFinite(Number(d.day)))
      .map((d) => [Number(d.day), d])
  )
  const firstDow = new Date(year, monthNumber - 1, 1).getDay()
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const cells = []

  for (let i = 0; i < firstDow; i += 1) {
    cells.push({ key: `pad-${i}`, type: 'pad' })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const data = byDay.get(day) || null
    cells.push({ key: `day-${day}`, type: 'day', day, data })
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, type: 'pad' })
  }

  return cells
}

const monthStats = (days) => {
  const values = (days || []).map((d) => Number(d.aqi)).filter(Number.isFinite)
  if (!values.length) return { avg: null, min: null, max: null, count: 0 }
  const sum = values.reduce((a, b) => a + b, 0)
  return {
    avg: Math.round(sum / values.length),
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length
  }
}

const HourlyTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  return (
    <div className="aqi-hourly-tooltip">
      <strong>{point.label}</strong>
      <span style={{ color: point.color }}>AQI {point.aqi} · {point.band}</span>
      {Number.isFinite(point.pm25) && <em>PM2.5 {Math.round(point.pm25)}</em>}
    </div>
  )
}

const AqiCalendarPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const slug = searchParams.get('slug') || ''
  const year = Number(searchParams.get('year')) || CURRENT_YEAR
  const slugType = searchParams.get('slugType') || 'cityId'
  const placeName = String(searchParams.get('name') || '')
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')

  const aoiPayload = useMemo(() => {
    if (location.state?.geometry?.type && location.state?.geometry?.coordinates) {
      return {
        geometry: location.state.geometry,
        source: location.state.source || (location.state.kml ? 'kml' : 'draw'),
        kml: location.state.kml || null
      }
    }
    return readStoredAoi()
  }, [location.state])

  const aoiGeometry = aoiPayload?.geometry || null

  const goToDashboard = () => {
    navigate('/dashboard', {
      state: {
        restoreAoi: true,
        geometry: aoiGeometry,
        kml: aoiPayload?.kml || null,
        source: aoiPayload?.source || 'draw'
      }
    })
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [calendar, setCalendar] = useState(null)
  const [activeMonth, setActiveMonth] = useState(new Date().getMonth() + 1)
  const [hoveredDay, setHoveredDay] = useState(null)

  const [selectedDay, setSelectedDay] = useState(null)
  const [hourlyLoading, setHourlyLoading] = useState(false)
  const [hourlyError, setHourlyError] = useState(null)
  const [hourly, setHourly] = useState(null)

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  useEffect(() => {
    if (!slug) {
      setCalendar(null)
      setError('No location yet. Draw an area on the map, then open AQI Calendar.')
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedDay(null)
    setHourly(null)
    setHourlyError(null)

    fetchAqiCalendar({ slug, year, slugType, sensorname: 'AQI-IN' })
      .then((data) => {
        if (cancelled) return
        setCalendar(data)
        const current = new Date().getMonth() + 1
        const preferred = data.months?.find((m) => m.month === current && m.days?.length)
          || data.months?.find((m) => m.days?.length)
        if (preferred) setActiveMonth(preferred.month)
      })
      .catch((err) => {
        if (cancelled) return
        setCalendar(null)
        setError(err.message || 'Failed to load AQI calendar')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [slug, year, slugType])

  useEffect(() => {
    setSelectedDay(null)
    setHourly(null)
    setHourlyError(null)
  }, [activeMonth])

  useEffect(() => {
    if (!selectedDay?.date) {
      setHourly(null)
      setHourlyError(null)
      setHourlyLoading(false)
      return undefined
    }

    let cancelled = false
    setHourlyLoading(true)
    setHourlyError(null)

    fetchDayHourlyAqi({
      latitude: lat,
      longitude: lng,
      date: selectedDay.date,
      slug,
      slugType
    })
      .then((data) => {
        if (cancelled) return
        setHourly(data)
      })
      .catch((err) => {
        if (cancelled) return
        setHourly(null)
        setHourlyError(err.message || 'Failed to load hourly AQI')
      })
      .finally(() => {
        if (!cancelled) setHourlyLoading(false)
      })

    return () => { cancelled = true }
  }, [selectedDay?.date, lat, lng, slug, slugType])

  const month = useMemo(
    () => calendar?.months?.find((m) => m.month === activeMonth) || null,
    [calendar, activeMonth]
  )

  const cells = useMemo(
    () => (month ? buildMonthCells(calendar.year, month.month, month.days) : []),
    [calendar, month]
  )

  const stats = useMemo(() => monthStats(month?.days), [month])

  const setYear = (nextYear) => {
    const params = new URLSearchParams(searchParams)
    params.set('year', String(nextYear))
    setSearchParams(params)
  }

  const displayName = titleCase(
    placeName
    || String(calendar?.slug || '').split('/').filter(Boolean).pop()
    || 'Drawn area city'
  )

  const slugTrail = slug
    ? slug.split('/').filter(Boolean).map(titleCase).join(' · ')
    : ''

  const handleDayClick = (cell) => {
    if (!cell?.data || !Number.isFinite(Number(cell.data.aqi))) return
    const date = dateForCell(calendar.year, month.month, cell.day, cell.data)
    if (selectedDay?.date === date) {
      setSelectedDay(null)
      return
    }
    setSelectedDay({
      day: cell.day,
      date,
      aqi: cell.data.aqi,
      color: cell.data.color || aqiInColor(cell.data.aqi),
      label: aqiInLabel(cell.data.aqi),
      monthName: month.name
    })
  }

  const hourlyOpen = Boolean(selectedDay)

  return (
    <div className={`aqi-calendar-page${hourlyOpen ? ' has-hourly' : ''}`}>
      <div className="aqi-calendar-atmosphere" aria-hidden="true" />

      <div className="aqi-calendar-shell">
        <header className="aqi-calendar-topbar">
          <div className="aqi-calendar-brand-row">
            <button type="button" className="aqi-calendar-back" onClick={goToDashboard}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Dashboard
            </button>
            <div className="aqi-calendar-brand-block">
              <p className="aqi-calendar-kicker">ClimateEye</p>
              <h1>AQI Calendar</h1>
            </div>
          </div>

          <section className="aqi-calendar-toolbar" aria-label="Location and year">
            <div className="aqi-calendar-toolbar-main">
              <AoiMiniMap geometry={aoiGeometry} />
              <div className="aqi-calendar-place">
                <span className="aqi-calendar-place-label">Location</span>
                <strong>{displayName}</strong>
                <em>
                  {slugTrail || 'Nearest city for your drawn area'}
                  {lat && lng ? ` · ${Number(lat).toFixed(3)}°, ${Number(lng).toFixed(3)}°` : ''}
                </em>
              </div>
            </div>

            <div className="aqi-calendar-toolbar-actions">
              <label className="aqi-calendar-year">
                <span>Year</span>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  disabled={!slug}
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="aqi-calendar-map-btn" onClick={goToDashboard}>
                Change area
              </button>
            </div>
          </section>
        </header>

        {!slug && (
          <div className="aqi-calendar-empty">
            <h2>No area selected</h2>
            <p>
              Draw a polygon on the dashboard map, then open <strong>AQI Calendar</strong>.
              We resolve the nearest aqi.in city and load its monthly history.
            </p>
            <button type="button" className="aqi-calendar-map-btn" onClick={goToDashboard}>
              Go to map
            </button>
          </div>
        )}

        {loading && (
          <div className="aqi-calendar-loading" role="status">
            <span className="aqi-calendar-spinner" aria-hidden="true" />
            Loading AQI history for {displayName}…
          </div>
        )}

        {error && slug && <p className="aqi-calendar-error">{error}</p>}

        {calendar && !loading && (
          <>
            <section className="aqi-calendar-summary" aria-label="Year summary">
              <div>
                <span>Days recorded</span>
                <strong>{calendar.dayCount}</strong>
              </div>
              <div>
                <span>Year average</span>
                <strong style={{ color: aqiInColor(calendar.avgAqi) }}>
                  {calendar.avgAqi ?? '—'}
                </strong>
                <em>{aqiInLabel(calendar.avgAqi)}</em>
              </div>
              <div>
                <span>Best day</span>
                <strong style={{ color: aqiInColor(calendar.minAqi) }}>
                  {calendar.minAqi ?? '—'}
                </strong>
              </div>
              <div>
                <span>Worst day</span>
                <strong style={{ color: aqiInColor(calendar.maxAqi) }}>
                  {calendar.maxAqi ?? '—'}
                </strong>
              </div>
            </section>

            <nav className="aqi-calendar-months" role="tablist" aria-label="Month">
              {(calendar.months || []).map((m) => {
                const hasData = Boolean(m.days?.length)
                return (
                  <button
                    key={m.month}
                    type="button"
                    role="tab"
                    aria-selected={activeMonth === m.month}
                    className={activeMonth === m.month ? 'is-active' : ''}
                    onClick={() => setActiveMonth(m.month)}
                    disabled={!hasData}
                  >
                    <span>{m.name.slice(0, 3)}</span>
                    {hasData && <i aria-hidden="true" />}
                  </button>
                )
              })}
            </nav>

            <div className={`aqi-calendar-workspace${hourlyOpen ? ' is-split' : ''}`}>
              {month && (
                <section className="aqi-calendar-panel" aria-label={`${month.name} ${calendar.year}`}>
                  <div className="aqi-calendar-panel-head">
                    <div>
                      <h2>{month.name} {calendar.year}</h2>
                      <p>
                        {stats.count
                          ? `${stats.count} days · month avg ${stats.avg} (${aqiInLabel(stats.avg)}) · tap a day for 24h`
                          : 'No day values for this month'}
                      </p>
                    </div>
                    {hoveredDay?.data && !hourlyOpen && (
                      <div className="aqi-calendar-hover-chip" style={{ borderColor: hoveredDay.data.color || aqiInColor(hoveredDay.data.aqi) }}>
                        <span>{month.name} {hoveredDay.day}</span>
                        <strong style={{ color: hoveredDay.data.color || aqiInColor(hoveredDay.data.aqi) }}>
                          AQI {hoveredDay.data.aqi}
                        </strong>
                        <em>{aqiInLabel(hoveredDay.data.aqi)}</em>
                      </div>
                    )}
                  </div>

                  {month.days.length === 0 ? (
                    <p className="aqi-calendar-status">No day values for this month.</p>
                  ) : (
                    <>
                      <div className="aqi-calendar-weekdays" aria-hidden="true">
                        {WEEKDAYS.map((label) => (
                          <span key={label}>{label}</span>
                        ))}
                      </div>

                      <div className="aqi-calendar-grid" role="grid" aria-label={`${month.name} daily AQI`}>
                        {cells.map((cell) => {
                          if (cell.type === 'pad') {
                            return <div key={cell.key} className="aqi-calendar-cell is-pad" aria-hidden="true" />
                          }

                          const data = cell.data
                          const color = data?.color || aqiInColor(data?.aqi)
                          const label = aqiInLabel(data?.aqi)
                          const hasValue = data && Number.isFinite(Number(data.aqi))
                          const cellDate = hasValue
                            ? dateForCell(calendar.year, month.month, cell.day, data)
                            : null
                          const isSelected = hourlyOpen && selectedDay?.date === cellDate

                          return (
                            <button
                              key={cell.key}
                              type="button"
                              className={`aqi-calendar-cell ${hasValue ? 'has-value' : 'is-empty'}${isSelected ? ' is-selected' : ''}`}
                              style={hasValue ? {
                                '--aqi-color': color,
                                background: `${color}18`,
                                borderColor: isSelected ? color : `${color}66`
                              } : undefined}
                              disabled={!hasValue}
                              onClick={() => handleDayClick(cell)}
                              onMouseEnter={() => setHoveredDay(hasValue ? { day: cell.day, data } : null)}
                              onMouseLeave={() => setHoveredDay(null)}
                              onFocus={() => setHoveredDay(hasValue ? { day: cell.day, data } : null)}
                              onBlur={() => setHoveredDay(null)}
                              title={hasValue
                                ? `${data.date || `${month.name} ${cell.day}`}: AQI ${data.aqi} (${label}) — click for 24h`
                                : `${month.name} ${cell.day}: no data`}
                              aria-pressed={isSelected}
                              aria-label={hasValue
                                ? `${month.name} ${cell.day}, AQI ${data.aqi}, ${label}. Show hourly`
                                : `${month.name} ${cell.day}, no data`}
                            >
                              <span className="aqi-calendar-cell-day">{cell.day}</span>
                              {hasValue ? (
                                <>
                                  <strong style={{ color }}>{data.aqi}</strong>
                                  <em>{label}</em>
                                </>
                              ) : (
                                <em className="aqi-calendar-cell-nodata">—</em>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}

                  <div className="aqi-calendar-legend" aria-label="AQI scale">
                    {AQI_LEGEND.map((band, index) => {
                      const sample = index === 0 ? 25 : (AQI_LEGEND[index - 1].max + 1)
                      const color = aqiInColor(sample)
                      return (
                        <div key={band.label} className="aqi-calendar-legend-item">
                          <i style={{ background: color }} />
                          <span>{band.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {hourlyOpen && (
                <aside className="aqi-hourly-panel" aria-label={`Hourly AQI for ${selectedDay.date}`}>
                  <div className="aqi-hourly-head">
                    <div>
                      <p className="aqi-hourly-kicker">24-hour AQI</p>
                      <h3>
                        {selectedDay.monthName} {selectedDay.day}, {calendar.year}
                      </h3>
                      <p className="aqi-hourly-sub">
                        Daily AQI {selectedDay.aqi} · {selectedDay.label}
                        {hourly?.source ? ` · via ${hourly.source}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="aqi-hourly-close"
                      onClick={() => setSelectedDay(null)}
                      aria-label="Close hourly chart"
                    >
                      ×
                    </button>
                  </div>

                  {hourlyLoading && (
                    <div className="aqi-calendar-loading" role="status">
                      <span className="aqi-calendar-spinner" aria-hidden="true" />
                      Loading hourly series…
                    </div>
                  )}

                  {hourlyError && !hourlyLoading && (
                    <p className="aqi-calendar-error">{hourlyError}</p>
                  )}

                  {!hourlyLoading && hourly && (
                    <>
                      <div className="aqi-hourly-stats">
                        <div>
                          <span>Avg</span>
                          <strong style={{ color: aqiInColor(hourly.avg) }}>{hourly.avg ?? '—'}</strong>
                        </div>
                        <div>
                          <span>Min</span>
                          <strong style={{ color: aqiInColor(hourly.min) }}>{hourly.min ?? '—'}</strong>
                        </div>
                        <div>
                          <span>Max</span>
                          <strong style={{ color: aqiInColor(hourly.max) }}>{hourly.max ?? '—'}</strong>
                        </div>
                        <div>
                          <span>Hours</span>
                          <strong>{hourly.count}</strong>
                        </div>
                      </div>

                      <div className="aqi-hourly-chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={hourly.points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                            <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                            <XAxis
                              dataKey="label"
                              tick={{ fill: 'rgba(232,238,248,0.55)', fontSize: 10 }}
                              axisLine={false}
                              tickLine={false}
                              interval="preserveStartEnd"
                              minTickGap={8}
                            />
                            <YAxis
                              tick={{ fill: 'rgba(232,238,248,0.45)', fontSize: 10 }}
                              axisLine={false}
                              tickLine={false}
                              width={32}
                            />
                            <Tooltip content={<HourlyTooltip />} cursor={{ fill: 'rgba(20,184,166,0.08)' }} />
                            <Bar dataKey="aqi" radius={[4, 4, 0, 0]} maxBarSize={18}>
                              {hourly.points.map((point) => (
                                <Cell key={point.time} fill={point.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )}
                </aside>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AqiCalendarPage
