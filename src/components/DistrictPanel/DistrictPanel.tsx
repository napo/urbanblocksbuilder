import * as turf from '@turf/turf'
import { useState } from 'react'
import { useAnalysisStore } from '../../state/analysisStore'
import type { District, DistrictAssignmentStrategy } from '../../domain/district'

function buildDistrictsFromGeoJson(json: unknown): { districts: District[]; error: string | null } {
  if (!json || typeof json !== 'object') {
    return { districts: [], error: 'The uploaded file does not contain a valid GeoJSON object.' }
  }
  const value = json as GeoJSON.GeoJSON

  const features = value.type === 'FeatureCollection'
    ? value.features
    : value.type === 'Feature'
      ? [value]
      : (value.type === 'Polygon' || value.type === 'MultiPolygon')
        ? [{ type: 'Feature' as const, properties: {}, geometry: value }]
        : []

  const polygonFeatures = features.filter(
    (feature): feature is GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> =>
      Boolean(feature.geometry) && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'),
  )

  if (polygonFeatures.length === 0) {
    return { districts: [], error: 'No Polygon or MultiPolygon features were found in the uploaded file.' }
  }

  const districts: District[] = polygonFeatures.map((feature, index) => {
    const bbox = turf.bbox(feature.geometry) as [number, number, number, number]
    return {
      id: `district-${index + 1}`,
      name: (feature.properties?.name as string | undefined) ?? `District ${index + 1}`,
      source: 'upload',
      geometry: feature.geometry,
      bbox,
      areaKm2: turf.area(feature.geometry) / 1_000_000,
    }
  })

  return { districts, error: null }
}

export function DistrictPanel() {
  const districts = useAnalysisStore((state) => state.districts)
  const setDistricts = useAnalysisStore((state) => state.setDistricts)
  const districtStrategy = useAnalysisStore((state) => state.districtStrategy)
  const setDistrictStrategy = useAnalysisStore((state) => state.setDistrictStrategy)
  const districtStatistics = useAnalysisStore((state) => state.districtStatistics)
  const selectedDistrictId = useAnalysisStore((state) => state.selectedDistrictId)
  const setSelectedDistrictId = useAnalysisStore((state) => state.setSelectedDistrictId)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setError(null)
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const result = buildDistrictsFromGeoJson(json)
      if (result.error) {
        setError(result.error)
        return
      }
      setDistricts(result.districts)
    } catch {
      setError('The uploaded file is not valid JSON.')
    }
  }

  return (
    <section aria-label="Districts" style={{ display: 'grid', gap: '0.5rem' }}>
      <h2>Districts (optional)</h2>
      <p style={{ fontSize: '0.8rem', color: '#475569' }}>
        Upload a district boundary GeoJSON file to associate urban blocks with districts after generation. Districts never split the road network.
      </p>
      <label htmlFor="district-upload">Upload district boundaries</label>
      <input
        id="district-upload"
        type="file"
        accept=".geojson,.json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
          event.target.value = ''
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
      {districts.length > 0 ? <p>{districts.length} district(s) loaded.</p> : null}

      <label htmlFor="district-strategy">Assignment strategy</label>
      <select id="district-strategy" value={districtStrategy} onChange={(event) => setDistrictStrategy(event.target.value as DistrictAssignmentStrategy)}>
        <option value="largest-overlap">Largest area overlap (default)</option>
        <option value="point-on-surface">Point-on-surface containment</option>
        <option value="intersection">Geometric intersection (statistical allocation)</option>
      </select>

      {districtStatistics.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.75rem', width: '100%' }}>
            <thead>
              <tr>
                {['District', 'Blocks', 'Mean area', 'Median area', 'Min', 'Max', 'Q1', 'Q3', 'Mean compactness', 'Total area', '% above threshold', '% area analysed'].map((header) => (
                  <th key={header} style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem', textAlign: 'left' }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {districtStatistics.map((stat) => (
                <tr
                  key={stat.districtId}
                  onClick={() => setSelectedDistrictId(stat.districtId)}
                  style={{ cursor: 'pointer', background: selectedDistrictId === stat.districtId ? '#eef2ff' : undefined }}
                >
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{stat.districtName ?? stat.districtId}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{stat.blockCount}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{Math.round(stat.meanBlockAreaM2).toLocaleString()}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{Math.round(stat.medianBlockAreaM2).toLocaleString()}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{Math.round(stat.minBlockAreaM2).toLocaleString()}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{Math.round(stat.maxBlockAreaM2).toLocaleString()}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{Math.round(stat.firstQuartileAreaM2).toLocaleString()}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{Math.round(stat.thirdQuartileAreaM2).toLocaleString()}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{stat.meanCompactness.toFixed(3)}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{Math.round(stat.totalBlockAreaM2).toLocaleString()}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{stat.percentAboveAreaThreshold.toFixed(1)}%</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '0.2rem 0.35rem' }}>{stat.percentDistrictAreaAnalysed.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
