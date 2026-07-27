// JSTS ships its convenience instance methods (.buffer(), .intersection(),
// .contains(), .intersects(), .union(), ...) as a separate side-effecting
// module that monkey-patches Geometry.prototype. It must be imported before
// any of those methods are called anywhere in the geometry pipeline.
import 'jsts/org/locationtech/jts/monkey.js'
import { GeoJSONReader, GeoJSONWriter } from 'jsts/org/locationtech/jts/io.js'
import { Coordinate, GeometryFactory, PrecisionModel } from 'jsts/org/locationtech/jts/geom.js'
import { IsValidOp } from 'jsts/org/locationtech/jts/operation/valid.js'

/** Builds real JSTS Coordinate instances - plain {x, y} objects are not enough for every JSTS operation (e.g. IsValidOp expects a .copy() method). */
export function toJstsCoordinates(points: readonly (readonly [number, number])[]): InstanceType<typeof Coordinate>[] {
  return points.map(([x, y]) => new Coordinate(x, y))
}

/**
 * Builds a JSTS GeometryFactory whose precision model snaps coordinates to a
 * grid derived from the configured tolerance. Running noding and union
 * operations through this factory is what makes the snapping tolerance apply
 * consistently across the whole pipeline.
 */
export function createGeometryFactory(toleranceMeters: number): GeometryFactory {
  const scale = toleranceMeters > 0 ? 1 / toleranceMeters : 1
  return new GeometryFactory(new PrecisionModel(scale))
}

export function toJstsGeometry(geometry: GeoJSON.Geometry, factory: GeometryFactory) {
  const reader = new GeoJSONReader(factory)
  return reader.read(geometry as unknown as Record<string, unknown>)
}

export function toGeoJsonGeometry(geometry: unknown): GeoJSON.Geometry {
  const writer = new GeoJSONWriter()
  return writer.write(geometry) as GeoJSON.Geometry
}

export type JstsGeometry = { buffer: (distance: number) => JstsGeometry } & Record<string, unknown>

export function isValidJstsGeometry(geometry: unknown): boolean {
  const op = new IsValidOp(geometry)
  return op.isValid()
}

/**
 * Attempts to repair an invalid geometry using the buffer(0) idiom, which is
 * the standard JTS/JSTS technique for resolving most self-intersections and
 * ring orientation issues. Returns null if the repair still fails validation.
 */
export function repairJstsGeometry(geometry: JstsGeometry): { geometry: JstsGeometry; repaired: boolean } | null {
  try {
    if (isValidJstsGeometry(geometry)) {
      return { geometry, repaired: false }
    }
    const buffered = geometry.buffer(0)
    if (isValidJstsGeometry(buffered)) {
      return { geometry: buffered, repaired: true }
    }
    return null
  } catch {
    return null
  }
}
