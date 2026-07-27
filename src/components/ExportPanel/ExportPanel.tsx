import { useAnalysisStore } from '../../state/analysisStore'
import { exportGeoJson } from '../../services/export/exportGeoJson'
import { downloadAnalysisReport } from '../../services/export/exportReport'
import { buildBlocksFeatureCollection } from '../MapView/mapLayerData'

export function ExportPanel() {
  const blocks = useAnalysisStore((state) => state.blocks)
  const originalRoads = useAnalysisStore((state) => state.originalRoads)
  const nodedRoads = useAnalysisStore((state) => state.nodedRoads)
  const removedBranches = useAnalysisStore((state) => state.removedBranches)
  const twoCoreRoads = useAnalysisStore((state) => state.twoCoreRoads)
  const districts = useAnalysisStore((state) => state.districts)
  const districtStatistics = useAnalysisStore((state) => state.districtStatistics)
  const report = useAnalysisStore((state) => state.report)

  const hasResults = blocks.length > 0

  const exportDistricts = () => {
    const statsById = new Map(districtStatistics.map((stat) => [stat.districtId, stat]))
    exportGeoJson('urban-blocks-builder-districts.geojson', {
      type: 'FeatureCollection',
      features: districts.map((district) => ({
        type: 'Feature',
        geometry: district.geometry,
        properties: { districtId: district.id, name: district.name, ...statsById.get(district.id) },
      })),
    })
  }

  return (
    <section aria-label="Export" style={{ display: 'grid', gap: '0.4rem' }}>
      <h2>Export</h2>
      <p style={{ fontSize: '0.8rem', color: '#475569' }}>All exports are generated locally in your browser as GeoJSON or JSON files.</p>
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        <button type="button" disabled={!hasResults} onClick={() => exportGeoJson('urban-blocks.geojson', buildBlocksFeatureCollection(blocks))}>
          Export urban blocks (GeoJSON)
        </button>
        <button type="button" disabled={originalRoads.features.length === 0} onClick={() => exportGeoJson('original-roads.geojson', originalRoads)}>
          Export original roads (GeoJSON)
        </button>
        <button type="button" disabled={nodedRoads.features.length === 0} onClick={() => exportGeoJson('noded-network.geojson', nodedRoads)}>
          Export noded network (GeoJSON)
        </button>
        <button type="button" disabled={removedBranches.features.length === 0} onClick={() => exportGeoJson('removed-branches.geojson', removedBranches)}>
          Export removed branches (GeoJSON)
        </button>
        <button type="button" disabled={twoCoreRoads.features.length === 0} onClick={() => exportGeoJson('two-core-network.geojson', twoCoreRoads)}>
          Export 2-core network (GeoJSON)
        </button>
        <button type="button" disabled={districts.length === 0} onClick={exportDistricts}>
          Export districts with statistics (GeoJSON)
        </button>
        <button type="button" disabled={!report} onClick={() => report && downloadAnalysisReport(report)}>
          Export complete analysis report (JSON)
        </button>
      </div>
    </section>
  )
}
