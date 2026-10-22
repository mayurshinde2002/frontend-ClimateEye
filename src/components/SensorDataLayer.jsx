import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleMarker, Popup, useMap } from 'react-leaflet'
import { aqiInColor, aqiInLabel, fetchSensorBundle } from '../services/aqiInApi'
import { useLeafletSafeOverlay } from '../hooks/useLeafletSafeOverlay'
import AqiRankingsPanel from './AqiRankingsPanel'
import './SensorDataLayer.css'

const finite = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const stationAqi = (station) => (
  finite(station?.iaqi?.['AQI-IN'])
  ?? finite(station?.iaqi?.aqi)
  ?? finite(station?.aqi)
)

const SensorDataLayer = ({ latitude, longitude, onClose }) => {
  const map = useMap()
  const panelRef = useRef(null)
  useLeafletSafeOverlay(panelRef)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [bundle, setBundle] = useState(null)
  const [activeUid, setActiveUid] = useState(null)
  const [rankingsOpen, setRankingsOpen] = useState(false)

  const latKey = Number(latitude?.toFixed?.(3) ?? latitude)
  const lngKey = Number(longitude?.toFixed?.(3) ?? longitude)

  useEffect(() => {
    if (!Number.isFinite(latKey) || !Number.isFinite(lngKey)) return undefined

    let cancelled = false
    setLoading(true)
    setError(null)

    const timer = window.setTimeout(() => {
      fetchSensorBundle(latKey, lngKey)
        .then((data) => {
          if (cancelled) return
          setBundle(data)
          setActiveUid(data.stations?.[0]?.uid || data.city?.uid || null)
        })
        .catch((err) => {
          if (cancelled) return
          setBundle(null)
          setError(err.message || 'Could not load sensor data')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [latKey, lngKey])

  const stations = bundle?.stations || []
  const active = useMemo(
    () => stations.find((item) => item.uid === activeUid) || stations[0] || bundle?.city || null,
    [stations, activeUid, bundle?.city]
  )
  const activeScore = stationAqi(active)
  const categoryColor = aqiInColor(activeScore)
  const categoryLabel = aqiInLabel(activeScore)

  const onSelectRanked = (row) => {
    const lat = finite(row.latitude)
    const lng = finite(row.longitude)
    if (lat != null && lng != null) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 6), { animate: true, duration: 0.85 })
    }
  }

  return (
    <>
      {stations.map((station) => {
        const lat = finite(station.latitude)
        const lng = finite(station.longitude)
        if (lat == null || lng == null) return null
        const score = stationAqi(station)
        const color = aqiInColor(score)
        const selected = station.uid === active?.uid
        return (
          <CircleMarker
            key={station.uid || `${lat}-${lng}`}
            center={[lat, lng]}
            radius={selected ? 11 : 8}
            pathOptions={{
              color: '#ffffff',
              weight: selected ? 3 : 2,
              fillColor: color,
              fillOpacity: 0.92
            }}
            eventHandlers={{
              click: () => setActiveUid(station.uid)
            }}
          >
            <Popup>
              <div className="sensor-popup">
                <strong>{station.location || station.station || station.city || 'Sensor'}</strong>
                <div>AQI-IN: {score ?? '—'}</div>
                <div>{station.city}{station.state ? `, ${station.state}` : ''}</div>
                {station.distance != null && <div>{Number(station.distance).toFixed(1)} km away</div>}
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {createPortal(
        <>
          <div
            ref={panelRef}
            className="sensor-data-panel leaflet-control"
            onWheel={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <div className="sensor-data-header">
              <div className="sensor-data-heading">
                <span className="sensor-data-title">Sensor data</span>
                <span className="sensor-data-sub">
                  aqi.in · {latKey.toFixed(3)}, {lngKey.toFixed(3)}
                </span>
              </div>
              <div className="sensor-data-header-actions">
                <button
                  type="button"
                  className={`sensor-rankings-btn${rankingsOpen ? ' active' : ''}`}
                  onClick={() => setRankingsOpen((open) => !open)}
                  title="World AQI rankings"
                >
                  Rankings
                </button>
                {loading && <span className="sensor-data-status">Loading…</span>}
                {!loading && activeScore != null && (
                  <span className="sensor-data-badge" style={{ color: categoryColor }}>
                    {categoryLabel}
                  </span>
                )}
                {onClose && (
                  <button type="button" className="sensor-data-close" onClick={onClose}>
                    Close
                  </button>
                )}
              </div>
            </div>

            {error && <p className="sensor-data-error">{error}</p>}

            {!error && !loading && !stations.length && (
              <p className="sensor-data-empty">No nearby sensors for this location.</p>
            )}

            {active && (
              <div className="sensor-data-active">
                <div className="sensor-data-active-name">
                  {active.location || active.station || active.city || 'Nearest sensor'}
                </div>
                <div className="sensor-data-active-meta">
                  {active.city}{active.state ? `, ${active.state}` : ''}
                  {active.distance != null ? ` · ${Number(active.distance).toFixed(1)} km` : ''}
                  {active.isOnline != null ? (active.isOnline ? ' · Online' : ' · Offline') : ''}
                </div>
                <div className="sensor-data-score" style={{ color: categoryColor }}>
                  <span className="sensor-data-score-value">{activeScore ?? '—'}</span>
                  <span className="sensor-data-score-unit">AQI-IN</span>
                </div>
                <div className="sensor-data-grid">
                  {[
                    ['PM2.5', active.iaqi?.pm25],
                    ['PM10', active.iaqi?.pm10],
                    ['NO₂', active.iaqi?.no2],
                    ['SO₂', active.iaqi?.so2],
                    ['O₃', active.iaqi?.o3],
                    ['CO', active.iaqi?.co]
                  ].map(([label, value]) => (
                    <div key={label} className="sensor-data-cell">
                      <span>{label}</span>
                      <strong>{value == null ? '—' : Number(value).toFixed(0)}</strong>
                    </div>
                  ))}
                </div>
                {active.weather?.temp_c != null && (
                  <div className="sensor-data-weather">
                    {active.weather.temp_c}°C
                    {active.weather.condition?.text ? ` · ${active.weather.condition.text}` : ''}
                    {active.weather.humidity != null ? ` · RH ${active.weather.humidity}%` : ''}
                  </div>
                )}
                {active.updated_at && (
                  <div className="sensor-data-updated">
                    Updated {String(active.updated_at).replace('T', ' ').replace('.000Z', ' UTC')}
                  </div>
                )}
              </div>
            )}

            {stations.length > 1 && (
              <ul className="sensor-data-list">
                {stations.map((station) => {
                  const score = stationAqi(station)
                  return (
                    <li key={station.uid}>
                      <button
                        type="button"
                        className={`sensor-data-list-item${station.uid === active?.uid ? ' active' : ''}`}
                        onClick={() => setActiveUid(station.uid)}
                      >
                        <span
                          className="sensor-data-dot"
                          style={{ background: aqiInColor(score) }}
                        />
                        <span className="sensor-data-list-text">
                          <strong>{station.location || station.city || station.uid}</strong>
                          <small>
                            {score ?? '—'} AQI
                            {station.distance != null ? ` · ${Number(station.distance).toFixed(1)} km` : ''}
                          </small>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <AqiRankingsPanel
            open={rankingsOpen}
            onClose={() => setRankingsOpen(false)}
            onSelectCity={onSelectRanked}
          />
        </>,
        map.getContainer()
      )}
    </>
  )
}

export default SensorDataLayer
