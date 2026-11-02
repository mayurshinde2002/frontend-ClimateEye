import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polygon, GeoJSON, useMap, Circle, CircleMarker, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import DrawAreaComponent from './DrawAreaComponent'
import { fetchAreaConstruction } from '../services/areaConstruction'
import { CONSTRUCTION_COLOR, describeConstruction } from '../services/constructionTiles'
import { calculateGeometryCenter } from '../services/api'
import RegionalWindMap from './RegionalWindMap'
import TemperatureFieldMap from './TemperatureFieldMap'
import TemperaturePanel from './TemperaturePanel'
import RainFieldMap from './RainFieldMap'
import AQIGridMap from './AQIGridMap'
import SensorDataLayer from './SensorDataLayer'
import CamsMethaneHeatLayer from './CamsMethaneHeatLayer'
import LocationRadiusOverlay, { latLngBoundsForRadius } from './LocationRadiusOverlay'
import './MapComponent.css'

// Fix for default marker icons in Leaflet
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

export const BASEMAPS = {
  streets: {
    id: 'streets',
    label: 'Streets',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    labels: false,
    maxZoom: 19
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    labels: true,
    maxZoom: 19
  },
  terrain: {
    id: 'terrain',
    label: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    labels: false,
    maxZoom: 17
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    // Free OSM tiles + CSS dark filter (no API key / Carto)
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    labels: false,
    maxZoom: 19,
    darkFilter: true
  }
}

const LABEL_TILE_LAYER = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

// Fit map only when needed (KML / methane). Manual draw keeps the current zoom.
const MapViewUpdater = ({ polygonCoordinates, methanePoints, autoFitPolygon = false }) => {
  const map = useMap()
  const lastFitKeyRef = useRef('')

  useEffect(() => {
    const polygonPoints = autoFitPolygon ? (polygonCoordinates || []) : []
    const points = [
      ...polygonPoints,
      ...(methanePoints || [])
    ]
    if (!points.length) {
      lastFitKeyRef.current = ''
      return
    }

    const fitKey = `${autoFitPolygon ? 'kml' : 'methane'}:${points.length}:${points[0]?.[0]}:${points[0]?.[1]}`
    if (fitKey === lastFitKeyRef.current) return
    lastFitKeyRef.current = fitKey

    const bounds = L.latLngBounds(points)
    if (!bounds.isValid()) return

    // Never force a zoom-out below the user's current level for small areas
    const maxZoom = Math.max(map.getZoom() || 12, 15)
    map.fitBounds(bounds, { padding: [50, 50], maxZoom, animate: true })
  }, [polygonCoordinates, methanePoints, autoFitPolygon, map])

  return null
}

const SearchedPlaceMarker = ({ place }) => {
  const markerRef = useRef(null)

  useEffect(() => {
    markerRef.current?.openPopup()
  }, [place])

  return (
    <Marker position={[place.lat, place.lng]} ref={markerRef}>
      <Popup>
        <strong>{place.name}</strong>
        <div>{place.type}{place.context ? ` · ${place.context}` : ''}</div>
      </Popup>
    </Marker>
  )
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)

const todayDate = () => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

const MapPanes = () => {
  const map = useMap()
  const ensurePane = (name, zIndex, pointerEvents = 'none') => {
    const pane = map.getPane(name) || map.createPane(name)
    pane.style.zIndex = String(zIndex)
    pane.style.pointerEvents = pointerEvents
  }
  ensurePane('satelliteBase', 100)
  ensurePane('weatherField', 450)
  ensurePane('aqiGrid', 460, 'auto')
  ensurePane('countryBorders', 520)
  ensurePane('placeLabels', 640)
  return null
}

