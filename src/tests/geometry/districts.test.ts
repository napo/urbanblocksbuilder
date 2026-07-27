import { describe, expect, it } from 'vitest'
import { assignBlocksToDistricts, computeDistrictStatistics } from '../../geometry/districts'

function squarePolygon(minX: number, minY: number, size: number): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [[
      [minX, minY],
      [minX, minY + size],
      [minX + size, minY + size],
      [minX + size, minY],
      [minX, minY],
    ]],
  }
}

describe('assignBlocksToDistricts', () => {
  const districtA = { districtId: 'district-a', polygonMetric: squarePolygon(0, 0, 100), areaM2: 10000 }
  const districtB = { districtId: 'district-b', polygonMetric: squarePolygon(100, 0, 100), areaM2: 10000 }

  it('assigns a block to the district with the largest area overlap', () => {
    // A block mostly inside district A but crossing slightly into district B.
    const block = { blockId: 'block-1', polygonMetric: squarePolygon(-10, 0, 100), areaM2: 10000, compactness: 0.8 }

    const assignments = assignBlocksToDistricts([block], [districtA, districtB], 'largest-overlap', 1)

    expect(assignments[0].districtId).toBe('district-a')
    expect(assignments[0].overlapRatio).toBeGreaterThan(0.5)
  })

  it('assigns a block by point-on-surface containment', () => {
    const block = { blockId: 'block-2', polygonMetric: squarePolygon(120, 0, 50), areaM2: 2500, compactness: 0.8 }

    const assignments = assignBlocksToDistricts([block], [districtA, districtB], 'point-on-surface', 1)

    expect(assignments[0].districtId).toBe('district-b')
    expect(assignments[0].overlapRatio).toBe(1)
  })

  it('leaves a block unassigned when no district exists', () => {
    const block = { blockId: 'block-3', polygonMetric: squarePolygon(0, 0, 50), areaM2: 2500, compactness: 0.8 }

    const assignments = assignBlocksToDistricts([block], [], 'largest-overlap', 1)

    expect(assignments[0].districtId).toBeNull()
  })
})

describe('computeDistrictStatistics', () => {
  it('computes block counts and area statistics per district', () => {
    const districtA = { districtId: 'district-a', districtName: 'A', polygonMetric: squarePolygon(0, 0, 100), areaM2: 10000 }
    const blocks = [
      { blockId: 'b1', polygonMetric: squarePolygon(0, 0, 20), areaM2: 400, compactness: 0.9 },
      { blockId: 'b2', polygonMetric: squarePolygon(30, 0, 20), areaM2: 400, compactness: 0.7 },
    ]
    const assignments = [
      { blockId: 'b1', districtId: 'district-a', overlapRatio: 1 },
      { blockId: 'b2', districtId: 'district-a', overlapRatio: 1 },
    ]

    const stats = computeDistrictStatistics(blocks, [districtA], assignments, 'largest-overlap', 1, 100000)

    expect(stats).toHaveLength(1)
    expect(stats[0].blockCount).toBe(2)
    expect(stats[0].totalBlockAreaM2).toBe(800)
    expect(stats[0].meanCompactness).toBeCloseTo(0.8, 5)
  })
})
