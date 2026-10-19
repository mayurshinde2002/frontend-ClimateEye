// Fetches the latest OpenStreetMap buildings (including ones under construction) for the areas in
// scripts/building-areas.json and writes public/data/latest-buildings.geojson for the 3D view.
//
//   node scripts/fetch-latest-buildings.mjs               fail loudly on errors
//   node scripts/fetch-latest-buildings.mjs --allow-fail  keep the previous file and exit 0 (used by `npm run build`)
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AREAS_FILE = resolve(ROOT, 'scripts/building-areas.json')
const OUTPUT_FILE = resolve(ROOT, 'public/data/latest-buildings.geojson')
// Public Overpass servers are often busy (429/504), so each request tries them in turn
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
]
const ATTEMPTS_PER_SERVER = 2
const RETRY_DELAY_MS = 5000
const FLOOR_HEIGHT = 3
// Overpass rejects very large queries; ~25 km² per area keeps responses small and fast
const MAX_AREA_KM2 = 25
const PAUSE_BETWEEN_AREAS_MS = 2000

const allowFail = process.argv.includes('--allow-fail')

const parsePositive = (value) => {
  const number = parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? number : null
}

const areaKm2 = ([minLng, minLat, maxLng, maxLat]) => {
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180)
  return Math.abs((maxLng - minLng) * 111.32 * Math.cos(midLat) * (maxLat - minLat) * 110.574)
}

const validateArea = (area, index) => {
  const label = area?.name || `area #${index + 1}`
  const bbox = area?.bbox
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    throw new Error(`${label}: bbox must be [minLng, minLat, maxLng, maxLat]`)
  }
  const [minLng, minLat, maxLng, maxLat] = bbox
  if (minLng >= maxLng || minLat >= maxLat) throw new Error(`${label}: bbox min values must be less than max values`)
  if (areaKm2(bbox) > MAX_AREA_KM2) {
    throw new Error(`${label}: area is ${areaKm2(bbox).toFixed(1)} km², split it into areas of at most ${MAX_AREA_KM2} km²`)
  }
  return { name: label, bbox }
}

const toFeature = (way) => {
  const tags = way.tags || {}
  const ring = (way.geometry || []).map(point => [point.lon, point.lat])
  if (ring.length < 4) return null
  const [first, last] = [ring[0], ring[ring.length - 1]]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first)

  const underConstruction = tags.building === 'construction' || Boolean(tags.construction)
  const levels = parsePositive(tags['building:levels'])
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      id: `osm-way-${way.id}`,
      status: underConstruction ? 'construction' : 'complete',
      class: underConstruction ? (tags.construction || 'construction') : tags.building,
      height: parsePositive(tags.height) ?? (levels ? levels * FLOOR_HEIGHT : null),
      num_floors: levels,
      min_height: parsePositive(tags.min_height),
      min_floor: parsePositive(tags['building:min_level']),
      name: tags.name || null,
      updated: way.timestamp || null
    }
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const queryOverpass = async (name, query) => {
  const failures = []
  for (const url of OVERPASS_URLS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_SERVER; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'ClimateEye building sync (frontend-ClimateEye)'
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(150000)
        })
        if (response.ok) return await response.json()
        failures.push(`${new URL(url).host} ${response.status}`)
        // 4xx other than rate limiting means the query itself is bad; retrying won't help
        if (response.status >= 400 && response.status < 500 && response.status !== 429) break
      } catch (err) {
        failures.push(`${new URL(url).host} ${err.name === 'TimeoutError' ? 'timeout' : err.message}`)
      }
      console.warn(`  ${name}: ${failures[failures.length - 1]}, retrying...`)
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
  throw new Error(`${name}: all Overpass servers failed (${failures.join('; ')})`)
}

const fetchArea = async ({ name, bbox }) => {
  const [minLng, minLat, maxLng, maxLat] = bbox
  const query = `[out:json][timeout:120];way["building"](${minLat},${minLng},${maxLat},${maxLng});out geom tags meta;`
  const data = await queryOverpass(name, query)
  const features = (data.elements || []).map(toFeature).filter(Boolean)
  const underConstruction = features.filter(feature => feature.properties.status === 'construction').length
  console.log(`  ${name}: ${features.length} buildings (${underConstruction} under construction)`)
  return features
}

const main = async () => {
  const areas = JSON.parse(await readFile(AREAS_FILE, 'utf8')).map(validateArea)
  console.log(`Fetching latest OpenStreetMap buildings for ${areas.length} area(s)...`)

  const seen = new Set()
  const features = []
  for (const [index, area] of areas.entries()) {
    if (index > 0) await sleep(PAUSE_BETWEEN_AREAS_MS)
    for (const feature of await fetchArea(area)) {
      if (seen.has(feature.properties.id)) continue
      seen.add(feature.properties.id)
      features.push(feature)
    }
  }

  await mkdir(dirname(OUTPUT_FILE), { recursive: true })
  await writeFile(OUTPUT_FILE, JSON.stringify({
    type: 'FeatureCollection',
    generated_at: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors',
    areas: areas.map(area => area.name),
    features
  }))
  console.log(`Wrote ${features.length} buildings to public/data/latest-buildings.geojson`)
}

main().catch((err) => {
  console.error(`Building sync failed: ${err.message}`)
  if (allowFail) {
    console.warn('Keeping the previous latest-buildings.geojson (if any) and continuing the build.')
    process.exit(0)
  }
  process.exit(1)
})
