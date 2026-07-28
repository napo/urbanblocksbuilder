import { describe, expect, it } from 'vitest'
import { deduplicateOsmWays, parseOverpassWays } from '../../services/overpass/OverpassParser'
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

describe('parseOverpassWays', () => {
  it('reads the real OSM node IDs from "nodes" (out body geom) into nodeIds, parallel to coordinates', () => {
    const response = {
      elements: [
        {
          type: 'way',
          id: 42,
          tags: { highway: 'residential' },
          nodes: [100, 200, 300],
          geometry: [{ lat: 46.05, lon: 11.1 }, { lat: 46.06, lon: 11.11 }, { lat: 46.07, lon: 11.12 }],
        },
      ],
    }

    const [result] = parseOverpassWays(response)

    expect(result.nodeIds).toEqual(['100', '200', '300'])
  })

  it('leaves nodeIds undefined when the response has no node refs (e.g. "out tags geom")', () => {
    const response = {
      elements: [
        {
          type: 'way',
          id: 42,
          tags: { highway: 'residential' },
          geometry: [{ lat: 46.05, lon: 11.1 }, { lat: 46.06, lon: 11.11 }],
        },
      ],
    }

    const [result] = parseOverpassWays(response)

    expect(result.nodeIds).toBeUndefined()
  })

  it('leaves nodeIds undefined when nodes and geometry lengths disagree, rather than mismatching them', () => {
    const response = {
      elements: [
        {
          type: 'way',
          id: 42,
          tags: { highway: 'residential' },
          nodes: [100, 200, 300],
          geometry: [{ lat: 46.05, lon: 11.1 }, { lat: 46.06, lon: 11.11 }],
        },
      ],
    }

    const [result] = parseOverpassWays(response)

    expect(result.nodeIds).toBeUndefined()
  })
})