// Right-click can leave the map looking "stuck". Recover without touching Leaflet internals.
const MapInteractionFix = () => {
  const map = useMap()

  useEffect(() => {
    let alive = true
    const container = map.getContainer()

    const mapAlive = () => alive && map.getContainer() && map._loaded !== false

    const releaseStuckDrag = () => {
      if (!mapAlive()) return
      try {
        L.DomUtil.removeClass(container, 'leaflet-dragging')
        L.DomUtil.removeClass(document.body, 'leaflet-dragging')
        if (map.dragging && !map.dragging.enabled()) map.dragging.enable()
        if (!container.classList.contains('leaflet-crosshair')) {
          container.style.cursor = ''
        }
      } catch {
        // Map may already be unmounting.
      }
    }

    const onContextMenu = (event) => {
      L.DomEvent.preventDefault(event)
      releaseStuckDrag()
    }

    const onMouseUp = (event) => {
      if (event.button === 2) releaseStuckDrag()
    }

    map.on('contextmenu', onContextMenu)
    document.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('blur', releaseStuckDrag)

    return () => {
      alive = false
      document.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('blur', releaseStuckDrag)
      try {
        if (map.getContainer()) map.off('contextmenu', onContextMenu)
      } catch {
        // Ignore teardown races while MapContainer unmounts.
      }
    }
  }, [map])

  return null
}

// Higher-detail Natural Earth borders (coastlines + country lines)
const COUNTRY_BORDERS_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'

const CountryBorders = () => {
  const [data, setData] = useState(null)
  const map = useMap()

  useEffect(() => {
    let cancelled = false
    fetch(COUNTRY_BORDERS_URL)
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load country borders')
        return response.json()
      })
      .then((geojson) => {
        if (!cancelled) setData(geojson)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!data) return undefined
    const layer = L.geoJSON(data, {
      pane: 'countryBorders',
      interactive: false,
      style: () => ({
        color: '#0a0a0a',
        weight: map.getZoom() >= 6 ? 1.15 : 0.9,
        opacity: 0.92,
        fill: false,
        fillOpacity: 0,
        lineJoin: 'round',
        lineCap: 'round'
      })
    })
    layer.addTo(map)

    const syncWeight = () => {
      const weight = map.getZoom() >= 6 ? 1.15 : 0.9
      layer.setStyle({ weight })
    }
    map.on('zoomend', syncWeight)

    return () => {
      map.off('zoomend', syncWeight)
      map.removeLayer(layer)
    }
  }, [data, map])

  return null
}

const MapCenterWatcher = ({ onCenter, onView }) => {
  const map = useMap()

  useEffect(() => {
    let timer = null
    const publish = () => {
      const center = map.getCenter()
      const bounds = map.getBounds()
      const view = {
        latitude: center.lat,
        longitude: center.lng,
        zoom: map.getZoom(),
        bounds: {
          south: bounds.getSouth(),
          west: bounds.getWest(),
          north: bounds.getNorth(),
          east: bounds.getEast()
        }
      }
      onCenter(view)
      onView?.(view)
    }
    publish()
    const update = () => {
      clearTimeout(timer)
      timer = setTimeout(publish, 200)
    }
    map.on('moveend', update)
    return () => {
      clearTimeout(timer)
      map.off('moveend', update)
    }
  }, [map, onCenter, onView])

  return null
}

const colorForEnhancement = (value, legend) => {
  const palette = legend?.palette || ['#1b0c41', '#781c6d', '#ed6925', '#fcffa4']
  const min = legend?.min ?? 0
  const max = legend?.max ?? 300
  const amount = Number(value)
  if (!Number.isFinite(amount) || max <= min) return palette[Math.floor(palette.length / 2)]
  const t = Math.max(0, Math.min(1, (amount - min) / (max - min)))
  const index = Math.min(palette.length - 1, Math.round(t * (palette.length - 1)))
  return palette[index]
}

