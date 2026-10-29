import { useEffect, useState } from 'react'
import './WeatherConditionStrip.css'

const DIR = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

const useCountUp = (target, { duration = 900, enabled = true } = {}) => {
  const [value, setValue] = useState(null)

  useEffect(() => {
    if (!enabled || target == null || !Number.isFinite(Number(target))) {
      setValue(target == null ? null : Number(target))
      return undefined
    }

    const end = Number(target)
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    if (reduceMotion) {
      setValue(end)
      return undefined
    }

    setValue(0)
    let frame = 0
    const start = performance.now()

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      setValue(end * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, enabled])

  return value
}

const windDirLabel = (deg) => {
  if (deg == null || !Number.isFinite(deg)) return '—'
  return DIR[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}

const uvBand = (uv) => {
  if (uv == null) return { label: '—', tip: 'UV unavailable for this location.' }
  if (uv < 3) return { label: 'Low', tip: `The present UV index is ${Number(uv).toFixed(1)}, consider suggestions for the same!` }
  if (uv < 6) return { label: 'Moderate', tip: `The present UV index is ${Number(uv).toFixed(1)}, sunscreen is recommended.` }
  if (uv < 8) return { label: 'High', tip: `The present UV index is ${Number(uv).toFixed(1)}, limit midday sun exposure.` }
  if (uv < 11) return { label: 'Very High', tip: `The present UV index is ${Number(uv).toFixed(1)}, seek shade outdoors.` }
  return { label: 'Extreme', tip: `The present UV index is ${Number(uv).toFixed(1)}, avoid outdoor exposure.` }
}

const fmt = (n, digits = 0) => (n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(digits))

const ScaleBar = ({ pct, ready = true }) => {
  const clamped = Math.min(100, Math.max(0, pct ?? 0))
  return (
    <div className={`wcs-scale${ready ? ' is-ready' : ''}`}>
      <span className="wcs-scale-fill" style={{ '--scale-pct': `${clamped}%` }} />
      <span className="wcs-scale-thumb" style={{ '--scale-pct': `${clamped}%` }} />
    </div>
  )
}

const Compass = ({ deg, label }) => (
  <div className="wcs-compass" aria-hidden="true">
    <svg viewBox="0 0 88 88" width="88" height="88">
      <circle cx="44" cy="44" r="40" fill="#1e293b" stroke="#64748b" strokeWidth="3" />
      <circle cx="44" cy="44" r="34" fill="none" stroke="#334155" strokeWidth="2" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = ((a - 90) * Math.PI) / 180
        const x1 = 44 + Math.cos(rad) * 28
        const y1 = 44 + Math.sin(rad) * 28
        const x2 = 44 + Math.cos(rad) * 33
        const y2 = 44 + Math.sin(rad) * 33
        return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="2" />
      })}
      <g transform={`rotate(${Number(deg) || 0} 44 44)`}>
        <polygon points="44,12 50,44 44,38 38,44" fill="#38bdf8" />
        <polygon points="44,76 50,44 44,50 38,44" fill="#94a3b8" />
      </g>
      <circle cx="44" cy="44" r="5" fill="#e2e8f0" />
    </svg>
    <em>{label}</em>
  </div>
)

