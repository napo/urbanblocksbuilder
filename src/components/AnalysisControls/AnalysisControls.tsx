import { useAnalysisStore } from '../../state/analysisStore'
import { defaultHighwayFilters } from '../../config/defaults'
import { IndexedDbAnalysisCache } from '../../services/cache/IndexedDbAnalysisCache'
import type { AnalysisConfig } from '../../domain/types'

const ADVANCED_HIGHWAY_TOGGLES = [
  { key: 'includeService', label: 'Service roads' },
  { key: 'includeTrack', label: 'Tracks' },
  { key: 'includeFootway', label: 'Footways' },
  { key: 'includeCycleway', label: 'Cycleways' },
  { key: 'includePath', label: 'Paths' },
  { key: 'includeMotorway', label: 'Motorways' },
  { key: 'includeTrunk', label: 'Trunk roads' },
] as const

const SEPARATOR_TOGGLES = [
  { key: 'includeWaterway', label: 'Surface waterways (rivers, streams, canals)' },
  { key: 'includeRailway', label: 'Railways' },
] as const

const NUMERIC_FIELDS = [
  {
    id: 'concurrency',
    label: 'Overpass concurrency',
    help: 'How many grid cells to download at once. Keep this low (1-2) to stay within Overpass\'s fair-use limits.',
    min: 1,
    max: 4,
    step: 1,
    key: 'concurrency' as const,
  },
  {
    id: 'context-buffer',
    label: 'Context buffer (metres)',
    help: 'Extra margin downloaded around each grid cell so roads crossing a cell edge are not cut off.',
    min: 0,
    key: 'contextBufferMeters' as const,
  },
  {
    id: 'snapping-tolerance',
    label: 'Snapping tolerance (metres)',
    help: 'Coordinates closer than this are treated as the same point when reconstructing the road network.',
    min: 0.1,
    step: 0.1,
    key: 'snappingToleranceMeters' as const,
  },
  {
    id: 'min-area',
    label: 'Small artifact threshold (m²)',
    help: 'Blocks smaller than this are flagged as possible artifacts instead of being deleted.',
    min: 0,
    key: 'minAreaM2' as const,
  },
  {
    id: 'large-area',
    label: 'Large block threshold (m²)',
    help: 'Blocks larger than this are flagged as unusually large and worth reviewing.',
    min: 0,
    key: 'largeBlockAreaThresholdM2' as const,
  },
]

const cache = new IndexedDbAnalysisCache()

export interface AnalysisControlsProps {
  onRun: () => void
  canRun: boolean
}

function CheckboxRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '1.1rem 1fr', alignItems: 'center', gap: '0.4rem', fontWeight: 400 }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

function SelectAllNone({ onAll, onNone }: { onAll: () => void; onNone: () => void }) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.2rem' }}>
      <button type="button" className="ghost" style={{ padding: '0.1rem 0.3rem', fontSize: '0.72rem' }} onClick={onAll}>Select all</button>
      <button type="button" className="ghost" style={{ padding: '0.1rem 0.3rem', fontSize: '0.72rem' }} onClick={onNone}>Select none</button>
    </div>
  )
}

