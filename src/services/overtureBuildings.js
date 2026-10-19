import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'

const OVERTURE_CATALOG_URL = 'https://stac.overturemaps.org/catalog.json'
const OVERTURE_TILES_BASE = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles'
// Overture deletes releases after ~60 days, so this is only used if the catalog is unreachable
const FALLBACK_RELEASE = '2026-09-23.1'

export const OVERTURE_ATTRIBUTION = 'Buildings © Overture Maps Foundation (Google Open Buildings, Microsoft, OpenStreetMap)'

// Written by `npm run fetch-buildings` (scripts/fetch-latest-buildings.mjs)
const LATEST_BUILDINGS_URL = '/data/latest-buildings.geojson'

let protocolRegistered = false
let releasePromise = null
let latestBuildingsPromise = null

export const registerPmtilesProtocol = () => {
  if (protocolRegistered) return
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
}

const resolveLatestRelease = async () => {
  try {
    const response = await fetch(OVERTURE_CATALOG_URL)
    if (!response.ok) throw new Error(`Catalog returned ${response.status}`)
    const catalog = await response.json()
    return catalog.latest || FALLBACK_RELEASE
  } catch (err) {
    console.warn('[3D View] Could not resolve latest Overture release, using fallback:', err.message)
    return FALLBACK_RELEASE
  }
}

export const getOvertureBuildingsUrl = async () => {
  if (!releasePromise) releasePromise = resolveLatestRelease()
  const release = await releasePromise
  return `pmtiles://${OVERTURE_TILES_BASE}/${release}/buildings.pmtiles`
}

/**
 * Latest OpenStreetMap buildings synced by the build script, or null if the file is missing
 */
export const getLatestBuildings = () => {
  if (!latestBuildingsPromise) {
    latestBuildingsPromise = fetch(LATEST_BUILDINGS_URL)
      .then(response => (response.ok ? response.text() : ''))
      .then((text) => {
        // A missing file falls through to index.html on SPA hosts, so only accept real JSON
        if (!text.trimStart().startsWith('{')) return null
        const data = JSON.parse(text)
        return data?.features?.length ? data : null
      })
      .catch((err) => {
        console.warn('[3D View] Latest buildings unavailable:', err.message)
        return null
      })
  }
  return latestBuildingsPromise
}

// Overture stores `sources` as a JSON string in the vector tiles
export const describeBuildingSource = (rawSources) => {
  try {
    const sources = typeof rawSources === 'string' ? JSON.parse(rawSources) : rawSources
    const datasets = [...new Set((sources || []).map(source => source.dataset).filter(Boolean))]
    return datasets.length ? datasets.join(', ') : 'Unknown'
  } catch {
    return 'Unknown'
  }
}
