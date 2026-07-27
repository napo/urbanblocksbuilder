/**
 * Planar (Cartesian) area and perimeter for a polygon whose coordinates are
 * already in a metric projection. We deliberately avoid turf.area/turf.length
 * here: those assume WGS84 degrees and compute geodesic area, which would be
 * wrong (and inconsistent with the rest of the metric pipeline) if applied to
 * projected coordinates.
 */
function ringArea(ring: GeoJSON.Position[]): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

function ringPerimeter(ring: GeoJSON.Position[]): number {
  let length = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    length += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1])
  }
  return length
}

export function calculatePlanarArea(polygon: GeoJSON.Polygon): number {
  const [shell, ...holes] = polygon.coordinates
  const shellArea = ringArea(shell)
  const holesArea = holes.reduce((sum, hole) => sum + ringArea(hole), 0)
  return Math.max(0, shellArea - holesArea)
}

export function calculatePlanarPerimeter(polygon: GeoJSON.Polygon): number {
  return polygon.coordinates.reduce((sum, ring) => sum + ringPerimeter(ring), 0)
}

/** Polsby-Popper compactness: 1.0 is a perfect circle, lower is less compact. */
export function calculateCompactness(areaM2: number, perimeterM: number): number {
  if (perimeterM <= 0) {
    return 0
  }
  return (4 * Math.PI * areaM2) / (perimeterM * perimeterM)
}

export interface BlockIndicators {
  areaM2: number
  perimeterM: number
  compactness: number
}

export function calculateBlockIndicators(polygonMetric: GeoJSON.Polygon): BlockIndicators {
  const areaM2 = calculatePlanarArea(polygonMetric)
  const perimeterM = calculatePlanarPerimeter(polygonMetric)
  return {
    areaM2,
    perimeterM,
    compactness: calculateCompactness(areaM2, perimeterM),
  }
}
