import { describe, expect, it } from 'vitest'
import { assignBlocksToDistricts, computeDistrictStatistics, type DistrictAssignmentDistrictInput } from '../../geometry/districts'

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

  it('still finds the right district when a block genuinely straddles two adjacent district bounding boxes', () => {
    // Regression guard for the bbox pre-filter added to assignBlocksToDistricts:
    // this block's own bbox truly overlaps both district-a and district-b's
    // bboxes (unlike the "mostly in A" block above, whose bbox never reaches
    // B at all), so the pre-filter must not skip either candidate.
    const block = { blockId: 'straddling', polygonMetric: squarePolygon(70, 0, 60), areaM2: 3600, compactness: 0.8 }

    const assignments = assignBlocksToDistricts([block], [districtA, districtB], 'largest-overlap', 1)

    // 30x100 inside A, 30x100 inside B - evenly split, but B should not lose to A by more than float noise.
    expect(assignments[0].districtId).not.toBeNull()
    expect(assignments[0].overlapRatio).toBeGreaterThan(0.4)
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

  it('splits a straddling block\'s area across both districts under the intersection strategy (bbox pre-filter regression guard)', () => {
    const districtA: DistrictAssignmentDistrictInput = { districtId: 'district-a', polygonMetric: squarePolygon(0, 0, 100), areaM2: 10000 }
    const districtB: DistrictAssignmentDistrictInput = { districtId: 'district-b', polygonMetric: squarePolygon(100, 0, 100), areaM2: 10000 }
    const block = { blockId: 'straddling', polygonMetric: squarePolygon(70, 0, 60), areaM2: 3600, compactness: 0.8 }

    const stats = computeDistrictStatistics([block], [districtA, districtB], [], 'intersection', 1, 100000)

    const byId = Object.fromEntries(stats.map((s) => [s.districtId, s]))
    expect(byId['district-a'].blockCount).toBe(1)
    expect(byId['district-b'].blockCount).toBe(1)
    expect(byId['district-a'].totalBlockAreaM2).toBeCloseTo(1800, 0)
    expect(byId['district-b'].totalBlockAreaM2).toBeCloseTo(1800, 0)
  })
})
