import { UnaryUnionOp } from 'jsts/org/locationtech/jts/operation/union.js'
import { createGeometryFactory, isValidJstsGeometry, repairJstsGeometry, toJstsCoordinates, type JstsGeometry } from './validation'
import { SpatialIndex, bboxOfCoordinates, type Bbox } from './spatialIndex'

export interface NodingInputLine {
  wayId: string
  logicalLevel: number
  /** Metric (projected) coordinates. */
  coordinates: [number, number][]
}

export interface NodedEdge {
  id: string
  coordinates: [number, number][]
  logicalLevel: number
  wayReferences: string[]
}

export interface NodingStatistics {
  inputWays: number
  inputCoordinates: number
  inputSegments: number
  detectedIntersections: number
  segmentsAfterNoding: number
  generatedNodes: number
  invalidGeometries: number
  repairedGeometries: number
  removedDuplicateSegments: number
  incompatibleLevelCrossings: number
}

export interface NodingResult {
  edges: NodedEdge[]
  statistics: NodingStatistics
}

function edgeKey(coordinates: [number, number][], precisionDigits: number): string {
  const rounded = coordinates.map(([x, y]) => `${x.toFixed(precisionDigits)}:${y.toFixed(precisionDigits)}`)
  const forward = rounded.join('|')
  const backward = [...rounded].reverse().join('|')
  return forward < backward ? forward : backward
}

function countRealIntersections(lines: NodingInputLine[], toleranceMeters: number): number {
  if (lines.length < 2) {
    return 0
  }
  const index = new SpatialIndex<{ line: NodingInputLine; bbox: Bbox }>(Math.max(toleranceMeters * 20, 200))
  const entries = lines.map((line) => ({ line, bbox: bboxOfCoordinates(line.coordinates) }))
  for (const entry of entries) {
    index.insert(entry, entry.bbox)
  }

  let count = 0
  const seenPairs = new Set<string>()
  for (const entry of entries) {
    const candidates = index.queryCandidates(entry.bbox)
    for (const candidate of candidates) {
      if (candidate.line.wayId === entry.line.wayId) {
        continue
      }
      const pairKey = [entry.line.wayId, candidate.line.wayId].sort().join('::')
      if (seenPairs.has(pairKey)) {
        continue
      }
      seenPairs.add(pairKey)
      if (segmentsIntersect(entry.line.coordinates, candidate.line.coordinates)) {
        count += 1
      }
    }
  }
  return count
}

function segmentsIntersect(a: [number, number][], b: [number, number][]): boolean {
  for (let i = 0; i < a.length - 1; i += 1) {
    for (let j = 0; j < b.length - 1; j += 1) {
      if (lineSegmentsCross(a[i], a[i + 1], b[j], b[j + 1])) {
        return true
      }
    }
  }
  return false
}

function orientation(p: [number, number], q: [number, number], r: [number, number]): number {
  const value = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  if (Math.abs(value) < 1e-9) return 0
  return value > 0 ? 1 : -1
}

function onSegment(p: [number, number], q: [number, number], r: [number, number]): boolean {
  return (
    Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1])
  )
}

function lineSegmentsCross(p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]): boolean {
  const o1 = orientation(p1, p2, p3)
  const o2 = orientation(p1, p2, p4)
  const o3 = orientation(p3, p4, p1)
  const o4 = orientation(p3, p4, p2)

  if (o1 !== o2 && o3 !== o4) {
    return true
  }
  if (o1 === 0 && onSegment(p1, p3, p2)) return true
  if (o2 === 0 && onSegment(p1, p4, p2)) return true
  if (o3 === 0 && onSegment(p3, p1, p4)) return true
  if (o4 === 0 && onSegment(p3, p2, p4)) return true
  return false
}

function countIncompatibleLevelCrossings(lines: NodingInputLine[], toleranceMeters: number): number {
  const index = new SpatialIndex<{ line: NodingInputLine; bbox: Bbox }>(Math.max(toleranceMeters * 20, 200))
  const entries = lines.map((line) => ({ line, bbox: bboxOfCoordinates(line.coordinates) }))
  for (const entry of entries) {
    index.insert(entry, entry.bbox)
  }

  let count = 0
  const seenPairs = new Set<string>()
  for (const entry of entries) {
    const candidates = index.queryCandidates(entry.bbox)
    for (const candidate of candidates) {
      if (candidate.line.wayId === entry.line.wayId) continue
      if (candidate.line.logicalLevel === entry.line.logicalLevel) continue
      const pairKey = [entry.line.wayId, candidate.line.wayId].sort().join('::')
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)
      if (segmentsIntersect(entry.line.coordinates, candidate.line.coordinates)) {
        count += 1
      }
    }
  }
  return count
}

/** Finds which original way(s) a noded segment came from, by midpoint proximity. */
function attributeWayReferences(
  edgeCoordinates: [number, number][],
  candidateLines: NodingInputLine[],
  toleranceMeters: number,
): string[] {
  const midIndex = Math.floor(edgeCoordinates.length / 2)
  const midpoint = edgeCoordinates.length % 2 === 0 && edgeCoordinates.length >= 2
    ? [
        (edgeCoordinates[midIndex - 1][0] + edgeCoordinates[midIndex][0]) / 2,
        (edgeCoordinates[midIndex - 1][1] + edgeCoordinates[midIndex][1]) / 2,
      ]
    : edgeCoordinates[midIndex]

  const matches: string[] = []
  for (const line of candidateLines) {
    if (distancePointToPolyline(midpoint as [number, number], line.coordinates) <= toleranceMeters * 4) {
      matches.push(line.wayId)
    }
  }
  return matches.length > 0 ? matches : candidateLines.map((line) => line.wayId).slice(0, 1)
}

