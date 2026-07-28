import { describe, expect, it } from 'vitest'
import { runAnalysisPipeline } from '../../workers/analysisPipeline'
import { defaultAnalysisConfig } from '../../config/defaults'
import { createAnalysisArea } from '../../domain/analysisArea'

const noopCallbacks = {
  onProgress: () => {},
  onWarning: () => {},
  isCancelled: () => false,
}

function fixtureArea() {
  return createAnalysisArea(
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
}

describe('runAnalysisPipeline (fixture mode)', () => {
  it('merges the buildingless leftover into the one real (building-containing) block by default', async () => {
    // The fixture square sits deep inside the (much larger) analysis area.
    // Without the boundary-closure fix, only that square would come back;
    // with it, the rest of the area (not enclosed by any real road) also
    // comes back as its own "leftover" block. That leftover has no building
    // in it (see fixtureBuildingPoints, which only covers the real square),
    // so with the default no-buildings merge it gets folded straight back
    // into the one block that does have a building - recombining into a
    // single result that covers the whole area.
    const result = await runAnalysisPipeline(
      { area: fixtureArea(), config: defaultAnalysisConfig, fixtureMode: true, districts: [], districtStrategy: 'largest-overlap' },
      noopCallbacks,
    )

    expect(result.blocks.features).toHaveLength(1)
    const block = result.blocks.features[0]
    expect(block.properties.flaggedNoBuildings).toBe(false)
    // The merged shape is essentially the whole test area, not just the ~110m fixture square.
    expect(block.properties.areaM2).toBeGreaterThan(1_000_000)
    expect(block.properties.projection).toMatch(/utm/)

    // The dangling terminal branch must still be removed by the 2-core extraction.
    expect(result.removedBranches.features.length).toBeGreaterThan(0)
    expect(result.twoCoreRoads.features.length).toBeGreaterThan(0)
    expect(result.originalRoads.features.length).toBe(5)

    expect(result.report.applicationName).toBe('UrbanBlocksBuilder')
    // 5 fixture ways plus the analysis-area boundary ring fed in alongside them.
    expect(result.report.geometryStatistics.inputWays).toBe(6)
  })

  it('keeps the boundary-closed leftover as its own block when no-buildings merging is disabled', async () => {
    const result = await runAnalysisPipeline(
      {
        area: fixtureArea(),
        config: { ...defaultAnalysisConfig, mergeBuildinglessBlocks: false },
        fixtureMode: true,
        districts: [],
        districtStrategy: 'largest-overlap',
      },
      noopCallbacks,
    )

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

    // The leftover block's shape is the whole area minus the real block: it
    // should dwarf the real block's area and get flagged as unusually large.
    expect(leftoverBlock!.properties.areaM2).toBeGreaterThan(block!.properties.areaM2 * 10)
    expect(leftoverBlock!.properties.flaggedLargeArea).toBe(true)
  })
})
