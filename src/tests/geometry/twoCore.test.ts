import { describe, expect, it } from 'vitest'
import { buildGraphFromNodedEdges } from '../../geometry/graph'
import { extractTwoCore } from '../../geometry/twoCore'
import type { NodedEdge } from '../../geometry/noding'

function edge(id: string, from: [number, number], to: [number, number]): NodedEdge {
  return { id, coordinates: [from, to], logicalLevel: 0, wayReferences: [id] }
}

describe('extractTwoCore', () => {
  it('removes a single terminal branch attached to a closed square', () => {
    const square: NodedEdge[] = [
      edge('n', [0, 0], [0, 100]),
      edge('e', [0, 100], [100, 100]),
      edge('s', [100, 100], [100, 0]),
      edge('w', [100, 0], [0, 0]),
    ]
    const branch = edge('branch', [0, 0], [-50, -50])

    const graph = buildGraphFromNodedEdges([...square, branch], 1)
    const result = extractTwoCore(graph)

    expect(result.removedEdges).toHaveLength(1)
    expect(result.removedEdges[0].id).toBe('branch')
    expect(result.core.edges).toHaveLength(4)
  })

  it('recursively removes an entire terminal chain, not just its first segment', () => {
    const square: NodedEdge[] = [
      edge('n', [0, 0], [0, 100]),
      edge('e', [0, 100], [100, 100]),
      edge('s', [100, 100], [100, 0]),
      edge('w', [100, 0], [0, 0]),
    ]
    const chain: NodedEdge[] = [
      edge('chain-1', [0, 0], [-20, -20]),
      edge('chain-2', [-20, -20], [-40, -40]),
      edge('chain-3', [-40, -40], [-60, -60]),
    ]

    const graph = buildGraphFromNodedEdges([...square, ...chain], 1)
    const result = extractTwoCore(graph)

    expect(result.removedEdges).toHaveLength(3)
    expect(result.core.edges).toHaveLength(4)
  })

  it('preserves a closed ring entirely (no edges removed)', () => {
    const square: NodedEdge[] = [
      edge('n', [0, 0], [0, 100]),
      edge('e', [0, 100], [100, 100]),
      edge('s', [100, 100], [100, 0]),
      edge('w', [100, 0], [0, 0]),
    ]

    const graph = buildGraphFromNodedEdges(square, 1)
    const result = extractTwoCore(graph)

    expect(result.removedEdges).toHaveLength(0)
    expect(result.core.edges).toHaveLength(4)
    expect(result.core.nodes.size).toBe(4)
  })
})
