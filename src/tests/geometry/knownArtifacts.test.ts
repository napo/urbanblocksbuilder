import { describe, expect, it } from 'vitest'
import { nodeRoadNetwork, type NodingInputLine } from '../../geometry/noding'
import { buildGraphFromNodedEdges } from '../../geometry/graph'
import { extractTwoCore } from '../../geometry/twoCore'
import { polygonizeGraph, resolveFaceNesting } from '../../geometry/polygonize'
import { calculateBlockIndicators } from '../../geometry/indicators'
import { absorbBuildinglessBlocks, type MergeCandidate } from '../../geometry/blockMerging'

const TOL = 1

function circleRing(cx: number, cy: number, r: number, n = 16): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

function polygonizeAll(lines: NodingInputLine[]) {
  const noded = nodeRoadNetwork(lines, TOL)
  const graph = buildGraphFromNodedEdges(noded.edges, TOL)
  const core = extractTwoCore(graph)
  const raw = polygonizeGraph(core.core, TOL)
  return resolveFaceNesting(raw.faces, TOL)
}

/**
 * These two scenarios are not given any special-case handling anywhere in
 * the pipeline - a roundabout island and a divided-road median both just
 * come out of polygonizeGraph as their own small, real closed faces, like
 * any other topologically-valid loop in the road network. They end up
 * looking reasonable in practice only because they have no building inside
 * them, so the no-buildings merge (blockMerging.ts) folds them into a
 * neighbour. This test exists to make that reliance visible and catch a
 * regression if either step ever stops producing this result.
 */
describe('known artifacts: roundabout island and divided-road median', () => {
  it('a roundabout island polygonizes as its own small, near-circular face, and is absorbed by a neighbouring quadrant once buildings are considered', () => {
    const outerBlock: NodingInputLine[] = [
      { wayId: 'n', logicalLevel: 0, coordinates: [[0, 0], [400, 0]] },
      { wayId: 'e', logicalLevel: 0, coordinates: [[400, 0], [400, 400]] },
      { wayId: 's', logicalLevel: 0, coordinates: [[400, 400], [0, 400]] },
      { wayId: 'w', logicalLevel: 0, coordinates: [[0, 400], [0, 0]] },
    ]
    // A real OSM roundabout: a closed `junction=roundabout` ring plus four
    // approach ways, each ending exactly on the ring.
    const roundabout: NodingInputLine = { wayId: 'roundabout', logicalLevel: 0, coordinates: circleRing(200, 200, 15, 16) }
    const approaches: NodingInputLine[] = [
      { wayId: 'approach-n', logicalLevel: 0, coordinates: [[200, 0], [200, 185]] },
      { wayId: 'approach-e', logicalLevel: 0, coordinates: [[400, 200], [215, 200]] },
      { wayId: 'approach-s', logicalLevel: 0, coordinates: [[200, 400], [200, 215]] },
      { wayId: 'approach-w', logicalLevel: 0, coordinates: [[0, 200], [185, 200]] },
    ]

    const faces = polygonizeAll([...outerBlock, roundabout, ...approaches])
    expect(faces).toHaveLength(5)

    const indicators = faces.map((face) => calculateBlockIndicators(face.geometry))
    const island = indicators.reduce((smallest, current) => (current.areaM2 < smallest.areaM2 ? current : smallest))
    // A 15-unit-radius circle: pi*15^2 ~= 706.9, comfortably distinct from the ~39800 quadrants.
    expect(island.areaM2).toBeLessThan(1000)
    expect(island.compactness).toBeGreaterThan(0.95) // near-perfect circle

    const candidates: MergeCandidate[] = faces.map((face, i) => ({
      id: `face-${i}`,
      polygon: face.geometry,
      hasBuildings: indicators[i].areaM2 !== island.areaM2,
      invalidGeometry: false,
    }))
    const merged = absorbBuildinglessBlocks(candidates, TOL)

    expect(merged).toHaveLength(4)
    expect(merged.every((block) => block.hasBuildings)).toBe(true)
    const totalAreaBefore = indicators.reduce((sum, i) => sum + i.areaM2, 0)
    const totalAreaAfter = merged.reduce((sum, block) => sum + calculateBlockIndicators(block.polygon).areaM2, 0)
    expect(totalAreaAfter).toBeCloseTo(totalAreaBefore, 0) // no area lost or double-counted in the merge
  })

  it('a divided road (two parallel one-way ways) leaves a thin, low-compactness median sliver that gets absorbed by a neighbouring block', () => {
    const north: NodingInputLine[] = [
      { wayId: 'n-w', logicalLevel: 0, coordinates: [[0, 0], [0, 48]] },
      { wayId: 'n-top', logicalLevel: 0, coordinates: [[0, 0], [300, 0]] },
      { wayId: 'n-e', logicalLevel: 0, coordinates: [[300, 0], [300, 48]] },
    ]
    const south: NodingInputLine[] = [
      { wayId: 's-w', logicalLevel: 0, coordinates: [[0, 52], [0, 100]] },
      { wayId: 's-bottom', logicalLevel: 0, coordinates: [[0, 100], [300, 100]] },
      { wayId: 's-e', logicalLevel: 0, coordinates: [[300, 52], [300, 100]] },
    ]
    const carriageway: NodingInputLine[] = [
      { wayId: 'carriageway-north-side', logicalLevel: 0, coordinates: [[0, 48], [300, 48]] },
      { wayId: 'carriageway-south-side', logicalLevel: 0, coordinates: [[0, 52], [300, 52]] },
      { wayId: 'link-west', logicalLevel: 0, coordinates: [[0, 48], [0, 52]] },
      { wayId: 'link-east', logicalLevel: 0, coordinates: [[300, 48], [300, 52]] },
    ]

    const faces = polygonizeAll([...north, ...south, ...carriageway])
    expect(faces).toHaveLength(3)

    const indicators = faces.map((face) => calculateBlockIndicators(face.geometry))
    const median = indicators.reduce((smallest, current) => (current.areaM2 < smallest.areaM2 ? current : smallest))
    expect(median.areaM2).toBeCloseTo(1200, 0) // 300 x 4
    expect(median.compactness).toBeLessThan(0.1) // a thin strip is nowhere near circular

    const candidates: MergeCandidate[] = faces.map((face, i) => ({
      id: `face-${i}`,
      polygon: face.geometry,
      hasBuildings: indicators[i].areaM2 !== median.areaM2,
      invalidGeometry: false,
    }))
    const merged = absorbBuildinglessBlocks(candidates, TOL)

    expect(merged).toHaveLength(2)
    expect(merged.every((block) => block.hasBuildings)).toBe(true)
  })
})
