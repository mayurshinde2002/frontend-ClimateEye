import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, { Source, Layer, Popup, NavigationControl, AttributionControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { boundsFromGeometry, fetchBuildings } from '../services/api'
import { fetchAreaConstruction } from '../services/areaConstruction'
import { createPolygonIndex, pointInGeometry, ringCentroid } from '../utils/polygonIndex'
import {
  OVERTURE_ATTRIBUTION,
  describeBuildingSource,
  getLatestBuildings,
  getOvertureBuildingsUrl,
  registerPmtilesProtocol
} from '../services/overtureBuildings'
import './Building3DView.css'

registerPmtilesProtocol()

const BASE_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const SATELLITE_TILES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']
const TERRAIN_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png']
const TERRAIN_SOURCE_ID = 'terrain-dem'
const OVERTURE_SOURCE_ID = 'overture-buildings'
const GOOGLE_SOURCE_ID = 'google-buildings'
const OVERTURE_PREFIX = 'overture-buildings-3d'
const PARTS_PREFIX = 'overture-building-parts-3d'
const GOOGLE_PREFIX = 'google-buildings-3d'
const LATEST_SOURCE_ID = 'latest-buildings'
const LATEST_PREFIX = 'latest-buildings-3d'
const CONSTRUCTION_LAYER_ID = 'latest-buildings-construction'
const DRAWN_CONSTRUCTION_PREFIX = 'drawn-construction'
const CONSTRUCTION_COLOR = '#f59e0b'
const BUILDING_MINZOOM = 13
const DEFAULT_HEIGHT = 4
const FLOOR_HEIGHT = 3
// Muted plaster, stone and brick tones, picked per building so neighbours differ
const WALL_COLORS = [
  '#f3efe7', '#e9e2d6', '#ddd3c4', '#d4d8dc',
  '#e6d8c6', '#cdbba7', '#efe9e1', '#d9c7b2',
  '#c9b19b', '#e4e1dc', '#d8cdbf', '#f0e6d8',
  '#cfc6bb', '#e2d5c9', '#bfae9c', '#e8e4dc'
]
const GLASS_COLOR = '#6f8396'
// Fraction of each floor taken by the solid wall strip under the windows
const SPANDREL_RATIO = 0.4

const MIN_FLOORS_FOR_DETAIL = 3
const MIN_HEIGHT_FOR_DETAIL = 7
const MAX_FLOOR_HEIGHT = 4.5
// Buildings taller than this keep their real height but are split into this many bands
const MAX_DRAWN_FLOORS = 40
const FLOOR_DETAIL_MINZOOM = 15

const MAP_LIGHT = { anchor: 'viewport', color: '#ffffff', intensity: 0.35, position: [1.4, 210, 35] }
const MAP_SKY = {
  'sky-color': '#a9d3f5',
  'horizon-color': '#e8f2fb',
  'fog-color': '#eef2f6',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.85
}

const numberProp = (name) => ['to-number', ['get', name], 0]
const rawHeight = numberProp('height')
const rawNumFloors = numberProp('num_floors')
const rawMinFloor = ['max', 0, numberProp('min_floor')]
// num_floors counts from the ground, so a raised building part only spans num_floors - min_floor
const rawFloors = ['max', 0, ['-', rawNumFloors, rawMinFloor]]

const topValue = [
  'case',
  ['>', rawHeight, 0], rawHeight,
  ['>', rawNumFloors, 0], ['*', rawNumFloors, FLOOR_HEIGHT],
  DEFAULT_HEIGHT
]
// min_height / min_floor lift building parts such as towers on podiums off the ground
const baseValue = [
  'max',
  0,
  ['min', ['max', numberProp('min_height'), ['*', rawMinFloor, FLOOR_HEIGHT]], ['-', topValue, 1]]
]
const spanValue = ['-', topValue, baseValue]

// 3-storey homes are often only 7-8 m tall, so anything from 7 m gets at least 3 floors
const floorsFromSpan = [
  'case',
  ['>=', spanValue, MIN_HEIGHT_FOR_DETAIL], ['max', MIN_FLOORS_FOR_DETAIL, ['round', ['/', spanValue, FLOOR_HEIGHT]]],
  ['max', 1, ['round', ['/', spanValue, FLOOR_HEIGHT]]]
]
// Some records pair a large height with a too-small floor count, so floors are never taller than MAX_FLOOR_HEIGHT
const floorCount = [
  'max',
  1,
  ['round', rawFloors],
  ['case', ['>', rawFloors, 0], ['round', ['/', spanValue, MAX_FLOOR_HEIGHT]], floorsFromSpan]
]

const drawnFloors = ['min', floorCount, MAX_DRAWN_FLOORS]
const floorHeight = ['/', spanValue, drawnFloors]

// Overture ids are UUIDs, so one hex character gives a stable 0-15 index; Google features fall back to their area
const paletteIndex = [
  'case',
  ['has', 'id'], ['max', 0, ['index-of', ['slice', ['to-string', ['get', 'id']], 7, 8], '0123456789abcdef']],
  ['%', ['round', ['*', numberProp('area_m2'), 10]], WALL_COLORS.length]
]
const wallColor = ['to-color', ['get', 'facade_color'], ['at', paletteIndex, ['literal', WALL_COLORS]]]

const aboveGround = ['!=', ['get', 'is_underground'], true]
const hasFloorDetail = ['>=', floorCount, MIN_FLOORS_FOR_DETAIL]

// Each floor is a solid wall strip with a glass window band above it, as separate layers so faces
// never overlap. The top floor is solid so the roof keeps the wall colour.
// A floor layer only holds buildings with at least that many floors, so GPU cost grows with total floors.
const createBuildingLayers = (prefix, { sourceLayer, filter = true } = {}) => {
  const shared = { type: 'fill-extrusion', ...(sourceLayer ? { 'source-layer': sourceLayer } : {}) }
  const baseFilter = ['all', aboveGround, filter]

  const massLayer = (id, extraFilter, extra = {}) => ({
    ...shared,
    id,
    minzoom: BUILDING_MINZOOM,
    filter: ['all', baseFilter, extraFilter],
    ...extra,
    paint: {
      'fill-extrusion-base': baseValue,
      'fill-extrusion-height': topValue,
      'fill-extrusion-color': wallColor,
      'fill-extrusion-opacity': 1,
      'fill-extrusion-vertical-gradient': true
    }
  })

  const floorLayers = Array.from({ length: MAX_DRAWN_FLOORS }, (_, index) => {
    const floorBase = ['+', baseValue, ['*', floorHeight, index]]
    const floorTop = ['+', baseValue, ['*', floorHeight, index + 1]]
    const glassBase = ['+', floorBase, ['*', floorHeight, SPANDREL_RATIO]]
    const isTopFloor = ['==', drawnFloors, index + 1]
    return [
      {
        ...shared,
        id: `${prefix}-wall-${index}`,
        minzoom: FLOOR_DETAIL_MINZOOM,
        filter: ['all', baseFilter, hasFloorDetail, ['>', drawnFloors, index]],
        paint: {
          'fill-extrusion-base': floorBase,
          'fill-extrusion-height': ['case', isTopFloor, floorTop, glassBase],
          'fill-extrusion-color': wallColor,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': false
        }
      },
      {
        ...shared,
        id: `${prefix}-glass-${index}`,
        minzoom: FLOOR_DETAIL_MINZOOM,
        filter: ['all', baseFilter, hasFloorDetail, ['>', drawnFloors, index + 1]],
        paint: {
          'fill-extrusion-base': glassBase,
          'fill-extrusion-height': floorTop,
          'fill-extrusion-color': GLASS_COLOR,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': false
        }
      }
    ]
  }).flat()

  return [
    massLayer(prefix, ['!', hasFloorDetail]),
    massLayer(`${prefix}-multistorey`, hasFloorDetail, { maxzoom: FLOOR_DETAIL_MINZOOM }),
    ...floorLayers
  ]
}

// Buildings mapped in parts are drawn from their building_part pieces instead
const OVERTURE_BUILDING_FILTER = ['!=', ['get', 'has_parts'], true]
const googleBuildingLayers = createBuildingLayers(GOOGLE_PREFIX)
const latestBuildingLayers = createBuildingLayers(LATEST_PREFIX, { filter: ['==', ['get', 'status'], 'complete'] })
const constructionLayer = {
  id: CONSTRUCTION_LAYER_ID,
  type: 'fill-extrusion',
  minzoom: BUILDING_MINZOOM,
  filter: ['==', ['get', 'status'], 'construction'],
  paint: {
    'fill-extrusion-base': baseValue,
    'fill-extrusion-height': topValue,
    'fill-extrusion-color': CONSTRUCTION_COLOR,
    'fill-extrusion-opacity': 0.45
  }
}
const isDrawnSite = ['==', ['get', 'kind'], 'site']
const drawnConstructionLayers = [
  {
    id: `${DRAWN_CONSTRUCTION_PREFIX}-site-fill`,
    type: 'fill',
    minzoom: 10,
    filter: isDrawnSite,
    paint: { 'fill-color': CONSTRUCTION_COLOR, 'fill-opacity': 0.18 }
  },
  {
    id: `${DRAWN_CONSTRUCTION_PREFIX}-site-line`,
    type: 'line',
    minzoom: 10,
    filter: isDrawnSite,
    paint: { 'line-color': CONSTRUCTION_COLOR, 'line-width': 2, 'line-dasharray': [3, 2] }
  },
  {
    id: `${DRAWN_CONSTRUCTION_PREFIX}-building`,
    type: 'fill-extrusion',
    minzoom: 10,
    filter: ['!', isDrawnSite],
    paint: {
      'fill-extrusion-base': 0,
      'fill-extrusion-height': ['case', ['>', rawHeight, 0], rawHeight, 6],
      'fill-extrusion-color': CONSTRUCTION_COLOR,
      'fill-extrusion-opacity': 0.55
    }
  }
]
const interactiveBuildingLayerIds = [
  ...createBuildingLayers(OVERTURE_PREFIX).map(layer => layer.id),
  ...createBuildingLayers(PARTS_PREFIX).map(layer => layer.id),
  ...googleBuildingLayers.map(layer => layer.id),
  ...latestBuildingLayers.map(layer => layer.id),
  CONSTRUCTION_LAYER_ID
]

const formatDate = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

const hasMeasuredHeight = (props) => (
  Number(props.height) > 0 || Number(props.num_floors) > 0 || props.has_parts === true
)

const parseBounds = (bounds) => {
  const [minLng, minLat, maxLng, maxLat] = bounds.split(',').map(Number)
  return [[minLng, minLat], [maxLng, maxLat]]
}

const boundsAroundView = (view) => {
  if (!view || !Number.isFinite(view.latitude) || !Number.isFinite(view.longitude)) return null
  const bounds = view.bounds
  if (bounds) {
    const latSpan = bounds.north - bounds.south
    const lngSpan = bounds.east - bounds.west
    if (latSpan > 0 && latSpan <= 0.08 && lngSpan > 0 && lngSpan <= 0.08) {
      return `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`
    }
  }
  const half = 0.012
  return `${view.longitude - half},${view.latitude - half},${view.longitude + half},${view.latitude + half}`
}

const methaneColorExpression = (legend) => {
  const palette = legend?.palette || ['#1b0c41', '#781c6d', '#ed6925', '#fcffa4']
  const min = legend?.min ?? 0
  const max = legend?.max ?? 300
  const step = (max - min) / Math.max(palette.length - 1, 1)
  const stops = palette.flatMap((color, index) => [min + step * index, color])
  return ['interpolate', ['linear'], ['coalesce', ['get', 'methane_enhancement_ppm_m'], min], ...stops]
}

const describeHeight = (props) => {
  const height = Number(props.height)
  if (props.height !== undefined && props.height !== null && Number.isFinite(height) && height > 0) {
    return `${height.toFixed(1)} m${props.height_source === 'estimated' ? ' (estimated)' : ''}`
  }
  const floors = Number(props.num_floors)
  if (Number.isFinite(floors) && floors > 0) {
    return `${(floors * FLOOR_HEIGHT).toFixed(1)} m (from ${floors} floors)`
  }
  return `${DEFAULT_HEIGHT} m (default)`
}

const describeFloors = (props) => {
  const floors = Number(props.num_floors)
  if (Number.isFinite(floors) && floors > 0) return `${Math.round(floors)}`
  const height = Number(props.height)
  if (props.height != null && Number.isFinite(height) && height > 0) {
    const fromHeight = Math.max(1, Math.round(height / FLOOR_HEIGHT))
    const floors = height >= MIN_HEIGHT_FOR_DETAIL ? Math.max(MIN_FLOORS_FOR_DETAIL, fromHeight) : fromHeight
    return `~${floors} (estimated from height)`
  }
  return null
}

const formatConfidence = (value) => {
  if (value === null || value === undefined || value === '') return null
  const confidence = Number(value)
  return Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : null
}

const formatLabel = (value) => (
  value ? String(value).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : null
)

const Building3DView = ({ geometry, view, methaneOverlay, onBack }) => {
  const mapRef = useRef(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [satelliteBeforeId, setSatelliteBeforeId] = useState(null)
  const [showSatellite, setShowSatellite] = useState(false)
  const [showTerrain, setShowTerrain] = useState(true)
  const [showMethane, setShowMethane] = useState(true)
  const [buildingsUrl, setBuildingsUrl] = useState(null)
  const [googleEntry, setGoogleEntry] = useState(null)
  const [latestBuildings, setLatestBuildings] = useState(null)
  const [areaConstruction, setAreaConstruction] = useState(null)
  const [hiddenOvertureIds, setHiddenOvertureIds] = useState([])
  const [keptVersion, setKeptVersion] = useState(0)
  const hiddenIdsRef = useRef(new Set())
  // `Map` is the react-map-gl component in this file
  const keptBuildingsRef = useRef(new globalThis.Map())
  const [zoom, setZoom] = useState(null)
  const [popup, setPopup] = useState(null)
  const [cursor, setCursor] = useState('')

  const bounds = useMemo(
    () => (geometry ? boundsFromGeometry(geometry) : boundsAroundView(view)),
    [geometry, view]
  )

  const [initialViewState] = useState(() => {
    if (geometry) {
      const fitted = boundsFromGeometry(geometry)
      return {
        bounds: fitted ? parseBounds(fitted) : [[68, 6], [97, 36]],
        fitBoundsOptions: { padding: 60, maxZoom: 16.5 },
        pitch: 60,
        bearing: -20
      }
    }
    // Keep the current map extent and tilt into a 3D perspective (no forced street zoom).
    if (view?.bounds) {
      return {
        bounds: [
          [view.bounds.west, view.bounds.south],
          [view.bounds.east, view.bounds.north]
        ],
        fitBoundsOptions: { padding: 48, maxZoom: 12 },
        pitch: 58,
        bearing: -18
      }
    }
    return {
      latitude: view?.latitude ?? 20.5937,
      longitude: view?.longitude ?? 78.9629,
      zoom: view?.zoom ?? 5,
      pitch: 58,
      bearing: -18
    }
  })

  const areaFeature = useMemo(() => (
    geometry ? { type: 'Feature', geometry, properties: {} } : null
  ), [geometry])

  const methanePlumes = useMemo(() => ({
    type: 'FeatureCollection',
    features: methaneOverlay?.features || []
  }), [methaneOverlay])

  useEffect(() => {
    let cancelled = false
    getOvertureBuildingsUrl().then((url) => {
      if (!cancelled) setBuildingsUrl(url)
    })
    getLatestBuildings().then((data) => {
      if (!cancelled) setLatestBuildings(data)
    })
    return () => { cancelled = true }
  }, [])

  const latestIndex = useMemo(() => createPolygonIndex(latestBuildings?.features || []), [latestBuildings])
  const latestCounts = useMemo(() => {
    const features = latestBuildings?.features || []
    const construction = features.filter(feature => feature.properties?.status === 'construction').length
    return { total: features.length, construction }
  }, [latestBuildings])

  useEffect(() => {
    if (!geometry) return
    const controller = new AbortController()
    setAreaConstruction(null)
    fetchAreaConstruction(geometry, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setAreaConstruction(data) })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setAreaConstruction({ features: [], note: err.message })
      })
    return () => controller.abort()
  }, [geometry])

  useEffect(() => {
    if (!bounds) return
    let cancelled = false
    setGoogleEntry(null)
    fetchBuildings(bounds, {
      onChunk: (data) => { if (!cancelled) setGoogleEntry({ data, loading: true }) }
    })
      .then((data) => { if (!cancelled) setGoogleEntry({ data, loading: false }) })
      .catch((err) => {
        console.warn('[3D View] Estimated building heights unavailable:', err.message)
        if (!cancelled) setGoogleEntry({ error: err.message })
      })
    return () => { cancelled = true }
  }, [bounds])

  const googleInArea = useMemo(() => {
    const features = googleEntry?.data?.geojson?.features || []
    if (!geometry) return features
    return features.filter((feature) => {
      const centroid = ringCentroid(feature.geometry)
      return centroid && pointInGeometry(centroid, geometry)
    })
  }, [googleEntry, geometry])

  // Imagery detections are blocky 4 m pixel shapes, so they only fill gaps and never replace a real footprint
  const googleIndex = useMemo(() => (
    createPolygonIndex(googleInArea.filter(feature => feature.properties?.detection !== 'imagery'))
  ), [googleInArea])
  const imageryIndex = useMemo(() => (
    createPolygonIndex(googleInArea.filter(feature => feature.properties?.detection === 'imagery'))
  ), [googleInArea])

  // Freshly synced OSM buildings win over everything; Overture buildings with real OSM heights win over
  // Google estimates for the same footprint
  const googleBuildings = useMemo(() => {
    const keptIndex = createPolygonIndex(Array.from(keptBuildingsRef.current.values()))
    return {
      type: 'FeatureCollection',
      features: googleInArea.filter((feature) => {
        const centroid = ringCentroid(feature.geometry)
        return !latestIndex.find(centroid) && !keptIndex.find(centroid)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleInArea, latestIndex, keptVersion])

  // Hide Overture buildings replaced by a freshly synced OSM building (anywhere), or, inside the drawn area,
  // Overture buildings without height data that a Google building (with an estimated height) covers.
  // Runs on every idle because Overture tiles load lazily as the camera moves; the sets only ever grow.
  const reconcileBuildings = useCallback(() => {
    const map = mapRef.current?.getMap()
    const hasGoogle = googleIndex.size > 0 || imageryIndex.size > 0
    if (!map || (!hasGoogle && !latestIndex.size) || !map.getSource(OVERTURE_SOURCE_ID)) return
    const hidden = hiddenIdsRef.current
    const kept = keptBuildingsRef.current
    let hiddenGrew = false
    let keptGrew = false

    map.querySourceFeatures(OVERTURE_SOURCE_ID, { sourceLayer: 'building' }).forEach((feature) => {
      const id = feature.properties?.id
      if (!id || hidden.has(id) || kept.has(id)) return
      const centroid = ringCentroid(feature.geometry)
      if (!centroid) return
      if (latestIndex.size && latestIndex.find(centroid)) {
        hidden.add(id)
        hiddenGrew = true
        return
      }
      if (!hasGoogle || (geometry && !pointInGeometry(centroid, geometry))) return
      if (hasMeasuredHeight(feature.properties)) {
        kept.set(id, { type: 'Feature', geometry: feature.geometry, properties: {} })
        keptGrew = true
      } else if (googleIndex.find(centroid)) {
        hidden.add(id)
        hiddenGrew = true
      } else if (imageryIndex.find(centroid)) {
        kept.set(id, { type: 'Feature', geometry: feature.geometry, properties: {} })
        keptGrew = true
      }
    })

    if (hiddenGrew) setHiddenOvertureIds(Array.from(hidden))
    if (keptGrew) setKeptVersion(version => version + 1)
  }, [geometry, googleIndex, imageryIndex, latestIndex])

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapLoaded || !map || (!googleIndex.size && !imageryIndex.size && !latestIndex.size)) return
    reconcileBuildings()
    map.on('idle', reconcileBuildings)
    return () => { map.off('idle', reconcileBuildings) }
  }, [mapLoaded, googleIndex, imageryIndex, latestIndex, reconcileBuildings])

  const [overtureLayers, buildingPartLayers] = useMemo(() => {
    const replaced = (property) => (
      hiddenOvertureIds.length ? ['match', ['get', property], hiddenOvertureIds, false, true] : true
    )
    return [
      createBuildingLayers(OVERTURE_PREFIX, {
        sourceLayer: 'building',
        filter: ['all', OVERTURE_BUILDING_FILTER, replaced('id')]
      }),
      // Parts belong to a parent building via building_id, so they disappear with it
      createBuildingLayers(PARTS_PREFIX, { sourceLayer: 'building_part', filter: replaced('building_id') })
    ]
  }, [hiddenOvertureIds])

  const detailedBuildings = Boolean(buildingsUrl)
  const buildingsLoading = !buildingsUrl
  const googleLoading = Boolean(bounds) && (!googleEntry || googleEntry.loading)
  const googleCount = googleBuildings.features.length
  const detectedCount = googleBuildings.features.filter(f => f.properties?.detection === 'imagery').length
  const zoomedOut = zoom !== null && zoom < BUILDING_MINZOOM
  const floorDetailHidden = zoom !== null && zoom < FLOOR_DETAIL_MINZOOM

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    setZoom(map.getZoom())
    const layers = map.getStyle()?.layers || []
    const firstOverlay = layers.find(layer => ['line', 'symbol', 'fill-extrusion'].includes(layer.type))
    setSatelliteBeforeId(firstOverlay?.id || null)
    // Overture already contains the OSM buildings; drawing the basemap copies too causes z-fighting
    layers
      .filter(layer => layer['source-layer'] === 'building' && layer.source !== OVERTURE_SOURCE_ID)
      .forEach(layer => map.setLayoutProperty(layer.id, 'visibility', 'none'))
    map.setLight(MAP_LIGHT)
    if (map.setSky) map.setSky(MAP_SKY)
    setMapLoaded(true)
    // Sidebar collapse changes the container size — resize so the pitched view fills the page.
    requestAnimationFrame(() => {
      map.resize()
      window.setTimeout(() => map.resize(), 120)
    })
  }, [])

  useEffect(() => {
    if (!mapLoaded) return undefined
    const map = mapRef.current?.getMap()
    if (!map) return undefined
    const onResize = () => map.resize()
    window.addEventListener('resize', onResize)
    const timer = window.setTimeout(onResize, 50)
    return () => {
      window.removeEventListener('resize', onResize)
      window.clearTimeout(timer)
    }
  }, [mapLoaded])

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapLoaded || !map) return
    if (showTerrain && map.getSource(TERRAIN_SOURCE_ID)) {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.2 })
    } else {
      map.setTerrain(null)
    }
  }, [mapLoaded, showTerrain])

  const interactiveLayerIds = [
    ...(detailedBuildings ? interactiveBuildingLayerIds : []),
    ...(areaConstruction?.features?.length ? drawnConstructionLayers.map(layer => layer.id) : [])
  ]

  const handleClick = useCallback((event) => {
    const feature = event.features?.[0]
    if (!feature) {
      setPopup(null)
      return
    }
    setPopup({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
      layerId: feature.layer.id,
      properties: feature.properties || {}
    })
  }, [])

  const popupIsGoogle = popup?.layerId.startsWith(GOOGLE_PREFIX)
  const popupIsPart = popup?.layerId.startsWith(PARTS_PREFIX)
  const popupIsDrawn = popup?.layerId.startsWith(DRAWN_CONSTRUCTION_PREFIX)
  const popupIsLatest = popup?.layerId.startsWith(LATEST_PREFIX) || popup?.layerId === CONSTRUCTION_LAYER_ID || popupIsDrawn
  const popupUnderConstruction = (popupIsLatest && popup.properties.status === 'construction') || popupIsDrawn

  const hasMethane = Boolean(methaneOverlay?.tileUrl || methaneOverlay?.features?.length)
  const methaneVisible = hasMethane && showMethane

  return (
    <div className="building-3d-view">
      <Map
        ref={mapRef}
        initialViewState={initialViewState}
        mapStyle={BASE_STYLE}
        maxPitch={85}
        attributionControl={false}
        interactiveLayerIds={interactiveLayerIds}
        cursor={cursor}
        onLoad={handleLoad}
        onZoomEnd={(event) => setZoom(event.viewState.zoom)}
        onClick={handleClick}
        onMouseEnter={() => setCursor('pointer')}
        onMouseLeave={() => setCursor('')}
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" visualizePitch />
        <AttributionControl
          position="bottom-right"
          compact
          customAttribution={['© OpenStreetMap contributors', 'OpenFreeMap']}
        />

        <Source
          id={TERRAIN_SOURCE_ID}
          type="raster-dem"
          tiles={TERRAIN_TILES}
          encoding="terrarium"
          tileSize={256}
          maxzoom={15}
          attribution="Terrain: AWS Terrain Tiles"
        />

        {mapLoaded && showSatellite && (
          <Source id="satellite" type="raster" tiles={SATELLITE_TILES} tileSize={256} attribution="Imagery © Esri">
            <Layer id="satellite-layer" type="raster" beforeId={satelliteBeforeId || undefined} />
          </Source>
        )}

        {areaFeature && (
          <Source id="selected-area" type="geojson" data={areaFeature}>
            <Layer id="selected-area-fill" type="fill" paint={{ 'fill-color': '#14b8a6', 'fill-opacity': 0.08 }} />
            <Layer id="selected-area-line" type="line" paint={{ 'line-color': '#14b8a6', 'line-width': 2.5 }} />
          </Source>
        )}

        {buildingsUrl && (
          <Source id={OVERTURE_SOURCE_ID} type="vector" url={buildingsUrl} attribution={OVERTURE_ATTRIBUTION}>
            {overtureLayers.map(layer => <Layer key={layer.id} {...layer} />)}
            {buildingPartLayers.map(layer => <Layer key={layer.id} {...layer} />)}
          </Source>
        )}

        {googleCount > 0 && (
          <Source
            id={GOOGLE_SOURCE_ID}
            type="geojson"
            data={googleBuildings}
            attribution={googleEntry.data.attribution || 'Google Open Buildings'}
          >
            {googleBuildingLayers.map(layer => <Layer key={layer.id} {...layer} />)}
          </Source>
        )}

        {latestBuildings && (
          <Source
            id={LATEST_SOURCE_ID}
            type="geojson"
            data={latestBuildings}
            attribution={latestBuildings.attribution || '© OpenStreetMap contributors'}
          >
            {latestBuildingLayers.map(layer => <Layer key={layer.id} {...layer} />)}
            {!areaConstruction?.features?.length && <Layer {...constructionLayer} />}
          </Source>
        )}

        {areaConstruction?.features?.length > 0 && (
          <Source
            id={DRAWN_CONSTRUCTION_PREFIX}
            type="geojson"
            data={{ type: 'FeatureCollection', features: areaConstruction.features }}
            attribution="Construction © OpenStreetMap contributors"
          >
            {drawnConstructionLayers.map(layer => <Layer key={layer.id} {...layer} />)}
          </Source>
        )}

        {methaneVisible && methaneOverlay.tileUrl && (
          <Source
            id="methane-tiles"
            type="raster"
            tiles={[methaneOverlay.tileUrl]}
            tileSize={256}
            attribution={methaneOverlay.attribution || 'Google Earth Engine'}
          >
            <Layer id="methane-tiles-layer" type="raster" paint={{ 'raster-opacity': 0.7 }} />
          </Source>
        )}

        {methaneVisible && methanePlumes.features.length > 0 && (
          <Source id="methane-plumes" type="geojson" data={methanePlumes}>
            <Layer
              id="methane-plumes-layer"
              type="circle"
              paint={{
                'circle-radius': ['match', ['get', 'confidence'], 'high', 8, 6],
                'circle-color': methaneColorExpression(methaneOverlay.legend),
                'circle-stroke-color': ['match', ['get', 'confidence'], 'high', '#fb9b06', '#c4b5fd'],
                'circle-stroke-width': 2,
                'circle-opacity': 0.9
              }}
            />
          </Source>
        )}

        {popup && (
          <Popup
            longitude={popup.longitude}
            latitude={popup.latitude}
            anchor="bottom"
            closeOnClick={false}
            onClose={() => setPopup(null)}
            className="building-popup"
          >
            <div>
              <strong>
                {popup.properties.name ||
                  formatLabel(popup.properties.subtype) ||
                  (popupIsPart ? 'Building part' : 'Building')}
              </strong>
              {popupUnderConstruction && <div className="building-popup-status">Under construction</div>}
              <div>{popupUnderConstruction ? 'Planned height' : 'Height'}: {describeHeight(popup.properties)}</div>
              {describeFloors(popup.properties) && <div>Floors: {describeFloors(popup.properties)}</div>}
              {formatLabel(popup.properties.class) && <div>Type: {formatLabel(popup.properties.class)}</div>}
              {popupIsLatest ? (
                <>
                  <div>Source: OpenStreetMap{popupIsDrawn ? '' : ' (latest sync)'}</div>
                  {formatDate(popup.properties.updated) && (
                    <div>Last edited: {formatDate(popup.properties.updated)}</div>
                  )}
                </>
              ) : popupIsGoogle ? (
                <>
                    <div>
                      Source: Google Open Buildings
                      {popup.properties.detection === 'imagery' ? ' (detected in satellite imagery)' : ''}
                    </div>
                  {formatConfidence(popup.properties.confidence) && (
                    <div>Confidence: {formatConfidence(popup.properties.confidence)}</div>
                  )}
                </>
              ) : (
                <div>Source: {describeBuildingSource(popup.properties.sources)}</div>
              )}
            </div>
          </Popup>
        )}
      </Map>

      <button type="button" className="building-3d-back" onClick={onBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        <span>Back to 2D Map</span>
      </button>

      <div className="building-3d-legend">
        <div className="building-3d-legend-title">3D Buildings</div>
        {buildingsLoading && <p className="building-3d-note">Loading detailed buildings…</p>}
        {detailedBuildings && (
          <p className="building-3d-note">Overture Maps: Google, Microsoft and OSM footprints</p>
        )}
        {googleLoading && <p className="building-3d-note">Loading estimated heights for the drawn area…</p>}
        {googleCount > 0 && (
          <p className="building-3d-note">
            {googleCount.toLocaleString()} buildings in the drawn area with estimated heights
            {detectedCount > 0 && ` (${detectedCount.toLocaleString()} found only in satellite imagery)`}
          </p>
        )}
        {googleEntry?.data?.note && (
          <p className="building-3d-note warning">{googleEntry.data.note}</p>
        )}
        {!googleEntry?.data?.note && googleEntry?.data?.truncated && (
          <p className="building-3d-note warning">Height limit reached, draw a smaller area for full coverage</p>
        )}
        {googleEntry?.error && <p className="building-3d-note warning">{googleEntry.error}</p>}
        {latestCounts.total > 0 && (
          <p className="building-3d-note">
            Latest OSM buildings synced {formatDate(latestBuildings.generated_at) || 'recently'}
          </p>
        )}
        {bounds && !areaConstruction && (
          <p className="building-3d-note">Looking for under-construction buildings…</p>
        )}
        {areaConstruction && (
          <p className="building-3d-note">
            <span className="building-3d-swatch" style={{ background: CONSTRUCTION_COLOR }} />
            {areaConstruction.features.length} under construction in the drawn area
          </p>
        )}
        {areaConstruction?.note && <p className="building-3d-note warning">{areaConstruction.note}</p>}
        {!areaConstruction?.features?.length && latestCounts.construction > 0 && (
          <p className="building-3d-note">
            <span className="building-3d-swatch" style={{ background: CONSTRUCTION_COLOR }} />
            {latestCounts.construction} under construction
          </p>
        )}
        {detailedBuildings && zoomedOut && (
          <p className="building-3d-note warning">Zoom in to see buildings</p>
        )}
        {detailedBuildings && !zoomedOut && floorDetailHidden && (
          <p className="building-3d-note">Zoom in further to see individual floors</p>
        )}

        <div className="building-3d-toggles">
          <label>
            <input type="checkbox" checked={showSatellite} onChange={(e) => setShowSatellite(e.target.checked)} />
            Satellite
          </label>
          <label>
            <input type="checkbox" checked={showTerrain} onChange={(e) => setShowTerrain(e.target.checked)} />
            Terrain
          </label>
          {hasMethane && (
            <label>
              <input type="checkbox" checked={showMethane} onChange={(e) => setShowMethane(e.target.checked)} />
              Show methane
            </label>
          )}
        </div>
      </div>
    </div>
  )
}

export default Building3DView
