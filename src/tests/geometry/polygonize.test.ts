import { describe, expect, it } from 'vitest'
import { buildGraphFromNodedEdges } from '../../geometry/graph'
import { polygonizeGraph, resolveFaceNesting, type PolygonizedFace } from '../../geometry/polygonize'
import { calculatePlanarArea } from '../../geometry/indicators'
import type { NodedEdge } from '../../geometry/noding'

function square(minX: number, minY: number, size: number): GeoJSON.Polygon {
  const maxX = minX + size
  const maxY = minY + size
  return { type: 'Polygon', coordinates: [[[minX, minY], [minX, maxY], [maxX, maxY], [maxX, minY], [minX, minY]]] }
}

function face(geometry: GeoJSON.Polygon): PolygonizedFace {
  return { geometry, invalidGeometry: false, repaired: false }
}

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

describe('resolveFaceNesting', () => {
  it('leaves disjoint, non-nested faces untouched', () => {
    const faces = [face(square(0, 0, 10)), face(square(100, 100, 10))]
    const resolved = resolveFaceNesting(faces, 1)

    expect(resolved).toHaveLength(2)
    expect(resolved.map((f) => calculatePlanarArea(f.geometry)).sort()).toEqual([100, 100])
  })

  it('punches a smaller face out of a bigger one that fully contains it', () => {
    // Mirrors what happens when the AOI boundary ring (fed into the graph so
    // roads that dangle out of the selection close against it) never
    // connects to a real closed loop sitting entirely inside it: the
    // Polygonizer returns both as separate, overlapping filled faces instead
    // of an outer face with a hole.
    const outer = face(square(0, 0, 100))
    const inner = face(square(10, 10, 10))
    const resolved = resolveFaceNesting([outer, inner], 1)

    expect(resolved).toHaveLength(2)
    const punchedOuter = resolved.find((f) => f !== inner && calculatePlanarArea(f.geometry) < 10000)
    expect(punchedOuter).toBeDefined()
    // 100x100 square minus the 10x10 hole.
    expect(calculatePlanarArea(punchedOuter!.geometry)).toBeCloseTo(10000 - 100, 0)
    expect(punchedOuter!.geometry.coordinates).toHaveLength(2) // exterior ring + hole ring

    const untouchedInner = resolved.find((f) => calculatePlanarArea(f.geometry) === 100)
    expect(untouchedInner).toBeDefined()
  })
})
