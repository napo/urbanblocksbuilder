import * as turf from '@turf/turf'
import type { GridCell } from '../domain/types'
import { shouldSubdivideCell } from './gridComplexity'
import type { GridThresholds } from '../config/thresholds'

type Bbox = [number, number, number, number]

function metersPerDegree(centerLatitude: number): { lon: number; lat: number } {
  const latRad = (centerLatitude * Math.PI) / 180
  return {
    lat: 111320,
    lon: 111320 * Math.cos(latRad),
  }
}

function cellAreaKm2(bbox: Bbox): number {
  const { lon, lat } = metersPerDegree((bbox[1] + bbox[3]) / 2)
  const widthMeters = (bbox[2] - bbox[0]) * lon
  const heightMeters = (bbox[3] - bbox[1]) * lat
  return Math.max(0, (widthMeters * heightMeters) / 1_000_000)
}

function splitBboxIntoQuadrants(bbox: Bbox): Bbox[] {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const midLon = (minLon + maxLon) / 2
  const midLat = (minLat + maxLat) / 2
  return [
    [minLon, minLat, midLon, midLat],
    [midLon, minLat, maxLon, midLat],
    [minLon, midLat, midLon, maxLat],
    [midLon, midLat, maxLon, maxLat],
  ]
}

function initialCellBboxes(analysisBbox: Bbox, initialCellSizeMeters: number): Bbox[] {
  const { lon, lat } = metersPerDegree((analysisBbox[1] + analysisBbox[3]) / 2)
  const cellWidthDeg = initialCellSizeMeters / lon
  const cellHeightDeg = initialCellSizeMeters / lat

  const [minLon, minLat, maxLon, maxLat] = analysisBbox
  const cols = Math.max(1, Math.ceil((maxLon - minLon) / cellWidthDeg))
  const rows = Math.max(1, Math.ceil((maxLat - minLat) / cellHeightDeg))

  const bboxes: Bbox[] = []
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const cellMinLon = minLon + col * cellWidthDeg
      const cellMinLat = minLat + row * cellHeightDeg
      bboxes.push([
        cellMinLon,
        cellMinLat,
        Math.min(cellMinLon + cellWidthDeg, maxLon),
        Math.min(cellMinLat + cellHeightDeg, maxLat),
      ])
    }
  }
  return bboxes
}

/**
 * Generates the adaptive acquisition grid: an initial regular tiling of the
 * analysis-area bounding box, recursively subdivided (quadtree-style)
 * wherever the estimated complexity exceeds the configured per-cell limits.
 * This grid governs Overpass request planning only - it has no bearing on
 * final urban-block topology.
 */
export function generateAdaptiveGrid(
  analysisAreaGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  thresholds: GridThresholds,
): GridCell[] {
  const analysisBbox = turf.bbox(analysisAreaGeometry) as Bbox
  const analysisAreaFeature = turf.feature(analysisAreaGeometry)
  const cells: GridCell[] = []
  let counter = 0

  const limits = {
    maxWaysPerCell: thresholds.maxWaysPerCell,
    maxCoordinatesPerCell: thresholds.maxCoordinatesPerCell,
    maxResponseSizeKb: thresholds.maxResponseSizeKb,
  }

  const intersectsAnalysisArea = (bbox: Bbox): boolean => {
    try {
      const cellPolygon = turf.bboxPolygon(bbox)
      return turf.booleanIntersects(cellPolygon, analysisAreaFeature)
    } catch {
      return true
    }
  }

  const addCell = (bbox: Bbox, depth: number, parentId?: string): void => {
    if (!intersectsAnalysisArea(bbox)) {
      return
    }

    counter += 1
    const id = `cell-${counter}`
    const areaKm2 = cellAreaKm2(bbox)
    const needsSubdivision = depth < thresholds.maxDepth && shouldSubdivideCell(areaKm2, limits)

    if (needsSubdivision) {
      const cell: GridCell = {
        id,
        bbox,
        depth,
        state: 'Subdivided',
        parentId,
        children: [],
      }
      cells.push(cell)

      const childIds: string[] = []
      for (const quadrant of splitBboxIntoQuadrants(bbox)) {
        const beforeCount = cells.length
        addCell(quadrant, depth + 1, id)
        if (cells.length > beforeCount) {
          childIds.push(cells[beforeCount].id)
        }
      }
      cell.children = childIds
      return
    }

    cells.push({
      id,
      bbox,
      depth,
      state: 'Pending',
      parentId,
    })
  }

  for (const bbox of initialCellBboxes(analysisBbox, thresholds.initialCellSizeMeters)) {
    addCell(bbox, 0)
  }

  return cells
}

export function leafCells(cells: GridCell[]): GridCell[] {
  return cells.filter((cell) => cell.state !== 'Subdivided')
}
