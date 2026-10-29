import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Polygon, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './AoiMiniMap.css'

/** Free OSM tiles (no API key). Dark look via CSS on the tile pane. */
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

const ringToLatLngs = (ring) => (
  (ring || [])
    .map(([lng, lat]) => [Number(lat), Number(lng)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
)

const geometryToLatLngs = (geometry) => {
  if (!geometry) return null
  if (geometry.type === 'Polygon') {
    const outer = ringToLatLngs(geometry.coordinates?.[0])
    return outer?.length ? [outer] : null
  }
  if (geometry.type === 'MultiPolygon') {
    const parts = (geometry.coordinates || [])
      .map((poly) => ringToLatLngs(poly?.[0]))
      .filter((ring) => ring?.length)
    return parts.length ? parts : null
  }
  return null
}

const FitAoi = ({ positions, padding = 18, maxZoom = 14 }) => {
  const map = useMap()

  useEffect(() => {
    if (!positions?.length || !map) return undefined
    const bounds = L.latLngBounds(positions.flat())
    if (!bounds.isValid()) return undefined

    const fit = () => {
      map.invalidateSize()
      map.fitBounds(bounds, { padding: [padding, padding], maxZoom, animate: false })
    }

    fit()
    const t1 = window.setTimeout(fit, 80)
    const t2 = window.setTimeout(fit, 220)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [map, positions, padding, maxZoom])

  return null
}

const AoiMapView = ({
  positions,
  interactive = false,
  className = '',
  padding = 18,
  maxZoom = 14
}) => {
  const flat = positions.flat()
  const center = flat[0] || [20.6, 78.9]

  return (
    <MapContainer
      key={interactive ? 'aoi-full' : 'aoi-mini'}
      center={center}
      zoom={11}
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
      <Polygon
        positions={positions}
        pathOptions={{
          color: '#14b8a6',
          weight: interactive ? 3 : 2,
          fillColor: '#14b8a6',
          fillOpacity: interactive ? 0.32 : 0.28
        }}
      />
      <FitAoi positions={positions} padding={padding} maxZoom={maxZoom} />
    </MapContainer>
  )
}

const AoiMiniMap = ({ geometry, className = '' }) => {
  const [fullscreen, setFullscreen] = useState(false)
  const positions = useMemo(() => geometryToLatLngs(geometry), [geometry])

  useEffect(() => {
    if (!fullscreen) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [fullscreen])

  if (!positions?.length) {
    return (
      <div className={`aoi-mini-map aoi-mini-map--empty ${className}`.trim()}>
        <span>No drawn area</span>
      </div>
    )
  }

  return (
    <>
      <div className={`aoi-mini-map ${className}`.trim()} aria-label="Drawn area map">
        <AoiMapView
          positions={positions}
          interactive={false}
          className="aoi-mini-map-leaflet"
          padding={18}
          maxZoom={14}
        />
        <span className="aoi-mini-map-label">Drawn area</span>
        <button
          type="button"
          className="aoi-mini-map-expand"
          onClick={() => setFullscreen(true)}
          title="View map fullscreen"
          aria-label="View drawn area fullscreen"
        >
          <ExpandIcon />
        </button>
      </div>

      {fullscreen && createPortal(
        <div className="aoi-map-fullscreen" role="dialog" aria-modal="true" aria-label="Drawn area fullscreen map">
          <div className="aoi-map-fullscreen-bar">
            <div>
              <p className="aoi-map-fullscreen-kicker">ClimateEye</p>
              <h2>Drawn area</h2>
            </div>
            <button
              type="button"
              className="aoi-map-fullscreen-close"
              onClick={() => setFullscreen(false)}
              title="Exit fullscreen"
              aria-label="Exit fullscreen"
            >
              <CompressIcon />
              <span>Exit</span>
            </button>
          </div>
          <div className="aoi-map-fullscreen-stage">
            <AoiMapView
              positions={positions}
              interactive
              className="aoi-map-fullscreen-leaflet"
              padding={48}
              maxZoom={16}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export default AoiMiniMap
