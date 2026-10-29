import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { format } from 'date-fns'
import WeatherAnimatedBg from './WeatherAnimatedBg'
import WeatherMiniMap from './WeatherMiniMap'
import WeatherConditionStrip from './WeatherConditionStrip'
import { fetchWeatherData, fetchHourlyWeatherData, fetchAQIData } from '../services/api'
import { resolveCityFromCoords } from '../services/aqiInApi'
import './WeatherWorkspace.css'

const DEFAULT_PLACE = {
  city: 'Mumbai',
  state: 'Maharashtra',
  country: 'India',
  latitude: 19.076,
  longitude: 72.8777
}

const pickNumber = (...vals) => {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

const comfortFromTemp = (temp) => {
  if (temp == null) return { label: '—', tone: 'neutral' }
  if (temp >= 36) return { label: 'Hot', tone: 'hot' }
  if (temp >= 30) return { label: 'Warm', tone: 'warm' }
  if (temp >= 22) return { label: 'Pleasant', tone: 'pleasant' }
  if (temp >= 15) return { label: 'Mild', tone: 'mild' }
  return { label: 'Cool', tone: 'cool' }
}

const aqiBand = (aqi) => {
  if (aqi == null) return { label: '—', note: 'AQI unavailable', tone: 'unknown' }
  if (aqi <= 50) return { label: 'GOOD', note: 'Air quality is good.', tone: 'good' }
  if (aqi <= 100) return { label: 'MODERATE', note: 'Acceptable air.', tone: 'moderate' }
  if (aqi <= 150) return { label: 'UNHEALTHY*', note: 'Sensitive groups may feel effects.', tone: 'usg' }
  if (aqi <= 200) return { label: 'UNHEALTHY', note: 'Limit outdoor activity.', tone: 'unhealthy' }
  if (aqi <= 300) return { label: 'VERY POOR', note: 'Avoid outdoor exertion.', tone: 'very-poor' }
  return { label: 'HAZARDOUS', note: 'Stay indoors if possible.', tone: 'hazard' }
}

const humidityNote = (h) => {
  if (h == null) return 'Humidity unavailable'
  if (h < 40) return 'Air feels dry.'
  if (h < 60) return 'Comfortable humidity.'
  if (h < 75) return 'Air may feel slightly humid.'
  return 'Air feels sticky and humid.'
}

const weatherIconFor = (condition = '', hour = 12) => {
  const c = String(condition).toLowerCase()
  const night = hour < 6 || hour >= 19
  if (c.includes('rain') || c.includes('drizzle')) return 'rain'
  if (c.includes('storm') || c.includes('thunder')) return 'storm'
  if (c.includes('cloud') || c.includes('overcast')) return night ? 'cloud-night' : 'cloud'
  if (c.includes('clear') || c.includes('sun')) return night ? 'moon' : 'sun'
  return night ? 'cloud-night' : 'partly'
}

const WeatherGlyph = ({ type }) => {
  const uid = useId().replace(/:/g, '')
  if (type === 'rain') {
    return (
      <svg className="ww-glyph ww-glyph--rain" viewBox="0 0 40 40" aria-hidden="true">
        <defs>
          <linearGradient id={`wwRainCloud-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#94a3b8" />
          </linearGradient>
        </defs>
        <g className="ww-glyph-cloud">
          <ellipse cx="20" cy="16" rx="11" ry="7" fill={`url(#wwRainCloud-${uid})`} />
          <circle cx="13" cy="15" r="6" fill="#cbd5e1" />
          <circle cx="26" cy="14" r="7" fill="#e2e8f0" />
        </g>
        <g className="ww-glyph-drops" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round">
          <path className="ww-glyph-drop ww-glyph-drop--1" d="M12 24l1.5 7" />
          <path className="ww-glyph-drop ww-glyph-drop--2" d="M20 23l1.5 8" />
          <path className="ww-glyph-drop ww-glyph-drop--3" d="M28 24l1.5 7" />
        </g>
      </svg>
    )
  }
  if (type === 'moon' || type === 'cloud-night') {
    return (
      <svg className={`ww-glyph ww-glyph--${type}`} viewBox="0 0 40 40" aria-hidden="true">
        <circle className="ww-glyph-glow" cx="22" cy="16" r="11" fill="rgba(253, 230, 138, 0.28)" />
        <path className="ww-glyph-moon" d="M24 10a10 10 0 1 0 8 16 8 8 0 1 1-8-16z" fill="#fde68a" />
        {type === 'cloud-night' && (
          <g className="ww-glyph-cloud">
            <ellipse cx="18" cy="27" rx="10" ry="6" fill="#cbd5e1" />
          </g>
        )}
      </svg>
    )
  }
  if (type === 'cloud') {
    return (
      <svg className="ww-glyph ww-glyph--cloud" viewBox="0 0 40 40" aria-hidden="true">
        <g className="ww-glyph-cloud">
          <ellipse cx="20" cy="22" rx="12" ry="7" fill="#cbd5e1" />
          <circle cx="14" cy="18" r="6" fill="#e2e8f0" />
          <circle cx="24" cy="17" r="7" fill="#f8fafc" />
        </g>
      </svg>
    )
  }
  if (type === 'partly') {
    return (
      <svg className="ww-glyph ww-glyph--partly" viewBox="0 0 40 40" aria-hidden="true">
        <g className="ww-glyph-sun">
          <g className="ww-glyph-rays">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
              <line
                key={deg}
                x1="14"
                y1="14"
                x2={14 + Math.cos((deg * Math.PI) / 180) * 10}
                y2={14 + Math.sin((deg * Math.PI) / 180) * 10}
                stroke="#f59e0b"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            ))}
          </g>
          <circle cx="14" cy="14" r="5.5" fill="#fbbf24" />
        </g>
        <g className="ww-glyph-cloud">
          <ellipse cx="24" cy="25" rx="11" ry="7" fill="#e2e8f0" />
          <circle cx="18" cy="23" r="5" fill="#cbd5e1" />
          <circle cx="28" cy="22" r="6" fill="#f8fafc" />
        </g>
      </svg>
    )
  }
  return (
    <svg className="ww-glyph ww-glyph--sun" viewBox="0 0 40 40" aria-hidden="true">
      <circle className="ww-glyph-glow" cx="20" cy="20" r="14" fill="rgba(251, 191, 36, 0.28)" />
      <g className="ww-glyph-sun">
        <g className="ww-glyph-rays">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line
              key={deg}
              x1="20"
              y1="20"
              x2={20 + Math.cos((deg * Math.PI) / 180) * 14}
              y2={20 + Math.sin((deg * Math.PI) / 180) * 14}
              stroke="#f59e0b"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))}
        </g>
        <circle cx="20" cy="20" r="7" fill="#fbbf24" />
        <circle cx="17.5" cy="17.5" r="2" fill="rgba(255,255,255,0.45)" />
      </g>
    </svg>
  )
}

