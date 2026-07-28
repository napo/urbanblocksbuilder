import type { AnalysisArea, AnalysisConfig, AnalysisReport, NamedFeatureCollection, OSMWay, UrbanBlock } from '../../domain/types'
import type { District, DistrictAssignmentStrategy, DistrictStatistics } from '../../domain/district'

export interface CellCacheKeyInput {
  cellBbox: [number, number, number, number]
  /**
   * The exact Overpass query text for this cell (see OverpassQueryBuilder).
   * Keying on the query itself - rather than enumerating every filter/toggle
   * that can affect it (highway types, waterway/railway/building inclusion,
   * access exclusions...) - means a cache entry is invalidated automatically
   * whenever the query would actually be different, with no risk of a new
   * toggle being added to the config without also being added here.
   */
  query: string
  queryVersion: string
  algorithmVersion: string
  endpoint: string
  contextBufferMeters: number
}

/** Everything downloaded for one grid cell in a single Overpass call: the road/waterway/railway network plus building locations. */
export interface CellAcquisitionData {
  ways: OSMWay[]
  buildingPoints: [number, number][]
}

/** Lightweight metadata for listing saved analyses without loading their full geometry. */
export interface AnalysisSnapshotSummary {
  analysisId: string
  savedAt: string
  areaName: string
  areaKm2: number
  blockCount: number
}

/**
 * A complete, previously-computed analysis result, saved so it can be
 * reopened instantly - without re-downloading from Overpass or recomputing
 * the geometry pipeline - later in the same browser.
 */
export interface AnalysisSnapshot {
  analysisId: string
  savedAt: string
  area: AnalysisArea
  config: AnalysisConfig
  districts: District[]
  districtStrategy: DistrictAssignmentStrategy
  blocks: UrbanBlock[]
  originalRoads: NamedFeatureCollection
  nodedRoads: NamedFeatureCollection
  removedBranches: NamedFeatureCollection
  twoCoreRoads: NamedFeatureCollection
  grid: NamedFeatureCollection<{ id: string; state: string; depth: number }>
  districtStatistics: DistrictStatistics[]
  report: AnalysisReport
}

/**
 * Cache abstraction so the geometry worker and UI never talk to IndexedDB
 * directly. This is the seam that would let caching move to a backend
 * service later without touching call sites.
 */
export interface AnalysisCache {
  buildCellCacheKey(input: CellCacheKeyInput): Promise<string>
  getCellData(key: string): Promise<CellAcquisitionData | null>
  putCellData(key: string, data: CellAcquisitionData): Promise<void>

  saveAnalysisSnapshot(snapshot: AnalysisSnapshot): Promise<void>
  listAnalysisSnapshots(): Promise<AnalysisSnapshotSummary[]>
  loadAnalysisSnapshot(analysisId: string): Promise<AnalysisSnapshot | null>
  deleteAnalysisSnapshot(analysisId: string): Promise<void>

  clearAll(): Promise<void>
}
