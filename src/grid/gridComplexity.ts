import { defaultComplexityThresholds, type ComplexityLevel, type ComplexityThresholds } from '../config/thresholds'

export interface ComplexityEstimate {
  level: ComplexityLevel
  estimatedWays: number
  estimatedCoordinates: number
  estimatedResponseSizeKb: number
  reasons: string[]
}

/**
 * Estimates how demanding an area will be to acquire and process, before any
 * Overpass request is sent. This is a heuristic based on area and a
 * ways-per-km² density assumption; it is intentionally conservative and
 * documented as needing calibration against real responses (see
 * docs/algorithm.md).
 */
export function estimateAreaComplexity(
  areaKm2: number,
  thresholds: ComplexityThresholds = defaultComplexityThresholds,
): ComplexityEstimate {
  const estimatedWays = Math.max(1, Math.round(areaKm2 * thresholds.waysPerKm2Estimate))
  const estimatedCoordinates = estimatedWays * thresholds.coordinatesPerWayEstimate
  const estimatedResponseSizeKb = Math.round((estimatedCoordinates * thresholds.bytesPerCoordinateEstimate) / 1024)

  const reasons: string[] = []
  let level: ComplexityLevel

  if (estimatedWays <= thresholds.simpleMaxEstimatedWays) {
    level = 'simple'
    reasons.push(`Estimated ${estimatedWays} ways, within the simple-analysis range.`)
  } else if (estimatedWays <= thresholds.demandingMaxEstimatedWays) {
    level = 'demanding'
    reasons.push(`Estimated ${estimatedWays} ways exceeds the simple-analysis threshold (${thresholds.simpleMaxEstimatedWays}).`)
  } else {
    level = 'requires-subdivision'
    reasons.push(`Estimated ${estimatedWays} ways exceeds the demanding-analysis threshold (${thresholds.demandingMaxEstimatedWays}); the area will be split by the adaptive grid.`)
  }

  return { level, estimatedWays, estimatedCoordinates, estimatedResponseSizeKb, reasons }
}

export function shouldSubdivideCell(
  areaKm2: number,
  limits: { maxWaysPerCell: number; maxCoordinatesPerCell: number; maxResponseSizeKb: number },
  thresholds: ComplexityThresholds = defaultComplexityThresholds,
): boolean {
  const estimate = estimateAreaComplexity(areaKm2, thresholds)
  return (
    estimate.estimatedWays > limits.maxWaysPerCell ||
    estimate.estimatedCoordinates > limits.maxCoordinatesPerCell ||
    estimate.estimatedResponseSizeKb > limits.maxResponseSizeKb
  )
}
