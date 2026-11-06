import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
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
import AqiMiniMap from './AqiMiniMap'
import { fetchWeatherData } from '../services/api'
import {
  aqiInColor,
  aqiInLabel,
  HISTORY_RANGES,
  fetchAqiHistory,
  fetchSensorBundle,
  fetchTopCitiesRanklist,
  resolveCityFromCoords,
  resolveHistorySlug,
  stationAqiValue
} from '../services/aqiInApi'

const HISTORY_RANGE_ORDER = ['24h', '7d', '30d']
import { reverseGeocodePlace } from '../services/geocoding'
import { MUMBAI_PLACE, resolveStartupPlace } from '../services/startupPlace'
import './AqiWorkspace.css'

const DEFAULT_PLACE = MUMBAI_PLACE

const CITY_BG_BASE = 'https://myserver.aqi.in/countrybg/india'

const cityBgSlug = (city) => {
  const raw = String(city || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return raw || 'mumbai'
}

const cityBgUrl = (city) => `${CITY_BG_BASE}/${cityBgSlug(city)}.svg`

const AQI_SCALE = [
  { key: 'good', label: 'Good', max: 50, color: '#10b981' },
  { key: 'moderate', label: 'Moderate', max: 100, color: '#f59e0b' },
  { key: 'poor', label: 'Poor', max: 150, color: '#f97316' },
  { key: 'unhealthy', label: 'Unhealthy', max: 200, color: '#ef4444' },
  { key: 'severe', label: 'Severe', max: 300, color: '#8b5cf6' },
  { key: 'hazardous', label: 'Hazardous', max: 500, color: '#7f1d1d' }
]

const pickNumber = (...vals) => {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

const ordinal = (n) => {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return '—'
  const mod100 = v % 100
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`
  switch (v % 10) {
    case 1: return `${v}st`
    case 2: return `${v}nd`
    case 3: return `${v}rd`
    default: return `${v}th`
  }
}

const bandTone = (aqi) => {
  const v = Number(aqi)
  if (!Number.isFinite(v)) return 'unknown'
  if (v <= 50) return 'good'
  if (v <= 100) return 'moderate'
  if (v <= 150) return 'poor'
  if (v <= 200) return 'unhealthy'
  if (v <= 300) return 'severe'
  return 'hazardous'
}

/** Map AQI onto equal-width scale segments (0-50, 50-100, 100-150, 150-200, 200-300, 300-500). */
const SCALE_BREAKS = [0, 50, 100, 150, 200, 300, 500]

const scaleThumbPct = (aqi) => {
  if (!Number.isFinite(Number(aqi))) return '0%'
  const v = Math.max(0, Math.min(500, Number(aqi)))
  const segs = SCALE_BREAKS.length - 1
  let i = 0
  while (i < segs - 1 && v > SCALE_BREAKS[i + 1]) i += 1
  const lo = SCALE_BREAKS[i]
  const hi = SCALE_BREAKS[i + 1]
  const t = hi === lo ? 0 : (v - lo) / (hi - lo)
  return `${((i + t) / segs) * 100}%`
}

const pollutant = (station, keys) => {
  const iaqi = station?.iaqi || {}
  for (const key of keys) {
    const raw = iaqi[key] ?? station?.[key]
    const n = Number(
      raw != null && typeof raw === 'object'
        ? (raw.v ?? raw.value ?? raw.aqi ?? raw.concentration)
        : raw
    )
    if (Number.isFinite(n)) return n
  }
  return null
}

const conditionText = (...vals) => {
  for (const v of vals) {
    if (v == null || v === '') continue
    if (typeof v === 'string' || typeof v === 'number') return String(v)
    if (typeof v === 'object') {
      const text = v.text || v.description || v.label || v.condition || v.summary
      if (text != null && text !== '') return String(text)
    }
  }
  return '—'
}

const formatExtremeTime = (iso) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hour = date.getHours()
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h12 = hour % 12 || 12
  const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return `${h12}${ampm} ${day}`
}

const HistoryTooltip = ({ active, payload, placeName }) => {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  return (
    <div className="aqi-history-tooltip">
      <div className="aqi-history-tooltip-time">{point.label}</div>
      <div className="aqi-history-tooltip-row">
        <span className="aqi-history-tooltip-dot" style={{ background: point.color }} />
        <span>{placeName}: {Math.round(point.aqi)}</span>
      </div>
    </div>
  )
}

/** Soft, layered SVG cloud with blur + gradients (not flat circles). */
const SoftCloud = ({ className, variant = 'a' }) => {
  const id = `aqi-cloud-${variant}-${className?.includes('--d') ? 'd' : variant}`
  const shapes = {
    a: {
      viewBox: '0 0 220 110',
      base: 'M28 78c-16 0-28-11-28-24S14 30 30 30c4-14 18-24 34-24 14 0 26 7 32 18 6-4 13-6 21-6 20 0 36 14 38 33 14 1 25 12 25 25 0 14-12 26-27 26H28z',
      lit: [[84, 48, 36, 22], [136, 42, 32, 18]],
      shade: [[66, 68, 30, 14], [118, 72, 38, 12], [168, 64, 26, 11]]
    },
    b: {
      viewBox: '0 0 260 120',
      base: 'M34 86c-18 0-32-12-32-27S18 32 36 32c5-16 20-28 39-28 16 0 30 8 37 20 7-5 16-8 25-8 24 0 43 16 46 38 16 2 28 14 28 29 0 16-13 29-30 29H34z',
      lit: [[98, 52, 42, 24], [160, 46, 36, 20]],
      shade: [[78, 76, 34, 15], [140, 80, 44, 13], [198, 72, 30, 12]]
    },
    c: {
      viewBox: '0 0 180 96',
      base: 'M24 70c-13 0-24-9-24-20S12 30 26 30c3-12 14-20 28-20 11 0 21 5 26 14 5-3 11-5 17-5 17 0 30 11 32 27 11 1 20 10 20 20 0 12-10 22-22 22H24z',
      lit: [[68, 42, 28, 18], [112, 38, 24, 15]],
      shade: [[54, 60, 24, 11], [96, 64, 30, 10], [138, 58, 20, 9]]
    }
  }
  const shape = shapes[variant] || shapes.a

  return (
    <svg className={className} viewBox={shape.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#f8fafc" stopOpacity="0.88" />
          <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.78" />
        </linearGradient>
        <radialGradient id={`${id}-lit`} cx="40%" cy="28%" r="60%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-30%" y="-40%" width="160%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" />
        </filter>
        <filter id={`${id}-edge`} x="-25%" y="-35%" width="150%" height="170%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" />
        </filter>
      </defs>
      <g filter={`url(#${id}-soft)`}>
        <path d={shape.base} fill={`url(#${id}-fill)`} />
        {shape.lit.map(([cx, cy, rx, ry], i) => (
          <ellipse key={`lit-${i}`} cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id}-lit)`} opacity={i === 0 ? 1 : 0.8} />
        ))}
      </g>
      <g filter={`url(#${id}-edge)`} opacity="0.28">
        {shape.shade.map(([cx, cy, rx, ry], i) => (
          <ellipse key={`shade-${i}`} cx={cx} cy={cy} rx={rx} ry={ry} fill="#cbd5e1" opacity={0.45 + i * 0.08} />
        ))}
      </g>
    </svg>
  )
}

const normalizeStations = (items) => (
  (items || [])
    .map((s, i) => {
      const aqi = stationAqiValue(s)
      const lat = Number(s.latitude)
      const lng = Number(s.longitude)
      if (!Number.isFinite(aqi) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return {
        id: s.uid || s.locationId || `${lat}-${lng}-${i}`,
        lat,
        lng,
        aqi,
        name: s.location || s.city || s.location_slug || 'Station',
        raw: s
      }
    })
    .filter(Boolean)
)

const matchCityRank = (items, cityName) => {
  const needle = String(cityName || '').trim().toLowerCase()
  if (!needle || !items?.length) return null
  const exact = items.find((row) => {
    const city = String(row.city || row.location || '').trim().toLowerCase()
    return city === needle
  })
  if (exact) return exact
  return items.find((row) => {
    const city = String(row.city || row.location || '').trim().toLowerCase()
    return city.includes(needle) || needle.includes(city)
  }) || null
}

const AqiWorkspace = ({ onExpandMap }) => {
  const [place, setPlace] = useState(DEFAULT_PLACE)
  const [searchedPlace, setSearchedPlace] = useState(null)
  const [station, setStation] = useState(null)
  const [nearby, setNearby] = useState([])
  const [weather, setWeather] = useState(null)
  const [rankRow, setRankRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [historySlug, setHistorySlug] = useState(null)
  const [historyRangeId, setHistoryRangeId] = useState('7d')
  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(null)

  const loadAqi = useCallback(async (target) => {
    setLoading(true)
    setError(null)
    try {
      const [bundle, wx, ranks, cityResolved] = await Promise.all([
        fetchSensorBundle(target.latitude, target.longitude),
        fetchWeatherData(target.latitude, target.longitude).catch(() => null),
        fetchTopCitiesRanklist(250).catch(() => ({ items: [] })),
        resolveCityFromCoords(target.latitude, target.longitude).catch(() => null)
      ])

      const stations = normalizeStations(bundle.stations)
      const primary = stations[0] || null
      const cityMeta = bundle.city
      const cityName = target.city
        || cityMeta?.city
        || cityMeta?.location
        || cityResolved?.cityName
        || primary?.name
        || 'Selected place'

      const slugInfo = resolveHistorySlug(cityMeta)
        || resolveHistorySlug(primary?.raw)
        || (cityResolved?.slug
          ? { slug: cityResolved.slug, slugType: cityResolved.slugType, title: cityResolved.title }
          : null)

      setStation(primary?.raw || cityMeta || null)
      setNearby(stations)
      setWeather(wx)
      setRankRow(matchCityRank(ranks.items || [], cityName))
      setHistorySlug(slugInfo)
      setUpdatedAt(new Date())
      setPlace((prev) => ({
        ...prev,
        ...target,
        city: cityName,
        state: target.state || prev.state,
        country: target.country || prev.country
      }))
    } catch (err) {
      setError(err?.message || 'Could not load AQI for this place')
      setStation(null)
      setNearby([])
      setRankRow(null)
      setHistorySlug(null)
      setHistory(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!historySlug?.slug) {
      setHistory(null)
      setHistoryError(null)
      return undefined
    }
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)
    fetchAqiHistory(historyRangeId, {
      slug: historySlug.slug,
      slugType: historySlug.slugType || 'cityId',
      sensorname: 'AQI-IN'
    })
      .then((data) => {
        if (!cancelled) setHistory(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setHistory(null)
          setHistoryError(err?.message || 'Could not load AQI history')
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => { cancelled = true }
  }, [historySlug?.slug, historySlug?.slugType, historyRangeId])

  useEffect(() => {
    let cancelled = false
    setLocating(true)
    resolveStartupPlace()
      .then(async ({ place: startup }) => {
        if (cancelled) return
        setSearchedPlace(null)
        await loadAqi(startup)
      })
      .catch(() => {
        if (!cancelled) return loadAqi(DEFAULT_PLACE)
      })
      .finally(() => {
        if (!cancelled) setLocating(false)
      })
    return () => { cancelled = true }
  }, [loadAqi])

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
    await loadAqi(next)
  }, [loadAqi])

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
            reverseGeocodePlace(latitude, longitude),
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
          await loadAqi(next)
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

  const live = useMemo(() => {
    const aqi = stationAqiValue(station) ?? nearby[0]?.aqi ?? null
    const pm25 = pollutant(station, ['PM2.5', 'pm2_5', 'pm25', 'PM25'])
    const pm10 = pollutant(station, ['PM10', 'pm10'])
    const co = pollutant(station, ['CO', 'co'])
    const so2 = pollutant(station, ['SO2', 'so2'])
    const no2 = pollutant(station, ['NO2', 'no2'])
    const o3 = pollutant(station, ['O3', 'o3', 'Ozone'])
    const label = aqiInLabel(aqi)
    const color = aqiInColor(aqi)
    const tone = bandTone(aqi)
    const stationWeather = station?.weather || {}
    const w = weather || {}
    return {
      aqi,
      pm25,
      pm10,
      co,
      so2,
      no2,
      o3,
      label,
      color,
      tone,
      temp: pickNumber(stationWeather.temp_c, stationWeather.temp, w.temperature, w.temp, w.temp_c),
      humidity: pickNumber(stationWeather.humidity, w.humidity),
      wind: pickNumber(stationWeather.wind_speed, stationWeather.wind, w.wind_speed),
      uv: pickNumber(w.uv_index, w.uv_index_max, w.uvIndex),
      condition: conditionText(
        stationWeather.condition,
        stationWeather.weather,
        w.condition,
        w.weather,
        w.summary
      )
    }
  }, [station, nearby, weather])

  const pollutantCards = useMemo(() => {
    const accentForPm = (v) => {
      if (!Number.isFinite(v)) return '#64748b'
      if (v <= 30) return '#10b981'
      if (v <= 60) return '#f59e0b'
      if (v <= 90) return '#f97316'
      if (v <= 120) return '#ef4444'
      if (v <= 250) return '#8b5cf6'
      return '#7f1d1d'
    }
    const accentForGas = (v) => {
      if (!Number.isFinite(v)) return '#64748b'
      if (v <= 40) return '#10b981'
      if (v <= 80) return '#f59e0b'
      if (v <= 180) return '#f97316'
      if (v <= 280) return '#ef4444'
      return '#8b5cf6'
    }
    const fmt = (v, digits = 0) => {
      if (!Number.isFinite(v)) return '—'
      return digits > 0 ? Number(v).toFixed(digits) : String(Math.round(v))
    }
    return [
      {
        key: 'pm25',
        code: 'PM2.5',
        title: 'Particulate Matter',
        value: fmt(live.pm25),
        unit: 'µg/m³',
        accent: accentForPm(live.pm25),
        alert: Number.isFinite(live.pm25) && live.pm25 > 60,
        icon: 'pm'
      },
      {
        key: 'pm10',
        code: 'PM10',
        title: 'Particulate Matter',
        value: fmt(live.pm10),
        unit: 'µg/m³',
        accent: accentForPm(live.pm10),
        alert: Number.isFinite(live.pm10) && live.pm10 > 100,
        icon: 'pm'
      },
      {
        key: 'co',
        code: 'CO',
        title: 'Carbon Monoxide',
        value: fmt(live.co),
        unit: 'ppb',
        accent: accentForGas(live.co),
        alert: Number.isFinite(live.co) && live.co > 1000,
        icon: 'gas'
      },
      {
        key: 'so2',
        code: 'SO2',
        title: 'Sulfur Dioxide',
        value: fmt(live.so2),
        unit: 'ppb',
        accent: accentForGas(live.so2),
        alert: false,
        icon: 'sink'
      },
      {
        key: 'no2',
        code: 'NO2',
        title: 'Nitrogen Dioxide',
        value: fmt(live.no2),
        unit: 'ppb',
        accent: accentForGas(live.no2),
        alert: false,
        icon: 'sink'
      },
      {
        key: 'o3',
        code: 'O3',
        title: 'Ozone',
        value: fmt(live.o3),
        unit: 'ppb',
        accent: accentForGas(live.o3),
        alert: false,
        icon: 'ozone'
      }
    ]
  }, [live.pm25, live.pm10, live.co, live.so2, live.no2, live.o3])

  const rankCopy = useMemo(() => {
    if (!rankRow?.rank) {
      return {
        badge: null,
        text: loading ? 'Looking up city ranking…' : `Live AQI for ${place.city}`
      }
    }
    return {
      badge: `Rank ${ordinal(rankRow.rank)}`,
      text: `Currently, ${place.city} ranks ${ordinal(rankRow.rank)} among the cities with the highest AQI levels in the world.`
    }
  }, [rankRow, place.city, loading])

  return (
    <div className={`aqi-workspace aqi-workspace--${live.tone}`}>
      <div className="aqi-workspace-ui">
        <div className="aqi-toolbar">
          <div className="aqi-place">
            <strong>{place.city}</strong>
            <span>
              {[place.state, place.country].filter(Boolean).join(', ')}
            </span>
          </div>
          <button
            type="button"
            className="aqi-locate"
            onClick={handleLocate}
            disabled={locating || loading}
          >
            {locating ? 'Locating…' : 'Use my location'}
          </button>
        </div>

        {error && <div className="aqi-error">{error}</div>}

        <div className="aqi-body">
          <section className={`aqi-hero aqi-hero--${live.tone}`} aria-label="Live AQI">
            <div className="aqi-hero-scene" aria-hidden="true">
              <div className="aqi-glow" />
              <div className="aqi-haze" />
              <div className="aqi-sun aqi-sun--pulse" />
              <SoftCloud className="aqi-cloud aqi-cloud--a" variant="a" />
              <SoftCloud className="aqi-cloud aqi-cloud--b" variant="b" />
              <SoftCloud className="aqi-cloud aqi-cloud--c" variant="c" />
              <SoftCloud className="aqi-cloud aqi-cloud--d" variant="a" />
              <svg className="aqi-birds" viewBox="0 0 120 40" preserveAspectRatio="xMidYMid meet">
                <path d="M8 22c4-4 8-4 12 0M6 18c3-3 6-3 9 0" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M34 14c5-5 10-5 14 0M32 10c3.5-3.5 7-3.5 10 0" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M58 20c3.5-3.5 7-3.5 10.5 0" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M78 12c4-4 8-4 12 0M76 8c3-3 6-3 9 0" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M102 18c3-3 6-3 9 0" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <img
                className="aqi-skyline"
                src={cityBgUrl(place.city)}
                alt=""
                draggable={false}
                onError={(e) => {
                  if (e.currentTarget.dataset.fallback === '1') return
                  e.currentTarget.dataset.fallback = '1'
                  e.currentTarget.src = cityBgUrl('mumbai')
                }}
              />
              <div className="aqi-ground-fade" />
            </div>

            <div className="aqi-hero-main">
              <p className="aqi-hero-kicker">
                <span className="aqi-live-dot" />
                Live AQI
              </p>
              <div className="aqi-hero-value-row">
                <span className="aqi-hero-value">
                  {loading && live.aqi == null ? '—' : live.aqi != null ? Math.round(live.aqi) : '—'}
                </span>
                <span className="aqi-hero-unit">AQI (IN)</span>
              </div>

              <div className="aqi-hero-status-pill">
                Air Quality is <strong style={{ color: live.color }}>{live.label}</strong>
              </div>

              <div className="aqi-pm-row">
                <div className="aqi-pm">
                  <span>PM2.5 :</span>
                  <strong>{live.pm25 != null ? Math.round(live.pm25) : '—'}</strong>
                  <em>µg/m³</em>
                </div>
                <div className="aqi-pm">
                  <span>PM10 :</span>
                  <strong>{live.pm10 != null ? Math.round(live.pm10) : '—'}</strong>
                  <em>µg/m³</em>
                </div>
              </div>

              <div className="aqi-scale" aria-hidden="true">
                <div className="aqi-scale-track">
                  {AQI_SCALE.map((seg) => (
                    <span key={seg.key} style={{ background: seg.color }} title={seg.label} />
                  ))}
                  <span className="aqi-scale-thumb" style={{ left: scaleThumbPct(live.aqi) }} />
                </div>
                <div className="aqi-scale-labels">
                  <span>0</span>
                  <span>50</span>
                  <span>100</span>
                  <span>150</span>
                  <span>200</span>
                  <span>300</span>
                  <span>500+</span>
                </div>
                <div className="aqi-scale-cats">
                  {AQI_SCALE.map((seg) => (
                    <span key={seg.key}>{seg.label}</span>
                  ))}
                </div>
              </div>

              {updatedAt && (
                <p className="aqi-updated">
                  Updated {format(updatedAt, 'h:mm a')}
                  {station?.isOnline === false ? ' · Station offline' : ''}
                </p>
              )}
            </div>

            <aside className="aqi-weather-card" aria-label="Weather">
              <div className="aqi-weather-sun" aria-hidden="true" />
              <div className="aqi-weather-top">
                <div className="aqi-weather-icon" aria-hidden="true">
                  <svg viewBox="0 0 48 48" width="40" height="40">
                    <circle cx="30" cy="16" r="8" fill="#fbbf24" />
                    <ellipse cx="20" cy="28" rx="12" ry="8" fill="#93c5fd" />
                    <circle cx="12" cy="26" r="6" fill="#60a5fa" />
                    <circle cx="24" cy="24" r="7" fill="#bfdbfe" />
                  </svg>
                </div>
                <div className="aqi-weather-temp">
                  <strong>
                    {live.temp != null ? `${Math.round(live.temp)}` : '—'}
                    <small>°c</small>
                  </strong>
                </div>
                <span className="aqi-weather-cond">{live.condition}</span>
                {onExpandMap && (
                  <button
                    type="button"
                    className="aqi-weather-expand"
                    onClick={onExpandMap}
                    title="Open full map"
                    aria-label="Open full map"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M12 19V5" />
                      <path d="M5 12l7-7 7 7" />
                    </svg>
                  </button>
                )}
              </div>
              <ul className="aqi-weather-stats">
                <li>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M12 3c0 0-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z" fill="#38bdf8" />
                  </svg>
                  <strong>{live.humidity != null ? `${Math.round(live.humidity)} %` : '—'}</strong>
                </li>
                <li>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M3 12h12M5 8h10M7 16h8" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" fill="none" />
                  </svg>
                  <strong>{live.wind != null ? `${Number(live.wind).toFixed(1)} km/h` : '—'}</strong>
                </li>
                <li>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" fill="#fbbf24" />
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
                      <line
                        key={d}
                        x1="12"
                        y1="12"
                        x2={12 + Math.cos((d * Math.PI) / 180) * 9}
                        y2={12 + Math.sin((d * Math.PI) / 180) * 9}
                        stroke="#f59e0b"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    ))}
                  </svg>
                  <strong>{live.uv != null ? Number(live.uv).toFixed(1) : '—'}</strong>
                </li>
              </ul>
            </aside>
          </section>

          <div className="aqi-side">
            <AqiMiniMap
              latitude={place.latitude}
              longitude={place.longitude}
              label={place.city}
              stations={nearby}
              selectedPlace={searchedPlace}
              onPlaceSelect={handlePlaceSearch}
              onExpand={onExpandMap}
            />
          </div>
        </div>

        <div className="aqi-pollutant-row" aria-label="Pollutant levels">
          {pollutantCards.map((card) => (
            <button
              key={card.key}
              type="button"
              className={`aqi-pollutant-card${card.alert ? ' aqi-pollutant-card--alert' : ''}`}
              style={{ '--aqi-pollutant-accent': card.accent }}
            >
              {card.alert && (
                <span className="aqi-pollutant-alert" title="Elevated level" aria-label="Elevated">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 8v5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
                    <circle cx="12" cy="17" r="1.3" fill="#fff" />
                  </svg>
                </span>
              )}
              <span className="aqi-pollutant-icon" aria-hidden="true">
                {card.icon === 'pm' && (
                  <svg viewBox="0 0 48 48" width="36" height="36">
                    <path d="M16 30c-4.5 0-8-3-8-7s3.5-7 8-7c1-.5 2.2-.8 3.5-.8 2.2-4 6.4-6.7 11.2-6.7 7 0 12.3 5.2 12.8 11.8 3.2.6 5.5 3.4 5.5 6.7 0 3.8-3.1 6.9-7 6.9H16z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    <circle cx="18" cy="26" r="1.4" fill="currentColor" />
                    <circle cx="24" cy="22" r="1.1" fill="currentColor" />
                    <circle cx="29" cy="27" r="1.3" fill="currentColor" />
                    <text x="24" y="20" textAnchor="middle" fill="currentColor" fontSize="7.2" fontWeight="700" fontFamily="Sora,sans-serif">{card.code}</text>
                  </svg>
                )}
                {card.icon === 'gas' && (
                  <svg viewBox="0 0 48 48" width="36" height="36">
                    <path d="M16 31c-4.5 0-8-3-8-7s3.5-7 8-7c1-.5 2.2-.8 3.5-.8 2.2-4 6.4-6.7 11.2-6.7 7 0 12.3 5.2 12.8 11.8 3.2.6 5.5 3.4 5.5 6.7 0 3.8-3.1 6.9-7 6.9H16z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    <text x="24" y="27" textAnchor="middle" fill="currentColor" fontSize="9" fontWeight="700" fontFamily="Sora,sans-serif">{card.code}</text>
                  </svg>
                )}
                {card.icon === 'sink' && (
                  <svg viewBox="0 0 48 48" width="36" height="36">
                    <path d="M16 28c-4.5 0-8-3-8-7s3.5-7 8-7c1-.5 2.2-.8 3.5-.8 2.2-4 6.4-6.7 11.2-6.7 7 0 12.3 5.2 12.8 11.8 3.2.6 5.5 3.4 5.5 6.7 0 3.8-3.1 6.9-7 6.9H16z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    <path d="M18 32v6M24 31v7M30 32v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <path d="M16 38h4M22 38h4M28 38h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <text x="24" y="24" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="700" fontFamily="Sora,sans-serif">{card.code}</text>
                  </svg>
                )}
                {card.icon === 'ozone' && (
                  <svg viewBox="0 0 48 48" width="36" height="36">
                    <path d="M16 30c-4.5 0-8-3-8-7s3.5-7 8-7c1-.5 2.2-.8 3.5-.8 2.2-4 6.4-6.7 11.2-6.7 7 0 12.3 5.2 12.8 11.8 3.2.6 5.5 3.4 5.5 6.7 0 3.8-3.1 6.9-7 6.9H16z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    <circle cx="17" cy="26" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <circle cx="24" cy="23" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <circle cx="31" cy="27" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <text x="24" y="18" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="700" fontFamily="Sora,sans-serif">{card.code}</text>
                  </svg>
                )}
              </span>
              <span className="aqi-pollutant-copy">
                <span className="aqi-pollutant-code">{card.code}</span>
                <span className="aqi-pollutant-title">{card.title}</span>
              </span>
              <span className="aqi-pollutant-reading">
                <strong>{loading && card.value === '—' ? '…' : card.value}</strong>
                <em>{card.unit}</em>
              </span>
              <span className="aqi-pollutant-chevron" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
            </button>
          ))}
        </div>

        <section className="aqi-history-panel" aria-label="AQI history chart">
          <div className="aqi-history-summary">
            <div className="aqi-history-summary-left">
              <span className="aqi-history-chip">
                <span className="aqi-history-chip-dot" />
                {place.city}
              </span>
              <label className="aqi-history-range">
                <span className="sr-only">History range</span>
                <select
                  value={historyRangeId}
                  onChange={(event) => setHistoryRangeId(event.target.value)}
                  aria-label="History range"
                >
                  {HISTORY_RANGE_ORDER.map((id) => (
                    <option key={id} value={id}>{HISTORY_RANGES[id].label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="aqi-history-extremes">
              <div
                className="aqi-history-extreme"
                style={{ '--extreme-color': aqiInColor(history?.minValue) }}
              >
                <strong>
                  {historyLoading ? '…' : history?.minValue != null ? Math.round(history.minValue) : '—'}
                </strong>
                <div>
                  <span>↓ Min. AQI (IN)</span>
                  <small>{formatExtremeTime(history?.minPoint?.time)}</small>
                </div>
              </div>
              <div
                className="aqi-history-extreme"
                style={{ '--extreme-color': aqiInColor(history?.maxValue) }}
              >
                <strong>
                  {historyLoading ? '…' : history?.maxValue != null ? Math.round(history.maxValue) : '—'}
                </strong>
                <div>
                  <span>↑ Max. AQI (IN)</span>
                  <small>{formatExtremeTime(history?.maxPoint?.time)}</small>
                </div>
              </div>
            </div>
          </div>

          <div className="aqi-history-plot">
            {historyLoading && (
              <p className="aqi-history-note">
                Loading {HISTORY_RANGES[historyRangeId]?.label || 'AQI'} history…
              </p>
            )}
            {historyError && <p className="aqi-history-error">{historyError}</p>}
            {!historyLoading && !historyError && !(history?.points?.length) && (
              <p className="aqi-history-note">No history points for this city.</p>
            )}
            {!historyLoading && !historyError && history?.points?.length > 0 && (
              <ResponsiveContainer width="100%" height="100%" minHeight={160}>
                <BarChart data={history.points} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    domain={[0, 'auto']}
                    label={{
                      value: 'AQI (IN)',
                      angle: -90,
                      position: 'insideLeft',
                      fill: 'rgba(255,255,255,0.45)',
                      fontSize: 10
                    }}
                  />
                  <Tooltip
                    content={<HistoryTooltip placeName={place.city} />}
                    cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                  />
                  <Bar dataKey="aqi" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false}>
                    {history.points.map((point) => (
                      <Cell key={`${point.time}-${point.index}`} fill={point.color || '#38bdf8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="aqi-history-footer">
            <span>{history?.startLabel || ''}</span>
            <span>Time</span>
            <span>{history?.endLabel || ''}</span>
          </div>
        </section>

        <footer className="aqi-rank-bar" aria-label="City AQI ranking">
          {rankCopy.badge && <span className="aqi-rank-badge">{rankCopy.badge}</span>}
          <p>{rankCopy.text}</p>
        </footer>
      </div>
    </div>
  )
}

export default AqiWorkspace
