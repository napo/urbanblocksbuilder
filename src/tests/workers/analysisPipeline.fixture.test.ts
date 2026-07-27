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

    expect(result.blocks.features).toHaveLength(1)
    const block = result.blocks.features[0]
    expect(block.properties.areaM2).toBeGreaterThan(8000)
    expect(block.properties.areaM2).toBeLessThan(16000)
    expect(block.properties.compactness).toBeGreaterThan(0.6)
    expect(block.properties.compactness).toBeLessThanOrEqual(1)
    expect(block.properties.flaggedSmallArtifact).toBe(false)
    expect(block.properties.flaggedLargeArea).toBe(false)
    expect(block.properties.projection).toMatch(/utm/)

    // The dangling terminal branch must be removed by the 2-core extraction.
    expect(result.removedBranches.features.length).toBeGreaterThan(0)
    expect(result.twoCoreRoads.features.length).toBeGreaterThan(0)
    expect(result.originalRoads.features.length).toBe(5)

    expect(result.report.applicationName).toBe('UrbanBlocksBuilder')
    expect(result.report.geometryStatistics.inputWays).toBe(5)
  })
})