function distancePointToPolyline(point: [number, number], line: [number, number][]): number {
  let min = Infinity
  for (let i = 0; i < line.length - 1; i += 1) {
    min = Math.min(min, distancePointToSegment(point, line[i], line[i + 1]))
  }
  return min
}

function distancePointToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) {
    return Math.hypot(p[0] - a[0], p[1] - a[1])
  }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  const projX = a[0] + t * dx
  const projY = a[1] + t * dy
  return Math.hypot(p[0] - projX, p[1] - projY)
}

function extractLineStrings(geometry: JstsGeometry): [number, number][][] {
  const typedGeometry = geometry as unknown as { getNumGeometries: () => number; getGeometryN: (n: number) => JstsGeometry }
  const numGeometries = typedGeometry.getNumGeometries?.() ?? 1
  const results: [number, number][][] = []
  if (numGeometries > 1) {
    for (let i = 0; i < numGeometries; i += 1) {
      results.push(...extractLineStrings(typedGeometry.getGeometryN(i)))
    }
    return results
  }

  const coordinates = (geometry as unknown as { getCoordinates: () => Array<{ x: number; y: number }> }).getCoordinates()
  if (coordinates.length >= 2) {
    results.push(coordinates.map((coordinate) => [coordinate.x, coordinate.y] as [number, number]))
  }
  return results
}

/**
 * Nodes a road network so that roads at the same logical level are split at
 * every mutual intersection, while roads at incompatible logical levels
 * (bridges, tunnels, differing `layer` values) are left disconnected even if
 * their 2D geometry crosses. Uses JSTS's union-based noding idiom: unioning a
 * MultiLineString through a snapping-precision GeometryFactory produces a
 * fully noded, duplicate-free arrangement of line segments.
 */
export function nodeRoadNetwork(lines: NodingInputLine[], toleranceMeters: number): NodingResult {
  const statistics: NodingStatistics = {
    inputWays: lines.length,
    inputCoordinates: lines.reduce((sum, line) => sum + line.coordinates.length, 0),
    inputSegments: lines.reduce((sum, line) => sum + Math.max(0, line.coordinates.length - 1), 0),
    detectedIntersections: 0,
    segmentsAfterNoding: 0,
    generatedNodes: 0,
    invalidGeometries: 0,
    repairedGeometries: 0,
    removedDuplicateSegments: 0,
    incompatibleLevelCrossings: 0,
  }

  if (lines.length === 0) {
    return { edges: [], statistics }
  }

  statistics.incompatibleLevelCrossings = countIncompatibleLevelCrossings(lines, toleranceMeters)

  const groups = new Map<number, NodingInputLine[]>()
  for (const line of lines) {
    const group = groups.get(line.logicalLevel)
    if (group) {
      group.push(line)
    } else {
      groups.set(line.logicalLevel, [line])
    }
  }

  const factory = createGeometryFactory(toleranceMeters)
  const dedupeKeys = new Set<string>()
  const edges: NodedEdge[] = []
  const nodeKeys = new Set<string>()
  let edgeCounter = 0

  for (const [logicalLevel, groupLines] of groups.entries()) {
    statistics.detectedIntersections += countRealIntersections(groupLines, toleranceMeters)

    const validLines = groupLines.filter((line) => line.coordinates.length >= 2)
    const jstsLines = validLines
      .map((line) => {
        try {
          return (factory as unknown as { createLineString: (coords: unknown) => JstsGeometry }).createLineString(
            toJstsCoordinates(line.coordinates),
          )
        } catch {
          return null
        }
      })
      .filter((line): line is JstsGeometry => line !== null)

    if (jstsLines.length === 0) {
      continue
    }

    const multiLine = (factory as unknown as { createMultiLineString: (lines: JstsGeometry[]) => JstsGeometry }).createMultiLineString(jstsLines)

    let noded: JstsGeometry
    try {
      noded = UnaryUnionOp.union(multiLine) as JstsGeometry
    } catch {
      noded = multiLine
    }

    if (!isValidJstsGeometry(noded)) {
      statistics.invalidGeometries += 1
      const repaired = repairJstsGeometry(noded)
      if (repaired) {
        noded = repaired.geometry
        if (repaired.repaired) {
          statistics.repairedGeometries += 1
        }
      }
    }

    const nodedCoordinateSets = extractLineStrings(noded)

    for (const coordinates of nodedCoordinateSets) {
      const key = edgeKey(coordinates, 2)
      if (dedupeKeys.has(key)) {
        statistics.removedDuplicateSegments += 1
        continue
      }
      dedupeKeys.add(key)

      const wayReferences = attributeWayReferences(coordinates, validLines, toleranceMeters)
      edgeCounter += 1
      edges.push({
        id: `edge-${edgeCounter}`,
        coordinates,
        logicalLevel,
        wayReferences,
      })

      const start = coordinates[0]
      const end = coordinates[coordinates.length - 1]
      nodeKeys.add(`${logicalLevel}:${start[0].toFixed(2)}:${start[1].toFixed(2)}`)
      nodeKeys.add(`${logicalLevel}:${end[0].toFixed(2)}:${end[1].toFixed(2)}`)
    }
  }

  statistics.segmentsAfterNoding = edges.length
  statistics.generatedNodes = nodeKeys.size

  return { edges, statistics }
}