const HourlySpark = ({ cards }) => {
  const uid = useId().replace(/:/g, '')
  const points = useMemo(() => {
    const temps = cards.map((x) => x.temp).filter((t) => t != null)
    if (temps.length < 2) return { line: '', area: '', dots: [] }
    const min = Math.min(...temps)
    const max = Math.max(...temps)
    const span = max - min || 1
    const dots = cards.map((h, i) => {
      const x = (i / Math.max(cards.length - 1, 1)) * 280
      const y = 36 - (((h.temp ?? min) - min) / span) * 26
      return { x, y, temp: h.temp }
    })
    const line = dots.map((d) => `${d.x},${d.y}`).join(' ')
    const area = `0,44 ${line} 280,44`
    return { line, area, dots }
  }, [cards])

  if (!points.line) return null

  return (
    <svg className="ww-temp-spark" viewBox="0 0 280 48" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`wwSparkFill-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(14, 165, 233, 0.35)" />
          <stop offset="100%" stopColor="rgba(14, 165, 233, 0)" />
        </linearGradient>
        <linearGradient id={`wwSparkStroke-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      <polygon className="ww-temp-spark-area" points={points.area} fill={`url(#wwSparkFill-${uid})`} />
      <polyline
        className="ww-temp-spark-line"
        fill="none"
        stroke={`url(#wwSparkStroke-${uid})`}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points.line}
      />
      {points.dots.map((d, i) => (
        <circle key={i} className="ww-temp-spark-dot" cx={d.x} cy={d.y} r="2.6" style={{ '--dot-i': i }} />
      ))}
    </svg>
  )
}