const WindTurbine = () => (
  <div className="wcs-turbine" aria-hidden="true">
    <svg viewBox="0 0 72 110" width="52" height="80">
      <defs>
        <linearGradient id="wcsTowerGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="35%" stopColor="#f1f5f9" />
          <stop offset="70%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
        <linearGradient id="wcsNacelleGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id="wcsBladeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#64748b" />
          <stop offset="30%" stopColor="#f8fafc" />
          <stop offset="70%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        <radialGradient id="wcsHubGrad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#64748b" />
        </radialGradient>
        <filter id="wcsTurbineShadow" x="-20%" y="-10%" width="140%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.4" floodColor="#0f172a" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* ground contact shadow */}
      <ellipse cx="36" cy="104" rx="10" ry="2.4" fill="rgba(15,23,42,0.35)" />

      {/* tapered tower */}
      <path
        d="M32 48 L40 48 L42.5 102 L29.5 102 Z"
        fill="url(#wcsTowerGrad)"
        filter="url(#wcsTurbineShadow)"
      />
      <path d="M33.2 52 L38.8 52 L39.4 78 L32.6 78 Z" fill="rgba(255,255,255,0.22)" />

      {/* nacelle */}
      <g filter="url(#wcsTurbineShadow)">
        <rect x="28" y="40" width="22" height="11" rx="4" fill="url(#wcsNacelleGrad)" />
        <rect x="46" y="42.5" width="8" height="6" rx="2" fill="#94a3b8" />
        <circle cx="31" cy="45.5" r="1.2" fill="#334155" opacity="0.5" />
      </g>

      {/* spinning rotor */}
      <g transform="translate(30 45.5)">
        <g className="wcs-turbine-rotor">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0"
            to="360"
            dur="3.8s"
            repeatCount="indefinite"
          />
          {[0, 120, 240].map((deg) => (
            <g key={deg} transform={`rotate(${deg})`}>
              <path
                d="M0 0
                   C 2 -6, 3 -18, 2.2 -34
                   C 1.4 -40, 0.2 -44, 0 -46
                   C -0.2 -44, -1.4 -40, -2.2 -34
                   C -3 -18, -2 -6, 0 0 Z"
                fill="url(#wcsBladeGrad)"
              />
              <path
                d="M0.15 0 C1.2 -8, 1.5 -22, 0.9 -38"
                stroke="rgba(255,255,255,0.45)"
                strokeWidth="0.7"
                fill="none"
                strokeLinecap="round"
              />
            </g>
          ))}
          <circle r="4.2" fill="url(#wcsHubGrad)" />
          <circle r="1.6" fill="#334155" />
        </g>
      </g>
    </svg>
  </div>
)

const GustTree = () => (
  <div className="wcs-gust-scene" aria-hidden="true">
    <svg className="wcs-gust-wind" viewBox="0 0 140 70" preserveAspectRatio="none">
      <path className="wcs-gust-streak wcs-gust-streak--1" d="M4 18 C28 14, 48 20, 72 16" />
      <path className="wcs-gust-streak wcs-gust-streak--2" d="M0 32 C30 28, 55 36, 88 30" />
      <path className="wcs-gust-streak wcs-gust-streak--3" d="M10 46 C34 42, 58 50, 82 44" />
      <path className="wcs-gust-streak wcs-gust-streak--4" d="M78 22 C98 18, 118 24, 138 20" />
      <path className="wcs-gust-streak wcs-gust-streak--5" d="M70 40 C96 36, 116 44, 140 38" />
    </svg>
    <div className="wcs-gust-tree-wrap">
      <img
        className="wcs-gust-tree"
        src="/weather/gust-tree.png?v=2"
        alt=""
        draggable={false}
      />
      <span className="wcs-gust-leaf wcs-gust-leaf--a" />
      <span className="wcs-gust-leaf wcs-gust-leaf--b" />
      <span className="wcs-gust-leaf wcs-gust-leaf--c" />
    </div>
  </div>
)

