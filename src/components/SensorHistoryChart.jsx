import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  HISTORY_RANGES,
  aqiInColor,
  fetchAqiHistory,
  resolveHistorySlug
} from '../services/aqiInApi'
import { useLeafletSafeOverlay } from '../hooks/useLeafletSafeOverlay'
import './SensorHistoryChart.css'

const RANGE_ORDER = ['24h', '7d', '30d']

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
    <div className="sensor-history-tooltip">
      <div className="sensor-history-tooltip-time">{point.label}</div>
      <div className="sensor-history-tooltip-row">
        <span className="sensor-history-tooltip-dot" style={{ background: point.color }} />
        <span>{placeName}: {point.aqi}</span>
      </div>
    </div>
  )
}

const SensorHistoryChart = ({ place, open, onClose }) => {
  const overlayRef = useRef(null)
  useLeafletSafeOverlay(overlayRef, open)
  const [rangeId, setRangeId] = useState('7d')
  const [chartType, setChartType] = useState('bar')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [series, setSeries] = useState(null)

  const slugInfo = useMemo(() => resolveHistorySlug(place), [place])
  const placeName = slugInfo?.title || place?.city || place?.location || 'Location'

  useEffect(() => {
    if (!open || !slugInfo?.slug) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchAqiHistory(rangeId, {
      slug: slugInfo.slug,
      slugType: slugInfo.slugType,
      sensorname: 'AQI-IN'
    })
      .then((data) => {
        if (cancelled) return
        setSeries(data)
      })
      .catch((err) => {
        if (cancelled) return
        setSeries(null)
        setError(err.message || 'Could not load history')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [open, rangeId, slugInfo?.slug, slugInfo?.slugType])

  if (!open) return null

  if (!slugInfo?.slug) {
    return (
      <div
        ref={overlayRef}
        className="sensor-history-overlay leaflet-control"
        onWheel={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sensor-history-card">
          <div className="sensor-history-top">
            <div>
              <span className="sensor-history-eyebrow">AQI Graph</span>
              <h3>Historical Air Quality Data</h3>
            </div>
            <button type="button" className="sensor-history-close" onClick={onClose}>×</button>
          </div>
          <p className="sensor-history-error">
            This place has no aqi.in slug, so history cannot be loaded.
          </p>
        </div>
      </div>
    )
  }

  const points = series?.points || []
  const minColor = aqiInColor(series?.minValue)
  const maxColor = aqiInColor(series?.maxValue)

  return (
    <div
      ref={overlayRef}
      className="sensor-history-overlay leaflet-control"
      role="dialog"
      aria-label="AQI history chart"
      onWheel={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="sensor-history-card">
        <div className="sensor-history-top">
          <div>
            <span className="sensor-history-eyebrow">AQI Graph</span>
            <h3>Historical Air Quality Data</h3>
            <p className="sensor-history-place">{placeName}</p>
          </div>
          <div className="sensor-history-controls">
            <div className="sensor-history-chart-toggle" role="group" aria-label="Chart type">
              <button
                type="button"
                className={chartType === 'line' ? 'active' : ''}
                onClick={() => setChartType('line')}
                title="Line chart"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 17l6-6 4 4 8-8" />
                </svg>
              </button>
              <button
                type="button"
                className={chartType === 'bar' ? 'active' : ''}
                onClick={() => setChartType('bar')}
                title="Bar chart"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 20V10M12 20V4M20 20v-7" />
                </svg>
              </button>
            </div>
            <select
              className="sensor-history-select"
              value={rangeId}
              onChange={(event) => setRangeId(event.target.value)}
              aria-label="History range"
            >
              {RANGE_ORDER.map((id) => (
                <option key={id} value={id}>{HISTORY_RANGES[id].label}</option>
              ))}
            </select>
            <select className="sensor-history-select" value="AQI-IN" disabled aria-label="Metric">
              <option value="AQI-IN">AQI (IN)</option>
            </select>
            <button type="button" className="sensor-history-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="sensor-history-summary">
          <span className="sensor-history-chip">
            <span className="sensor-history-chip-dot" />
            {placeName}
          </span>
          <div className="sensor-history-extremes">
            <div className="sensor-history-extreme" style={{ '--extreme-color': minColor }}>
              <strong>{series?.minValue ?? '—'}</strong>
              <div>
                <span>↓ Min. AQI (IN)</span>
                <small>{formatExtremeTime(series?.minPoint?.time)}</small>
              </div>
            </div>
            <div className="sensor-history-extreme" style={{ '--extreme-color': maxColor }}>
              <strong>{series?.maxValue ?? '—'}</strong>
              <div>
                <span>↑ Max. AQI (IN)</span>
                <small>{formatExtremeTime(series?.maxPoint?.time)}</small>
              </div>
            </div>
          </div>
        </div>

        <div className="sensor-history-plot">
          {loading && <p className="sensor-history-note">Loading history…</p>}
          {error && <p className="sensor-history-error">{error}</p>}
          {!loading && !error && !points.length && (
            <p className="sensor-history-note">No history points for this range.</p>
          )}
          {!loading && !error && points.length > 0 && (
            <ResponsiveContainer width="100%" height={320} minHeight={280}>
              {chartType === 'bar' ? (
                <BarChart data={points} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={28}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
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
                    content={<HistoryTooltip placeName={placeName} />}
                    cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                  />
                  <Bar
                    dataKey="aqi"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={18}
                    isAnimationActive={false}
                  >
                    {points.map((point) => (
                      <Cell key={`${point.time}-${point.index}`} fill={point.color || '#38bdf8'} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <LineChart data={points} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={28}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                    domain={[0, 'auto']}
                  />
                  <Tooltip
                    content={<HistoryTooltip placeName={placeName} />}
                    cursor={{ stroke: 'rgba(255,255,255,0.35)', strokeDasharray: '4 4' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="aqi"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </div>

        <div className="sensor-history-footer">
          <span>{series?.startLabel || ''}</span>
          <span>Time</span>
          <span>{series?.endLabel || ''}</span>
        </div>
      </div>
    </div>
  )
}

export default SensorHistoryChart
