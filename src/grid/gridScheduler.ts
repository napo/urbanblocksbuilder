import type { AnalysisConfig, GridCell, OSMWay } from '../domain/types'
import { bufferGridCell } from './gridBuffer'
import { OverpassClient, parseOverpassWays, parseOverpassBuildingCenters } from '../services/overpass/OverpassClient'
import { OverpassRequestError } from '../services/overpass/OverpassErrors'
import type { AnalysisCache, CellAcquisitionData } from '../services/cache/AnalysisCache'

export interface GridSchedulerCallbacks {
  onCellStateChange: (cell: GridCell) => void
  onWarning: (message: string) => void
  isCancelled: () => boolean
}

export interface GridSchedulerOptions {
  analysisAreaGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  config: AnalysisConfig
  concurrency: number
  overpassClient: OverpassClient
  cache?: AnalysisCache
}

export interface GridScheduleResult {
  ways: OSMWay[]
  buildingPoints: [number, number][]
  failedCells: GridCell[]
  completedCells: number
  cacheHits: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function queryCellWithRetries(
  cell: GridCell,
  bufferedBbox: [number, number, number, number],
  options: GridSchedulerOptions,
  callbacks: GridSchedulerCallbacks,
): Promise<{ data: CellAcquisitionData; fromCache: boolean } | null> {
  const { config, overpassClient, cache } = options
  const query = overpassClient.buildRoadQuery(bufferedBbox)
  const cacheKey = cache
    ? await cache.buildCellCacheKey({
        cellBbox: bufferedBbox,
        query,
        queryVersion: config.queryVersion,
        algorithmVersion: config.algorithmVersion,
        endpoint: config.endpoint,
        contextBufferMeters: config.contextBufferMeters,
      })
    : null

  if (cache && cacheKey) {
    const cached = await cache.getCellData(cacheKey)
    if (cached) {
      return { data: cached, fromCache: true }
    }
  }

  let lastError: unknown = null
  let attemptsMade = 0
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    if (callbacks.isCancelled()) {
      return null
    }
    attemptsMade += 1
    try {
      const response = await overpassClient.query(bufferedBbox, query)
      const ways = parseOverpassWays(response).map((way) => ({ ...way, sourceCellIds: [cell.id] }))
      const buildingPoints = parseOverpassBuildingCenters(response)
      const data: CellAcquisitionData = { ways, buildingPoints }

      // A cell with zero roads is almost never genuine for an urban-blocks
      // analysis - OSM road coverage is near-universal wherever this tool is
      // useful. It's a known failure mode of the public Overpass mirrors to
      // return 200 OK with an empty body instead of a proper error when
      // under load, so treat an empty response like a retryable failure
      // rather than accepting (and caching!) it immediately - a bad empty
      // response cached as "the answer" would otherwise silently and
      // permanently kill this cell for every future run over the same area,
      // with no error ever surfaced (see the "still doesn't cut" reports
      // this caused before this fix).
      if (ways.length === 0 && attempt < config.maxRetries) {
        await delay(Math.min(1000 * 2 ** attempt, 15000))
        continue
      }

      if (ways.length === 0) {
        callbacks.onWarning(
          `Grid cell ${cell.id} returned no roads after ${attemptsMade} attempt(s). If this area should have streets, try clearing the local cache (Processing parameters) and running the analysis again.`,
        )
      }

      if (cache && cacheKey) {
        await cache.putCellData(cacheKey, data)
      }
      return { data, fromCache: false }
    } catch (error) {
      lastError = error
      const isRetryable = error instanceof OverpassRequestError ? error.retryable : false
      if (!isRetryable || attempt === config.maxRetries) {
        break
      }
      await delay(Math.min(1000 * 2 ** attempt, 15000))
    }
  }

  callbacks.onWarning(
    `Grid cell ${cell.id} failed after ${attemptsMade} attempt(s): ${lastError instanceof Error ? lastError.message : 'unknown error'}. Continuing with the remaining cells.`,
  )
  return null
}

/**
 * Runs Overpass acquisition across the adaptive grid's leaf cells with a
 * bounded concurrency pool, per-cell retry/backoff, and partial recovery:
 * a failed cell is marked Failed and skipped rather than aborting the whole
 * analysis.
 */
export async function runGridSchedule(
  cells: GridCell[],
  options: GridSchedulerOptions,
  callbacks: GridSchedulerCallbacks,
): Promise<GridScheduleResult> {
  const ways: OSMWay[] = []
  const buildingPoints: [number, number][] = []
  const failedCells: GridCell[] = []
  let completedCells = 0
  let cacheHits = 0
  let cursor = 0

  const runNext = async (): Promise<void> => {
    while (cursor < cells.length) {
      if (callbacks.isCancelled()) {
        return
      }
      const index = cursor
      cursor += 1
      const cell = cells[index]

      cell.state = 'Querying'
      callbacks.onCellStateChange(cell)

      const buffered = bufferGridCell(cell, options.analysisAreaGeometry, options.config.contextBufferMeters)
      const result = await queryCellWithRetries(cell, buffered.bbox, options, callbacks)

      if (result) {
        ways.push(...result.data.ways)
        buildingPoints.push(...result.data.buildingPoints)
        cell.state = 'Completed'
        cell.waysEstimate = result.data.ways.length
        if (result.fromCache) {
          cacheHits += 1
        }
        completedCells += 1
      } else if (!callbacks.isCancelled()) {
        cell.state = 'Failed'
        failedCells.push(cell)
      } else {
        cell.state = 'Cancelled'
      }
      callbacks.onCellStateChange(cell)
    }
  }

  const workerCount = Math.max(1, Math.min(options.concurrency, cells.length || 1))
  await Promise.all(Array.from({ length: workerCount }, () => runNext()))

  return { ways, buildingPoints, failedCells, completedCells, cacheHits }
}
