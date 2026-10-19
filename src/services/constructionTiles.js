// India-wide construction sites and buildings under construction, built weekly from OpenStreetMap by
// .github/workflows/construction-tiles.yml. Set VITE_CONSTRUCTION_TILES_URL to the public R2 URL of
// india-construction.pmtiles; without it, a copy in public/data (e.g. the workflow artifact) is used.
const DEFAULT_TILES_URL = '/data/india-construction.pmtiles'

export const CONSTRUCTION_SOURCE_LAYER = 'construction'
export const CONSTRUCTION_ATTRIBUTION = 'Construction © OpenStreetMap contributors'
export const CONSTRUCTION_COLOR = '#f59e0b'
// The tiles start at zoom 10 (tippecanoe -Z10)
export const CONSTRUCTION_MINZOOM = 10

let constructionPromise = null

const resolveTilesUrl = () => {
  const configured = import.meta.env.VITE_CONSTRUCTION_TILES_URL?.trim()
  return new URL(configured || DEFAULT_TILES_URL, window.location.origin).href
}

/**
 * Resolves to { url, summary } where url is the plain https URL of the PMTiles archive and summary
 * holds { generated_at, sites, buildings }, or null when no tiles have been published yet
 */
export const getConstructionTiles = () => {
  if (!constructionPromise) {
    const url = resolveTilesUrl()
    constructionPromise = fetch(url.replace(/\.pmtiles(\?.*)?$/, '.json'))
      .then(response => (response.ok ? response.text() : ''))
      .then((text) => {
        // A missing file falls through to index.html on SPA hosts, so only accept real JSON
        if (!text.trimStart().startsWith('{')) return null
        return { url, summary: JSON.parse(text) }
      })
      .catch((err) => {
        console.warn('[Construction] India construction tiles unavailable:', err.message)
        return null
      })
  }
  return constructionPromise
}

const formatLabel = (value) => (
  value && value !== 'yes' ? String(value).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : null
)

export const formatConstructionDate = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

/**
 * Popup text for a feature from the construction tiles: { title, status, lines }.
 * status is only set for named features, otherwise the title already says it.
 */
export const describeConstruction = (props = {}) => {
  const isSite = props.kind === 'site'
  const height = Number(props.height)
  const levels = Number(props.levels)
  const type = formatLabel(props.type)
  const updated = formatConstructionDate(props.updated)
  return {
    title: props.name || (isSite ? 'Construction site' : 'Building under construction'),
    status: props.name ? (isSite ? 'Construction site' : 'Under construction') : null,
    lines: [
      type && `Type: ${type}`,
      height > 0 && `Planned height: ${height.toFixed(1)} m`,
      levels > 0 && `Planned floors: ${Math.round(levels)}`,
      'Source: OpenStreetMap',
      updated && `Last edited: ${updated}`
    ].filter(Boolean)
  }
}
