import { useAnalysisStore } from '../../state/analysisStore'

export interface AnalysisProgressProps {
  onCancel: () => void
}

export function AnalysisProgress({ onCancel }: AnalysisProgressProps) {
  const progress = useAnalysisStore((state) => state.progress)
  const isProcessing = useAnalysisStore((state) => state.isProcessing)

  return (
    <section aria-label="Analysis progress" style={{ display: 'grid', gap: '0.4rem' }}>
      <h2>Progress</h2>
      <div role="status" aria-live="polite" style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
        {progress ? (
          <>
            <p><strong>{progress.phase}</strong> — {progress.percent}%</p>
            <div role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} style={{ background: '#e2e8f0', height: '0.5rem', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{ width: `${progress.percent}%`, background: '#4f46e5', height: '100%' }} />
            </div>
            {progress.totalCells > 0 ? <p>Grid cells: {progress.completedCells}/{progress.totalCells}{progress.currentCell ? ` (current: ${progress.currentCell})` : ''}</p> : null}
            <p>Downloaded ways: {progress.downloadedWays} · Coordinates: {progress.coordinates} · Segments: {progress.segments}</p>
            <p>Elapsed: {(progress.elapsedMs / 1000).toFixed(1)} s</p>
            <p>Cache: {progress.cacheStatus}</p>
          </>
        ) : (
          <p>{isProcessing ? 'Starting analysis…' : 'No analysis has been run yet.'}</p>
        )}
      </div>
      {isProcessing ? (
        <button type="button" onClick={onCancel}>Cancel analysis</button>
      ) : null}
    </section>
  )
}
