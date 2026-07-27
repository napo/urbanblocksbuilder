import { describe, expect, it } from 'vitest'
import { deduplicateOsmWays } from '../../services/overpass/OverpassParser'
import type { OSMWay } from '../../domain/types'

function way(id: string, coordinateCount: number, sourceCellIds: string[]): OSMWay {
  return {
    id,
    tags: { highway: 'residential' },
    coordinates: Array.from({ length: coordinateCount }, (_, i) => [i, i] as [number, number]),
    logicalLevel: 0,
    sourceCellIds,
    originalGeometry: { type: 'LineString', coordinates: [] },
    status: 'downloaded',
  }
}

describe('deduplicateOsmWays', () => {
  it('deduplicates ways downloaded from overlapping grid cells by OSM ID', () => {
    const ways = [way('42', 3, ['cell-1']), way('42', 3, ['cell-2']), way('7', 2, ['cell-1'])]

    const result = deduplicateOsmWays(ways)

    expect(result).toHaveLength(2)
    const way42 = result.find((entry) => entry.id === '42')
    expect(way42?.sourceCellIds.sort()).toEqual(['cell-1', 'cell-2'])
  })

  it('keeps the most complete geometry when the same way is returned with different coordinate counts', () => {
    const ways = [way('42', 2, ['cell-1']), way('42', 5, ['cell-2'])]

    const result = deduplicateOsmWays(ways)

    expect(result).toHaveLength(1)
    expect(result[0].coordinates).toHaveLength(5)
  })
})
