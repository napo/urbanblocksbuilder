import { describe, expect, it } from 'vitest'
import { buildAnalysisReport, OSM_ATTRIBUTION } from '../../services/export/exportReport'
import { defaultAnalysisConfig } from '../../config/defaults'
import { createAnalysisArea } from '../../domain/analysisArea'

describe('buildAnalysisReport', () => {
  it('produces a complete report including OSM attribution and the exact Overpass queries used', () => {
    const area = createAnalysisArea(
      { type: 'Polygon', coordinates: [[[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]] },
      'upload',
      'Test area',
    )

    const report = buildAnalysisReport({
      area,
      config: defaultAnalysisConfig,
      projection: '+proj=utm +zone=31 +north',
      exactQueries: ['[out:json];way["highway"~"residential"](0,0,1,1);out tags geom;'],
      overpassEndpoints: defaultAnalysisConfig.endpoints,
      gridConfiguration: { totalCells: 1, leafCells: 1 },
      acquisitionStatistics: { downloadedWays: 5 },
      geometryStatistics: { inputWays: 5, segmentsAfterNoding: 5 },
      districtStatistics: [],
      warnings: [],
      errors: [],
      cacheInformation: { status: 'ok' },
    })

    expect(report.applicationName).toBe('UrbanBlocksBuilder')
    expect(report.osmAttribution).toBe(OSM_ATTRIBUTION)
    expect(report.exactQueries).toHaveLength(1)
    expect(report.configuration).toBe(defaultAnalysisConfig)
    expect(report.analysisAreaName).toBe('Test area')
    expect(report.generatedAt).toBeTruthy()
  })
})
