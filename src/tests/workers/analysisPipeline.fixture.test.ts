import { describe, expect, it } from 'vitest'
import { runAnalysisPipeline } from '../../workers/analysisPipeline'
import { defaultAnalysisConfig } from '../../config/defaults'
import { createAnalysisArea } from '../../domain/analysisArea'

const noopCallbacks = {
  onProgress: () => {},
  onWarning: () => {},
  isCancelled: () => false,
}

describe('runAnalysisPipeline (fixture mode)', () => {
  it('runs the full pipeline end-to-end and produces a real urban block from the fixture road network', async () => {
    const area = createAnalysisArea(
      {
        type: 'Polygon',
        coordinates: [[
          [-0.01, -0.01],
          [-0.01, 0.01],
          [0.01, 0.01],
          [0.01, -0.01],
          [-0.01, -0.01],
        ]],
      },
      'upload',
      'Fixture test area',
    )

    const result = await runAnalysisPipeline(
      { area, config: defaultAnalysisConfig, fixtureMode: true, districts: [], districtStrategy: 'largest-overlap' },
      noopCallbacks,
    )

    // The fixture square sits deep inside the (much larger) analysis area, so
    // besides that real block, the leftover of the area - not enclosed by any
    // real road - is now also emitted as a boundary-closed block (see
    // boundaryClosure.ts): the selection boundary is fed into the graph so
    // that roads dangling out of an area close against it instead of
    // vanishing, and the whole area is always tiled edge to edge.
    expect(result.blocks.features).toHaveLength(2)
    const block = result.blocks.features.find((feature) => feature.properties.flaggedBoundaryClosure === false)
    const leftoverBlock = result.blocks.features.find((feature) => feature.properties.flaggedBoundaryClosure === true)
    expect(block).toBeDefined()
    expect(leftoverBlock).toBeDefined()

    expect(block!.properties.areaM2).toBeGreaterThan(8000)
    expect(block!.properties.areaM2).toBeLessThan(16000)
    expect(block!.properties.compactness).toBeGreaterThan(0.6)
    expect(block!.properties.compactness).toBeLessThanOrEqual(1)
    expect(block!.properties.flaggedSmallArtifact).toBe(false)
    expect(block!.properties.flaggedLargeArea).toBe(false)
    expect(block!.properties.projection).toMatch(/utm/)

    // The leftover block's shape is the whole area minus the real block: it
    // should dwarf the real block's area and get flagged as unusually large.
    expect(leftoverBlock!.properties.areaM2).toBeGreaterThan(block!.properties.areaM2 * 10)
    expect(leftoverBlock!.properties.flaggedLargeArea).toBe(true)

    // The dangling terminal branch must be removed by the 2-core extraction.
    expect(result.removedBranches.features.length).toBeGreaterThan(0)
    expect(result.twoCoreRoads.features.length).toBeGreaterThan(0)
    expect(result.originalRoads.features.length).toBe(5)

    expect(result.report.applicationName).toBe('UrbanBlocksBuilder')
    // 5 fixture ways plus the analysis-area boundary ring fed in alongside them.
    expect(result.report.geometryStatistics.inputWays).toBe(6)
  })
})
