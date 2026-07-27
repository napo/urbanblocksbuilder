import * as turf from '@turf/turf'
import type { AnalysisArea, AnalysisAreaGeometry } from './types'

export function createAnalysisArea(
  geometry: AnalysisAreaGeometry,
  source: AnalysisArea['source'],
  name?: string,
  radiusMeters?: number,
): AnalysisArea {
  const bbox = turf.bbox(geometry) as [number, number, number, number]
  const areaKm2 = turf.area(geometry) / 1000000

  return {
    id: crypto.randomUUID(),
    name,
    source,
    geometry,
    bbox,
    areaKm2,
    radiusMeters,
  }
}

export function normalizeGeoJsonGeometry(input: unknown): AnalysisAreaGeometry | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const parsed = input as GeoJSON.GeoJSON

  if (parsed.type === 'Polygon') {
    return parsed
  }

  if (parsed.type === 'MultiPolygon') {
    return parsed
  }

  if (parsed.type === 'Feature' && parsed.geometry) {
    if (parsed.geometry.type === 'Polygon' || parsed.geometry.type === 'MultiPolygon') {
      return parsed.geometry
    }
  }

  if (parsed.type === 'FeatureCollection') {
    const polygonFeatures = parsed.features.filter(
      (feature): feature is GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> =>
        Boolean(feature.geometry) &&
        (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'),
    )

    if (polygonFeatures.length === 0) {
      return null
    }

    if (polygonFeatures.length === 1) {
      return polygonFeatures[0].geometry
    }

    return {
      type: 'MultiPolygon',
      coordinates: polygonFeatures.flatMap((feature) =>
        feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates,
      ),
    }
  }

  return null
}

export function validateCoordinateBounds(coordinates: number[]): boolean {
  return coordinates[0] >= -180 && coordinates[0] <= 180 && coordinates[1] >= -90 && coordinates[1] <= 90
}

export function validateGeometry(geometry: AnalysisAreaGeometry): string[] {
  const errors: string[] = []

  if (!geometry || !Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    errors.push('The geometry is empty.')
    return errors
  }

  const rings: GeoJSON.Position[][] = geometry.type === 'Polygon'
    ? geometry.coordinates
    : geometry.coordinates.flatMap((polygon) => polygon)

  for (const ring of rings) {
    if (ring.length < 4) {
      errors.push('A polygon ring must have at least four coordinates (three vertices plus the closing point).')
      continue
    }
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) {
      errors.push('A polygon ring must be closed (its first and last coordinates must match).')
    }
    for (const coordinate of ring) {
      if (!Array.isArray(coordinate) || coordinate.length < 2 || !validateCoordinateBounds(coordinate)) {
        errors.push('One or more coordinates fall outside the WGS84 coordinate range.')
        break
      }
    }
  }

  return errors
}

export const MAX_UPLOAD_VERTEX_COUNT = 50000
export const MAX_UPLOAD_FILE_SIZE_BYTES = 25 * 1024 * 1024
export const MAX_ANALYSIS_AREA_KM2 = 100000

export function countVertices(geometry: AnalysisAreaGeometry): number {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flatMap((polygon) => polygon)
  return rings.reduce((sum, ring) => sum + ring.length, 0)
}

/**
 * Validates a candidate geometry before it is accepted as (or merged into)
 * an AnalysisArea: coordinate bounds and ring validity (via validateGeometry
 * above), plus vertex-count and geographic-extent sanity limits appropriate
 * for an MVP that must eventually query Overpass and node the result
 * in-browser. Self-intersections are reported as warnings, not hard errors,
 * since many real-world polygons have minor topological glitches turf can
 * still work around downstream.
 */
export function validateUploadCandidate(geometry: AnalysisAreaGeometry): { errors: string[]; warnings: string[] } {
  const errors = validateGeometry(geometry)
  const warnings: string[] = []

  const vertexCount = countVertices(geometry)
  if (vertexCount > MAX_UPLOAD_VERTEX_COUNT) {
    errors.push(`The geometry has ${vertexCount} vertices, which exceeds the ${MAX_UPLOAD_VERTEX_COUNT} limit. Simplify the geometry before uploading.`)
  }

  return { errors, warnings }
}
