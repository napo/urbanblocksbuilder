import { describe, expect, it, vi } from 'vitest'
import { runGridSchedule } from '../../grid/gridScheduler'
import { defaultAnalysisConfig } from '../../config/defaults'
import type { GridCell } from '../../domain/types'
import { OverpassClient } from '../../services/overpass/OverpassClient'
import { OverpassRequestError } from '../../services/overpass/OverpassErrors'

const area: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]] }
const cells: GridCell[] = [{ id: 'cell-1', bbox: [0, 0, 0.01, 0.01], depth: 0, state: 'Pending' }]

describe('runGridSchedule retry classification', () => {
  it('retries a retryable failure and succeeds once the query eventually resolves', async () => {
    const overpassClient = new OverpassClient(defaultAnalysisConfig)
    vi.spyOn(overpassClient, 'query')
      .mockRejectedValueOnce(new OverpassRequestError('server error', true))
      .mockResolvedValueOnce({ elements: [] })

    const warnings: string[] = []
    const result = await runGridSchedule(
      cells,
      { analysisAreaGeometry: area, config: { ...defaultAnalysisConfig, concurrency: 1, maxRetries: 3 }, concurrency: 1, overpassClient },
      { onCellStateChange: () => {}, onWarning: (message) => warnings.push(message), isCancelled: () => false },
    )

    expect(overpassClient.query).toHaveBeenCalledTimes(2)
    expect(result.completedCells).toBe(1)
    expect(result.failedCells).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })

  it('gives up immediately on a non-retryable failure instead of burning through retries', async () => {
    const overpassClient = new OverpassClient(defaultAnalysisConfig)
    vi.spyOn(overpassClient, 'query').mockRejectedValue(new OverpassRequestError('Malformed Overpass query', false))

    const warnings: string[] = []
    const result = await runGridSchedule(
      cells,
      { analysisAreaGeometry: area, config: { ...defaultAnalysisConfig, concurrency: 1, maxRetries: 3 }, concurrency: 1, overpassClient },
      { onCellStateChange: () => {}, onWarning: (message) => warnings.push(message), isCancelled: () => false },
    )

    expect(overpassClient.query).toHaveBeenCalledTimes(1)
    expect(result.failedCells).toHaveLength(1)
    expect(warnings[0]).toContain('failed after 1 attempt(s)')
  })
})
