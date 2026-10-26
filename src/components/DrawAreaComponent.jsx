import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import './DrawAreaComponent.css'

const DrawAreaComponent = ({ isDrawing, onGeometryComplete, onCancel }) => {
  const map = useMap()
  const pointsRef = useRef([])
  const markersRef = useRef([])
  const polylineRef = useRef(null)
  const wasDrawingRef = useRef(false)
  const onCompleteRef = useRef(onGeometryComplete)
  const onCancelRef = useRef(onCancel)
  const [isActive, setIsActive] = useState(false)
  const [pointCount, setPointCount] = useState(0)

  useEffect(() => {
    onCompleteRef.current = onGeometryComplete
  }, [onGeometryComplete])

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  const restoreMapControls = useCallback(() => {
    try {
      if (!map?.getContainer?.()) return
      map.doubleClickZoom?.enable()
      map.boxZoom?.enable()
      map.getContainer().style.cursor = ''
      L.DomUtil.removeClass(map.getContainer(), 'leaflet-dragging')
      L.DomUtil.removeClass(document.body, 'leaflet-dragging')
    } catch {
      // Map may already be unmounting.
    }
  }, [map])

  const clearLayers = useCallback(() => {
    if (!map) return
    markersRef.current.forEach((marker) => {
      try { map.removeLayer(marker) } catch { /* ignore */ }
    })
    markersRef.current = []

    if (polylineRef.current) {
      try { map.removeLayer(polylineRef.current) } catch { /* ignore */ }
      polylineRef.current = null
    }
  }, [map])

  const resetSession = useCallback(() => {
    clearLayers()
    pointsRef.current = []
    setPointCount(0)
  }, [clearLayers])

  const redrawPolyline = useCallback(() => {
    if (!map) return
    if (polylineRef.current) {
      try { map.removeLayer(polylineRef.current) } catch { /* ignore */ }
      polylineRef.current = null
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
  }, [map])

  const finishDrawing = useCallback(() => {
    if (pointsRef.current.length < 3) return

    const closedPoints = [...pointsRef.current, pointsRef.current[0]]
    const coordinates = closedPoints.map(([lat, lng]) => [lng, lat])
    const geometry = {
      type: 'Polygon',
      coordinates: [coordinates]
    }

    onCompleteRef.current?.(geometry)
    resetSession()
    restoreMapControls()
    wasDrawingRef.current = false
    setIsActive(false)
  }, [resetSession, restoreMapControls])

  const cancelDrawing = useCallback(() => {
    resetSession()
    restoreMapControls()
    wasDrawingRef.current = false
    setIsActive(false)
    onCancelRef.current?.()
  }, [resetSession, restoreMapControls])

  useEffect(() => {
    if (!map) return undefined

    // Leaving draw mode — clear session
    if (!isDrawing) {
      if (wasDrawingRef.current) {
        resetSession()
        restoreMapControls()
        wasDrawingRef.current = false
      }
      setIsActive(false)
      return undefined
    }

    const startingFresh = !wasDrawingRef.current
    wasDrawingRef.current = true
    setIsActive(true)
    map.getContainer().style.cursor = 'crosshair'
    // Double-click finishes the polygon — don't also zoom the map.
    map.doubleClickZoom?.disable()
    map.boxZoom?.disable()
    // Keep dragging / scroll zoom so user can pan mid-draw without losing points.

    if (startingFresh) {
      resetSession()
    } else {
      // Effect re-ran (parent re-render / callback identity) — keep points, refresh line
      setPointCount(pointsRef.current.length)
      redrawPolyline()
    }

    const handleMapClick = (e) => {
      // Ignore click that ends a pan/drag
      if (e.originalEvent?.defaultPrevented) return
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
      redrawPolyline()
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
      // Do NOT reset points here — pan/parent re-render must keep in-progress drawing.
    }
  }, [isDrawing, map, resetSession, restoreMapControls, redrawPolyline, finishDrawing])

  if (!isActive) {
    return null
  }

  return (
    <div className="draw-controls-overlay">
      <div className="draw-instructions">
        <p>Click on the map to add points (you can pan/zoom while drawing)</p>
        <p>Double-click or click "Finish" to complete</p>
      </div>
      <div className="draw-actions">
        <button
          className="draw-button finish-button"
          onClick={finishDrawing}
          disabled={pointCount < 3}
          type="button"
        >
          Finish Drawing ({pointCount})
        </button>
        <button
          className="draw-button cancel-button"
          type="button"
          onClick={cancelDrawing}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default DrawAreaComponent
