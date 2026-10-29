import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet'
import PlaceSearch from './PlaceSearch'
import 'leaflet/dist/leaflet.css'
import './WeatherMiniMap.css'

const FREE_OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION = '&copy; OpenStreetMap'

const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3H3v5" />
    <path d="M16 3h5v5" />
    <path d="M8 21H3v-5" />
    <path d="M16 21h5v-5" />
  </svg>
)

const CompressIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 3v6H3" />
    <path d="M15 3v6h6" />
    <path d="M9 21v-6H3" />
    <path d="M15 21v-6h6" />
  </svg>
)

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

const MapReady = ({ onReady }) => {
  const map = useMap()
  useEffect(() => {
    onReady?.(map)
    return () => onReady?.(null)
  }, [map, onReady])
  return null
}

const MapView = ({ center, zoom, interactive, className, onMapReady }) => (
  <MapContainer
    key={interactive ? 'weather-map-full' : 'weather-map-mini'}
    center={center}
    zoom={zoom}
    zoomControl={interactive}
    attributionControl={false}
    dragging={interactive}
    scrollWheelZoom={interactive}
    doubleClickZoom={interactive}
    boxZoom={interactive}
    keyboard={interactive}
    touchZoom={interactive}
    className={className}
  >
    <TileLayer url={FREE_OSM_TILES} attribution={OSM_ATTRIBUTION} />
    <CircleMarker
      center={center}
      radius={interactive ? 10 : 8}
      pathOptions={{
        color: '#14b8a6',
        weight: 2,
        fillColor: '#2dd4bf',
        fillOpacity: 0.85
      }}
    />
    <Recenter center={center} zoom={zoom} />
    <MapReady onReady={onMapReady} />
  </MapContainer>
)

const WeatherMiniMap = ({
  latitude,
  longitude,
  label = 'Location',
  className = '',
  onPlaceSelect,
  selectedPlace = null
}) => {
  const [fullscreen, setFullscreen] = useState(false)
  const [leafletMap, setLeafletMap] = useState(null)
  const handleMapReady = useCallback((mapInstance) => {
    setLeafletMap(mapInstance)
  }, [])

  const center = useMemo(() => {
    const lat = Number(latitude)
    const lng = Number(longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return [lat, lng]
  }, [latitude, longitude])

  useEffect(() => {
    if (!fullscreen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [fullscreen])

  const searchOverlay = (
    <div className="weather-mini-map-search">
      <PlaceSearch
        map={leafletMap}
        selectedPlace={selectedPlace}
        onSelect={(place) => onPlaceSelect?.(place)}
        onClear={() => {}}
      />
    </div>
  )

  if (!center) {
    return (
      <div className={`weather-mini-map weather-mini-map--empty ${className}`.trim()}>
        <span>Map unavailable</span>
        {searchOverlay}
      </div>
    )
  }

  return (
    <>
      <div className={`weather-mini-map ${className}`.trim()} aria-label={`${label} map`}>
        <MapView
          center={center}
          zoom={11}
          interactive={false}
          className="weather-mini-map-leaflet"
          onMapReady={handleMapReady}
        />
        {searchOverlay}
        <span className="weather-mini-map-label">{label}</span>
        <button
          type="button"
          className="weather-mini-map-expand"
          onClick={() => setFullscreen(true)}
          title="Expand map"
          aria-label="Expand map"
        >
          <ExpandIcon />
        </button>
      </div>

      {fullscreen &&
        createPortal(
          <div className="weather-map-fullscreen" role="dialog" aria-modal="true" aria-label="Location map">
            <div className="weather-map-fullscreen-stage">
              <MapView
                center={center}
                zoom={12}
                interactive
                className="weather-map-fullscreen-leaflet"
                onMapReady={handleMapReady}
              />
              <div className="weather-mini-map-search weather-mini-map-search--fullscreen">
                <PlaceSearch
                  map={leafletMap}
                  selectedPlace={selectedPlace}
                  onSelect={(place) => onPlaceSelect?.(place)}
                  onClear={() => {}}
                />
              </div>
              <span className="weather-mini-map-label weather-mini-map-label--lg">{label}</span>
              <button
                type="button"
                className="weather-mini-map-expand weather-map-fullscreen-close"
                onClick={() => setFullscreen(false)}
                title="Close map"
                aria-label="Close map"
              >
                <CompressIcon />
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

export default WeatherMiniMap