/** Cel-shaded cumulus cluster — white highlight / pale blue / blue-grey shadow. */
const Cumulus = ({ className = '', transform = '' }) => (
  <g className={className} transform={transform}>
    {/* base shadow body */}
    <ellipse cx="70" cy="48" rx="52" ry="28" fill="#9eb6c8" />
    <ellipse cx="38" cy="44" rx="34" ry="24" fill="#8eabc0" />
    <ellipse cx="108" cy="46" rx="36" ry="26" fill="#a7becf" />
    {/* mid tone */}
    <ellipse cx="70" cy="40" rx="48" ry="24" fill="#c9dce8" />
    <ellipse cx="42" cy="36" rx="30" ry="20" fill="#bdd4e2" />
    <ellipse cx="102" cy="38" rx="32" ry="22" fill="#d0e2ed" />
    {/* bright lobes */}
    <ellipse cx="28" cy="28" rx="20" ry="16" fill="#eef6fb" />
    <ellipse cx="54" cy="22" rx="24" ry="18" fill="#ffffff" />
    <ellipse cx="82" cy="24" rx="22" ry="17" fill="#f5fafd" />
    <ellipse cx="110" cy="30" rx="20" ry="15" fill="#e8f2f8" />
    <ellipse cx="68" cy="30" rx="18" ry="14" fill="#ffffff" />
    {/* underside shade pockets */}
    <ellipse cx="48" cy="52" rx="22" ry="10" fill="#7f9fb6" opacity="0.85" />
    <ellipse cx="90" cy="54" rx="24" ry="10" fill="#7a9ab2" opacity="0.8" />
  </g>
)

const CloudBanner = () => (
  <div className="wcs-cloud-banner" aria-hidden="true">
    <div className="wcs-cloud-track">
      <img className="wcs-cloud-banner-img" src="/weather/cloud-banner.png" alt="" draggable={false} />
      <img className="wcs-cloud-banner-img" src="/weather/cloud-banner.png" alt="" draggable={false} />
    </div>
    <svg className="wcs-cloud-banner-svg" viewBox="0 0 840 90" preserveAspectRatio="xMidYMax slice">
      <g className="wcs-cloud-svg-track">
        <Cumulus transform="translate(-10 8) scale(1.05)" />
        <Cumulus transform="translate(95 0) scale(0.92)" />
        <Cumulus transform="translate(200 10) scale(1)" />
        <Cumulus transform="translate(300 -2) scale(0.85)" />
        <Cumulus transform="translate(355 18) scale(0.7)" />
        <Cumulus transform="translate(410 8) scale(1.05)" />
        <Cumulus transform="translate(515 0) scale(0.92)" />
        <Cumulus transform="translate(620 10) scale(1)" />
        <Cumulus transform="translate(720 -2) scale(0.85)" />
        <Cumulus transform="translate(775 18) scale(0.7)" />
      </g>
    </svg>
  </div>
)

