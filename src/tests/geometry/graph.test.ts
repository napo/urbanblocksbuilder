import { describe, expect, it } from 'vitest'
import { buildGraphFromNodedEdges } from '../../geometry/graph'
import type { NodedEdge } from '../../geometry/noding'

const TOL = 3 // matches the app's default snappingToleranceMeters

describe('buildGraphFromNodedEdges', () => {
  it('does not merge two endpoints that are within the coordinate tolerance but have different known OSM node IDs', () => {
    // The documented edge case: a ground-level approach ends near, but not
    // exactly at, an unrelated way's vertex - here 1.5m apart, well inside
    // the 3m tolerance. Both ends have distinct, known real OSM node IDs, so
    // they must stay two separate graph nodes rather than incidentally weld.
    const edges: NodedEdge[] = [
      { id: 'e1', coordinates: [[0, 0], [50, 0]], logicalLevel: 0, wayReferences: ['approach'], startNodeId: 'n-approach-start', endNodeId: 'n-approach-end' },
      { id: 'e2', coordinates: [[51.5, 0], [100, 0]], logicalLevel: 0, wayReferences: ['unrelated'], startNodeId: 'n-unrelated-start', endNodeId: 'n-unrelated-end' },
    ]

    const graph = buildGraphFromNodedEdges(edges, TOL)

    expect(graph.nodes.size).toBe(4)
    const approachEnd = graph.nodes.get('osm:n-approach-end')
    const unrelatedStart = graph.nodes.get('osm:n-unrelated-start')
    expect(approachEnd).toBeDefined()
    expect(unrelatedStart).toBeDefined()
    expect(approachEnd?.degree).toBe(1)
    expect(unrelatedStart?.degree).toBe(1)
  })

  it('merges two endpoints that share the same known OSM node ID even if their coordinates differ slightly', () => {
    // Same real intersection, digitized with a small float difference across
    // two independently-downloaded ways (e.g. from different grid cells).
    const edges: NodedEdge[] = [
      { id: 'e1', coordinates: [[0, 0], [50, 0.05]], logicalLevel: 0, wayReferences: ['road-a'], startNodeId: 'n-start', endNodeId: 'n-shared' },
      { id: 'e2', coordinates: [[50.02, 0.01], [100, 0]], logicalLevel: 0, wayReferences: ['road-b'], startNodeId: 'n-shared', endNodeId: 'n-end' },
    ]

    const graph = buildGraphFromNodedEdges(edges, TOL)

    expect(graph.nodes.size).toBe(3)
    const shared = graph.nodes.get('osm:n-shared')
    expect(shared).toBeDefined()
    expect(shared?.degree).toBe(2)
  })

  it('falls back to coordinate-proximity clustering when node IDs are unknown (fixture/demo data, boundary ring)', () => {
    const edges: NodedEdge[] = [
      { id: 'e1', coordinates: [[0, 0], [50, 0]], logicalLevel: 0, wayReferences: ['road-a'] },
      { id: 'e2', coordinates: [[50.4, 0.2], [100, 0]], logicalLevel: 0, wayReferences: ['road-b'] },
    ]

    const graph = buildGraphFromNodedEdges(edges, TOL)

    // No known IDs on either side, so the two close-but-not-identical
    // endpoints still merge via the original tolerance-rounding behaviour.
    expect(graph.nodes.size).toBe(3)
  })

  it('merges a known-ID endpoint with an unidentified one only when they land in the same coordinate bucket (boundary-ring closure case)', () => {
    const edges: NodedEdge[] = [
      { id: 'e1', coordinates: [[0, 0], [50, 0]], logicalLevel: 0, wayReferences: ['road-clipped-at-boundary'], startNodeId: 'n-start' },
      { id: 'e2', coordinates: [[50, 0], [100, 100]], logicalLevel: 0, wayReferences: ['boundary-ring'] },
    ]

    const graph = buildGraphFromNodedEdges(edges, TOL)

    expect(graph.nodes.size).toBe(3)
    const junction = graph.nodes.get('50:0')
    expect(junction?.degree).toBe(2)
  })
})
