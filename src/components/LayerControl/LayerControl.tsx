import { useAnalysisStore, type LayerVisibility } from '../../state/analysisStore'
import { buildLegendEntries, CHOROPLETH_PALETTES, type BlockStyleAttribute, type ChoroplethPalette, type ClassificationMethod } from '../MapView/blockStyling'

const LAYER_LABELS: Array<{ key: keyof LayerVisibility; label: string }> = [
  { key: 'analysisArea', label: 'Analysis area' },
  { key: 'districts', label: 'Districts' },
  { key: 'grid', label: 'Technical acquisition grid' },
  { key: 'originalRoads', label: 'Original OSM roads' },
  { key: 'nodedRoads', label: 'Noded road network' },
  { key: 'removedBranches', label: 'Removed terminal branches' },
  { key: 'twoCoreRoads', label: '2-core network' },
  { key: 'blocks', label: 'Urban blocks' },
]

export function LayerControl() {
  const layerVisibility = useAnalysisStore((state) => state.layerVisibility)
  const toggleLayer = useAnalysisStore((state) => state.toggleLayer)
  const blocks = useAnalysisStore((state) => state.blocks)
  const blockStyleAttribute = useAnalysisStore((state) => state.blockStyleAttribute)
  const classificationMethod = useAnalysisStore((state) => state.classificationMethod)
  const manualBreaks = useAnalysisStore((state) => state.manualBreaks)
  const setBlockStyleAttribute = useAnalysisStore((state) => state.setBlockStyleAttribute)
  const setClassificationMethod = useAnalysisStore((state) => state.setClassificationMethod)
  const setManualBreaks = useAnalysisStore((state) => state.setManualBreaks)
  const blockColorPalette = useAnalysisStore((state) => state.blockColorPalette)
  const setBlockColorPalette = useAnalysisStore((state) => state.setBlockColorPalette)

  const legend = buildLegendEntries(blockStyleAttribute, classificationMethod, blocks, manualBreaks, blockColorPalette)

  return (
    <section aria-label="Layer control and legend" style={{ display: 'grid', gap: '0.5rem' }}>
      <h2>Layers</h2>
      <fieldset style={{ border: '1px solid #e2e8f0', display: 'grid', gap: '0.25rem', padding: '0.5rem' }}>
        <legend>Map layers</legend>
        {LAYER_LABELS.map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="checkbox" checked={layerVisibility[key]} onChange={() => toggleLayer(key)} />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset style={{ border: '1px solid #e2e8f0', display: 'grid', gap: '0.35rem', padding: '0.5rem' }}>
        <legend>Block styling</legend>
        <label htmlFor="style-attribute">Colour blocks by</label>
        <select
          id="style-attribute"
          value={blockStyleAttribute}
          onChange={(event) => setBlockStyleAttribute(event.target.value as BlockStyleAttribute)}
        >
          <option value="area">Area</option>
          <option value="compactness">Compactness</option>
          <option value="district">District</option>
          <option value="flags">Diagnostic flags</option>
        </select>

        {(blockStyleAttribute === 'area' || blockStyleAttribute === 'compactness') ? (
          <>
            <label htmlFor="color-palette">Colour palette</label>
            <select
              id="color-palette"
              value={blockColorPalette}
              onChange={(event) => setBlockColorPalette(event.target.value as ChoroplethPalette)}
            >
              {Object.keys(CHOROPLETH_PALETTES).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', height: '0.9rem', borderRadius: '0.2rem', overflow: 'hidden', border: '1px solid #0002' }} aria-hidden="true">
              {CHOROPLETH_PALETTES[blockColorPalette].map((color) => (
                <span key={color} style={{ background: color, flex: 1 }} />
              ))}
            </div>

            <label htmlFor="classification-method">Classification method</label>
            <select
              id="classification-method"
              value={classificationMethod}
              onChange={(event) => setClassificationMethod(event.target.value as ClassificationMethod)}
            >
              <option value="quantile">Quantiles</option>
              <option value="equal-interval">Equal intervals</option>
              <option value="manual">Manual thresholds</option>
            </select>
            {classificationMethod === 'manual' ? (
              <label htmlFor="manual-breaks">
                Manual thresholds (comma-separated)
                <input
                  id="manual-breaks"
                  type="text"
                  defaultValue={manualBreaks.join(', ')}
                  onBlur={(event) => setManualBreaks(event.target.value.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value)))}
                />
              </label>
            ) : null}
          </>
        ) : null}
      </fieldset>

      <div aria-label="Legend" style={{ display: 'grid', gap: '0.2rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.9rem' }}>Legend</h3>
        {legend.map((entry) => (
          <div key={entry.label} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem' }}>
            <span style={{ width: '0.9rem', height: '0.9rem', background: entry.color, border: '1px solid #0003', display: 'inline-block' }} aria-hidden="true" />
            <span>{entry.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
