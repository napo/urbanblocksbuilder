import * as turf from '@turf/turf'
import type { AnalysisArea, AnalysisConfig, GridCell, OSMWay, UrbanBlockProperties } from '../domain/types'
import type { District, DistrictAssignmentStrategy } from '../domain/district'
import { validateGeometry } from '../domain/analysisArea'
import { estimateAreaComplexity } from '../grid/gridComplexity'
import { generateAdaptiveGrid, leafCells } from '../grid/adaptiveGrid'
import { runGridSchedule } from '../grid/gridScheduler'
import { OverpassClient, deduplicateOsmWays } from '../services/overpass/OverpassClient'
import type { AnalysisCache } from '../services/cache/AnalysisCache'
import { getProjectionForBbox, projectGeometry, unprojectGeometry } from '../geometry/projection'
import { calculateLogicalLevel } from '../geometry/logicalLayer'
import { nodeRoadNetwork, type NodingInputLine } from '../geometry/noding'
import { buildGraphFromNodedEdges, type GraphEdge } from '../geometry/graph'
import { extractTwoCore } from '../geometry/twoCore'
import { polygonizeGraph, resolveFaceNesting } from '../geometry/polygonize'
import { clipPolygonToArea } from '../geometry/clipping'
import { AOI_BOUNDARY_WAY_ID, computeBoundaryContactLength, extractBoundaryRingLines } from '../geometry/boundaryClosure'
import { calculateBlockIndicators } from '../geometry/indicators'
import { assignBlocksToDistricts, computeDistrictStatistics } from '../geometry/districts'
import { buildAnalysisReport } from '../services/export/exportReport'
import { fixtureRoads } from '../config/defaults'
import type { AnalysisPhase, CompletedResultPayload, NamedFeatureCollection } from './workerMessages'

export interface PipelineCallbacks {
  onProgress: (phase: AnalysisPhase, percent: number, extra?: Partial<{
    completedCells: number
    totalCells: number
    currentCell: string
    downloadedWays: number
    coordinates: number
    segments: number
    cacheStatus: string
  }>) => void
  onWarning: (message: string) => void
  isCancelled: () => boolean
}

export interface PipelineInput {
  area: AnalysisArea
  config: AnalysisConfig
  fixtureMode: boolean
  districts: District[]
  districtStrategy: DistrictAssignmentStrategy
  cache?: AnalysisCache
}

function toLineFeatureCollection(ways: Array<{ id: string; coordinates: [number, number][]; logicalLevel?: number }>): NamedFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: ways
      .filter((way) => way.coordinates.length >= 2)
      .map((way) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: way.coordinates },
        properties: { id: way.id, logicalLevel: way.logicalLevel ?? 0 },
      })),
  }
}

function buildFixtureWays(): OSMWay[] {
  return fixtureRoads.map((road) => ({
    id: road.id,
    tags: { highway: 'residential' },
    coordinates: road.coordinates.map(([lon, lat]) => [lon, lat]) as [number, number][],
    logicalLevel: 0,
    sourceCellIds: ['fixture-cell'],
    originalGeometry: { type: 'LineString', coordinates: road.coordinates.map(([lon, lat]) => [lon, lat]) },
    status: 'downloaded',
  }))
}

/** Clips a projected LineString to a projected area polygon, returning 0..n surviving segments. */
function clipLineToArea(coordinates: [number, number][], areaMetric: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number][][] {
  try {
    const line = turf.lineString(coordinates)
    const areaFeature = turf.feature(areaMetric)
    const split = turf.lineSplit(line, areaFeature)
    const candidateLines = split.features.length > 0 ? split.features.map((feature) => feature.geometry.coordinates as [number, number][]) : [coordinates]

    const surviving: [number, number][][] = []
    for (const candidate of candidateLines) {
      if (candidate.length < 2) continue
      const midpoint = candidate[Math.floor(candidate.length / 2)]
      if (turf.booleanPointInPolygon(turf.point(midpoint), areaFeature)) {
        surviving.push(candidate)
      }
    }
    return surviving.length > 0 ? surviving : (turf.booleanPointInPolygon(turf.point(coordinates[0]), areaFeature) ? [coordinates] : [])
  } catch {
    return [coordinates]
  }
}

