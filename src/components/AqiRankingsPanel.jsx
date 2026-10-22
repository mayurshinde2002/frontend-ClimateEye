import { useEffect, useMemo, useRef, useState } from 'react'
import { aqiInColor, aqiInLabel, fetchIndiaCityRanklist } from '../services/aqiInApi'
import { useLeafletSafeOverlay } from '../hooks/useLeafletSafeOverlay'

const WHO_PM25_STANDARD = 15
const AQI_STANDARD = 50

const finite = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const timesAboveStandard = (row) => {
  const pm25 = finite(row.pm25)
  if (pm25 != null && pm25 > 0) {
    return Math.max(1, Math.round(pm25 / WHO_PM25_STANDARD))
  }
  const aqi = finite(row.aqi)
  if (aqi == null || aqi <= 0) return null
  return Math.max(1, Math.round(aqi / AQI_STANDARD))
}

const placeLabel = (row) => {
  const parts = [row.city || row.location, row.state, 'India'].filter(Boolean)
  // Avoid "India, India" if country already present
  const unique = []
  parts.forEach((part) => {
    if (!unique.some((item) => item.toLowerCase() === String(part).toLowerCase())) {
      unique.push(part)
    }
  })
  return unique.join(', ')
}

const titleName = (row) => row.city || row.location || '—'

const AqiArc = ({ aqi, color }) => {
  const value = Math.max(0, Math.min(500, Number(aqi) || 0))
  const t = value / 500
  const angle = Math.PI * (1 - t)
  const x = 18 + 14 * Math.cos(angle)
  const y = 20 - 14 * Math.sin(angle)
  return (
    <svg className="aqi-rank-arc" viewBox="0 0 36 24" width="36" height="24" aria-hidden>
      <path
        d="M4 20 A14 14 0 0 1 32 20"
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d={`M4 20 A14 14 0 0 1 ${x} ${y}`}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <text x="18" y="22" textAnchor="middle" className="aqi-rank-arc-text" fill={color}>
        {Number.isFinite(Number(aqi)) ? Math.round(aqi) : '—'}
      </text>
    </svg>
  )
}

const AqiRankingsPanel = ({ open, onClose, onSelectCity }) => {
  const overlayRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [items, setItems] = useState([])
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchIndiaCityRanklist(30)
      .then((data) => {
        if (cancelled) return
        setItems(data.items || [])
        setUpdatedAt(data.fetchedAt || new Date().toISOString())
      })
      .catch((err) => {
        if (cancelled) return
        setItems([])
        setError(err.message || 'Could not load rankings')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [open])

  const rows = useMemo(() => items.slice(0, 30), [items])

  useLeafletSafeOverlay(overlayRef, open)

  if (!open) return null

  const stamp = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
    : ''

  return (
    <div
      ref={overlayRef}
      className="aqi-rank-overlay leaflet-control"
      role="dialog"
      aria-label="AQI rankings"
      onWheel={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="aqi-rank-card">
        <div className="aqi-rank-tabs">
          <button type="button" className="aqi-rank-tab active">
            India&apos;s Most Polluted City Rankings
          </button>
          <button type="button" className="aqi-rank-close" onClick={onClose} aria-label="Close rankings">
            ×
          </button>
        </div>

        <div
          className="aqi-rank-table-wrap"
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="aqi-rank-table-head">
            <span>Rank</span>
            <span>Most Polluted Cities</span>
            <span>AQI</span>
            <span>AQI Status</span>
            <span>Standard Value</span>
          </div>

          {loading && <p className="aqi-rank-note">Loading Indian cities…</p>}
          {error && <p className="aqi-rank-error">{error}</p>}
          {!loading && !error && !rows.length && (
            <p className="aqi-rank-note">No Indian cities found in the ranking list.</p>
          )}

          <ul className="aqi-rank-rows">
            {rows.map((row, index) => {
              const aqi = finite(row.aqi)
              const color = aqiInColor(aqi)
              const status = aqiInLabel(aqi)
              const times = timesAboveStandard(row)
              const key = `india-${row.rank || index}-${row.locationId || row.city}`
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="aqi-rank-row"
                    onClick={() => onSelectCity?.(row)}
                  >
                    <span className="aqi-rank-col-rank">{row.rank || index + 1}</span>
                    <span className="aqi-rank-col-place">
                      {row.flag ? (
                        <img src={row.flag} alt="" className="aqi-rank-flag" loading="lazy" />
                      ) : (
                        <span className="aqi-rank-flag aqi-rank-flag--empty" />
                      )}
                      <span className="aqi-rank-place-text">
                        <strong>{titleName(row)}</strong>
                        <small>{placeLabel(row)}</small>
                      </span>
                    </span>
                    <span className="aqi-rank-col-aqi">
                      <AqiArc aqi={aqi} color={color} />
                    </span>
                    <span className="aqi-rank-col-status" style={{ color }}>{status}</span>
                    <span className="aqi-rank-col-standard" style={{ color }}>
                      {times != null ? `${times}x above Standard` : '—'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="aqi-rank-footer">
          <span className="aqi-rank-footer-link">AQI India City Rankings →</span>
          <span className="aqi-rank-footer-updated">Last Updated {stamp}</span>
        </div>
      </div>
    </div>
  )
}

export default AqiRankingsPanel
