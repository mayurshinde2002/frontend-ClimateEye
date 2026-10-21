import { useEffect, useMemo, useState } from 'react'
import { calculateGeometryCenter, fetchAQIData } from '../services/api'
import './AreaPollutantsPanel.css'

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const pick = (data, keys) => {
  for (const key of keys) {
    const value = finiteOrNull(data?.[key])
    if (value !== null) return value
  }
  return null
}

const aqiCategory = (aqi) => {
  if (aqi === null) return { label: '—', color: '#94a3b8' }
  if (aqi <= 50) return { label: 'Good', color: '#10b981' }
  if (aqi <= 100) return { label: 'Moderate', color: '#f59e0b' }
  if (aqi <= 150) return { label: 'Poor', color: '#f97316' }
  if (aqi <= 200) return { label: 'Unhealthy', color: '#ef4444' }
  if (aqi <= 300) return { label: 'Severe', color: '#8b5cf6' }
  return { label: 'Hazardous', color: '#7f1d1d' }
}

const formatValue = (value, digits = 1) => (
  value === null ? 'N/A' : Number(value).toFixed(digits)
)

const AreaPollutantsPanel = ({ geometry, areaLabel, onClear }) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pollutants, setPollutants] = useState(null)

  const center = useMemo(
    () => (geometry ? calculateGeometryCenter(geometry) : null),
    [geometry]
  )

  useEffect(() => {
    if (!center) {
      setPollutants(null)
      setError(null)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetchAQIData(center.latitude, center.longitude)
      .then((data) => {
        if (cancelled) return
        setPollutants({
          aqi: pick(data, ['aqi', 'aqi_0to3m', 'european_aqi', 'us_aqi']),
          pm25: pick(data, ['pm2_5', 'pm2_5_0to3m', 'pm25']),
          pm10: pick(data, ['pm10', 'pm10_0to3m']),
          no2: pick(data, ['no2', 'no2_0to3m']),
          so2: pick(data, ['so2', 'so2_0to3m']),
          o3: pick(data, ['o3', 'o3_0to3m'])
        })
      })
      .catch((err) => {
        if (cancelled) return
        setPollutants(null)
        setError(err.message || 'Could not load pollutants')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [center?.latitude, center?.longitude])

  if (!geometry || !center) return null

  const category = aqiCategory(pollutants?.aqi ?? null)

  return (
    <div className="area-pollutants-panel" role="status" aria-live="polite">
      <div className="area-pollutants-header">
        <div className="area-pollutants-heading">
          <span className="area-pollutants-title">Area air quality</span>
          {areaLabel && <span className="area-pollutants-area">{areaLabel}</span>}
        </div>
        <div className="area-pollutants-header-actions">
          {!loading && pollutants?.aqi !== null && pollutants?.aqi !== undefined && (
            <span className="area-pollutants-badge" style={{ color: category.color, borderColor: category.color }}>
              {category.label}
            </span>
          )}
          {loading && <span className="area-pollutants-status">Loading…</span>}
          {onClear && (
            <button className="area-pollutants-clear" onClick={onClear} type="button">
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <div className="area-pollutants-error">{error}</div>}

      {!error && (
        <>
          <div className="area-pollutants-aqi" style={{ color: category.color }}>
            <span className="area-pollutants-aqi-label">AQI</span>
            <span className="area-pollutants-aqi-value">
              {loading ? '…' : formatValue(pollutants?.aqi ?? null, 0)}
            </span>
          </div>

          <div className="area-pollutants-grid">
            <div className="area-pollutants-item">
              <span>PM2.5</span>
              <strong>{loading ? '…' : `${formatValue(pollutants?.pm25 ?? null)} µg/m³`}</strong>
            </div>
            <div className="area-pollutants-item">
              <span>PM10</span>
              <strong>{loading ? '…' : `${formatValue(pollutants?.pm10 ?? null)} µg/m³`}</strong>
            </div>
            <div className="area-pollutants-item">
              <span>NO₂</span>
              <strong>{loading ? '…' : `${formatValue(pollutants?.no2 ?? null)} µg/m³`}</strong>
            </div>
            <div className="area-pollutants-item">
              <span>SO₂</span>
              <strong>{loading ? '…' : `${formatValue(pollutants?.so2 ?? null)} µg/m³`}</strong>
            </div>
            <div className="area-pollutants-item area-pollutants-item--wide">
              <span>O₃</span>
              <strong>{loading ? '…' : `${formatValue(pollutants?.o3 ?? null)} µg/m³`}</strong>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default AreaPollutantsPanel