export function AnalysisControls({ onRun, canRun }: AnalysisControlsProps) {
  const config = useAnalysisStore((state) => state.config)
  const setConfig = useAnalysisStore((state) => state.setConfig)
  const fixtureMode = useAnalysisStore((state) => state.fixtureMode)
  const setFixtureMode = useAnalysisStore((state) => state.setFixtureMode)
  const isProcessing = useAnalysisStore((state) => state.isProcessing)
  const setCacheStatus = useAnalysisStore((state) => state.setCacheStatus)

  const toggleHighway = (value: string) => {
    const nextFilters = config.highwayFilters.includes(value)
      ? config.highwayFilters.filter((entry) => entry !== value)
      : [...config.highwayFilters, value]
    setConfig({ ...config, highwayFilters: nextFilters })
  }

  const setAdvancedHighways = (value: boolean) => {
    const updates = Object.fromEntries(ADVANCED_HIGHWAY_TOGGLES.map(({ key }) => [key, value])) as Partial<AnalysisConfig>
    setConfig({ ...config, ...updates })
  }

  const clearAllCache = async () => {
    if (!window.confirm('Clear all locally cached Overpass responses and analysis results? This cannot be undone.')) {
      return
    }
    await cache.clearAll()
    setCacheStatus('Local cache cleared.')
  }

  return (
    <section aria-label="Analysis configuration" style={{ display: 'grid', gap: '0.85rem' }}>
      <h2 style={{ margin: 0 }}>Analysis settings</h2>
      <p style={{ fontSize: '0.8rem', margin: 0 }}>
        These control what gets downloaded from OpenStreetMap and how the road network is processed. The defaults
        work well for a typical neighbourhood-sized area.
      </p>

      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontWeight: 400 }}>
        <input type="checkbox" checked={fixtureMode} onChange={(event) => setFixtureMode(event.target.checked)} />
        Use offline fixture data (demo mode, no Overpass requests)
      </label>

      <details open>
        <summary>Road types</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.85rem', marginTop: '0.6rem' }}>
          <fieldset style={{ display: 'grid', gap: '0.3rem' }}>
            <legend>Included</legend>
            <SelectAllNone
              onAll={() => setConfig({ ...config, highwayFilters: [...defaultHighwayFilters] })}
              onNone={() => setConfig({ ...config, highwayFilters: [] })}
            />
            {defaultHighwayFilters.map((value) => (
              <CheckboxRow key={value} checked={config.highwayFilters.includes(value)} label={value} onChange={() => toggleHighway(value)} />
            ))}
          </fieldset>

          <fieldset style={{ display: 'grid', gap: '0.3rem' }}>
            <legend>Advanced</legend>
            <SelectAllNone onAll={() => setAdvancedHighways(true)} onNone={() => setAdvancedHighways(false)} />
            {ADVANCED_HIGHWAY_TOGGLES.map(({ key, label }) => (
              <CheckboxRow key={key} checked={config[key]} label={label} onChange={() => setConfig({ ...config, [key]: !config[key] })} />
            ))}
          </fieldset>

          <fieldset style={{ display: 'grid', gap: '0.3rem' }}>
            <legend>Additional separators</legend>
            <p style={{ fontSize: '0.72rem', margin: 0 }}>
              Divide blocks even where no road runs alongside them.
            </p>
            {SEPARATOR_TOGGLES.map(({ key, label }) => (
              <CheckboxRow key={key} checked={config[key]} label={label} onChange={() => setConfig({ ...config, [key]: !config[key] })} />
            ))}
          </fieldset>

          <fieldset style={{ display: 'grid', gap: '0.3rem' }}>
            <legend>Building-based merging</legend>
            <p style={{ fontSize: '0.72rem', margin: 0 }}>
              A block with no building inside it (a park, a car park...) is absorbed into its longest-bordering neighbour.
            </p>
            <CheckboxRow
              checked={config.mergeBuildinglessBlocks}
              label="Merge buildingless blocks into neighbours"
              onChange={() => setConfig({ ...config, mergeBuildinglessBlocks: !config.mergeBuildinglessBlocks })}
            />
          </fieldset>
        </div>
      </details>

      <details>
        <summary>Processing parameters</summary>
        <div style={{ display: 'grid', gap: '0.65rem', marginTop: '0.6rem' }}>
          {NUMERIC_FIELDS.map((field) => (
            <div key={field.id} style={{ display: 'grid', gap: '0.15rem' }}>
              <label htmlFor={field.id}>{field.label}</label>
              <input
                id={field.id}
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={config[field.key]}
                onChange={(event) => setConfig({ ...config, [field.key]: Number(event.target.value) })}
              />
              <p style={{ fontSize: '0.75rem', margin: 0 }}>{field.help}</p>
            </div>
          ))}
        </div>
      </details>

      <details>
        <summary>Local cache</summary>
        <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.6rem' }}>
          <p style={{ fontSize: '0.8rem', margin: 0 }}>
            Overpass responses and results are cached in your browser (IndexedDB) so re-running the same area doesn't
            re-download it.
          </p>
          <button type="button" className="secondary" style={{ justifySelf: 'start' }} onClick={() => void clearAllCache()}>
            Clear all local cache
          </button>
        </div>
      </details>

      <button type="button" onClick={onRun} disabled={!canRun || isProcessing} style={{ fontSize: '0.95rem', padding: '0.75rem' }}>
        {isProcessing ? 'Analysis running…' : 'Run analysis'}
      </button>
    </section>
  )
}
