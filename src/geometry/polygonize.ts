import { Polygonizer } from 'jsts/org/locationtech/jts/operation/polygonize.js'
import { createGeometryFactory, isValidJstsGeometry, repairJstsGeometry, toGeoJsonGeometry, toJstsCoordinates, type JstsGeometry } from './validation'
import type { Graph } from './graph'

export interface PolygonizedFace {
  /** Metric-space polygon ring coordinates. */
  geometry: GeoJSON.Polygon
  invalidGeometry: boolean
  repaired: boolean
}

export interface PolygonizeResult {
  faces: PolygonizedFace[]
  dangleCount: number
  cutEdgeCount: number
  invalidRingCount: number
}

/**
 * Polygonizes an already-noded graph using the JSTS Polygonizer. The graph
 * must be correctly noded beforehand (see noding.ts) - the Polygonizer only
 * produces correct faces when input lines meet exactly at shared endpoints.
 */
export function polygonizeGraph(graph: Graph, toleranceMeters: number): PolygonizeResult {
  const factory = createGeometryFactory(toleranceMeters)
  const polygonizer = new Polygonizer()

  for (const edge of graph.edges) {
    if (edge.geometry.length < 2) {
      continue
    }
    try {
      const line = (factory as unknown as { createLineString: (coords: unknown) => JstsGeometry }).createLineString(
        toJstsCoordinates(edge.geometry),
      )
      polygonizer.add(line)
    } catch {
      // Skip edges JSTS cannot turn into a valid LineString (e.g. duplicate points).
    }
  }

  const polygons = polygonizer.getPolygons() as { size: () => number; get: (index: number) => JstsGeometry }
  const dangleCount = (polygonizer.getDangles() as { size: () => number }).size()
  const cutEdgeCount = (polygonizer.getCutEdges() as { size: () => number }).size()
  const invalidRingCount = (polygonizer.getInvalidRingLines() as { size: () => number }).size()

  const faces: PolygonizedFace[] = []
  const size = polygons.size()
  for (let i = 0; i < size; i += 1) {
    const item = polygons.get(i)
    if (!item) continue

    let polygon: JstsGeometry = item
    let repaired = false
    let invalidGeometry = false

    if (!isValidJstsGeometry(polygon)) {
      invalidGeometry = true
      const fixed = repairJstsGeometry(polygon)
      if (fixed) {
        polygon = fixed.geometry
        repaired = fixed.repaired
      }
    }

    if ((polygon as unknown as { isEmpty: () => boolean }).isEmpty()) {
      continue
    }

    const geometry = toGeoJsonGeometry(polygon)
    if (geometry.type === 'Polygon') {
      faces.push({ geometry, invalidGeometry, repaired })
    } else if (geometry.type === 'MultiPolygon') {
      for (const coordinates of geometry.coordinates) {
        faces.push({ geometry: { type: 'Polygon', coordinates }, invalidGeometry, repaired })
      }
    }
  }

  return { faces, dangleCount, cutEdgeCount, invalidRingCount }
}
