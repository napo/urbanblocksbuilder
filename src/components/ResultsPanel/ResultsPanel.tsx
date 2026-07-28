import { useAnalysisStore } from '../../state/analysisStore'

export function ResultsPanel() {
  const selectedArea = useAnalysisStore((state) => state.selectedArea)
  const blocks = useAnalysisStore((state) => state.blocks)
  const selectedBlockId = useAnalysisStore((state) => state.selectedBlockId)
  const report = useAnalysisStore((state) => state.report)

  const selectedBlock = blocks.find((block) => block.id === selectedBlockId)
  const flaggedCount = blocks.filter((block) => block.properties.flaggedSmallArtifact || block.properties.flaggedLargeArea || block.properties.flaggedInvalidGeometry).length

  return (
    <section aria-label="Results" style={{ background: '#fff', padding: '1rem', border: '1px solid #e2e8f0' }}>
      <h2>Results</h2>
      <p>{selectedArea ? `${selectedArea.areaKm2.toFixed(2)} km² analysis area` : 'Select an area to begin.'}</p>
      <p>{blocks.length} urban block(s) generated{flaggedCount > 0 ? `, ${flaggedCount} flagged for review` : ''}.</p>

      {selectedBlock ? (
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <h3 style={{ marginTop: 0 }}>Selected block: {selectedBlock.properties.blockId}</h3>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.5rem', fontSize: '0.85rem' }}>
            <dt>Area</dt>
            <dd>{Math.round(selectedBlock.properties.areaM2).toLocaleString()} m²</dd>
            <dt>Perimeter</dt>
            <dd>{Math.round(selectedBlock.properties.perimeterM).toLocaleString()} m</dd>
            <dt>Compactness</dt>
            <dd>{selectedBlock.properties.compactness.toFixed(3)}</dd>
            <dt>District</dt>
            <dd>{selectedBlock.properties.districtId ?? 'None assigned'}</dd>
            <dt>Warnings</dt>
            <dd>
              {[
                selectedBlock.properties.flaggedSmallArtifact && 'Small artifact',
                selectedBlock.properties.flaggedLargeArea && 'Unusually large',
                selectedBlock.properties.flaggedInvalidGeometry && 'Invalid geometry',
              ].filter(Boolean).join(', ') || 'None'}
            </dd>
            <dt>Boundary-closed</dt>
            <dd>{selectedBlock.properties.flaggedBoundaryClosure ? 'Yes - part of this edge is the selection outline, not a street' : 'No'}</dd>
            <dt>Has building</dt>
            <dd>{selectedBlock.properties.flaggedNoBuildings ? 'No - could not be merged into a neighbouring block' : 'Yes'}</dd>
          </dl>
        </div>
      ) : null}

      {report ? (
        <details style={{ marginTop: '0.75rem' }}>
          <summary>Geometry statistics</summary>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.1rem 0.5rem', fontSize: '0.8rem' }}>
            {Object.entries(report.geometryStatistics).map(([key, value]) => (
              <div key={key} style={{ display: 'contents' }}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  )
}
