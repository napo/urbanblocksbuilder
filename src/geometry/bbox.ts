/**
 * Small bounding-box helpers shared by every step that needs to cheaply rule
 * out a pair of polygons before running an expensive JSTS predicate on them
 * (resolveFaceNesting, blockMerging, district assignment - see each call
 * site for which exact JSTS operation the pre-filter guards).
 */
export type Bbox = [number, number, number, number]

export function polygonBbox(polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon): Bbox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const polygons = polygon.type === 'Polygon' ? [polygon.coordinates] : polygon.coordinates
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  return [minX, minY, maxX, maxY]
}

/** True when the two bounding boxes overlap at all - a necessary (not sufficient) condition for the underlying geometries to touch or intersect. */
export function bboxesOverlap(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

/** True when `outer` fully contains `inner` - a necessary (not sufficient) condition for the outer geometry to contain the inner one. */
export function bboxCovers(outer: Bbox, inner: Bbox): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
}
