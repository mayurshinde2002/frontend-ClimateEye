import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { aqiInColor, fetchSensorsInView, stationAqiValue } from '../services/aqiInApi'
import PlaceSearch from './PlaceSearch'
import 'leaflet/dist/leaflet.css'
import './AqiMiniMap.css'

const FREE_OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION = '&copy; OpenStreetMap'

const finite = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const viewKeyFromMap = (map) => {
  const bounds = map.getBounds()
  const zoom = map.getZoom()
  const step = zoom >= 11 ? 0.08 : zoom >= 9 ? 0.15 : zoom >= 7 ? 0.35 : 0.75
  const snap = (value) => Math.round(value / step) * step
  return [
    zoom | 0,
    snap(bounds.getSouth()),
    snap(bounds.getWest()),
    snap(bounds.getNorth()),
    snap(bounds.getEast())
  ].join(':')
}

const aqiChipIcon = (aqi, color) => {
  const label = aqi == null ? '—' : String(Math.round(aqi))
  const digits = label.length
  const fontSize = digits >= 3 ? 11 : 12
  return L.divIcon({
    className: 'aqi-chip-marker',
    html: `<span class="aqi-chip" style="background:${color};font-size:${fontSize}px">${label}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  })
}

const Recenter = ({ center, zoom }) => {
  const map = useMap()
  useEffect(() => {
    if (!map || !center) return undefined
    const apply = () => {
      map.invalidateSize()
      map.setView(center, zoom, { animate: false })
    }
    apply()
    const t1 = window.setTimeout(apply, 80)
    const t2 = window.setTimeout(apply, 220)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [map, center, zoom])
  return null
}

/** Loads every discovered aqi.in sensor that falls inside the current map view. */
const SensorsInView = ({ seedStations = [], onLoadingChange }) => {
  const map = useMap()
  const [viewKey, setViewKey] = useState('')
  const [stations, setStations] = useState([])
  const requestIdRef = useRef(0)

  useMapEvents({
    moveend: () => setViewKey(viewKeyFromMap(map)),
    zoomend: () => setViewKey(viewKeyFromMap(map))
  })

  useEffect(() => {
    if (!map) return undefined
    const boot = () => setViewKey(viewKeyFromMap(map))
    boot()
    const t = window.setTimeout(boot, 120)
    return () => window.clearTimeout(t)
  }, [map])

  useEffect(() => {
    if (!viewKey || !map) return undefined
    let cancelled = false
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    onLoadingChange?.(true)

    const timer = window.setTimeout(() => {
      const bounds = map.getBounds()
      const zoom = map.getZoom()

      fetchSensorsInView(bounds, zoom, (payload) => {
        if (cancelled || requestIdRef.current !== requestId) return
        setStations(payload.stations || [])
        if (payload.done) onLoadingChange?.(false)
      })
        .then((data) => {
          if (cancelled || requestIdRef.current !== requestId) return
          setStations(data.stations || [])
          onLoadingChange?.(false)
        })
        .catch(() => {
          if (cancelled || requestIdRef.current !== requestId) return
          onLoadingChange?.(false)
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [map, viewKey, onLoadingChange])

  const markers = useMemo(() => {
    const byKey = new Map()

    const push = (raw, index = 0) => {
      const lat = finite(raw.lat ?? raw.latitude)
      const lng = finite(raw.lng ?? raw.longitude)
      const aqi = stationAqiValue(raw) ?? finite(raw.aqi)
      if (lat == null || lng == null || aqi == null) return
      const id = raw.uid
        || raw.id
        || raw.locationId
        || `${lat.toFixed(4)}:${lng.toFixed(4)}:${index}`
      if (byKey.has(id)) return
      const rounded = Math.round(aqi)
      byKey.set(id, {
        id,
        lat,
        lng,
        aqi: rounded,
        name: raw.name || raw.location || raw.city || 'Station',
        color: aqiInColor(aqi),
        icon: aqiChipIcon(rounded, aqiInColor(aqi))
      })
    }

    ;(seedStations || []).forEach((s, i) => push(s, i))
    ;(stations || []).forEach((s, i) => push(s, i + 1000))

    return [...byKey.values()]
  }, [stations, seedStations])

  return (
    <>
      {markers.map((m) => (
        <Marker
          key={m.id}
          position={[m.lat, m.lng]}
          icon={m.icon}
          title={`${m.name}: AQI ${m.aqi}`}
        />
      ))}
    </>
  )
}

const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3H3v5" />
    <path d="M16 3h5v5" />
    <path d="M8 21H3v-5" />
    <path d="M16 21h5v-5" />
  </svg>
)

const AqiMiniMap = ({
  latitude,
  longitude,
  label = 'Location',
  stations = [],
  onPlaceSelect,
  selectedPlace = null,
  onExpand,
  className = ''
}) => {
  const [loadingSensors, setLoadingSensors] = useState(false)

  const center = useMemo(() => {
    const lat = Number(latitude)
    const lng = Number(longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [19.076, 72.8777]
    return [lat, lng]
  }, [latitude, longitude])

  const zoom = 11

  const handleMapReady = useCallback((map) => {
    if (!map) return
    window.setTimeout(() => map.invalidateSize(), 100)
  }, [])

  const handleLoadingChange = useCallback((busy) => {
    setLoadingSensors(Boolean(busy))
  }, [])

  return (
    <div className={`aqi-mini-map ${className}`.trim()}>
      <div className="aqi-mini-map-chrome">
        <span className="aqi-mini-map-badge">AQI Map</span>
        {loadingSensors && <span className="aqi-mini-map-loading">Finding sensors…</span>}
      </div>
      <div className="aqi-mini-map-search">
        <PlaceSearch
          selectedPlace={selectedPlace}
          onSelect={(place) => onPlaceSelect?.(place)}
          onClear={() => {}}
        />
      </div>
      <MapContainer
        key={`aqi-mini-${center[0].toFixed(3)}-${center[1].toFixed(3)}`}
        center={center}
        zoom={zoom}
        zoomControl={false}
        attributionControl={false}
        dragging
        scrollWheelZoom={false}
        className="aqi-mini-map-leaflet"
        whenReady={(e) => handleMapReady(e.target)}
      >
        <TileLayer url={FREE_OSM_TILES} attribution={OSM_ATTRIBUTION} />
        <Recenter center={center} zoom={zoom} />
        <SensorsInView seedStations={stations} onLoadingChange={handleLoadingChange} />
      </MapContainer>
      <div className="aqi-mini-map-label">{label}</div>
      {onExpand && (
        <button
          type="button"
          className="aqi-mini-map-expand"
          onClick={onExpand}
          title="Open full map"
          aria-label="Open full map with all tools"
        >
          <ExpandIcon />
        </button>
      )}
    </div>
  )
}

export default AqiMiniMap
