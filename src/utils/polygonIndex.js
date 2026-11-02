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

const nearlySame = (a, b, eps = 1e-10) => (
  Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps
)

const pointInRect = ([x, y], [minX, minY, maxX, maxY]) => (
  x >= minX && x <= maxX && y >= minY && y <= maxY
)

const segmentIntersection = (a, b, c, d) => {
  const [x1, y1] = a
  const [x2, y2] = b
  const [x3, y3] = c
  const [x4, y4] = d
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(den) < 1e-14) return null
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]
}

const closeRing = (ring) => {
  if (!ring?.length) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (nearlySame(first, last)) return ring
  return [...ring, first]
}

/**
 * Clip an axis-aligned cell rectangle [minLng,minLat,maxLng,maxLat] to a polygon geometry.
 * Returns a closed [lng,lat] ring, or null if there is no visible intersection.
 */
export const clipRectToGeometry = (rect, geometry) => {
  const [minX, minY, maxX, maxY] = rect
  const cellCorners = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY]
  ]
  const cellEdges = [
    [cellCorners[0], cellCorners[1]],
    [cellCorners[1], cellCorners[2]],
    [cellCorners[2], cellCorners[3]],
    [cellCorners[3], cellCorners[0]]
  ]

  const pts = []
  const push = (p) => {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return
    if (pts.some((q) => nearlySame(q, p, 1e-9))) return
    pts.push(p)
  }

  cellCorners.forEach((c) => {
    if (pointInGeometry(c, geometry)) push(c)
  })

  polygonsOf(geometry).forEach(([outer]) => {
    const ring = outer || []
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (pointInRect(a, rect)) push(a)
      cellEdges.forEach(([c, d]) => {
        const hit = segmentIntersection(a, b, c, d)
        if (hit) push(hit)
      })
    }
  })

  if (pts.length < 3) return null

  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
  pts.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx))
  return closeRing(pts)
}

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
