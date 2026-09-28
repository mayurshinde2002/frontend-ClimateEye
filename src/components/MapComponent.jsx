import React, { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polygon, useMap, CircleMarker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import DrawAreaComponent from './DrawAreaComponent'
import './MapComponent.css'

// Fix for default marker icons in Leaflet
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// Component to handle map view changes and zoom to bounds
const MapViewUpdater = ({ polygonCoordinates, methanePoints }) => {
  const map = useMap()
  
  useEffect(() => {
    const points = [
      ...(polygonCoordinates || []),
      ...(methanePoints || [])
    ]
    if (points.length > 0) {
      const bounds = L.latLngBounds(points)
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 11 })
    }
  }, [polygonCoordinates, methanePoints, map])
  
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
  drawnGeometry,
  uploadedKML,
  isDrawing,
  onGeometryComplete,
  onCancelDrawing,
  methaneOverlay,
  methaneLoading,
  onClearMethane
}) => {
  const [mapCenter] = useState([20.5937, 78.9629]) // Default to India center
  const [mapZoom] = useState(5)
  const [polygonCoordinates, setPolygonCoordinates] = useState(null)

  const methanePoints = useMemo(() => {
    if (!methaneOverlay?.features?.length) return null
    return methaneOverlay.features
      .map((feature) => {
        const [lng, lat] = feature.geometry?.coordinates || []
        return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
      })
      .filter(Boolean)
  }, [methaneOverlay])

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

  // Light theme tile layer (matching UI light colors)
  const lightTileLayer = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
  
  // Satellite tile layer (using Esri World Imagery)
  const satelliteTileLayer = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  
  // Label layer overlay for location names only (shows place names, cities, states, countries)
  // Using World Boundaries and Places - provides clean labels without road clutter
  const labelTileLayer = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

  return (
    <div className="map-container">
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        style={{ height: '100%', width: '100%' }}
        className="leaflet-map"
      >
        <MapViewUpdater polygonCoordinates={polygonCoordinates} methanePoints={methanePoints} />
       
        {/* Satellite imagery base layer */}
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
          url={satelliteTileLayer}
        />
        
        {/* Label layer overlay for location names - shows place names, cities, states, countries */}
        {/* Using World Boundaries and Places - provides clean labels (location names only) without road clutter */}
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
          url={labelTileLayer}
          opacity={1}
          zIndex={1000}
        />
       
        {polygonCoordinates && (
          <Polygon
            positions={polygonCoordinates}
            pathOptions={{
              color: '#14b8a6',
              fillColor: '#14b8a6',
              fillOpacity: 0.25,
              weight: 2
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

        {methaneOverlay?.features?.map((feature) => {
          const [lng, lat] = feature.geometry?.coordinates || []
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
          const props = feature.properties || {}
          const fill = colorForEnhancement(props.methane_enhancement_ppm_m, methaneOverlay.legend)
          const confidence = props.confidence || 'medium'
          return (
            <CircleMarker
              key={feature.id || `${lat}-${lng}`}
              center={[lat, lng]}
              radius={confidence === 'high' ? 9 : 7}
              pathOptions={{
                color: confidence === 'high' ? '#fb9b06' : '#c4b5fd',
                fillColor: fill,
                fillOpacity: 0.9,
                weight: 2
              }}
            >
              <Popup>
                <div className="methane-popup">
                  <strong>Methane plume</strong>
                  <div>Enhancement: {Number(props.methane_enhancement_ppm_m || 0).toFixed(1)} ppm·m</div>
                  <div>Confidence: {confidence}</div>
                  {props.observed_at && <div>Observed: {props.observed_at.replace('T', ' ').replace('Z', ' UTC')}</div>}
                  {props.wind_speed_m_s != null && (
                    <div>Wind: {Number(props.wind_speed_m_s).toFixed(1)} m/s at {props.wind_direction_deg}°</div>
                  )}
                  {props.plume_len_max > 0 && (
                    <div>Plume length: {Math.round(props.plume_len_max)} m</div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
      </MapContainer>

      {(methaneLoading || methaneOverlay) && (
        <div className="methane-legend">
          <div className="methane-legend-header">
            <span>Methane analysis</span>
            {onClearMethane && (
              <button type="button" className="methane-legend-close" onClick={onClearMethane}>
                Clear
              </button>
            )}
          </div>
          {methaneLoading ? (
            <p className="methane-legend-note">Loading plumes and tiles…</p>
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
                <span>{methaneOverlay.legend?.title || 'Methane'} ({methaneOverlay.legend?.unit || 'ppm-m'})</span>
                <span>{methaneOverlay.legend?.max ?? 300}</span>
              </div>
              <p className="methane-legend-note">
                {methaneOverlay.count ?? methaneOverlay.features?.length ?? 0} plumes
                {methaneOverlay.dateLabel ? ` · ${methaneOverlay.dateLabel}` : ''}
              </p>
              {methaneOverlay.note && <p className="methane-legend-note">{methaneOverlay.note}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default MapComponent

