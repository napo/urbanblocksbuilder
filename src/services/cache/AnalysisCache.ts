import type { AnalysisReport, GridCell, OSMWay, UrbanBlock } from '../../domain/types'

export interface CellCacheKeyInput {
  cellBbox: [number, number, number, number]
  highwayFilters: string[]
  accessFilters: string[]
  queryVersion: string
  algorithmVersion: string
  endpoint: string
  contextBufferMeters: number
}

export interface CachedAnalysisSummary {
  analysisId: string
  updatedAt: string
}

/**
 * Cache abstraction so the geometry worker and UI never talk to IndexedDB
 * directly. This is the seam that would let caching move to a backend
 * service later without touching call sites.
 */
export interface AnalysisCache {
  buildCellCacheKey(input: CellCacheKeyInput): Promise<string>
  getCellWays(key: string): Promise<OSMWay[] | null>
  putCellWays(key: string, ways: OSMWay[]): Promise<void>

  saveGridState(analysisId: string, cells: GridCell[]): Promise<void>
  loadGridState(analysisId: string): Promise<GridCell[] | null>

  saveFinalBlocks(analysisId: string, blocks: UrbanBlock[]): Promise<void>
  loadFinalBlocks(analysisId: string): Promise<UrbanBlock[] | null>

  saveReport(analysisId: string, report: AnalysisReport): Promise<void>
  loadReport(analysisId: string): Promise<AnalysisReport | null>

  clearAnalysis(analysisId: string): Promise<void>
  clearAll(): Promise<void>
  listCachedAnalyses(): Promise<CachedAnalysisSummary[]>
}
