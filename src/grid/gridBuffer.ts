import * as turf from '@turf/turf'
import type { GridCell } from '../domain/types'

/**
 * Adds a context buffer around a grid cell and clips the buffered cell to
 * the analysis area, producing the actual geometry to send to Overpass for
 * that cell. Buffering uses turf's geodesic buffer (metres), never a naive
 * degree offset.
 */
export function bufferGridCell(
  cell: GridCell,
  analysisAreaGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  contextBufferMeters: number,
): { bbox: [number, number, number, number]; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon } {
  const cellPolygon = turf.bboxPolygon(cell.bbox)
  const buffered = (contextBufferMeters > 0
    ? turf.buffer(cellPolygon, contextBufferMeters, { units: 'meters' })
    : cellPolygon) ?? cellPolygon

  const bufferedBbox = turf.bbox(buffered) as [number, number, number, number]

  let clipped: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null
  try {
    const analysisFeature = turf.feature(analysisAreaGeometry)
    const intersection = turf.intersect(turf.featureCollection([buffered, analysisFeature]))
    if (intersection && (intersection.geometry.type === 'Polygon' || intersection.geometry.type === 'MultiPolygon')) {
      clipped = intersection.geometry
    }
  } catch {
    clipped = null
  }

  return {
    bbox: bufferedBbox,
    geometry: clipped ?? (buffered.geometry as GeoJSON.Polygon),
  }
}
