import { AnalysisProgress } from './AnalysisProgress'

export interface ProgressOverlayProps {
  onCancel: () => void
}

/**
 * Long-running work (grid generation, Overpass acquisition, noding,
 * polygonization, ...) is shown centred on screen instead of inside the
 * scrollable sidebar, so the user's attention is on it immediately and
 * never needs to scroll to check progress or find the Cancel button.
 */
export function ProgressOverlay({ onCancel }: ProgressOverlayProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Analysis in progress"
        className="panel"
        style={{ maxWidth: '480px', width: '100%' }}
      >
        <AnalysisProgress onCancel={onCancel} />
      </div>
    </div>
  )
}