const RainIcon = () => (
  <div className="wcs-rain-scene" aria-hidden="true">
    <svg className="wcs-rain-icon" viewBox="0 0 72 72" width="64" height="64">
      <defs>
        <radialGradient id="wcsRainSunCore" cx="38%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="45%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
        <radialGradient id="wcsRainSunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(251, 191, 36, 0.55)" />
          <stop offset="70%" stopColor="rgba(251, 191, 36, 0.12)" />
          <stop offset="100%" stopColor="rgba(251, 191, 36, 0)" />
        </radialGradient>
        <linearGradient id="wcsRainCloudHi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#e8f1f8" />
          <stop offset="100%" stopColor="#b6c9d8" />
        </linearGradient>
        <linearGradient id="wcsRainCloudShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d7e4ee" />
          <stop offset="100%" stopColor="#8fa8bb" />
        </linearGradient>
        <linearGradient id="wcsRainDropGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="40%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
        <filter id="wcsRainSoft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
      </defs>

      {/* soft sun bloom */}
      <circle className="wcs-rain-sun-glow" cx="50" cy="18" r="16" fill="url(#wcsRainSunGlow)" />

      {/* sun + rays */}
      <g className="wcs-rain-sun">
        <g className="wcs-rain-rays">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line
              key={deg}
              x1="50"
              y1="18"
              x2={50 + Math.cos((deg * Math.PI) / 180) * 13}
              y2={18 + Math.sin((deg * Math.PI) / 180) * 13}
              stroke="#fbbf24"
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.8"
            />
          ))}
        </g>
        <circle cx="50" cy="18" r="7.5" fill="url(#wcsRainSunCore)" />
        <circle cx="47.5" cy="15.5" r="2.2" fill="rgba(255,255,255,0.55)" />
      </g>

      {/* layered cloud */}
      <g className="wcs-rain-cloud">
        <ellipse cx="28" cy="34" rx="20" ry="11" fill="url(#wcsRainCloudShade)" opacity="0.9" />
        <ellipse cx="16" cy="31" rx="11" ry="9" fill="url(#wcsRainCloudShade)" />
        <ellipse cx="40" cy="31" rx="12" ry="10" fill="url(#wcsRainCloudHi)" />
        <ellipse cx="28" cy="28" rx="15" ry="10" fill="url(#wcsRainCloudHi)" />
        <ellipse cx="20" cy="27" rx="8" ry="7" fill="#ffffff" opacity="0.92" />
        <ellipse cx="34" cy="26" rx="9" ry="7" fill="#ffffff" />
        <ellipse cx="24" cy="36" rx="10" ry="4" fill="#7f9fb6" opacity="0.35" filter="url(#wcsRainSoft)" />
      </g>

      {/* teardrop rain */}
      <g className="wcs-rain-drops">
        {[
          { cls: 'wcs-rain-drop--1', x: 16, y: 40 },
          { cls: 'wcs-rain-drop--2', x: 26, y: 38 },
          { cls: 'wcs-rain-drop--3', x: 35, y: 41 },
          { cls: 'wcs-rain-drop--4', x: 21, y: 44 },
          { cls: 'wcs-rain-drop--5', x: 31, y: 43 }
        ].map((d) => (
          <path
            key={d.cls}
            className={`wcs-rain-drop ${d.cls}`}
            d={`M${d.x} ${d.y}
               c -0.2 1.6, -1.4 3.4, -1.4 5.2
               a 1.55 1.55 0 1 0 3.1 0
               c 0 -1.8, -1.3 -3.6, -1.7 -5.2 z`}
            fill="url(#wcsRainDropGrad)"
          />
        ))}
      </g>

      {/* ground splashes */}
      <g className="wcs-rain-splashes" fill="none" stroke="#7dd3fc" strokeWidth="1.2" strokeLinecap="round">
        <ellipse className="wcs-rain-splash wcs-rain-splash--1" cx="18" cy="60" rx="3" ry="1.2" />
        <ellipse className="wcs-rain-splash wcs-rain-splash--2" cx="28" cy="61" rx="3.4" ry="1.3" />
        <ellipse className="wcs-rain-splash wcs-rain-splash--3" cx="37" cy="59.5" rx="2.8" ry="1.1" />
      </g>
    </svg>
    <span className="wcs-rain-mist" />
  </div>
)

const PressureGauge = ({ pct, ready = false }) => {
  const clamped = Math.min(100, Math.max(0, pct ?? 50))
  /* CSS rotate: 0% = -90deg (left), 100% = +90deg (right) */
  return (
    <div
      className={`wcs-pressure-gauge${ready ? ' is-ready' : ''}`}
      style={{ '--pressure-pct': clamped }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 60" width="96" height="58">
        <defs>
          <linearGradient id="wcsArcGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="35%" stopColor="#eab308" />
            <stop offset="65%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <filter id="wcsPressureGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d="M14 52 A36 36 0 0 1 86 52" fill="none" stroke="#334155" strokeWidth="10" strokeLinecap="round" />
        <path
          className="wcs-pressure-arc"
          d="M14 52 A36 36 0 0 1 86 52"
          fill="none"
          stroke="url(#wcsArcGrad)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <g className="wcs-pressure-needle" filter="url(#wcsPressureGlow)">
          <line x1="50" y1="52" x2="50" y2="24" stroke="#f8fafc" strokeWidth="3" strokeLinecap="round" />
          <circle cx="50" cy="52" r="4.5" fill="#f8fafc" />
          <circle cx="50" cy="52" r="2" fill="#ef4444" />
        </g>
      </svg>
    </div>
  )
}

const UvSunIcon = () => (
  <div className="wcs-uv-icon" aria-hidden="true">
    <svg viewBox="0 0 48 48" width="34" height="34">
      <defs>
        <radialGradient id="wcsUvSun" cx="38%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="55%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
      </defs>
      <g className="wcs-uv-rays">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <line
            key={deg}
            x1="24"
            y1="24"
            x2={24 + Math.cos((deg * Math.PI) / 180) * 18}
            y2={24 + Math.sin((deg * Math.PI) / 180) * 18}
            stroke="#fde68a"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        ))}
      </g>
      <circle className="wcs-uv-core" cx="24" cy="24" r="9" fill="url(#wcsUvSun)" />
      <circle cx="21" cy="21" r="2.4" fill="rgba(255,255,255,0.55)" />
    </svg>
  </div>
)