const MapComponent = ({
  viewType,
  showWind = false,
  showTemperature = false,
  showRain = false,
  showAqi = false,
  showSensorData = false,
  onToggleSensorData,
  drawnGeometry,
  uploadedKML,
  isDrawing,
  onGeometryComplete,
  onCancelDrawing,
  methaneOverlay,
  methaneLoading,
  onClearMethane,
  onMapView,
  locateRequest = 0,
  onLocateStateChange,
  onMapReady,
  searchedPlace = null
}) => {
  const [mapCenter] = useState([20.5937, 78.9629]) // Default to India center
  const [mapZoom] = useState(5)
  const [polygonCoordinates, setPolygonCoordinates] = useState(null)
  const [map, setMap] = useState(null)
  const [areaConstruction, setAreaConstruction] = useState(null)
  const [userLocation, setUserLocation] = useState(null)
  const [selectedRadius, setSelectedRadius] = useState(1000)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState(null)
  const [viewCenter, setViewCenter] = useState({ latitude: mapCenter[0], longitude: mapCenter[1] })

  const handleViewCenter = useMemo(() => (center) => setViewCenter(center), [])

  useEffect(() => {
    onMapReady?.(map || null)
    return () => onMapReady?.(null)
  }, [map, onMapReady])

  const focusPoint = useMemo(() => {
    if (userLocation) return { latitude: userLocation.lat, longitude: userLocation.lng }
    if (searchedPlace) return { latitude: searchedPlace.lat, longitude: searchedPlace.lng }
    if (drawnGeometry) {
      const center = calculateGeometryCenter(drawnGeometry)
      if (center) return center
    }
    return viewCenter
  }, [userLocation, searchedPlace, drawnGeometry, viewCenter])

  const focusLatitude = Number(focusPoint.latitude.toFixed(2))
  const focusLongitude = Number(focusPoint.longitude.toFixed(2))

  const clearUserLocation = () => {
    setUserLocation(null)
    setLocationError(null)
    setLocating(false)
  }

  const locateUser = useCallback(() => {
    // Toggle off: hide marker, rings, and nearby data panel
    if (userLocation) {
      clearUserLocation()
      return
    }
    if (!navigator.geolocation) {
      setLocationError('This browser cannot read your location.')
      return
    }
    setLocating(true)
    setLocationError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        }
        setUserLocation(next)
        setSelectedRadius(1000)
        setLocating(false)
        if (map) {
          const bounds = latLngBoundsForRadius(next.lat, next.lng, 1000)
          map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15, animate: true })
        }
      },
      (err) => {
        setLocating(false)
        const messages = {
          1: 'Location permission was blocked. Allow location for this site and try again.',
          2: 'Your location could not be found.',
          3: 'Finding your location took too long. Try again.'
        }
        setLocationError(messages[err.code] || 'Your location could not be found.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    )
  }, [userLocation, map])

  useEffect(() => {
    if (!locateRequest) return
    locateUser()
    // Only fire when Dashboard increments locateRequest (not when locateUser identity changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [locateRequest])

  useEffect(() => {
    onLocateStateChange?.({
      locating,
      active: Boolean(userLocation),
      error: locationError
    })
  }, [locating, userLocation, locationError, onLocateStateChange])

  useEffect(() => {
    if (!drawnGeometry) {
      setAreaConstruction(null)
      return
    }
    const controller = new AbortController()
    setAreaConstruction(null)
    fetchAreaConstruction(drawnGeometry, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setAreaConstruction(data) })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setAreaConstruction({ features: [], note: err.message })
      })
    return () => controller.abort()
  }, [drawnGeometry])

  const methanePoints = useMemo(() => {
    if (!methaneOverlay?.features?.length) return null
    return methaneOverlay.features
      .map((feature) => {
        const [lng, lat] = feature.geometry?.coordinates || []
        return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
      })
      .filter(Boolean)
  }, [methaneOverlay])

  const aqiGeometry = useMemo(() => {
    if (drawnGeometry?.coordinates?.[0]?.length) return drawnGeometry
    if (!polygonCoordinates?.length) return null
    const ring = polygonCoordinates.map(([lat, lng]) => [lng, lat])
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      ring.push([...first])
    }
    return { type: 'Polygon', coordinates: [ring] }
  }, [drawnGeometry, polygonCoordinates])

  useEffect(() => {
    if (drawnGeometry && drawnGeometry.coordinates) {
      // Convert GeoJSON [lng, lat] to Leaflet [lat, lng]
      const coords = drawnGeometry.coordinates[0].map(coord => [coord[1], coord[0]])
      setPolygonCoordinates(coords)
    } else if (uploadedKML) {
      parseKML(uploadedKML)
    } else {
      setPolygonCoordinates(null)
    }
  }, [drawnGeometry, uploadedKML])

  const parseKML = (kmlData) => {
    try {
      const parser = new DOMParser()
      const kmlDoc = parser.parseFromString(kmlData.content, 'text/xml')
      const errorNode = kmlDoc.querySelector('parsererror')
      
      if (errorNode) {
        console.error('KML parsing error:', errorNode.textContent)
        return
      }

      const coordinatesElements = kmlDoc.querySelectorAll('coordinates')
      if (coordinatesElements.length > 0) {
        const coordsText = coordinatesElements[0].textContent.trim()
        const coordPairs = coordsText.split(/\s+/).filter(c => c.trim())
        
        const coords = coordPairs.map(coord => {
          const [lng, lat] = coord.split(',').map(Number)
          return [lat, lng] // Convert to Leaflet format [lat, lng]
        })
        
        setPolygonCoordinates(coords)
      }
    } catch (error) {
      console.error('Error parsing KML:', error)
    }
  }

  const basemap = BASEMAPS[viewType] || BASEMAPS.dark

  return (
    <div className={`map-container${basemap.darkFilter ? ' map-container--dark-osm' : ''}`}>
      <MapContainer
        ref={setMap}
        center={mapCenter}
        zoom={mapZoom}
        style={{ height: '100%', width: '100%' }}
        className="leaflet-map"
      >
        <MapPanes />
        <MapInteractionFix />
        <MapViewUpdater
          polygonCoordinates={polygonCoordinates}
          methanePoints={methanePoints}
          autoFitPolygon={Boolean(uploadedKML)}
        />
        <MapCenterWatcher onCenter={handleViewCenter} onView={onMapView} />

        {showWind && <RegionalWindMap />}
        {showTemperature && <TemperatureFieldMap />}
        {showRain && <RainFieldMap />}
        {showAqi && <AQIGridMap geometry={aqiGeometry} />}

        {showSensorData && (
          <SensorDataLayer onClose={onToggleSensorData} />
        )}

        {searchedPlace && (
          <SearchedPlaceMarker place={searchedPlace} />
        )}

        {userLocation && (
          <>
            <Circle
              center={[userLocation.lat, userLocation.lng]}
              radius={Math.max(userLocation.accuracy || 0, 20)}
              pathOptions={{ color: '#93c5fd', fillColor: '#93c5fd', fillOpacity: 0.2, weight: 1 }}
            />
            <CircleMarker
              center={[userLocation.lat, userLocation.lng]}
              radius={8}
              pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
            >
              <Popup>
                <strong>Your location</strong>
                {userLocation.accuracy > 0 && <div>Accurate to about {Math.round(userLocation.accuracy)} m</div>}
              </Popup>
            </CircleMarker>
            <LocationRadiusOverlay
              userLocation={userLocation}
              selectedRadius={selectedRadius}
              onSelectRadius={setSelectedRadius}
            />
          </>
        )}

        <TileLayer
          key={`base-${basemap.id}`}
          attribution={basemap.attribution}
          url={basemap.url}
          pane="satelliteBase"
          maxZoom={basemap.maxZoom || 19}
        />

        {basemap.labels && (
          <TileLayer
            key={`labels-${basemap.id}`}
            attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
            url={LABEL_TILE_LAYER}
            pane="placeLabels"
            opacity={1}
          />
        )}

        <CountryBorders />
       
        {polygonCoordinates && (
          <Polygon
            positions={polygonCoordinates}
            pathOptions={{
              color: '#14b8a6',
              fillColor: '#14b8a6',
              fillOpacity: 0.12,
              weight: 2
            }}
          />
        )}

        {areaConstruction?.features?.length > 0 && (
          <GeoJSON
            key={`${areaConstruction.features.length}:${areaConstruction.features[0]?.properties?.id || ''}`}
            data={{ type: 'FeatureCollection', features: areaConstruction.features }}
            style={(feature) => (
              feature.properties.kind === 'site'
                ? { color: CONSTRUCTION_COLOR, weight: 2, dashArray: '6 4', fillColor: CONSTRUCTION_COLOR, fillOpacity: 0.28 }
                : { color: '#b45309', weight: 2, fillColor: CONSTRUCTION_COLOR, fillOpacity: 0.8 }
            )}
            onEachFeature={(feature, layer) => {
              const described = describeConstruction(feature.properties)
              layer.bindPopup(
                `<strong>${escapeHtml(described.title)}</strong>` +
                (described.status ? `<div>${escapeHtml(described.status)}</div>` : '') +
                described.lines.map(line => `<div>${escapeHtml(line)}</div>`).join('')
              )
            }}
          />
        )}
        
        {isDrawing && (
          <DrawAreaComponent
            isDrawing={isDrawing}
            onGeometryComplete={onGeometryComplete}
            onCancel={onCancelDrawing}
          />
        )}

        {methaneOverlay?.tileUrl && (
          <TileLayer
            key={methaneOverlay.tileUrl}
            attribution={methaneOverlay.attribution || 'Google Earth Engine'}
            url={methaneOverlay.tileUrl}
            opacity={0.72}
            zIndex={500}
          />
        )}

        {methaneOverlay?.tileUrls?.map((url) => (
          <TileLayer
            key={url}
            attribution="NASA EMIT · US GHG Center"
            url={url}
            opacity={0.78}
            zIndex={510}
          />
        ))}

        {methaneOverlay?.mode === 'cams-hourly' && (
          <CamsMethaneHeatLayer
            methaneOverlay={methaneOverlay}
            geometry={drawnGeometry || aqiGeometry}
          />
        )}

        {methaneOverlay?.mode !== 'cams-hourly' &&
          methaneOverlay?.features?.map((feature) => {
            const [lng, lat] = feature.geometry?.coordinates || []
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
            const props = feature.properties || {}
            const isEmit = props.source === 'emit'
            const fill = colorForEnhancement(
              props.methane_enhancement_ppm_m ?? (isEmit ? methaneOverlay.legend?.max : null),
              methaneOverlay.legend
            )
            const confidence = props.confidence || 'medium'
            return (
              <CircleMarker
                key={feature.id || `${lat}-${lng}`}
                center={[lat, lng]}
                radius={isEmit || confidence === 'high' ? 9 : 7}
                pathOptions={{
                  color: '#fb9b06',
                  fillColor: isEmit ? '#1b0c41' : fill,
                  fillOpacity: 0.9,
                  weight: 2.5
                }}
              >
                <Popup>
                  <div className="methane-popup">
                    <strong>
                      {isEmit ? 'EMIT methane plume' : 'Methane plume'}
                    </strong>
                    {props.methane_enhancement_ppm_m != null && (
                      <div>
                        Enhancement:{' '}
                        {Number(props.methane_enhancement_ppm_m).toFixed(1)} ppm·m
                      </div>
                    )}
                    {isEmit && (
                      <div>
                        Origin marker · spread shown as EMIT enhancement tiles
                      </div>
                    )}
                    <div>Confidence: {confidence}</div>
                    {props.observed_at && (
                      <div>
                        Observed:{' '}
                        {String(props.observed_at)
                          .replace('T', ' ')
                          .replace('Z', ' UTC')}
                      </div>
                    )}
                    {props.wind_speed_m_s != null && (
                      <div>
                        Wind: {Number(props.wind_speed_m_s).toFixed(1)} m/s at{' '}
                        {props.wind_direction_deg}°
                      </div>
                    )}
                    {props.plume_len_max > 0 && (
                      <div>Plume length: {Math.round(props.plume_len_max)} m</div>
                    )}
                    {isEmit && props.item_id && (
                      <div>ID: {props.item_id}</div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
      </MapContainer>

      {drawnGeometry && (
        <div className="construction-area-note">
          <span className="construction-area-swatch" />
          {areaConstruction
            ? `${areaConstruction.features.length} under construction`
            : 'Looking for under-construction buildings…'}
          {areaConstruction?.note && <div className="construction-area-detail">{areaConstruction.note}</div>}
        </div>
      )}

      {showTemperature && (
        <TemperaturePanel
          latitude={Math.round(focusLatitude * 2) / 2}
          longitude={Math.round(focusLongitude * 2) / 2}
          date={todayDate()}
        />
      )}

      {(methaneLoading || methaneOverlay) && (
        <div className="methane-legend">
          <div className="methane-legend-header">
            <span>
              {methaneOverlay?.mode === 'cams-hourly'
                ? 'Live / Hourly Methane (CAMS)'
                : 'Plume Methane (origin + spread)'}
            </span>
            {onClearMethane && (
              <button type="button" className="methane-legend-close" onClick={onClearMethane}>
                Clear
              </button>
            )}
          </div>
          {methaneLoading ? (
            <p className="methane-legend-note">Loading methane for selected area…</p>
          ) : (
            <>
              <div
                className="methane-legend-bar"
                style={{
                  background: `linear-gradient(to right, ${(methaneOverlay.legend?.palette || ['#1b0c41', '#fcffa4']).join(',')})`
                }}
              />
              <div className="methane-legend-scale">
                <span>{methaneOverlay.legend?.min ?? 0}</span>
                <span>
                  {methaneOverlay.legend?.title || 'Methane'} (
                  {methaneOverlay.legend?.unit ||
                    (methaneOverlay.mode === 'cams-hourly' ? 'μg/m³' : 'ppm-m')}
                  )
                </span>
                <span>{methaneOverlay.legend?.max ?? 300}</span>
              </div>
              <p className="methane-legend-note">
                {methaneOverlay.mode === 'cams-hourly'
                  ? `${methaneOverlay.count ?? methaneOverlay.features?.length ?? 0} CAMS sample(s)`
                  : [
                      methaneOverlay.archiveCount > 0
                        ? `${methaneOverlay.archiveCount} archive plume(s)`
                        : null,
                      methaneOverlay.emitCount > 0
                        ? `${methaneOverlay.emitCount} EMIT plume(s)`
                        : null,
                      methaneOverlay.tileUrl ? 'archive tiles' : null,
                      methaneOverlay.tileUrls?.length
                        ? `${methaneOverlay.tileUrls.length} EMIT tile layer(s)`
                        : null
                    ]
                      .filter(Boolean)
                      .join(' · ') ||
                    `${methaneOverlay.count ?? methaneOverlay.features?.length ?? 0} plume(s)`}
                {methaneOverlay.dateLabel ? ` · ${methaneOverlay.dateLabel}` : ''}
              </p>
              {methaneOverlay.mode === 'cams-hourly' && methaneOverlay.hourly?.length > 0 && (
                <div className="methane-hourly-spark">
                  {(() => {
                    const series = methaneOverlay.hourly
                      .filter((row) => row.methane != null)
                      .slice(-24)
                    if (series.length < 2) return null
                    const vals = series.map((row) => row.methane)
                    const lo = Math.min(...vals)
                    const hi = Math.max(...vals)
                    const span = hi - lo || 1
                    const w = 220
                    const h = 36
                    const points = series
                      .map((row, i) => {
                        const x = (i / (series.length - 1)) * w
                        const y = h - ((row.methane - lo) / span) * (h - 4) - 2
                        return `${x.toFixed(1)},${y.toFixed(1)}`
                      })
                      .join(' ')
                    return (
                      <>
                        <svg
                          className="methane-hourly-spark-svg"
                          viewBox={`0 0 ${w} ${h}`}
                          width="100%"
                          height={h}
                          aria-hidden="true"
                        >
                          <polyline
                            fill="none"
                            stroke="#fb9b06"
                            strokeWidth="2"
                            points={points}
                          />
                        </svg>
                        <p className="methane-legend-note">Last 24 hourly values (μg/m³)</p>
                      </>
                    )
                  })()}
                </div>
              )}
              {methaneOverlay.attribution && (
                <p className="methane-legend-note">{methaneOverlay.attribution}</p>
              )}
              {methaneOverlay.note && <p className="methane-legend-note">{methaneOverlay.note}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default MapComponent

