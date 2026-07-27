import { describe, expect, it } from 'vitest'
import { computeBoundaryContactLength, extractBoundaryRingLines } from '../../geometry/boundaryClosure'

const areaSquare: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]]],
}

describe('extractBoundaryRingLines', () => {
  it('returns the exterior ring of a Polygon', () => {
    const rings = extractBoundaryRingLines(areaSquare)
    expect(rings).toHaveLength(1)
    expect(rings[0]).toEqual(areaSquare.coordinates[0])
  })

  it('returns every ring (exterior + holes) across a MultiPolygon', () => {
    const multi: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [areaSquare.coordinates, [[[200, 200], [200, 210], [210, 210], [210, 200], [200, 200]]]],
    }
    expect(extractBoundaryRingLines(multi)).toHaveLength(2)
  })
})

describe('computeBoundaryContactLength', () => {
  it('reports near-zero contact for a block that sits well inside the area', () => {
    const inner: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[40, 40], [40, 60], [60, 60], [60, 40], [40, 40]]] }
    expect(computeBoundaryContactLength(inner, areaSquare, 1)).toBe(0)
  })

  it('reports the full perimeter for a block whose edge is the area boundary itself', () => {
    // Regression test: this used to always return 0 because the JSTS point
    // factory method was called detached from its instance (losing `this`),
    // throwing inside the function's try/catch and silently masking every
    // real contact as "no contact" - see analysisPipeline.fixture.test.ts.
    const contactLength = computeBoundaryContactLength(areaSquare, areaSquare, 1)
    expect(contactLength).toBeCloseTo(400, 0)
  })
})
