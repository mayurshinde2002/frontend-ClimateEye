/**
 * Fixed geographic sample lattice for weather heat fields.
 * Colors stay stable across resize; pan/zoom only adds missing cells.
 */

export const snapToStep = (value, step) => Math.round(value / step) * step

/** Coarser lattice when zoomed out — still on fixed degree snaps. */
export const fixedStepForZoom = (zoom) => {
  if (zoom < 5) return 2
  if (zoom < 7) return 1
  if (zoom < 9) return 0.5
  return 0.25
}

const roundCoord = (value, step) => {
  const decimals = step >= 1 ? 0 : step >= 0.5 ? 1 : 2
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Sample points on a fixed lat/lng lattice covering the bounds.
 * Caps count by coarsening step, never by arbitrary viewport-relative strides.
 */
export const fixedGridPoints = (bounds, zoom, maxPoints = 56) => {
  let step = fixedStepForZoom(zoom)
  const south0 = bounds.getSouth?.() ?? bounds.south
  const north0 = bounds.getNorth?.() ?? bounds.north
  const west0 = bounds.getWest?.() ?? bounds.west
  const east0 = bounds.getEast?.() ?? bounds.east

  const build = (cell) => {
    const south = snapToStep(south0, cell) - cell
    const north = snapToStep(north0, cell) + cell
    const west = snapToStep(west0, cell) - cell
    const east = snapToStep(east0, cell) + cell
    const points = []
    const seen = new Set()
    for (let lat = south; lat <= north + cell * 0.01; lat += cell) {
      for (let lng = west; lng <= east + cell * 0.01; lng += cell) {
        const point = {
          lat: roundCoord(lat, cell),
          lng: roundCoord(lng, cell)
        }
        const key = `${point.lat}:${point.lng}`
        if (seen.has(key)) continue
        seen.add(key)
        points.push(point)
      }
    }
    return points
  }

  let points = build(step)
  while (points.length > maxPoints && step < 4) {
    step *= 2
    if (step > 4) step = 4
    points = build(step)
  }
  // If still oversized (huge continent view), thin by taking every Nth lattice cell
  // but keep geographic snap order so the same cells are always chosen.
  if (points.length > maxPoints) {
    const stride = Math.ceil(points.length / maxPoints)
    points = points.filter((_, index) => index % stride === 0).slice(0, maxPoints)
  }

  return { points, step }
}

/** Stable IDW soft radius from lattice step (degrees). */
export const softFromStep = (step) => Math.max(0.012, step * 0.35)

/**
 * View signature for reload decisions: zoom + lattice step + snapped center.
 * Pure resize keeps the same center/zoom, so the key (and sample set) stay
 * stable — only pan/zoom across a lattice cell triggers a refetch.
 */
export const fieldViewKey = (bounds, zoom, step) => {
  const center = typeof bounds.getCenter === 'function'
    ? bounds.getCenter()
    : {
      lat: ((bounds.getSouth?.() ?? bounds.south) + (bounds.getNorth?.() ?? bounds.north)) / 2,
      lng: ((bounds.getWest?.() ?? bounds.west) + (bounds.getEast?.() ?? bounds.east)) / 2
    }
  const lat = snapToStep(center.lat, step)
  const lng = snapToStep(center.lng, step)
  return `${zoom | 0}:${step}:${lat}:${lng}`
}

/** Samples from cache that fall near the current view. */
export const samplesNearBounds = (cache, bounds, pad, predicate) => {
  const south = bounds.getSouth() - pad
  const north = bounds.getNorth() + pad
  const west = bounds.getWest() - pad
  const east = bounds.getEast() + pad
  const out = []
  cache.forEach((sample) => {
    if (!sample) return
    if (predicate && !predicate(sample)) return
    if (sample.lat < south || sample.lat > north || sample.lng < west || sample.lng > east) return
    out.push(sample)
  })
  return out
}
