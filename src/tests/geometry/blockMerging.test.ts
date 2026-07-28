import { describe, expect, it } from 'vitest'
import { absorbBuildinglessBlocks, type MergeCandidate } from '../../geometry/blockMerging'
import { calculatePlanarArea } from '../../geometry/indicators'

function square(minX: number, minY: number, size: number): GeoJSON.Polygon {
  const maxX = minX + size
  const maxY = minY + size
  return { type: 'Polygon', coordinates: [[[minX, minY], [minX, maxY], [maxX, maxY], [maxX, minY], [minX, minY]]] }
}

function candidate(id: string, polygon: GeoJSON.Polygon, hasBuildings: boolean): MergeCandidate {
  return { id, polygon, hasBuildings, invalidGeometry: false }
}

describe('absorbBuildinglessBlocks', () => {
  it('leaves blocks alone when every block already has a building', () => {
    const result = absorbBuildinglessBlocks(
      [candidate('a', square(0, 0, 10), true), candidate('b', square(10, 0, 10), true)],
      1,
    )

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.mergedIds)).toEqual([['a'], ['b']])
  })

  it('merges a buildingless block into the neighbour it shares a border with', () => {
    const result = absorbBuildinglessBlocks(
      [candidate('empty', square(0, 0, 10), false), candidate('real', square(10, 0, 10), true)],
      1,
    )

    expect(result).toHaveLength(1)
    expect(result[0].hasBuildings).toBe(true)
    expect(result[0].mergedIds.sort()).toEqual(['empty', 'real'])
    expect(calculatePlanarArea(result[0].polygon)).toBeCloseTo(200, 0)
  })

  it('picks the neighbour with the longest shared border when there is more than one candidate', () => {
    // "empty" is a 10x20 block; "small-neighbour" shares only its 10-unit
    // north edge, "big-neighbour" shares the full 20-unit east edge.
    const empty: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0, 20], [10, 20], [10, 0], [0, 0]]] }
    const smallNeighbour: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 20], [0, 30], [10, 30], [10, 20], [0, 20]]] }
    const bigNeighbour: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[10, 0], [10, 20], [20, 20], [20, 0], [10, 0]]] }

    const result = absorbBuildinglessBlocks(
      [candidate('empty', empty, false), candidate('small-neighbour', smallNeighbour, true), candidate('big-neighbour', bigNeighbour, true)],
      1,
    )

    expect(result).toHaveLength(2)
    const merged = result.find((r) => r.mergedIds.includes('empty'))
    expect(merged?.mergedIds.sort()).toEqual(['big-neighbour', 'empty'])
  })

  it('chains through multiple buildingless blocks until it reaches a real one', () => {
    const result = absorbBuildinglessBlocks(
      [
        candidate('empty-1', square(0, 0, 10), false),
        candidate('empty-2', square(10, 0, 10), false),
        candidate('real', square(20, 0, 10), true),
      ],
      1,
    )

    expect(result).toHaveLength(1)
    expect(result[0].hasBuildings).toBe(true)
    expect(result[0].mergedIds.sort()).toEqual(['empty-1', 'empty-2', 'real'])
  })

  it('leaves an isolated buildingless block on its own when it has no neighbour', () => {
    const result = absorbBuildinglessBlocks(
      [candidate('empty', square(0, 0, 10), false), candidate('far-away', square(1000, 1000, 10), true)],
      1,
    )

    expect(result).toHaveLength(2)
    const stillEmpty = result.find((r) => r.mergedIds.includes('empty'))
    expect(stillEmpty?.hasBuildings).toBe(false)
  })

  it('consolidates two adjacent buildingless blocks into one when neither has a neighbour with a building', () => {
    const result = absorbBuildinglessBlocks(
      [candidate('empty-1', square(0, 0, 10), false), candidate('empty-2', square(10, 0, 10), false)],
      1,
    )

    expect(result).toHaveLength(1)
    expect(result[0].hasBuildings).toBe(false)
    expect(result[0].mergedIds.sort()).toEqual(['empty-1', 'empty-2'])
  })
})
