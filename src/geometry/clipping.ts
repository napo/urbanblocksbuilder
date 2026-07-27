import { createGeometryFactory, isValidJstsGeometry, repairJstsGeometry, toGeoJsonGeometry, toJstsGeometry, type JstsGeometry } from './validation'

/**
 * Clips a metric-space polygon against a metric-space analysis-area
 * geometry using a real topological intersection (JSTS), so faces that
 * extend past the requested boundary (typically caused by roads dangling
 * out of the analysis area) are cut down to the actual area of interest.
 */
export function clipPolygonToArea(
  polygon: GeoJSON.Polygon,
  areaGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  toleranceMeters: number,
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const factory = createGeometryFactory(toleranceMeters)
  try {
    const polygonGeometry = toJstsGeometry(polygon, factory) as JstsGeometry
    const areaGeom = toJstsGeometry(areaGeometry, factory) as JstsGeometry

    const safePolygon = isValidJstsGeometry(polygonGeometry) ? polygonGeometry : repairJstsGeometry(polygonGeometry)?.geometry
    const safeArea = isValidJstsGeometry(areaGeom) ? areaGeom : repairJstsGeometry(areaGeom)?.geometry
    if (!safePolygon || !safeArea) {
      return null
    }

    const intersection = (safePolygon as unknown as { intersection: (other: JstsGeometry) => JstsGeometry }).intersection(safeArea)
    if ((intersection as unknown as { isEmpty: () => boolean }).isEmpty()) {
      return null
    }

    const result = toGeoJsonGeometry(intersection)
    if (result.type === 'Polygon' || result.type === 'MultiPolygon') {
      return result
    }
    return null
  } catch {
    return null
  }
}
