import React, { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polygon, useMap } from 'react-leaflet'
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
const MapViewUpdater = ({ viewType, polygonCoordinates }) => {
  const map = useMap()
  
  useEffect(() => {
    if (polygonCoordinates && polygonCoordinates.length > 0) {
      // Calculate bounds from polygon coordinates
      const bounds = L.latLngBounds(polygonCoordinates)
      map.fitBounds(bounds, { padding: [50, 50] })
    }
  }, [polygonCoordinates, map])
  
  return null
}

const MapComponent = ({ viewType, drawnGeometry, uploadedKML, isDrawing, onGeometryComplete, onCancelDrawing }) => {
  const [mapCenter] = useState([20.5937, 78.9629]) // Default to India center
  const [mapZoom] = useState(5)
  const [polygonCoordinates, setPolygonCoordinates] = useState(null)

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
        <MapViewUpdater viewType={viewType} polygonCoordinates={polygonCoordinates} />
       
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
      </MapContainer>
    </div>
  )
}

export default MapComponent

