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
          releaseFirstQuery = () => res({ elements: [] })
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
