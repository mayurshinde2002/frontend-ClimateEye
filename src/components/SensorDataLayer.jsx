import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet'
import { aqiInColor, aqiInLabel, fetchSensorsInView } from '../services/aqiInApi'
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

const viewKeyFromMap = (map) => {
  const bounds = map.getBounds()
  const zoom = map.getZoom()
  const step = zoom >= 9 ? 0.15 : zoom >= 7 ? 0.35 : zoom >= 5 ? 0.75 : 1.5
  const snap = (value) => Math.round(value / step) * step
  return [
    zoom | 0,
    snap(bounds.getSouth()),
    snap(bounds.getNorth()),
    snap(bounds.getWest()),
    snap(bounds.getEast())
  ].join(':')
}

const SensorDataLayer = ({ onClose }) => {
  const map = useMap()
  const panelRef = useRef(null)
  useLeafletSafeOverlay(panelRef)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [stations, setStations] = useState([])
  const [selected, setSelected] = useState(null)
  const [rankingsOpen, setRankingsOpen] = useState(false)
  const [viewKey, setViewKey] = useState(() => viewKeyFromMap(map))
  const requestIdRef = useRef(0)

  useMapEvents({
    moveend: () => setViewKey(viewKeyFromMap(map)),
    zoomend: () => setViewKey(viewKeyFromMap(map))
  })

  useEffect(() => {
    if (!viewKey) return undefined
    let cancelled = false
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)

    const timer = window.setTimeout(() => {
      const bounds = map.getBounds()
      const zoom = map.getZoom()

      fetchSensorsInView(bounds, zoom, (payload) => {
        if (cancelled || requestIdRef.current !== requestId) return
        const list = payload.stations || []
        setStations(list)
        // Keep selection only if that sensor is still in the current view
        setSelected((prev) => {
          if (!prev) return null
          return list.find((item) => item.uid === prev.uid) || null
        })
        if (payload.done) setLoading(false)
      })
        .then((data) => {
          if (cancelled || requestIdRef.current !== requestId) return
          setStations(data.stations || [])
          setLoading(false)
        })
        .catch((err) => {
          if (cancelled || requestIdRef.current !== requestId) return
          setError(err.message || 'Could not load sensors for this view')
          setLoading(false)
        })
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [map, viewKey])

  const activeScore = stationAqi(selected)
  const categoryColor = aqiInColor(activeScore)
  const categoryLabel = aqiInLabel(activeScore)

  const onSelectRanked = (row) => {
    const lat = finite(row.latitude)
    const lng = finite(row.longitude)
    if (lat != null && lng != null) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 6), { animate: true, duration: 0.85 })
    }
  }

  const selectStation = (station) => {
    setSelected(station)
  }

  return (
    <>
      {stations.map((station) => {
        const lat = finite(station.latitude)
        const lng = finite(station.longitude)
        if (lat == null || lng == null) return null
        const score = stationAqi(station)
        const color = aqiInColor(score)
        const isSelected = selected?.uid === station.uid
        return (
          <CircleMarker
            key={station.uid || `${lat}-${lng}`}
            center={[lat, lng]}
            radius={isSelected ? 10 : 6}
            pathOptions={{
              color: '#ffffff',
              weight: isSelected ? 3 : 1.5,
              fillColor: color,
              fillOpacity: 0.92
            }}
            eventHandlers={{
              click: () => selectStation(station)
            }}
          >
            <Popup>
              <div className="sensor-popup">
                <strong>{station.location || station.station || station.city || 'Sensor'}</strong>
                <div>AQI-IN: {score ?? '—'}</div>
                <div>{station.city}{station.state ? `, ${station.state}` : ''}</div>
                <div className="sensor-popup-hint">Click marker to open details</div>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {createPortal(
        <>
          <div
            ref={panelRef}
            className="sensor-data-panel sensor-data-panel--selected leaflet-control"
            onWheel={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <div className="sensor-data-header">
              <div className="sensor-data-heading">
                <span className="sensor-data-title">Sensor data</span>
                <span className="sensor-data-sub">
                  {selected ? 'Selected from map' : 'Click a sensor on the map'}
                </span>
              </div>
              <div className="sensor-data-header-actions">
                <button
                  type="button"
                  className={`sensor-rankings-btn${rankingsOpen ? ' active' : ''}`}
                  onClick={() => setRankingsOpen((open) => !open)}
                  title="India AQI city rankings"
                >
                  Rankings
                </button>
                {loading && !selected && <span className="sensor-data-status">Loading map…</span>}
                {selected && activeScore != null && (
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

            {!selected && !error && (
              <p className="sensor-data-empty">
                Select any coloured marker on the map to view its AQI and pollutant details here.
              </p>
            )}

            {selected && (
              <div className="sensor-data-active">
                <div className="sensor-data-active-name">
                  {selected.location || selected.station || selected.city || 'Sensor'}
                </div>
                <div className="sensor-data-active-meta">
                  {selected.city}{selected.state ? `, ${selected.state}` : ''}
                  {selected.isOnline != null ? (selected.isOnline ? ' · Online' : ' · Offline') : ''}
                </div>
                <div className="sensor-data-score" style={{ color: categoryColor }}>
                  <span className="sensor-data-score-value">{activeScore ?? '—'}</span>
                  <span className="sensor-data-score-unit">AQI-IN</span>
                </div>
                <div className="sensor-data-grid">
                  {[
                    ['PM2.5', selected.iaqi?.pm25],
                    ['PM10', selected.iaqi?.pm10],
                    ['NO₂', selected.iaqi?.no2],
                    ['SO₂', selected.iaqi?.so2],
                    ['O₃', selected.iaqi?.o3],
                    ['CO', selected.iaqi?.co]
                  ].map(([label, value]) => (
                    <div key={label} className="sensor-data-cell">
                      <span>{label}</span>
                      <strong>{value == null ? '—' : Number(value).toFixed(0)}</strong>
                    </div>
                  ))}
                </div>
                {selected.weather?.temp_c != null && (
                  <div className="sensor-data-weather">
                    {selected.weather.temp_c}°C
                    {selected.weather.condition?.text ? ` · ${selected.weather.condition.text}` : ''}
                    {selected.weather.humidity != null ? ` · RH ${selected.weather.humidity}%` : ''}
                  </div>
                )}
                {selected.updated_at && (
                  <div className="sensor-data-updated">
                    Updated {String(selected.updated_at).replace('T', ' ').replace('.000Z', ' UTC')}
                  </div>
                )}
                <button
                  type="button"
                  className="sensor-data-clear-selection"
                  onClick={() => setSelected(null)}
                >
                  Clear selection
                </button>
              </div>
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
