import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  CONSTRUCTION_ATTRIBUTION,
  CONSTRUCTION_COLOR,
  CONSTRUCTION_MINZOOM,
  CONSTRUCTION_SOURCE_LAYER,
  describeConstruction
} from '../services/constructionTiles'

const isSite = (_zoom, feature) => feature.props.kind === 'site'
const isBuilding = (_zoom, feature) => feature.props.kind !== 'site'

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

const popupHtml = (props) => {
  const { title, status, lines } = describeConstruction(props)
  return `<div class="construction-popup"><strong>${escapeHtml(title)}</strong>` +
    (status ? `<div class="construction-popup-status">${escapeHtml(status)}</div>` : '') +
    lines.map(line => `<div>${escapeHtml(line)}</div>`).join('') +
    '</div>'
}

/**
 * Draws the India construction PMTiles on the Leaflet map (rendered client-side by protomaps-leaflet)
 */
const ConstructionLayer2D = ({ tiles, visible = true, interactive = true }) => {
  const map = useMap()
  const interactiveRef = useRef(interactive)
  interactiveRef.current = interactive

  useEffect(() => {
    if (!tiles?.url || !visible) return
    let layer = null
    let cancelled = false

    const handleClick = (event) => {
      if (!layer || !interactiveRef.current || map.getZoom() < CONSTRUCTION_MINZOOM) return
      const picked = Array.from(layer.queryTileFeaturesDebug(event.latlng.lng, event.latlng.lat).values())
        .flat()
        .filter(item => item.layerName === CONSTRUCTION_SOURCE_LAYER)
      if (!picked.length) return
      // Prefer a building over the site that surrounds it
      const best = picked.find(item => item.feature.props.kind !== 'site') || picked[0]
      L.popup().setLatLng(event.latlng).setContent(popupHtml(best.feature.props)).openOn(map)
    }

    import('protomaps-leaflet').then(({ leafletLayer, PolygonSymbolizer, LineSymbolizer }) => {
      if (cancelled) return
      layer = leafletLayer({
        url: tiles.url,
        maxDataZoom: 14,
        zIndex: 600,
        attribution: CONSTRUCTION_ATTRIBUTION,
        paintRules: [
          {
            dataLayer: CONSTRUCTION_SOURCE_LAYER,
            minzoom: CONSTRUCTION_MINZOOM,
            filter: isSite,
            symbolizer: new PolygonSymbolizer({ fill: CONSTRUCTION_COLOR, opacity: 0.18 })
          },
          {
            dataLayer: CONSTRUCTION_SOURCE_LAYER,
            minzoom: CONSTRUCTION_MINZOOM,
            filter: isSite,
            symbolizer: new LineSymbolizer({ color: CONSTRUCTION_COLOR, width: 2, dash: [6, 4] })
          },
          {
            dataLayer: CONSTRUCTION_SOURCE_LAYER,
            minzoom: CONSTRUCTION_MINZOOM,
            filter: isBuilding,
            symbolizer: new PolygonSymbolizer({ fill: CONSTRUCTION_COLOR, opacity: 0.6, stroke: '#b45309', width: 1.5 })
          }
        ],
        labelRules: []
      })
      layer.addTo(map)
      map.on('click', handleClick)
    }).catch((err) => {
      console.warn('[Construction] Could not load the 2D construction layer:', err.message)
    })

    return () => {
      cancelled = true
      map.off('click', handleClick)
      if (layer) map.removeLayer(layer)
    }
  }, [map, tiles, visible])

  return null
}

export default ConstructionLayer2D
