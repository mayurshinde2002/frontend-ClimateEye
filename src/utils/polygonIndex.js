const polygonsOf = (geometry) => {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

/**
 * Average of the outer ring vertices of the first polygon, as [lng, lat]
 */
export const ringCentroid = (geometry) => {
  const ring = polygonsOf(geometry)[0]?.[0]
  if (!ring?.length) return null
  const first = ring[0]
  const last = ring[ring.length - 1]
  const count = ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.length - 1 : ring.length
  let sumLng = 0
  let sumLat = 0
  for (let i = 0; i < count; i += 1) {
    sumLng += ring[i][0]
    sumLat += ring[i][1]
  }
  return [sumLng / count, sumLat / count]
}

const pointInRing = ([x, y], ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export const pointInGeometry = (point, geometry) => (
  polygonsOf(geometry).some(([outer, ...holes]) => (
    outer && pointInRing(point, outer) && !holes.some(hole => pointInRing(point, hole))
  ))
)

const bboxOf = (geometry) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  polygonsOf(geometry).forEach(([outer]) => {
    (outer || []).forEach(([x, y]) => {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    })
  })
  return minX === Infinity ? null : [minX, minY, maxX, maxY]
}

/**
 * Grid index over polygon features so point lookups only test nearby polygons.
 * cellSize is in degrees (~0.001 deg is ~100 m).
 */
export const createPolygonIndex = (features, cellSize = 0.001) => {
  const entries = []
  const cells = new Map()
  const cellKey = (cx, cy) => `${cx}:${cy}`

  features.forEach((feature) => {
    const bbox = bboxOf(feature.geometry)
    if (!bbox) return
    const index = entries.push({ feature, bbox }) - 1
    for (let cx = Math.floor(bbox[0] / cellSize); cx <= Math.floor(bbox[2] / cellSize); cx += 1) {
      for (let cy = Math.floor(bbox[1] / cellSize); cy <= Math.floor(bbox[3] / cellSize); cy += 1) {
        const key = cellKey(cx, cy)
        if (!cells.has(key)) cells.set(key, [])
        cells.get(key).push(index)
      }
    }
  })

  return {
    size: entries.length,
    find: (point) => {
      const candidates = cells.get(cellKey(Math.floor(point[0] / cellSize), Math.floor(point[1] / cellSize)))
      if (!candidates) return null
      for (const index of candidates) {
        const { feature, bbox } = entries[index]
        if (point[0] < bbox[0] || point[0] > bbox[2] || point[1] < bbox[1] || point[1] > bbox[3]) continue
        if (pointInGeometry(point, feature.geometry)) return feature
      }
      return null
    }
  }
}
