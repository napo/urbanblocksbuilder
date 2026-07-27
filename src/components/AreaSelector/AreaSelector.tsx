import { useState } from 'react'
import { useAnalysisStore } from '../../state/analysisStore'
import type { AnalysisArea, AnalysisSource } from '../../domain/types'
import { PlaceSearch } from '../PlaceSearch/PlaceSearch'
import { GeoJsonUpload } from '../GeoJsonUpload/GeoJsonUpload'
import { DrawingTools } from '../DrawingTools/DrawingTools'

interface AreaSelectorProps {
  onAreaSelected?: (area: AnalysisArea) => void
}

type SelectionMode = Extract<AnalysisSource, 'geocoder' | 'upload' | 'rectangle' | 'polygon'>

const MODE_OPTIONS: Array<{ id: SelectionMode; icon: string; label: string }> = [
  { id: 'geocoder', icon: '🔍', label: 'Search a place' },
  { id: 'rectangle', icon: '▭', label: 'Draw a rectangle' },
  { id: 'polygon', icon: '⬠', label: 'Draw a polygon' },
  { id: 'upload', icon: '📄', label: 'Upload GeoJSON' },
]

export function AreaSelector({ onAreaSelected }: AreaSelectorProps) {
  const [resetKey, setResetKey] = useState(0)
  const mode = useAnalysisStore((state) => state.areaSelectionMode)
  const setMode = useAnalysisStore((state) => state.setAreaSelectionMode)
  const selectedArea = useAnalysisStore((state) => state.selectedArea)
  const previewArea = useAnalysisStore((state) => state.previewArea)
  const setSelectedArea = useAnalysisStore((state) => state.setSelectedArea)
  const setPreviewArea = useAnalysisStore((state) => state.setPreviewArea)
  const setDrawingMode = useAnalysisStore((state) => state.setDrawingMode)
  const startNewDrawingSession = useAnalysisStore((state) => state.startNewDrawingSession)

  const confirmArea = (area: AnalysisArea) => {
    setSelectedArea(area)
    setPreviewArea(area)
    onAreaSelected?.(area)
  }

  const selectMode = (nextMode: SelectionMode) => {
    setMode(nextMode)
    if (nextMode === 'rectangle' || nextMode === 'polygon') {
      setDrawingMode(nextMode)
      // Bump the session token even if the mode string is unchanged, so
      // re-clicking the same shape button always clears any stray/unfinished
      // drawing instead of leaving it on the map.
      startNewDrawingSession()
    }
  }

  const clearSelection = () => {
    setSelectedArea(null)
    setPreviewArea(null)
    if (mode === 'rectangle' || mode === 'polygon') {
      startNewDrawingSession()
    }
    // Forces PlaceSearch/GeoJsonUpload to remount, wiping their own local
    // state (search text and results, uploaded file preview, choice
    // dialogs) so "clear" really starts from a blank slate.
    setResetKey((value) => value + 1)
  }

  const hasSelection = Boolean(selectedArea || previewArea)

  return (
    <section aria-label="Analysis area selection" style={{ display: 'grid', gap: '0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>1. What area do you want to analyse?</h2>
        {hasSelection ? (
          <button type="button" className="ghost" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={clearSelection}>
            ✕ Clear selection
          </button>
        ) : null}
      </div>
      <div className="segmented" role="group" aria-label="Area selection mode">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={mode === option.id}
            onClick={() => selectMode(option.id)}
          >
            <span className="icon" aria-hidden="true">{option.icon}</span>
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'geocoder' ? <PlaceSearch key={resetKey} onPreview={setPreviewArea} onConfirm={confirmArea} /> : null}
      {mode === 'upload' ? <GeoJsonUpload key={resetKey} onPreview={setPreviewArea} onConfirm={confirmArea} /> : null}

      {(mode === 'rectangle' || mode === 'polygon') ? (
        <DrawingTools previewArea={previewArea} onConfirm={confirmArea} />
      ) : null}

      {selectedArea ? (
        <p role="status" className="badge badge-success" style={{ justifySelf: 'start' }}>
          ✓ {selectedArea.name ?? 'Unnamed area'} · {selectedArea.areaKm2.toFixed(2)} km²
        </p>
      ) : null}
    </section>
  )
}
