import { Coordinate } from 'jsts/org/locationtech/jts/geom.js'
import { createGeometryFactory, toJstsGeometry, type JstsGeometry } from './validation'

/**
 * Sentinel way id for the analysis-area boundary once it is fed into the
 * road-noding step. Lets downstream code (map-layer filtering, road
 * classification) tell a synthetic boundary edge apart from a real OSM way.
 */
export const AOI_BOUNDARY_WAY_ID = '__aoi-boundary__'

/**
 * Extracts every ring (exterior + holes, across every polygon of a
 * MultiPolygon) of a metric-space area geometry as closed line coordinate
 * arrays. Feeding these into the same noding pass as the road network lets a
 * road that dangles out of the selection close against the boundary itself,
 * instead of being stripped as a dead end by 2-core extraction (see
 * analysisPipeline.ts, and docs/algorithm.md).
 */
export function extractBoundaryRingLines(areaGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number][][] {
  const polygons = areaGeometry.type === 'Polygon' ? [areaGeometry.coordinates] : areaGeometry.coordinates
  const rings: [number, number][][] = []
  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length >= 4) {
        rings.push(ring as [number, number][])
      }
    }
  }
  return rings
}

/**
 * Sums the length of a block polygon's exterior-ring segments that lie
 * within (a small multiple of) the noding tolerance of the analysis-area
 * boundary - i.e. how much of the block's perimeter is the selection edge
 * rather than a real street. Used to flag blocks whose shape is partly an
 * artifact of where the user drew the area, not of the road network.
 */
export function computeBoundaryContactLength(
  polygon: GeoJSON.Polygon,
  areaGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  toleranceMeters: number,
): number {
  try {
    const factory = createGeometryFactory(toleranceMeters)
    const areaGeom = toJstsGeometry(areaGeometry, factory) as JstsGeometry
    const areaBoundary = (areaGeom as unknown as { getBoundary: () => JstsGeometry }).getBoundary() as unknown as {
      distance: (other: JstsGeometry) => number
    }
    const pointFactory = factory as unknown as { createPoint: (coordinate: InstanceType<typeof Coordinate>) => JstsGeometry }

    const ring = polygon.coordinates[0] ?? []
    const contactDistance = toleranceMeters * 2
    let contactLength = 0

    for (let i = 0; i < ring.length - 1; i += 1) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[i + 1]
      const midpoint = pointFactory.createPoint(new Coordinate((ax + bx) / 2, (ay + by) / 2))
      if (areaBoundary.distance(midpoint) <= contactDistance) {
        contactLength += Math.hypot(bx - ax, by - ay)
      }
    }
    return contactLength
  } catch {
    return 0
  }
}
