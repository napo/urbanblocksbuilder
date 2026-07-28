export type AnalysisSource = 'geocoder' | 'upload' | 'rectangle' | 'polygon' | 'radius' | 'fixture'

/** A GeoJSON FeatureCollection whose feature properties have a known shape, rather than the spec's nullable "any". */
export type NamedFeatureCollection<P = Record<string, unknown>> = GeoJSON.FeatureCollection<GeoJSON.Geometry, P>

export type AnalysisAreaGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon

export interface AnalysisArea {
  id: string
  name?: string
  source: AnalysisSource
  geometry: AnalysisAreaGeometry
  bbox: [number, number, number, number]
  areaKm2: number
  radiusMeters?: number
}

export interface GeocodingResult {
  placeId: string
  displayName: string
  type: string
  bbox?: [number, number, number, number]
  geometry?: GeoJSON.Geometry | null
  lat?: number
  lon?: number
}

export interface OSMWay {
  id: string
  tags: Record<string, string>
  coordinates: [number, number][]
  /**
   * The real OSM node ID at each coordinate, parallel to `coordinates`, when
   * the Overpass response included it (`out body geom` - see
   * OverpassQueryBuilder). `undefined` entries mean that vertex's identity is
   * unknown (e.g. fixture/demo data) and topology for it falls back to
   * coordinate-proximity matching - see geometry/graph.ts.
   */
  nodeIds?: (string | undefined)[]
  logicalLevel: number
  sourceCellIds: string[]
  originalGeometry: GeoJSON.LineString
  status: 'pending' | 'downloaded' | 'deduped' | 'failed'
}

export interface GridCell {
  id: string
  bbox: [number, number, number, number]
  depth: number
  state: 'Pending' | 'Estimating' | 'Querying' | 'Completed' | 'Subdivided' | 'Retrying' | 'Failed' | 'Cancelled'
  waysEstimate?: number
  coordinatesEstimate?: number
  responseSizeEstimate?: number
  parentId?: string
  children?: string[]
}

export interface UrbanBlockProperties {
  blockId: string
  areaM2: number
  perimeterM: number
  compactness: number
  source: 'osm-road-network'
  projection: string
  flaggedSmallArtifact: boolean
  flaggedLargeArea: boolean
  flaggedInvalidGeometry: boolean
  /** True when a non-trivial part of this block's edge is the analysis-area boundary rather than a real street. */
  flaggedBoundaryClosure: boolean
  /** True when this block still has no building inside it after the no-building merge pass (nowhere to absorb into). */
  flaggedNoBuildings: boolean
  districtId?: string
  districtOverlapRatio?: number
}

export interface UrbanBlock {
  id: string
  geometry: GeoJSON.Polygon
  properties: UrbanBlockProperties
}

export interface AnalysisProgress {
  phase: string
  percent: number
  completedCells: number
  totalCells: number
  currentCell?: string
  downloadedWays: number
  coordinates: number
  segments: number
  elapsedMs: number
  warnings: string[]
  errors: string[]
  cacheStatus: string
}

export interface AnalysisConfig {
  queryVersion: string
  algorithmVersion: string
  endpoint: string
  endpoints: string[]
  highwayFilters: string[]
  accessFilters: string[]
  includeService: boolean
  includeTrack: boolean
  includeFootway: boolean
  includeCycleway: boolean
  includePath: boolean
  includeMotorway: boolean
  includeTrunk: boolean
  includeWaterway: boolean
  waterwayFilters: string[]
  includeRailway: boolean
  railwayFilters: string[]
  /** When true, fetches building footprints and merges any block with none into its longest-bordering neighbour. */
  mergeBuildinglessBlocks: boolean
  contextBufferMeters: number
  initialCellSizeMeters: number
  maxDepth: number
  maxWaysPerCell: number
  maxCoordinatesPerCell: number
  maxResponseSizeKb: number
  maxRetries: number
  concurrency: number
  snappingToleranceMeters: number
  minAreaM2: number
  maxAreaM2: number
  largeBlockAreaThresholdM2: number
}

export interface AnalysisReport {
  applicationName: string
  applicationVersion: string
  algorithmVersion: string
  generatedAt: string
  analysisAreaName?: string
  analysisAreaSummary: string
  configuration: AnalysisConfig
  highwayFilters: string[]
  accessFilters: string[]
  overpassEndpoints: string[]
  exactQueries: string[]
  projection: string
  tolerances: Record<string, number>
  gridConfiguration: Record<string, number>
  acquisitionStatistics: Record<string, number>
  geometryStatistics: Record<string, number>
  districtStatistics: Record<string, unknown>
  warnings: string[]
  errors: string[]
  cacheInformation: Record<string, unknown>
  osmAttribution: string
  dataLicense: string
}
