import { describe, expect, it } from 'vitest'
import { buildGraphFromNodedEdges } from '../../geometry/graph'
import { polygonizeGraph } from '../../geometry/polygonize'
import { calculatePlanarArea } from '../../geometry/indicators'
import type { NodedEdge } from '../../geometry/noding'

function edge(id: string, from: [number, number], to: [number, number]): NodedEdge {
  return { id, coordinates: [from, to], logicalLevel: 0, wayReferences: [id] }
}

describe('polygonizeGraph', () => {
  it('polygonizes a simple closed square into exactly one face', () => {
    const square: NodedEdge[] = [
      edge('n', [0, 0], [0, 100]),
      edge('e', [0, 100], [100, 100]),
      edge('s', [100, 100], [100, 0]),
      edge('w', [100, 0], [0, 0]),
    ]

    const graph = buildGraphFromNodedEdges(square, 1)
    const result = polygonizeGraph(graph, 1)

    expect(result.faces).toHaveLength(1)
    expect(calculatePlanarArea(result.faces[0].geometry)).toBeCloseTo(10000, 0)
  })

  it('polygonizes two adjacent squares sharing an edge into exactly two faces', () => {
    const squares: NodedEdge[] = [
      edge('left-n', [0, 0], [0, 100]),
      edge('left-e', [0, 100], [100, 100]),
      edge('middle', [100, 100], [100, 0]),
      edge('left-w', [100, 0], [0, 0]),
      edge('right-n', [100, 100], [200, 100]),
      edge('right-e', [200, 100], [200, 0]),
      edge('right-w', [200, 0], [100, 0]),
    ]

    const graph = buildGraphFromNodedEdges(squares, 1)
    const result = polygonizeGraph(graph, 1)

    expect(result.faces).toHaveLength(2)
    for (const face of result.faces) {
      expect(calculatePlanarArea(face.geometry)).toBeCloseTo(10000, 0)
    }
  })
})