export async function runAnalysisPipeline(input: PipelineInput, callbacks: PipelineCallbacks): Promise<CompletedResultPayload> {
  const { area, config } = input
  const warnings: string[] = []
  const errors: string[] = []
  const exactQueries: string[] = []

  const addWarning = (message: string) => {
    warnings.push(message)
    callbacks.onWarning(message)
  }

  callbacks.onProgress('Area validation', 2)
  const geometryErrors = validateGeometry(area.geometry)
  if (geometryErrors.length > 0) {
    throw new Error(`Analysis area is invalid: ${geometryErrors.join(' ')}`)
  }

  callbacks.onProgress('Complexity estimation', 5)
  const complexity = estimateAreaComplexity(area.areaKm2)
  if (complexity.level === 'requires-subdivision') {
    addWarning(`This area is estimated at ${complexity.estimatedWays} ways and will be subdivided automatically by the adaptive grid.`)
  }

  callbacks.onProgress('Grid generation', 8)
  const gridThresholds = {
    initialCellSizeMeters: config.initialCellSizeMeters,
    contextBufferMeters: config.contextBufferMeters,
    maxDepth: config.maxDepth,
    maxWaysPerCell: config.maxWaysPerCell,
    maxCoordinatesPerCell: config.maxCoordinatesPerCell,
    maxResponseSizeKb: config.maxResponseSizeKb,
    maxRetries: config.maxRetries,
  }
  const grid = input.fixtureMode ? [] : generateAdaptiveGrid(area.geometry, gridThresholds)
  const cells = leafCells(grid)

  callbacks.onProgress('Cell estimation', 10, { totalCells: cells.length, completedCells: 0 })

  let ways: OSMWay[]
  let cacheStatus: string
  let cacheHits = 0

  if (input.fixtureMode) {
    callbacks.onProgress('Overpass acquisition', 20, { cacheStatus: 'Fixture mode: no Overpass requests were made.' })
    ways = buildFixtureWays()
    cacheStatus = 'Fixture mode: no Overpass requests were made.'
    exactQueries.push('(fixture mode - no live Overpass query executed)')
  } else {
    // Rotate through the configured endpoints so a retry after a failure
    // (timeout, rate limit, server error) lands on a different Overpass
    // instance instead of hammering the one that just failed.
    const overpassClient = new OverpassClient(config, { rotateEndpoints: config.endpoints.length > 1 })
    for (const cell of cells) {
      exactQueries.push(overpassClient.buildRoadQuery(cell.bbox))
    }

    const result = await runGridSchedule(cells, {
      analysisAreaGeometry: area.geometry,
      config,
      concurrency: config.concurrency,
      overpassClient,
      cache: input.cache,
    }, {
      onCellStateChange: (cell) => {
        const settledCells = cells.filter((entry) => entry.state === 'Completed' || entry.state === 'Failed').length
        const acquisitionPercent = 10 + Math.round((settledCells / Math.max(1, cells.length)) * 25)
        callbacks.onProgress('Overpass acquisition', acquisitionPercent, {
          totalCells: cells.length,
          completedCells: settledCells,
          currentCell: cell.id,
        })
      },
      onWarning: addWarning,
      isCancelled: callbacks.isCancelled,
    })

    ways = result.ways
    cacheHits = result.cacheHits
    cacheStatus = result.cacheHits > 0
      ? `${result.cacheHits}/${cells.length} cells served from the local cache.`
      : 'No cached cells were used for this run.'

    if (result.failedCells.length > 0) {
      addWarning(`${result.failedCells.length} grid cell(s) could not be downloaded after retries and were skipped.`)
    }
  }

  if (callbacks.isCancelled()) {
    throw new CancellationError()
  }

  callbacks.onProgress('Way deduplication', 35, { downloadedWays: ways.length })
  const dedupedWays = deduplicateOsmWays(ways).map((way) => ({ ...way, logicalLevel: calculateLogicalLevel(way.tags) }))
  const originalRoads = toLineFeatureCollection(dedupedWays)

  callbacks.onProgress('Projection', 45)
  const projection = getProjectionForBbox(area.bbox)
  const areaMetric = projectGeometry(area.geometry, projection)

  const metricLines: NodingInputLine[] = []
  for (const way of dedupedWays) {
    const metricLine = projectGeometry({ type: 'LineString', coordinates: way.coordinates }, projection) as GeoJSON.LineString
    const metricCoordinates = metricLine.coordinates as [number, number][]
    for (const segment of clipLineToArea(metricCoordinates, areaMetric)) {
      metricLines.push({ wayId: way.id, logicalLevel: way.logicalLevel, coordinates: segment })
    }
  }

  // Feed the selection boundary itself into the noding pass as a ground-level
  // (logicalLevel 0) line. Roads get hard-clipped to this same boundary
  // above, so any road that would otherwise close a block just outside the
  // selection now closes against the boundary instead of dangling and being
  // stripped by the 2-core step - see docs on AOI_BOUNDARY_WAY_ID.
  for (const ring of extractBoundaryRingLines(areaMetric)) {
    metricLines.push({ wayId: AOI_BOUNDARY_WAY_ID, logicalLevel: 0, coordinates: ring })
  }

  if (callbacks.isCancelled()) {
    throw new CancellationError()
  }

  callbacks.onProgress('Noding', 55, { coordinates: metricLines.reduce((sum, line) => sum + line.coordinates.length, 0) })
  const nodingResult = nodeRoadNetwork(metricLines, config.snappingToleranceMeters)
  if (nodingResult.statistics.invalidGeometries > nodingResult.statistics.repairedGeometries) {
    addWarning(`${nodingResult.statistics.invalidGeometries - nodingResult.statistics.repairedGeometries} invalid geometries encountered during noding could not be repaired.`)
  }

  callbacks.onProgress('Graph construction', 65, { segments: nodingResult.edges.length })
  const graph = buildGraphFromNodedEdges(nodingResult.edges, config.snappingToleranceMeters)
  // Edges attributable only to the synthetic boundary ring (see
  // AOI_BOUNDARY_WAY_ID) aren't real streets, so keep them out of the
  // road-network layers shown on the map - the selection outline is already
  // drawn as its own layer.
  const isBoundaryOnlyEdge = (edge: GraphEdge) => edge.osmWayReferences.length === 1 && edge.osmWayReferences[0] === AOI_BOUNDARY_WAY_ID
  const toRoadFeatures = (edges: GraphEdge[]) =>
    toLineFeatureCollection(
      edges
        .filter((edge) => !isBoundaryOnlyEdge(edge))
        .map((edge) => ({ id: edge.id, coordinates: unprojectLineCoordinates(edge.geometry, projection), logicalLevel: edge.logicalLevel })),
    )
  const nodedRoads = toRoadFeatures(graph.edges)

  if (callbacks.isCancelled()) {
    throw new CancellationError()
  }

  callbacks.onProgress('2-core extraction', 72)
  const twoCoreResult = extractTwoCore(graph)
  const removedBranches = toRoadFeatures(twoCoreResult.removedEdges)
  const twoCoreRoads = toRoadFeatures(twoCoreResult.core.edges)

  callbacks.onProgress('Polygonization', 80)
  const rawPolygonizeResult = polygonizeGraph(twoCoreResult.core, config.snappingToleranceMeters)
  const polygonizedFaces = resolveFaceNesting(rawPolygonizeResult.faces, config.snappingToleranceMeters)
  if (polygonizedFaces.length === 0 && graph.edges.length > 0) {
    addWarning('Polygonization produced no closed urban blocks from the 2-core network. The road network for this area may be too sparse or disconnected.')
  }

  if (callbacks.isCancelled()) {
    throw new CancellationError()
  }

  callbacks.onProgress('Indicator calculation', 88)
  const medianAreaForFlagging = median(polygonizedFaces.map((face) => calculateBlockIndicators(face.geometry).areaM2))
  const blocksMetric: Array<{ id: string; polygonMetric: GeoJSON.Polygon; properties: UrbanBlockProperties }> = []
  let blockCounter = 0
  let boundaryClosedCount = 0

  for (const face of polygonizedFaces) {
    const clipped = clipPolygonToArea(face.geometry, areaMetric, config.snappingToleranceMeters)
    const polygonsToEmit: GeoJSON.Polygon[] = !clipped
      ? []
      : clipped.type === 'Polygon'
        ? [clipped]
        : clipped.coordinates.map((coordinates) => ({ type: 'Polygon' as const, coordinates }))

    for (const polygon of polygonsToEmit) {
      const indicators = calculateBlockIndicators(polygon)
      if (indicators.areaM2 <= 0) continue

      blockCounter += 1
      const blockId = `block-${blockCounter}`
      const flaggedSmallArtifact = indicators.areaM2 < config.minAreaM2
      const flaggedLargeArea = indicators.areaM2 > config.largeBlockAreaThresholdM2 || (medianAreaForFlagging > 0 && indicators.areaM2 > medianAreaForFlagging * 8)
      const boundaryContactLength = computeBoundaryContactLength(polygon, areaMetric, config.snappingToleranceMeters)
      const flaggedBoundaryClosure = boundaryContactLength > config.snappingToleranceMeters * 3
      if (flaggedBoundaryClosure) {
        boundaryClosedCount += 1
      }

      blocksMetric.push({
        id: blockId,
        polygonMetric: polygon,
        properties: {
          blockId,
          areaM2: indicators.areaM2,
          perimeterM: indicators.perimeterM,
          compactness: indicators.compactness,
          source: 'osm-road-network',
          projection,
          flaggedSmallArtifact,
          flaggedLargeArea,
          flaggedInvalidGeometry: face.invalidGeometry && !face.repaired,
          flaggedBoundaryClosure,
        },
      })
    }
  }

  if (boundaryClosedCount > 0) {
    addWarning(
      `${boundaryClosedCount} block(s) are partly bounded by the selection edge rather than a real street, because the road network didn't fully enclose that part of the area. This is expected right at the edge of the selection; if it happens well inside it, the road data for that patch may be incomplete (see any grid-cell warnings above).`,
    )
  }

  callbacks.onProgress('District assignment', 93)
  let districtStatistics: ReturnType<typeof computeDistrictStatistics> = []
  if (input.districts.length > 0) {
    const districtsMetric = input.districts.map((district) => ({
      districtId: district.id,
      districtName: district.name,
      polygonMetric: projectGeometry(district.geometry, projection),
      areaM2: district.areaKm2 * 1_000_000,
    }))

    const blockInputs = blocksMetric.map((block) => ({
      blockId: block.id,
      polygonMetric: block.polygonMetric,
      areaM2: block.properties.areaM2,
      compactness: block.properties.compactness,
    }))

    // A block's own districtId/overlapRatio properties are always single-valued,
    // so 'intersection' (statistical allocation) still needs a fallback
    // single-district assignment for those properties; the district
    // statistics below use the true proportional allocation regardless.
    const assignments = input.districtStrategy === 'intersection'
      ? assignBlocksToDistricts(blockInputs, districtsMetric, 'largest-overlap', config.snappingToleranceMeters)
      : assignBlocksToDistricts(blockInputs, districtsMetric, input.districtStrategy, config.snappingToleranceMeters)

    const assignmentByBlockId = new Map(assignments.map((assignment) => [assignment.blockId, assignment]))
    for (const block of blocksMetric) {
      const assignment = assignmentByBlockId.get(block.id)
      if (assignment?.districtId) {
        block.properties.districtId = assignment.districtId
        block.properties.districtOverlapRatio = assignment.overlapRatio
      }
    }

    districtStatistics = computeDistrictStatistics(
      blockInputs,
      districtsMetric,
      assignments,
      input.districtStrategy,
      config.snappingToleranceMeters,
      config.largeBlockAreaThresholdM2,
    )
  }

  callbacks.onProgress('Export preparation', 97)
  const blocksFeatureCollection: GeoJSON.FeatureCollection<GeoJSON.Polygon, UrbanBlockProperties> = {
    type: 'FeatureCollection',
    features: blocksMetric.map((block) => ({
      type: 'Feature',
      geometry: unprojectGeometry(block.polygonMetric, projection),
      properties: block.properties,
    })),
  }

  const gridFeatureCollection: NamedFeatureCollection<{ id: string; state: GridCell['state']; depth: number }> = {
    type: 'FeatureCollection',
    features: grid.map((cell) => ({
      type: 'Feature',
      geometry: turf.bboxPolygon(cell.bbox).geometry,
      properties: { id: cell.id, state: cell.state, depth: cell.depth },
    })),
  }

  const report = buildAnalysisReport({
    area,
    config,
    projection,
    exactQueries,
    overpassEndpoints: config.endpoints,
    gridConfiguration: {
      initialCellSizeMeters: config.initialCellSizeMeters,
      contextBufferMeters: config.contextBufferMeters,
      maxDepth: config.maxDepth,
      totalCells: grid.length,
      leafCells: cells.length,
    },
    acquisitionStatistics: {
      downloadedWays: ways.length,
      dedupedWays: dedupedWays.length,
      cacheHits,
      failedCells: cells.filter((cell) => cell.state === 'Failed').length,
    },
    geometryStatistics: nodingResult.statistics as unknown as Record<string, number>,
    districtStatistics,
    warnings,
    errors,
    cacheInformation: { status: cacheStatus, cacheHits },
  })

  callbacks.onProgress('Completed', 100)

  return {
    blocks: blocksFeatureCollection,
    originalRoads,
    nodedRoads,
    removedBranches,
    twoCoreRoads,
    grid: gridFeatureCollection,
    districtStatistics,
    projection,
    report,
  }
}

function unprojectLineCoordinates(coordinates: [number, number][], projection: string): [number, number][] {
  return (unprojectGeometry({ type: 'LineString', coordinates }, projection) as GeoJSON.LineString).coordinates as [number, number][]
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export class CancellationError extends Error {
  constructor() {
    super('The analysis was cancelled.')
    this.name = 'CancellationError'
  }
}
