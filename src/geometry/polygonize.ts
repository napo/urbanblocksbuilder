import { Polygonizer } from 'jsts/org/locationtech/jts/operation/polygonize.js'
import { UnaryUnionOp } from 'jsts/org/locationtech/jts/operation/union.js'
import { createGeometryFactory, isValidJstsGeometry, repairJstsGeometry, toGeoJsonGeometry, toJstsCoordinates, toJstsGeometry, type JstsGeometry } from './validation'
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

function polygonBbox(polygon: GeoJSON.Polygon): [number, number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of polygon.coordinates) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return [minX, minY, maxX, maxY]
}

function bboxCovers(outer: [number, number, number, number], inner: [number, number, number, number]): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
}

/**
 * The Polygonizer resolves faces per connected component of the input graph.
 * When the analysis-area boundary is fed in alongside the road network (see
 * boundaryClosure.ts), a real closed road loop that never happens to reach
 * the boundary - directly or indirectly through other roads - ends up in its
 * own disconnected component, so it comes back as a separate face nested
 * inside the boundary's leftover face rather than as a hole in it: both get
 * emitted as overlapping, filled polygons. This punches every face that
 * geometrically contains another out of it, turning that overlap into the
 * correct outer-face-with-a-hole shape.
 */
export function resolveFaceNesting(faces: PolygonizedFace[], toleranceMeters: number): PolygonizedFace[] {
  if (faces.length < 2) {
    return faces
  }

  const factory = createGeometryFactory(toleranceMeters)
  const geometries = faces.map((face) => toJstsGeometry(face.geometry, factory) as JstsGeometry)
  const bboxes = faces.map((face) => polygonBbox(face.geometry))
  const covers = (a: JstsGeometry, b: JstsGeometry) => (a as unknown as { covers: (other: JstsGeometry) => boolean }).covers(b)

  const resolved: PolygonizedFace[] = []
  for (let i = 0; i < faces.length; i += 1) {
    const containedIndexes: number[] = []
    for (let j = 0; j < faces.length; j += 1) {
      if (i === j || !bboxCovers(bboxes[i], bboxes[j])) {
        continue
      }
      if (covers(geometries[i], geometries[j]) && !covers(geometries[j], geometries[i])) {
        containedIndexes.push(j)
      }
    }

    if (containedIndexes.length === 0) {
      resolved.push(faces[i])
      continue
    }

    try {
      const holesCollection = (factory as unknown as { createGeometryCollection: (geoms: JstsGeometry[]) => JstsGeometry }).createGeometryCollection(
        containedIndexes.map((index) => geometries[index]),
      )
      const holesUnion = UnaryUnionOp.union(holesCollection) as JstsGeometry
      const punched = (geometries[i] as unknown as { difference: (other: JstsGeometry) => JstsGeometry }).difference(holesUnion)
      if ((punched as unknown as { isEmpty: () => boolean }).isEmpty()) {
        continue
      }

      const geometry = toGeoJsonGeometry(punched)
      if (geometry.type === 'Polygon') {
        resolved.push({ ...faces[i], geometry })
      } else if (geometry.type === 'MultiPolygon') {
        for (const coordinates of geometry.coordinates) {
          resolved.push({ ...faces[i], geometry: { type: 'Polygon', coordinates } })
        }
      }
    } catch {
      resolved.push(faces[i])
    }
  }

  return resolved
}
