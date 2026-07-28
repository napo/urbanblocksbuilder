/// <reference lib="webworker" />

import { runAnalysisPipeline, CancellationError } from './analysisPipeline'
import { IndexedDbAnalysisCache } from '../services/cache/IndexedDbAnalysisCache'
import type { AnalysisSnapshot } from '../services/cache/AnalysisCache'
import type { StartMessage, OutgoingWorkerMessage, AnalysisPhase, CompletedResultPayload } from './workerMessages'

function generateAnalysisId(): string {
  return `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function buildSnapshot(payload: StartMessage['payload'], result: CompletedResultPayload): AnalysisSnapshot {
  return {
    analysisId: generateAnalysisId(),
    savedAt: new Date().toISOString(),
    area: payload.area,
    config: payload.config,
    districts: payload.districts,
    districtStrategy: payload.districtStrategy,
    blocks: result.blocks.features.map((feature) => ({
      id: feature.properties.blockId,
      geometry: feature.geometry,
      properties: feature.properties,
    })),
    originalRoads: result.originalRoads,
    nodedRoads: result.nodedRoads,
    removedBranches: result.removedBranches,
    twoCoreRoads: result.twoCoreRoads,
    grid: result.grid,
    districtStatistics: result.districtStatistics,
    report: result.report,
  }
}

let cancelled = false
const cache = new IndexedDbAnalysisCache()

function post(message: OutgoingWorkerMessage): void {
  self.postMessage(message)
}

self.addEventListener('message', (event: MessageEvent<StartMessage | { type: 'cancellation-request' }>) => {
  if (event.data.type === 'cancellation-request') {
    cancelled = true
    return
  }

  if (event.data.type !== 'start') {
    return
  }

  cancelled = false
  const { payload } = event.data
  const startedAt = Date.now()

  const runAnalysis = async () => {
    try {
      const result = await runAnalysisPipeline(
        {
          area: payload.area,
          config: payload.config,
          fixtureMode: payload.fixtureMode,
          districts: payload.districts,
          districtStrategy: payload.districtStrategy,
          cache: payload.fixtureMode ? undefined : cache,
        },
        {
          onProgress: (phase: AnalysisPhase, percent, extra) => {
            post({
              type: 'progress',
              payload: {
                phase,
                percent,
                completedCells: extra?.completedCells ?? 0,
                totalCells: extra?.totalCells ?? 0,
                currentCell: extra?.currentCell,
                downloadedWays: extra?.downloadedWays ?? 0,
                coordinates: extra?.coordinates ?? 0,
                segments: extra?.segments ?? 0,
                elapsedMs: Date.now() - startedAt,
                warnings: [],
                errors: [],
                cacheStatus: extra?.cacheStatus ?? 'Idle',
              },
            })
          },
          onWarning: (message) => post({ type: 'warning', payload: { message } }),
          isCancelled: () => cancelled,
        },
      )

      if (cancelled) {
        post({ type: 'cancellation-confirmed' })
        return
      }

      post({ type: 'completed-result', payload: result })

      if (!payload.fixtureMode) {
        cache.saveAnalysisSnapshot(buildSnapshot(payload, result)).catch(() => {
          post({ type: 'warning', payload: { message: 'This analysis completed, but could not be saved locally for later resuming.' } })
        })
      }
    } catch (error) {
      if (error instanceof CancellationError || cancelled) {
        post({ type: 'cancellation-confirmed' })
        return
      }
      post({
        type: 'processing-error',
        payload: { message: error instanceof Error ? error.message : 'Analysis failed for an unknown reason.' },
      })
    }
  }

  void runAnalysis()
})