/**
 * Single dark-glass metrics grid for the active place (locate / search).
 * Includes AQI + humidity alongside wind/gust/cloud/precip/pressure/UV.
 */
const WeatherConditionStrip = ({
  city,
  metrics,
  loading = false,
  aqiVal = null,
  aqiBand = { label: '—', note: '', tone: 'unknown' },
  humidity = null,
  humidityNote = '',
  aqiNeedle = 15
}) => {
  const m = metrics || {}
  const uv = uvBand(m.uvIndex)
  const dir = windDirLabel(m.windDirection)
  const gustMs =
    m.windGusts == null ? null : m.windGusts > 60 ? m.windGusts * 0.277778 : m.windGusts
  const pressurePct =
    m.pressure == null ? 50 : ((m.pressure - 980) / (1040 - 980)) * 100
  const uvPct = m.uvIndex == null ? 0 : (m.uvIndex / 11) * 100
  const visKm =
    m.visibility == null
      ? null
      : m.visibility > 100
        ? m.visibility / 1000
        : m.visibility

  const [needleReady, setNeedleReady] = useState(false)
  const [metersReady, setMetersReady] = useState(false)
  const animatedAqi = useCountUp(aqiVal, { duration: 1100, enabled: !loading })
  const animatedHumidity = useCountUp(humidity, { duration: 1000, enabled: !loading })
  const animatedPrecip = useCountUp(m.precipitation, { duration: 950, enabled: !loading })
  const animatedPressure = useCountUp(m.pressure, { duration: 1100, enabled: !loading })
  const animatedUv = useCountUp(m.uvIndex, { duration: 1000, enabled: !loading })

  useEffect(() => {
    setNeedleReady(false)
    const id = requestAnimationFrame(() => setNeedleReady(true))
    return () => cancelAnimationFrame(id)
  }, [aqiNeedle, aqiVal])

  useEffect(() => {
    setMetersReady(false)
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setMetersReady(true))
    })
    return () => cancelAnimationFrame(id)
  }, [pressurePct, uvPct, m.pressure, m.uvIndex])

  return (
    <section className="wcs" aria-label={`Conditions for ${city || 'selected location'}`}>
      <div className="wcs-head">
        <h2>Conditions for {city || 'this location'}</h2>
        <p>Updates when you locate or search a place</p>
      </div>

      {loading && !metrics ? (
        <div className="wcs-loading">Loading conditions…</div>
      ) : (
        <div className="wcs-grid">
          <article className="wcs-card wcs-card--wind">
            <Compass deg={m.windDirection} label={dir} />
            <div className="wcs-stat">
              <strong>
                {fmt(m.windDirection, 0)}° {dir}
              </strong>
              <span>Direction</span>
            </div>
            <WindTurbine />
            <div className="wcs-stat">
              <strong>{fmt(m.windSpeed, 1)} km/h</strong>
              <span>Wind Speed</span>
            </div>
          </article>

          <article className="wcs-card wcs-card--gust ">
            <GustTree />
            <div className="wcs-stat wcs-stat--center">
              <span>Gust Speed</span>
              <strong>{fmt(gustMs, 1)} m/s</strong>
            </div>
          </article>

          <article className="wcs-card wcs-card--cloud">
            <CloudBanner />
            <div className="wcs-cloud-row" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '28px', paddingTop: '2px', position: 'relative', zIndex: 2}}>
              <div className="wcs-stat">
                <span>Cloud Cover</span>
                <strong>{fmt(m.cloudCover, 0)} %</strong>
              </div>
              <div className="wcs-divider" />
              <div className="wcs-stat">
                <span>Visibility</span>
                <strong>{fmt(visKm, 0)} km</strong>
              </div>
            </div>
          </article>

          <article className="wcs-card wcs-card--aqi wcs-card--animated">
            <div
              className={`wcs-aqi-meter${needleReady ? ' is-ready' : ''}`}
              style={{ '--aqi-pct': `${aqiNeedle}%` }}
            >
              <div className="wcs-aqi-arc" />
              <div className="wcs-aqi-glow" aria-hidden="true" />
              <div className="wcs-aqi-needle" />
              <div className="wcs-aqi-readout">
                <strong>{animatedAqi != null ? Math.round(animatedAqi) : '—'}</strong>
                <em>AQI</em>
              </div>
            </div>
            <div className="wcs-stat wcs-stat--center">
              <span className={`wcs-aqi-band wcs-aqi-band--${aqiBand.tone}`}>{aqiBand.label}</span>
              <p>{aqiBand.note}</p>
            </div>
          </article>

          <article className="wcs-card wcs-card--precip wcs-card--animated wcs-card--animated-delay-2">
            <RainIcon />
            <div className="wcs-precip-body">
              <div className="wcs-stat">
                <span>Precipitation</span>
                <strong>
                  {animatedPrecip != null ? `${Math.round(animatedPrecip)} mm` : '— mm'}
                </strong>
              </div>
              <p>
                Current precipitation chances sit at{' '}
                {animatedPrecip != null ? `${Math.round(animatedPrecip)}mm` : '—'}
              </p>
            </div>
          </article>

          <article className="wcs-card wcs-card--pressure wcs-card--animated wcs-card--animated-delay-3">
            <PressureGauge pct={pressurePct} ready={metersReady} />
            <div className="wcs-pressure-body">
              <div className="wcs-stat">
                <span>Pressure</span>
                <strong>
                  {animatedPressure != null ? `${Math.round(animatedPressure)} mb` : '— mb'}
                </strong>
              </div>
              <ScaleBar pct={pressurePct} ready={metersReady} />
              <p>
                Current pressure level is a{' '}
                {animatedPressure != null ? `${Math.round(animatedPressure)}mb` : '—'}.
              </p>
            </div>
          </article>

          <article className="wcs-card wcs-card--uv wcs-card--animated wcs-card--animated-delay-4">
            <div className="wcs-uv-row">
              <UvSunIcon />
              <div className="wcs-stat">
                <span>UV Index</span>
                <strong>
                  {animatedUv != null ? Number(animatedUv).toFixed(1) : '—'} {uv.label}
                </strong>
              </div>
            </div>
            <ScaleBar pct={uvPct} ready={metersReady} />
            <p>{uv.tip}</p>
          </article>

          <article className="wcs-card wcs-card--humidity wcs-card--animated">
            <div className="wcs-humidity-icon" aria-hidden="true">
              <span className="wcs-humidity-ripple" />
              <svg viewBox="0 0 48 48" width="36" height="36">
                <path
                  className="wcs-humidity-drop"
                  d="M24 6C24 6 10 22 10 30a14 14 0 0 0 28 0C38 22 24 6 24 6z"
                  fill="#38bdf8"
                />
                <path d="M20 30c0 4 2.5 7 6 7" stroke="#e0f2fe" strokeWidth="2" fill="none" />
              </svg>
            </div>
            <div className="wcs-stat wcs-stat--center">
              <span>Humidity</span>
              <strong>{animatedHumidity != null ? `${Math.round(animatedHumidity)}%` : '—'}</strong>
              <p>{humidityNote}</p>
            </div>
          </article>
        </div>
      )}
    </section>
  )
}

export default WeatherConditionStrip
