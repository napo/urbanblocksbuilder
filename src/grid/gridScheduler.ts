import type { AnalysisConfig, GridCell, OSMWay } from '../domain/types'
import { bufferGridCell } from './gridBuffer'
import { OverpassClient, parseOverpassWays } from '../services/overpass/OverpassClient'
import type { AnalysisCache } from '../services/cache/AnalysisCache'

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
): Promise<{ ways: OSMWay[]; fromCache: boolean } | null> {
  const { config, overpassClient, cache } = options
  const query = overpassClient.buildRoadQuery(bufferedBbox)
  const cacheKey = cache
    ? await cache.buildCellCacheKey({
        cellBbox: bufferedBbox,
        highwayFilters: config.highwayFilters,
        accessFilters: config.accessFilters,
        queryVersion: config.queryVersion,
        algorithmVersion: config.algorithmVersion,
        endpoint: config.endpoint,
        contextBufferMeters: config.contextBufferMeters,
      })
    : null

  if (cache && cacheKey) {
    const cached = await cache.getCellWays(cacheKey)
    if (cached) {
      return { ways: cached, fromCache: true }
    }
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    if (callbacks.isCancelled()) {
      return null
    }
    try {
      const response = await overpassClient.query(bufferedBbox, query)
      const ways = parseOverpassWays(response).map((way) => ({ ...way, sourceCellIds: [cell.id] }))
      if (cache && cacheKey) {
        await cache.putCellWays(cacheKey, ways)
      }
      return { ways, fromCache: false }
    } catch (error) {
      lastError = error
      const isRetryable = error instanceof Error && /timeout|network|5\d\d|rate/i.test(error.message)
      if (!isRetryable || attempt === config.maxRetries) {
        break
      }
      await delay(Math.min(500 * 2 ** attempt, 8000))
    }
  }

  callbacks.onWarning(
    `Grid cell ${cell.id} failed after ${config.maxRetries + 1} attempt(s): ${lastError instanceof Error ? lastError.message : 'unknown error'}. Continuing with the remaining cells.`,
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
        ways.push(...result.ways)
        cell.state = 'Completed'
        cell.waysEstimate = result.ways.length
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

  return { ways, failedCells, completedCells, cacheHits }
}