const reverseGeocode = async (latitude, longitude) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return null
    const data = await res.json()
    const a = data.address || {}
    return {
      city: a.city || a.town || a.village || a.suburb || a.county || 'Your area',
      state: a.state || a.region || '',
      country: a.country || ''
    }
  } catch {
    return null
  }
}

const WeatherWorkspace = () => {
  const [place, setPlace] = useState(DEFAULT_PLACE)
  const [weather, setWeather] = useState(null)
  const [aqi, setAqi] = useState(null)
  const [hourly, setHourly] = useState([])
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [searchedPlace, setSearchedPlace] = useState(null)

  const loadWeather = useCallback(async (nextPlace) => {
    setLoading(true)
    setError(null)
    const { latitude, longitude } = nextPlace
    const today = format(new Date(), 'yyyy-MM-dd')

    try {
      const [weatherRes, aqiRes, hourlyRes] = await Promise.allSettled([
        fetchWeatherData(latitude, longitude),
        fetchAQIData(latitude, longitude),
        fetchHourlyWeatherData(latitude, longitude, today)
      ])

      if (weatherRes.status === 'fulfilled') {
        setWeather(weatherRes.value)
      } else {
        setWeather(null)
      }

      if (aqiRes.status === 'fulfilled') {
        setAqi(aqiRes.value)
      } else {
        setAqi(null)
      }

      if (hourlyRes.status === 'fulfilled') {
        const raw = hourlyRes.value
        const list = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.hourly_records)
            ? raw.hourly_records
            : Array.isArray(raw?.hourly)
              ? raw.hourly
              : Array.isArray(raw?.data)
                ? raw.data
                : Array.isArray(raw?.records)
                  ? raw.records
                  : []
        setHourly(list.filter((r) => r != null))
      } else {
        setHourly([])
      }

      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Failed to load weather')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWeather(place)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — initial Mumbai load

  const handlePlaceSearch = useCallback(async (picked) => {
    if (!picked || !Number.isFinite(picked.lat) || !Number.isFinite(picked.lng)) return
    setSearchedPlace(picked)
    const parts = String(picked.context || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    const next = {
      city: picked.name || 'Selected place',
      state: parts.length >= 2 ? parts[parts.length - 2] : (parts[0] || ''),
      country: parts[parts.length - 1] || 'India',
      latitude: picked.lat,
      longitude: picked.lng
    }
    setPlace(next)
    await loadWeather(next)
  }, [loadWeather])

  const handleLocate = async () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser')
      return
    }
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const latitude = pos.coords.latitude
        const longitude = pos.coords.longitude
        try {
          const [geo, city] = await Promise.all([
            reverseGeocode(latitude, longitude),
            resolveCityFromCoords(latitude, longitude).catch(() => null)
          ])
          const next = {
            city: geo?.city || city?.cityName || city?.title || 'Your location',
            state: geo?.state || '',
            country: geo?.country || 'India',
            latitude,
            longitude
          }
          setSearchedPlace(null)
          setPlace(next)
          await loadWeather(next)
        } catch (err) {
          setError(err?.message || 'Could not resolve location')
        } finally {
          setLocating(false)
        }
      },
      (err) => {
        setLocating(false)
        setError(err?.message || 'Location permission denied')
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  const metrics = useMemo(() => {
    const w = weather || {}
    const daily = w.daily || {}
    const temp = pickNumber(w.temperature, w.temp, w.temp_c, daily.temp_max)
    const feels = pickNumber(w.feels_like, w.feelsLike, w.apparent_temperature)
    const humidity = pickNumber(w.humidity, daily.humidity_max)
    const condition = w.condition || w.weather || w.summary || (temp != null ? 'Clear' : '—')
    const high = pickNumber(w.temp_max, daily.temp_max, w.high)
    const low = pickNumber(w.temp_min, daily.temp_min, w.low)
    const rainChance = pickNumber(w.precipitation_probability, w.rain_chance, w.precip_prob, daily.precipitation_probability)

    const aqiVal = pickNumber(
      aqi?.aqi,
      aqi?.AQI,
      aqi?.value,
      aqi?.data?.aqi,
      aqi?.overall?.aqi
    )

    return { temp, feels, humidity, condition, high, low, rainChance, aqiVal }
  }, [weather, aqi])

  /** Latest hour metrics for the active place (locate / search). */
  const conditionMetrics = useMemo(() => {
    const latest = hourly.length ? hourly[hourly.length - 1] : null
    const w = weather || {}
    const src = latest || w
    if (!src && !w) return null

    return {
      windSpeed: pickNumber(src.wind_speed, src.windSpeed, w.wind_speed),
      windGusts: pickNumber(src.wind_gusts, src.windGusts, src.gust, w.wind_gusts),
      windDirection: pickNumber(src.wind_direction, src.windDirection, w.wind_direction),
      cloudCover: pickNumber(src.cloud_cover, src.cloudCover, w.cloud_cover),
      visibility: pickNumber(src.visibility, w.visibility),
      pressure: pickNumber(src.pressure, src.surface_pressure, w.pressure),
      precipitation: pickNumber(src.precipitation, src.rain, w.precipitation, w.rain),
      uvIndex: pickNumber(src.uv_index, src.uvIndex, w.uv_index, w.uv_index_max)
    }
  }, [hourly, weather])

  const comfort = comfortFromTemp(metrics.temp)
  const band = aqiBand(metrics.aqiVal)

  const hourlyCards = useMemo(() => {
    const nowHour = new Date().getHours()
    const mapped = hourly
      .map((row, index) => {
        const timeRaw = row.time || row.hour || row.timestamp || row.datetime || row.date
        let hour = null
        if (typeof timeRaw === 'number') hour = timeRaw
        else if (typeof timeRaw === 'string') {
          const d = new Date(timeRaw)
          hour = Number.isNaN(d.getTime())
            ? Number(String(timeRaw).match(/(\d{1,2})/)?.[1])
            : d.getHours()
        }
        if (!Number.isFinite(hour)) hour = index
        hour = ((hour % 24) + 24) % 24

        const temp = pickNumber(row.temperature, row.temp, row.temp_c, row.temp_max)
        const precip = pickNumber(
          row.precipitation_probability,
          row.rain_chance,
          row.precip_prob,
          row.rain,
          row.precipitation
        )
        const condition = row.condition || row.weather || metrics.condition
        return { hour, temp, precip, condition, index }
      })
      .filter((r) => r.temp != null)

    const fromNow = mapped.filter((r) => r.hour >= nowHour)
    const slice = (fromNow.length >= 6 ? fromNow : mapped).slice(0, 7)

    return slice.map((r, i) => ({
      ...r,
      label: i === 0 && r.hour === nowHour ? 'Now' : format(new Date().setHours(r.hour, 0, 0, 0), 'h a'),
      icon: weatherIconFor(r.condition, r.hour)
    }))
  }, [hourly, metrics.condition])

  const aqiNeedle = metrics.aqiVal == null ? 15 : Math.min(100, Math.max(0, (metrics.aqiVal / 300) * 100))

  const crumb = ['Weather', place.country, place.state, place.city].filter(Boolean).join(' › ')

  return (
    <div className="weather-workspace">
      <WeatherAnimatedBg />

      <div className="weather-workspace-ui">
        <header className="ww-top">
          <p className="ww-breadcrumb">{crumb}</p>
          <div className="ww-top-actions">
            <button
              type="button"
              className="ww-chip-btn"
              onClick={handleLocate}
              disabled={locating}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
              {locating ? 'Locating…' : 'Locate me'}
            </button>
            <button type="button" className="ww-icon-btn" title="Favorite" aria-label="Favorite">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
              </svg>
            </button>
            <button
              type="button"
              className="ww-icon-btn"
              title="Refresh"
              aria-label="Refresh weather"
              onClick={() => loadWeather(place)}
              disabled={loading}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </button>
          </div>
        </header>

        {error && <div className="ww-error">{error}</div>}

        <div className="ww-scroll">
        <div className="ww-body">
          <section className="ww-hero">
            <div className="ww-hero-main">
              <h1 className="ww-title">{place.city} Weather Conditions</h1>
              <p className="ww-subtitle">Current Temperature Level</p>

              <div className="ww-hero-row">
                <div className="ww-temp-block">
                  <div className="ww-temp-main">
                    <span className="ww-temp-value">
                      {loading && metrics.temp == null ? '—' : metrics.temp != null ? Math.round(metrics.temp) : '—'}
                      <small>°c</small>
                    </span>
                    <div className="ww-temp-icon">
                      <WeatherGlyph type={weatherIconFor(metrics.condition, new Date().getHours())} />
                    </div>
                  </div>
                  <div className="ww-hi-lo">
                    <span>↑ {metrics.high != null ? `${Math.round(metrics.high)}°c` : '—'}</span>
                    <span>↓ {metrics.low != null ? `${Math.round(metrics.low)}°c` : '—'}</span>
                  </div>
                  <span className={`ww-comfort ww-comfort--${comfort.tone}`}>{comfort.label}</span>
                </div>

                <ul className="ww-facts">
                  <li>
                    <span>Condition</span>
                    <strong>{metrics.condition}</strong>
                  </li>
                  <li>
                    <span>Feels Like</span>
                    <strong>{metrics.feels != null ? `${Math.round(metrics.feels)}°c` : '—'}</strong>
                  </li>
                  <li>
                    <span>Chances of Rain</span>
                    <strong>{metrics.rainChance != null ? `${Math.round(metrics.rainChance)}%` : '—'}</strong>
                  </li>
                </ul>
              </div>

              {updatedAt && (
                <p className="ww-updated">Updated {format(updatedAt, 'h:mm a')}</p>
              )}
            </div>

            <aside id="weather-forecast-panel" className="ww-forecast ww-forecast--hero" aria-label="Hourly forecast">
              <p className="ww-forecast-label">Hourly</p>
              <div className="ww-hourly">
                {loading && hourlyCards.length === 0 && (
                  <p className="ww-forecast-empty">Loading hourly…</p>
                )}
                {!loading && hourlyCards.length === 0 && (
                  <p className="ww-forecast-empty">Hourly forecast will appear here.</p>
                )}
                {hourlyCards.map((h, i) => (
                  <div
                    key={`${h.hour}-${h.index}`}
                    className={`ww-hour${h.label === 'Now' ? ' is-now' : ''}`}
                    style={{ '--hour-i': i }}
                  >
                    <span className="ww-hour-label">{h.label}</span>
                    <span className="ww-hour-icon">
                      <WeatherGlyph type={h.icon} />
                    </span>
                    <strong>{h.temp != null ? `${Math.round(h.temp)}°` : '—'}</strong>
                    <em>{h.precip != null ? `${Math.round(h.precip)}%` : '—'}</em>
                  </div>
                ))}
              </div>
              <HourlySpark cards={hourlyCards} />
              <p className="ww-forecast-tip">
                {String(metrics.condition).toLowerCase().includes('rain')
                  ? 'Rain is possible — keep an umbrella handy.'
                  : 'It is likely to stay clear; sun protection may help.'}
              </p>
            </aside>
          </section>

          <div className="ww-right-stack">
            <WeatherMiniMap
              latitude={place.latitude}
              longitude={place.longitude}
              label={place.city}
              selectedPlace={searchedPlace}
              onPlaceSelect={handlePlaceSearch}
            />
          </div>
        </div>

        <WeatherConditionStrip
          city={place.city}
          metrics={conditionMetrics}
          loading={loading}
          aqiVal={metrics.aqiVal}
          aqiBand={band}
          humidity={metrics.humidity}
          humidityNote={humidityNote(metrics.humidity)}
          aqiNeedle={aqiNeedle}
        />
        </div>
      </div>
    </div>
  )
}

export default WeatherWorkspace
