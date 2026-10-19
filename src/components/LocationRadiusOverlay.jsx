import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Circle, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import { fetchAQIData, fetchBuildings, fetchWeatherData } from '../services/api'
import { ringCentroid } from '../utils/polygonIndex'

export const DISTANCE_RADII = [
  { meters: 100, label: '100 m' },
  { meters: 200, label: '200 m' },
  { meters: 500, label: '500 m' },
  { meters: 1000, label: '1 km' }
]

const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const toRad = (value) => (value * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const boundsForRadius = (lat, lng, meters) => {
  const pad = meters * 1.15
  const dLat = pad / 111320
  const dLng = pad / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
  return `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`
}

const formatRadius = (meters) => (
  meters >= 1000 ? `${meters / 1000} km` : `${meters} m`
)

const LocationRadiusOverlay = ({ userLocation, selectedRadius, onSelectRadius }) => {
  const map = useMap()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [aqi, setAqi] = useState(null)
  const [weather, setWeather] = useState(null)
  const [buildings, setBuildings] = useState(null)

  useEffect(() => {
    if (!userLocation || !map) return
    const circle = L.circle([userLocation.lat, userLocation.lng], { radius: selectedRadius })
    map.fitBounds(circle.getBounds(), { padding: [48, 48], maxZoom: 17, animate: true })
  }, [map, userLocation, selectedRadius])

  useEffect(() => {
    if (!userLocation) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)

    const { lat, lng } = userLocation
    const bounds = boundsForRadius(lat, lng, selectedRadius)

    Promise.all([
      fetchAQIData(lat, lng).catch(() => null),
      fetchWeatherData(lat, lng).catch(() => null),
      fetchBuildings(bounds).catch((err) => {
        if (err?.status === 404) return { geojson: { features: [] }, note: 'Buildings unavailable here' }
        throw err
      })
    ])
      .then(([aqiData, weatherData, buildingData]) => {
        if (cancelled) return
        setAqi(aqiData)
        setWeather(weatherData)

        const features = (buildingData?.geojson?.features || []).filter((feature) => {
          const centroid = ringCentroid(feature.geometry)
          if (!centroid) return false
          const [featureLng, featureLat] = centroid
          return haversineMeters(lat, lng, featureLat, featureLng) <= selectedRadius
        })
        setBuildings({
          type: 'FeatureCollection',
          features,
          note: buildingData?.note || null,
          truncated: Boolean(buildingData?.truncated)
        })
      })
      .catch((err) => {
        if (cancelled) return
        setAqi(null)
        setWeather(null)
        setBuildings(null)
        setError(err.message || 'Could not load nearby data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [userLocation, selectedRadius])

  const buildingStyle = useMemo(() => ({
    color: '#0f766e',
    weight: 1,
    fillColor: '#14b8a6',
    fillOpacity: 0.55
  }), [])

  if (!userLocation) return null

  const aqiValue = aqi?.aqi ?? aqi?.aqi_0to3m ?? aqi?.european_aqi ?? aqi?.us_aqi ?? aqi?.current?.aqi
  const temperature = weather?.temperature ?? weather?.current?.temperature
  const condition = weather?.condition ?? weather?.current?.condition

  return (
    <>
      {DISTANCE_RADII.map(({ meters }) => {
        const selected = meters === selectedRadius
        return (
          <Circle
            key={meters}
            center={[userLocation.lat, userLocation.lng]}
            radius={meters}
            pathOptions={{
              color: selected ? '#f59e0b' : '#2563eb',
              weight: selected ? 2.5 : 1.25,
              dashArray: selected ? null : '4 6',
              fillColor: selected ? '#f59e0b' : '#3b82f6',
              fillOpacity: selected ? 0.14 : 0.04,
              interactive: true
            }}
            eventHandlers={{
              click: () => onSelectRadius(meters)
            }}
          />
        )
      })}

      {buildings?.features?.length > 0 && (
        <GeoJSON
          key={`radius-buildings-${selectedRadius}-${buildings.features.length}`}
          data={buildings}
          style={buildingStyle}
          onEachFeature={(feature, layer) => {
            const height = feature.properties?.height
            const label = height != null && Number.isFinite(Number(height))
              ? `Building · ${Number(height).toFixed(1)} m`
              : 'Building'
            layer.bindPopup(`<strong>${label}</strong>`)
          }}
        />
      )}

      {createPortal(
        <div className="location-radius-panel">
          <div className="location-radius-title">Near you</div>
          <div className="location-radius-toggles" role="group" aria-label="Distance radius">
            {DISTANCE_RADII.map(({ meters, label }) => (
              <button
                key={meters}
                type="button"
                className={`location-radius-button${selectedRadius === meters ? ' active' : ''}`}
                onClick={() => onSelectRadius(meters)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="location-radius-selected">
            Within {formatRadius(selectedRadius)}
          </div>

          {loading && <div className="location-radius-note">Loading nearby data…</div>}
          {!loading && error && <div className="location-radius-note warning">{error}</div>}

          {!loading && !error && (
            <div className="location-radius-stats">
              <div className="location-radius-stat">
                <span>AQI</span>
                <strong>{aqiValue != null ? Math.round(aqiValue) : '—'}</strong>
              </div>
              <div className="location-radius-stat">
                <span>Temp</span>
                <strong>{temperature != null ? `${Number(temperature).toFixed(1)}°` : '—'}</strong>
              </div>
              <div className="location-radius-stat">
                <span>Buildings</span>
                <strong>{buildings?.features?.length ?? '—'}</strong>
              </div>
            </div>
          )}

          {!loading && !error && condition && (
            <div className="location-radius-condition">{condition}</div>
          )}
          {!loading && !error && buildings?.note && (
            <div className="location-radius-note">{buildings.note}</div>
          )}
          {!loading && !error && buildings?.truncated && (
            <div className="location-radius-note">Building list may be incomplete for this area</div>
          )}
          <div className="location-radius-footnote">
            AQI & temp at your location · buildings inside the selected ring
          </div>
        </div>,
        map.getContainer().parentElement || map.getContainer()
      )}
    </>
  )
}

export default LocationRadiusOverlay
