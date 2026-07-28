import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IndexedDbAnalysisCache } from '../../services/cache/IndexedDbAnalysisCache'
import type { AnalysisSnapshot, CellCacheKeyInput } from '../../services/cache/AnalysisCache'
import { defaultAnalysisConfig } from '../../config/defaults'
import type { AnalysisArea, AnalysisReport } from '../../domain/types'

const baseInput: CellCacheKeyInput = {
  cellBbox: [11.1, 46.05, 11.2, 46.08],
  query: 'way["highway"~"^(primary)$"](46.05,11.1,46.08,11.2);',
  queryVersion: 'v4',
  algorithmVersion: 'v0.1.0',
  endpoint: 'https://overpass-api.de/api/interpreter',
  contextBufferMeters: 400,
}

describe('IndexedDbAnalysisCache.buildCellCacheKey', () => {
  it('is deterministic for identical input', async () => {
    const cache = new IndexedDbAnalysisCache()
    const keyA = await cache.buildCellCacheKey({ ...baseInput })
    const keyB = await cache.buildCellCacheKey({ ...baseInput })
    expect(keyA).toBe(keyB)
  })

  it('changes when the query text changes - the fix for toggles (waterway, railway, building merge, advanced highway types...) that used to be missing from the cache key entirely', async () => {
    const cache = new IndexedDbAnalysisCache()
    const withoutBuildings = await cache.buildCellCacheKey({ ...baseInput })
    const withBuildings = await cache.buildCellCacheKey({
      ...baseInput,
      query: `${baseInput.query}\nway["building"]["building"!="no"](46.05,11.1,46.08,11.2)->.buildings;\n.buildings out center;`,
    })
    expect(withoutBuildings).not.toBe(withBuildings)
  })

  it('changes when queryVersion, algorithmVersion, endpoint, or contextBufferMeters differ', async () => {
    const cache = new IndexedDbAnalysisCache()
    const base = await cache.buildCellCacheKey({ ...baseInput })

    expect(await cache.buildCellCacheKey({ ...baseInput, queryVersion: 'v5' })).not.toBe(base)
    expect(await cache.buildCellCacheKey({ ...baseInput, algorithmVersion: 'v0.2.0' })).not.toBe(base)
    expect(await cache.buildCellCacheKey({ ...baseInput, endpoint: 'https://overpass.private.coffee/api/interpreter' })).not.toBe(base)
    expect(await cache.buildCellCacheKey({ ...baseInput, contextBufferMeters: 600 })).not.toBe(base)
  })
})

const emptyFeatureCollection = { type: 'FeatureCollection' as const, features: [] }

const baseReport: AnalysisReport = {
  applicationName: 'UrbanBlocksBuilder',
  applicationVersion: '0.1.0',
  algorithmVersion: 'v0.1.0',
  generatedAt: '2026-01-01T00:00:00.000Z',
  analysisAreaSummary: 'Test area',
  configuration: defaultAnalysisConfig,
  highwayFilters: [],
  accessFilters: [],
  overpassEndpoints: [],
  exactQueries: [],
  projection: 'EPSG:32632',
  tolerances: {},
  gridConfiguration: {},
  acquisitionStatistics: {},
  geometryStatistics: {},
  districtStatistics: {},
  warnings: [],
  errors: [],
  cacheInformation: {},
  osmAttribution: 'OpenStreetMap contributors',
  dataLicense: 'ODbL 1.0',
}

function buildSnapshot(overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  const area: AnalysisArea = {
    id: 'area-1',
    name: 'Test area',
    source: 'rectangle',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
    bbox: [0, 0, 1, 1],
    areaKm2: 1.5,
  }
  return {
    analysisId: `snapshot-${Math.random().toString(36).slice(2)}`,
    savedAt: new Date().toISOString(),
    area,
    config: defaultAnalysisConfig,
    districts: [],
    districtStrategy: 'largest-overlap',
    blocks: [],
    originalRoads: emptyFeatureCollection,
    nodedRoads: emptyFeatureCollection,
    removedBranches: emptyFeatureCollection,
    twoCoreRoads: emptyFeatureCollection,
    grid: emptyFeatureCollection,
    districtStatistics: [],
    report: baseReport,
    ...overrides,
  }
}

describe('IndexedDbAnalysisCache saved analyses', () => {
  // Reuse one instance (one open IndexedDB connection) across tests and clear
  // its contents between tests, rather than opening a fresh connection per
  // test - deleting the whole database while another connection to it is
  // still open leaves indexedDB.deleteDatabase() permanently "blocked".
  const cache = new IndexedDbAnalysisCache()

  beforeEach(async () => {
    await cache.clearAll()
  })

  it('round-trips a saved analysis through save/load', async () => {
    const snapshot = buildSnapshot({ analysisId: 'a1', area: { ...buildSnapshot().area, name: 'Trento centro' } })

    await cache.saveAnalysisSnapshot(snapshot)
    const loaded = await cache.loadAnalysisSnapshot('a1')

    expect(loaded).toEqual(snapshot)
  })

  it('lists saved analyses newest-first with summary fields only', async () => {
    await cache.saveAnalysisSnapshot(buildSnapshot({ analysisId: 'older', savedAt: '2026-01-01T00:00:00.000Z' }))
    await cache.saveAnalysisSnapshot(buildSnapshot({ analysisId: 'newer', savedAt: '2026-02-01T00:00:00.000Z' }))

    const summaries = await cache.listAnalysisSnapshots()

    expect(summaries.map((summary) => summary.analysisId)).toEqual(['newer', 'older'])
    expect(summaries[0]).toMatchObject({ areaName: 'Test area', areaKm2: 1.5, blockCount: 0 })
  })

  it('deletes a saved analysis', async () => {
    await cache.saveAnalysisSnapshot(buildSnapshot({ analysisId: 'to-delete' }))

    await cache.deleteAnalysisSnapshot('to-delete')

    expect(await cache.loadAnalysisSnapshot('to-delete')).toBeNull()
    expect(await cache.listAnalysisSnapshots()).toHaveLength(0)
  })

  it('returns null for an analysis that was never saved', async () => {
    expect(await cache.loadAnalysisSnapshot('does-not-exist')).toBeNull()
  })

  it('prunes the oldest saved analyses beyond the retention cap', async () => {
    for (let i = 0; i < 12; i += 1) {
      await cache.saveAnalysisSnapshot(
        buildSnapshot({ analysisId: `snap-${i}`, savedAt: new Date(2026, 0, i + 1).toISOString() }),
      )
    }

    const summaries = await cache.listAnalysisSnapshots()

    expect(summaries).toHaveLength(10)
    expect(summaries.map((summary) => summary.analysisId)).not.toContain('snap-0')
    expect(summaries.map((summary) => summary.analysisId)).not.toContain('snap-1')
    expect(summaries.map((summary) => summary.analysisId)).toContain('snap-11')
  })

  it('clearAll removes saved analyses too', async () => {
    await cache.saveAnalysisSnapshot(buildSnapshot({ analysisId: 'a1' }))

    await cache.clearAll()

    expect(await cache.listAnalysisSnapshots()).toHaveLength(0)
  })
})
