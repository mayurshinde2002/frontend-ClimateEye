import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import './DrawAreaComponent.css'

const DrawAreaComponent = ({ isDrawing, onGeometryComplete, onCancel }) => {
  const map = useMap()
  const pointsRef = useRef([])
  const markersRef = useRef([])
  const polylineRef = useRef(null)
  const [isActive, setIsActive] = useState(false)
  const [pointCount, setPointCount] = useState(0)
  const handlersRef = useRef({ click: null, dblclick: null })

  const restoreMapControls = useCallback(() => {
    try {
      if (!map?.getContainer?.()) return
      map.doubleClickZoom?.enable()
      map.boxZoom?.enable()
      map.dragging?.enable()
      map.scrollWheelZoom?.enable()
      map.getContainer().style.cursor = ''
      L.DomUtil.removeClass(map.getContainer(), 'leaflet-dragging')
      L.DomUtil.removeClass(document.body, 'leaflet-dragging')
    } catch {
      // Map may already be unmounting.
    }
  }, [map])

  const cleanup = useCallback(() => {
    markersRef.current.forEach((marker) => map.removeLayer(marker))
    markersRef.current = []

    if (polylineRef.current) {
      map.removeLayer(polylineRef.current)
      polylineRef.current = null
    }

    pointsRef.current = []
    setPointCount(0)
  }, [map])

  const finishDrawing = useCallback(() => {
    if (pointsRef.current.length < 3) return

    const closedPoints = [...pointsRef.current, pointsRef.current[0]]
    const coordinates = closedPoints.map(([lat, lng]) => [lng, lat])
    const geometry = {
      type: 'Polygon',
      coordinates: [coordinates]
    }

    onGeometryComplete(geometry)
    cleanup()
    restoreMapControls()
  }, [onGeometryComplete, cleanup, restoreMapControls])

  useEffect(() => {
    if (!isDrawing) {
      setIsActive(false)
      restoreMapControls()
      cleanup()
      return undefined
    }

    setIsActive(true)
    map.getContainer().style.cursor = 'crosshair'
    // Double-click finishes the polygon — don't also zoom the map.
    map.doubleClickZoom?.disable()
    map.boxZoom?.disable()
    pointsRef.current = []
    markersRef.current = []
    setPointCount(0)

    const handleMapClick = (e) => {
      const { lat, lng } = e.latlng
      pointsRef.current.push([lat, lng])
      setPointCount(pointsRef.current.length)

      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'draw-marker',
          html: '<div class="marker-dot"></div>',
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        }),
        interactive: false,
        keyboard: false
      }).addTo(map)

      markersRef.current.push(marker)

      if (polylineRef.current) {
        map.removeLayer(polylineRef.current)
      }

      if (pointsRef.current.length > 1) {
        polylineRef.current = L.polyline(pointsRef.current, {
          color: '#14b8a6',
          weight: 2,
          dashArray: '5, 5',
          opacity: 0.7,
          interactive: false
        }).addTo(map)
      }
    }

    const handleDoubleClick = (e) => {
      L.DomEvent.preventDefault(e)
      L.DomEvent.stop(e)
      if (pointsRef.current.length >= 3) {
        finishDrawing()
      }
    }

    const handleContextMenu = (e) => {
      L.DomEvent.preventDefault(e)
      L.DomEvent.stop(e)
    }

    handlersRef.current.click = handleMapClick
    handlersRef.current.dblclick = handleDoubleClick

    map.on('click', handleMapClick)
    map.on('dblclick', handleDoubleClick)
    map.on('contextmenu', handleContextMenu)

    return () => {
      try {
        if (map?.getContainer?.()) {
          map.off('click', handleMapClick)
          map.off('dblclick', handleDoubleClick)
          map.off('contextmenu', handleContextMenu)
        }
      } catch {
        // Ignore teardown races while MapContainer unmounts.
      }
      handlersRef.current.click = null
      handlersRef.current.dblclick = null
      cleanup()
      restoreMapControls()
    }
  }, [isDrawing, map, cleanup, finishDrawing, restoreMapControls])

  if (!isActive) {
    return null
  }

  return (
    <div className="draw-controls-overlay">
      <div className="draw-instructions">
        <p>Click on the map to add points</p>
        <p>Double-click or click "Finish" to complete</p>
      </div>
      <div className="draw-actions">
        <button
          className="draw-button finish-button"
          onClick={finishDrawing}
          disabled={pointCount < 3}
          type="button"
        >
          Finish Drawing
        </button>
        <button
          className="draw-button cancel-button"
          type="button"
          onClick={() => {
            cleanup()
            restoreMapControls()
            onCancel()
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default DrawAreaComponent
