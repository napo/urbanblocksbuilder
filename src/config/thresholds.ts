/**
 * Conservative default thresholds for area-complexity estimation and the
 * adaptive acquisition grid. These are starting points, not calibrated
 * standards - they must be validated against real Overpass responses across
 * a range of city densities before being treated as final (see
 * docs/algorithm.md, "Calibration"). All values are configurable at runtime
 * through AnalysisConfig; nothing here is hard-coded into the pipeline.
 */

export type ComplexityLevel = 'simple' | 'demanding' | 'requires-subdivision'

export interface ComplexityThresholds {
  /** Ways below this estimate keep a cell/area classified as "simple". */
  simpleMaxEstimatedWays: number
  /** Ways below this estimate are "demanding"; above it, subdivision is required. */
  demandingMaxEstimatedWays: number
  /** Approximate OSM ways per km² used to estimate way counts before querying. */
  waysPerKm2Estimate: number
  /** Approximate coordinates per way, used to estimate response size. */
  coordinatesPerWayEstimate: number
  /** Estimated bytes per coordinate in an `out tags geom` response. */
  bytesPerCoordinateEstimate: number
}

export const defaultComplexityThresholds: ComplexityThresholds = {
  simpleMaxEstimatedWays: 400,
  demandingMaxEstimatedWays: 1500,
  // Raised from 35: that figure under-estimated dense historic centres (e.g.
  // Trento's centro storico), so cells there weren't subdivided small enough
  // and their Overpass requests were timing out / 5xx-ing outright - still a
  // heuristic, not measured, see the module comment above.
  waysPerKm2Estimate: 80,
  coordinatesPerWayEstimate: 12,
  bytesPerCoordinateEstimate: 28,
}

export interface GridThresholds {
  initialCellSizeMeters: number
  contextBufferMeters: number
  maxDepth: number
  maxWaysPerCell: number
  maxCoordinatesPerCell: number
  maxResponseSizeKb: number
  maxRetries: number
}

export const defaultGridThresholds: GridThresholds = {
  initialCellSizeMeters: 4000,
  contextBufferMeters: 400,
  maxDepth: 4,
  maxWaysPerCell: 120,
  maxCoordinatesPerCell: 500,
  maxResponseSizeKb: 250,
  maxRetries: 3,
}

export const defaultLargeBlockAreaThresholdM2 = 100000
export const defaultSmallArtifactAreaThresholdM2 = 250
