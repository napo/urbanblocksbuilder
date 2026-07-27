import { describe, expect, it } from 'vitest'
import { generateAdaptiveGrid, leafCells } from '../../grid/adaptiveGrid'
import { bufferGridCell } from '../../grid/gridBuffer'
import type { GridThresholds } from '../../config/thresholds'

const baseThresholds: GridThresholds = {
  initialCellSizeMeters: 4000,
  contextBufferMeters: 400,
  maxDepth: 4,
  maxWaysPerCell: 120,
  maxCoordinatesPerCell: 500,
  maxResponseSizeKb: 250,
  maxRetries: 2,
}

const smallArea: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[-0.02, -0.02], [-0.02, 0.02], [0.02, 0.02], [0.02, -0.02], [-0.02, -0.02]]],
}

describe('generateAdaptiveGrid', () => {
  it('keeps a single cell as Pending when the area is well within the complexity limits', () => {
    const cells = generateAdaptiveGrid(smallArea, baseThresholds)
    const leaves = leafCells(cells)

    expect(leaves.length).toBeGreaterThan(0)
    expect(leaves.every((cell) => cell.state === 'Pending')).toBe(true)
  })

  it('subdivides cells (quadtree) when the per-cell way limit is tight', () => {
    const tightThresholds: GridThresholds = { ...baseThresholds, maxWaysPerCell: 1, maxCoordinatesPerCell: 1 }
    const cells = generateAdaptiveGrid(smallArea, tightThresholds)

    const subdivided = cells.filter((cell) => cell.state === 'Subdivided')
    expect(subdivided.length).toBeGreaterThan(0)
    for (const cell of subdivided) {
      expect(cell.children?.length).toBe(4)
    }
  })

  it('stops subdividing at the configured maximum depth', () => {
    const tightThresholds: GridThresholds = { ...baseThresholds, maxWaysPerCell: 1, maxCoordinatesPerCell: 1, maxDepth: 1 }
    const cells = generateAdaptiveGrid(smallArea, tightThresholds)

    expect(cells.every((cell) => cell.depth <= 1)).toBe(true)
  })
})

describe('bufferGridCell', () => {
  it('grows the cell bbox by the configured context buffer', () => {
    const cell = { id: 'cell-1', bbox: [0, 0, 0.01, 0.01] as [number, number, number, number], depth: 0, state: 'Pending' as const }
    const bigArea: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]]] }

    const buffered = bufferGridCell(cell, bigArea, 500)

    expect(buffered.bbox[0]).toBeLessThan(cell.bbox[0])
    expect(buffered.bbox[1]).toBeLessThan(cell.bbox[1])
    expect(buffered.bbox[2]).toBeGreaterThan(cell.bbox[2])
    expect(buffered.bbox[3]).toBeGreaterThan(cell.bbox[3])
  })
})
