import { describe, expect, it } from 'vitest'
import { nodeRoadNetwork } from '../../geometry/noding'

describe('nodeRoadNetwork', () => {
  it('splits both roads at a T-junction where one line touches the interior of another', () => {
    const lines = [
      { wayId: 'through-road', logicalLevel: 0, coordinates: [[0, 0], [100, 0]] as [number, number][] },
      { wayId: 'side-road', logicalLevel: 0, coordinates: [[50, 0], [50, 50]] as [number, number][] },
    ]

    const result = nodeRoadNetwork(lines, 1)

    expect(result.statistics.detectedIntersections).toBe(1)
    // The through-road must be split into two segments at (50, 0).
    const throughSegments = result.edges.filter((edge) => edge.wayReferences.includes('through-road'))
    expect(throughSegments.length).toBeGreaterThanOrEqual(2)
  })

  it('does not connect a bridge crossing over a normal road at the same 2D location', () => {
    const lines = [
      { wayId: 'ground-road', logicalLevel: 0, coordinates: [[0, 0], [100, 0]] as [number, number][] },
      { wayId: 'bridge-road', logicalLevel: 1, coordinates: [[50, -50], [50, 50]] as [number, number][] },
    ]

    const result = nodeRoadNetwork(lines, 1)

    expect(result.statistics.incompatibleLevelCrossings).toBe(1)
    expect(result.statistics.detectedIntersections).toBe(0)
    // Each way must survive as a single, unsplit edge since they never share a node.
    const groundSegments = result.edges.filter((edge) => edge.wayReferences.includes('ground-road'))
    const bridgeSegments = result.edges.filter((edge) => edge.wayReferences.includes('bridge-road'))
    expect(groundSegments).toHaveLength(1)
    expect(bridgeSegments).toHaveLength(1)
  })

  it('does not connect a tunnel crossing under a normal road', () => {
    const lines = [
      { wayId: 'surface-road', logicalLevel: 0, coordinates: [[0, 0], [100, 0]] as [number, number][] },
      { wayId: 'tunnel-road', logicalLevel: -1, coordinates: [[50, -50], [50, 50]] as [number, number][] },
    ]

    const result = nodeRoadNetwork(lines, 1)

    expect(result.statistics.incompatibleLevelCrossings).toBe(1)
    const surfaceSegments = result.edges.filter((edge) => edge.wayReferences.includes('surface-road'))
    expect(surfaceSegments).toHaveLength(1)
  })

  it('nodes two same-level roads that cross into four segments', () => {
    const lines = [
      { wayId: 'road-a', logicalLevel: 0, coordinates: [[-50, 0], [50, 0]] as [number, number][] },
      { wayId: 'road-b', logicalLevel: 0, coordinates: [[0, -50], [0, 50]] as [number, number][] },
    ]

    const result = nodeRoadNetwork(lines, 1)

    expect(result.statistics.detectedIntersections).toBe(1)
    expect(result.edges.length).toBe(4)
  })

  it('attributes a known OSM node ID to the edge endpoint it came from', () => {
    const lines = [
      { wayId: 'road-a', logicalLevel: 0, coordinates: [[0, 0], [100, 0]] as [number, number][], nodeIds: ['n1', 'n2'] },
    ]

    const result = nodeRoadNetwork(lines, 1)

    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].startNodeId).toBe('n1')
    expect(result.edges[0].endNodeId).toBe('n2')
  })

  it('leaves a newly computed intersection point without a node ID, even when both crossing ways have known IDs', () => {
    const lines = [
      { wayId: 'road-a', logicalLevel: 0, coordinates: [[-50, 0], [50, 0]] as [number, number][], nodeIds: ['a-start', 'a-end'] },
      { wayId: 'road-b', logicalLevel: 0, coordinates: [[0, -50], [0, 50]] as [number, number][], nodeIds: ['b-start', 'b-end'] },
    ]

    const result = nodeRoadNetwork(lines, 1)

    // The intersection at (0,0) is a new point, not an original vertex of either way.
    const endpointNodeIds = result.edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId])
    expect(endpointNodeIds.filter(Boolean).sort()).toEqual(['a-end', 'a-start', 'b-end', 'b-start'])
  })

  it('does not attribute a node ID when a way has no nodeIds at all (fixture/demo data)', () => {
    const lines = [
      { wayId: 'road-a', logicalLevel: 0, coordinates: [[0, 0], [100, 0]] as [number, number][] },
    ]

    const result = nodeRoadNetwork(lines, 1)

    expect(result.edges[0].startNodeId).toBeUndefined()
    expect(result.edges[0].endNodeId).toBeUndefined()
  })
})
