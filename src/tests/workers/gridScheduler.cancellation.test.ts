import { describe, expect, it, vi } from 'vitest'
import { runGridSchedule } from '../../grid/gridScheduler'
import { defaultAnalysisConfig } from '../../config/defaults'
import type { GridCell } from '../../domain/types'
import { OverpassClient } from '../../services/overpass/OverpassClient'

describe('runGridSchedule cancellation', () => {
  it('stops querying further cells once cancellation is requested mid-run', async () => {
    const cells: GridCell[] = [
      { id: 'cell-1', bbox: [0, 0, 0.01, 0.01], depth: 0, state: 'Pending' },
      { id: 'cell-2', bbox: [0.01, 0, 0.02, 0.01], depth: 0, state: 'Pending' },
      { id: 'cell-3', bbox: [0.02, 0, 0.03, 0.01], depth: 0, state: 'Pending' },
    ]

    const area: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0, 0.01], [0.03, 0.01], [0.03, 0], [0, 0]]] }
    const overpassClient = new OverpassClient(defaultAnalysisConfig)

    let releaseFirstQuery: () => void = () => {}
    const firstQueryStarted = new Promise<void>((resolve) => {
      const querySpy = vi.spyOn(overpassClient, 'query').mockImplementation(() => {
        resolve()
        return new Promise((res) => {
          // Non-empty so this resolution is accepted outright rather than
          // triggering the "retry a suspiciously-empty response" path (see
          // gridScheduler.retry.test.ts) - this test is only about
          // cancellation stopping further cells, not about that behaviour.
          releaseFirstQuery = () => res({ elements: [{ type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0.001, lon: 0.001 }] }] })
        })
      })
      void querySpy
    })

    let cancelled = false
    const resultPromise = runGridSchedule(
      cells,
      { analysisAreaGeometry: area, config: { ...defaultAnalysisConfig, concurrency: 1 }, concurrency: 1, overpassClient },
      { onCellStateChange: () => {}, onWarning: () => {}, isCancelled: () => cancelled },
    )

    await firstQueryStarted
    cancelled = true
    releaseFirstQuery()

    const result = await resultPromise

    expect(overpassClient.query).toHaveBeenCalledTimes(1)
    expect(result.completedCells).toBe(1)
    expect(result.failedCells).toHaveLength(0)
  })
})
