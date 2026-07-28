import { UnaryUnionOp } from 'jsts/org/locationtech/jts/operation/union.js'
import { createGeometryFactory, toGeoJsonGeometry, toJstsGeometry, type JstsGeometry } from './validation'

export interface MergeCandidate {
  id: string
  polygon: GeoJSON.Polygon
  hasBuildings: boolean
  invalidGeometry: boolean
}

export interface MergedBlock {
  mergedIds: string[]
  polygon: GeoJSON.Polygon
  hasBuildings: boolean
  invalidGeometry: boolean
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

function bboxesOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

function lineLength(geometry: GeoJSON.Geometry): number {
  if (geometry.type === 'LineString') {
    return ringLength(geometry.coordinates as [number, number][])
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.reduce((sum, line) => sum + ringLength(line as [number, number][]), 0)
  }
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.reduce((sum, entry) => sum + lineLength(entry), 0)
  }
  // Point/MultiPoint/empty results mean the geometries only touch at a
  // vertex, not along an edge - that is not a usable shared border.
  return 0
}

function ringLength(coordinates: [number, number][]): number {
  let sum = 0
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    sum += Math.hypot(coordinates[i + 1][0] - coordinates[i][0], coordinates[i + 1][1] - coordinates[i][1])
  }
  return sum
}

interface WorkingNode {
  mergedIds: string[]
  geometry: JstsGeometry
  bbox: [number, number, number, number]
  hasBuildings: boolean
  invalidGeometry: boolean
  /** No touching neighbour was found for this (still buildingless) node - skip it on later passes, its geometry cannot change on its own. */
  stuck: boolean
}

/**
 * Merges every block with no building inside it into whichever neighbouring
 * block it shares the longest border with, repeating so a whole run of
 * adjacent buildingless blocks (e.g. a park spanning several street-grid
 * cells) consolidates into the one real block it eventually borders. A
 * buildingless block with no neighbour at all (nothing to absorb into) is
 * left as its own block.
 */
export function absorbBuildinglessBlocks(candidates: MergeCandidate[], toleranceMeters: number): MergedBlock[] {
  if (candidates.length < 2) {
    return candidates.map((candidate) => ({
      mergedIds: [candidate.id],
      polygon: candidate.polygon,
      hasBuildings: candidate.hasBuildings,
      invalidGeometry: candidate.invalidGeometry,
    }))
  }

  const factory = createGeometryFactory(toleranceMeters)
  const touches = (a: JstsGeometry, b: JstsGeometry) => (a as unknown as { touches: (other: JstsGeometry) => boolean }).touches(b)
  const boundaryOf = (geometry: JstsGeometry) => (geometry as unknown as { getBoundary: () => JstsGeometry }).getBoundary()
  const intersectionOf = (a: JstsGeometry, b: JstsGeometry) => (a as unknown as { intersection: (other: JstsGeometry) => JstsGeometry }).intersection(b)

  const sharedBorderLength = (a: JstsGeometry, b: JstsGeometry): number => {
    try {
      const shared = intersectionOf(boundaryOf(a), boundaryOf(b))
      return lineLength(toGeoJsonGeometry(shared))
    } catch {
      return 0
    }
  }

  let nodes: WorkingNode[] = candidates.map((candidate) => ({
    mergedIds: [candidate.id],
    geometry: toJstsGeometry(candidate.polygon, factory) as JstsGeometry,
    bbox: polygonBbox(candidate.polygon),
    hasBuildings: candidate.hasBuildings,
    invalidGeometry: candidate.invalidGeometry,
    stuck: false,
  }))

  let iterations = 0
  const maxIterations = nodes.length + 1

  while (iterations < maxIterations) {
    iterations += 1
    const emptyIndex = nodes.findIndex((node) => !node.hasBuildings && !node.stuck)
    if (emptyIndex === -1) {
      break
    }
    const empty = nodes[emptyIndex]

    let bestIndex = -1
    let bestLength = 0
    for (let i = 0; i < nodes.length; i += 1) {
      if (i === emptyIndex || !bboxesOverlap(empty.bbox, nodes[i].bbox) || !touches(empty.geometry, nodes[i].geometry)) {
        continue
      }
      const length = sharedBorderLength(empty.geometry, nodes[i].geometry)
      if (length > bestLength) {
        bestLength = length
        bestIndex = i
      }
    }

    if (bestIndex === -1) {
      empty.stuck = true
      continue
    }

    const neighbour = nodes[bestIndex]
    try {
      const collection = (factory as unknown as { createGeometryCollection: (geoms: JstsGeometry[]) => JstsGeometry }).createGeometryCollection([
        empty.geometry,
        neighbour.geometry,
      ])
      const unioned = UnaryUnionOp.union(collection) as JstsGeometry
      const geometry = toGeoJsonGeometry(unioned)
      if (geometry.type !== 'Polygon') {
        // Pathological union (e.g. the two shapes only pinch at a point) - leave both as separate blocks rather than emit a MultiPolygon "block".
        empty.stuck = true
        continue
      }

      const merged: WorkingNode = {
        mergedIds: [...neighbour.mergedIds, ...empty.mergedIds],
        geometry: unioned,
        bbox: polygonBbox(geometry),
        hasBuildings: neighbour.hasBuildings || empty.hasBuildings,
        invalidGeometry: neighbour.invalidGeometry || empty.invalidGeometry,
        stuck: false,
      }
      nodes = [...nodes.filter((_, index) => index !== emptyIndex && index !== bestIndex), merged]
    } catch {
      empty.stuck = true
    }
  }

  return nodes.map((node) => ({
    mergedIds: node.mergedIds,
    polygon: toGeoJsonGeometry(node.geometry) as GeoJSON.Polygon,
    hasBuildings: node.hasBuildings,
    invalidGeometry: node.invalidGeometry,
  }))
}
