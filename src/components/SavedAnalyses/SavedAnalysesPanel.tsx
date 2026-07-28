import { useEffect, useState } from 'react'
import { useAnalysisStore } from '../../state/analysisStore'
import { IndexedDbAnalysisCache } from '../../services/cache/IndexedDbAnalysisCache'
import type { AnalysisSnapshotSummary } from '../../services/cache/AnalysisCache'

const cache = new IndexedDbAnalysisCache()

export interface SavedAnalysesPanelProps {
  /** Called once a saved analysis has been loaded back into the store, so the caller can switch to the results view. */
  onLoaded: () => void
}

export function SavedAnalysesPanel({ onLoaded }: SavedAnalysesPanelProps) {
  const [snapshots, setSnapshots] = useState<AnalysisSnapshotSummary[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const setSelectedArea = useAnalysisStore((state) => state.setSelectedArea)
  const setConfig = useAnalysisStore((state) => state.setConfig)
  const setDistricts = useAnalysisStore((state) => state.setDistricts)
  const setDistrictStrategy = useAnalysisStore((state) => state.setDistrictStrategy)
  const setBlocks = useAnalysisStore((state) => state.setBlocks)
  const setRoadLayers = useAnalysisStore((state) => state.setRoadLayers)
  const setGrid = useAnalysisStore((state) => state.setGrid)
  const setDistrictStatistics = useAnalysisStore((state) => state.setDistrictStatistics)
  const setReport = useAnalysisStore((state) => state.setReport)
  const showOnlyBlocksLayer = useAnalysisStore((state) => state.showOnlyBlocksLayer)
  const addWarning = useAnalysisStore((state) => state.addWarning)

  const refresh = () => {
    cache.listAnalysisSnapshots().then(setSnapshots).catch(() => setSnapshots([]))
  }

  useEffect(() => {
    refresh()
  }, [])

  const loadSnapshot = async (analysisId: string) => {
    setBusyId(analysisId)
    try {
      const snapshot = await cache.loadAnalysisSnapshot(analysisId)
      if (!snapshot) {
        addWarning('This saved analysis is no longer available.')
        refresh()
        return
      }
      setSelectedArea(snapshot.area)
      setConfig(snapshot.config)
      setDistricts(snapshot.districts)
      setDistrictStrategy(snapshot.districtStrategy)
      setBlocks(snapshot.blocks)
      setRoadLayers({
        originalRoads: snapshot.originalRoads,
        nodedRoads: snapshot.nodedRoads,
        removedBranches: snapshot.removedBranches,
        twoCoreRoads: snapshot.twoCoreRoads,
      })
      setGrid(snapshot.grid)
      setDistrictStatistics(snapshot.districtStatistics)
      setReport(snapshot.report)
      showOnlyBlocksLayer()
      onLoaded()
    } finally {
      setBusyId(null)
    }
  }

  const deleteSnapshot = async (analysisId: string) => {
    if (!window.confirm('Delete this saved analysis? This cannot be undone.')) {
      return
    }
    setBusyId(analysisId)
    try {
      await cache.deleteAnalysisSnapshot(analysisId)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  if (snapshots.length === 0) {
    return null
  }

  return (
    <section className="panel" aria-label="Saved analyses">
      <h2 style={{ margin: '0 0 0.4rem' }}>Saved analyses</h2>
      <p style={{ fontSize: '0.8rem', margin: '0 0 0.6rem' }}>
        Completed analyses are saved locally in your browser - reopen one instantly, with nothing re-downloaded or recomputed.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
        {snapshots.map((snapshot) => (
          <li
            key={snapshot.analysisId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.5rem',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '0.5rem 0.65rem',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{snapshot.areaName}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-subtle)' }}>
                {snapshot.areaKm2.toFixed(2)} km² · {snapshot.blockCount} block{snapshot.blockCount === 1 ? '' : 's'} ·{' '}
                {new Date(snapshot.savedAt).toLocaleString()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
              <button
                type="button"
                className="secondary"
                disabled={busyId !== null}
                onClick={() => void loadSnapshot(snapshot.analysisId)}
              >
                Load
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busyId !== null}
                onClick={() => void deleteSnapshot(snapshot.analysisId)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
