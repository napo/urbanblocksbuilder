import { useAnalysisStore } from '../../state/analysisStore'

export function ErrorPanel() {
  const warnings = useAnalysisStore((state) => state.warnings)
  const errors = useAnalysisStore((state) => state.errors)
  const clearMessages = useAnalysisStore((state) => state.clearMessages)

  const hasMessages = warnings.length > 0 || errors.length > 0

  return (
    <section aria-label="Warnings and errors">
      {/* Always mounted so screen readers are notified as soon as a message appears. */}
      <div className="visually-hidden" aria-live="assertive">{errors[errors.length - 1] ?? ''}</div>
      <div className="visually-hidden" aria-live="polite">{warnings[warnings.length - 1] ?? ''}</div>

      {hasMessages ? (
        <div
          style={{
            display: 'grid',
            gap: '0.4rem',
            background: errors.length > 0 ? 'var(--color-danger-soft)' : 'var(--color-warning-soft)',
            border: `1px solid ${errors.length > 0 ? 'var(--color-danger)' : 'var(--color-warning)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '0.65rem 0.85rem',
          }}
        >
          {errors.map((message, index) => (
            <p key={`error-${index}`} role="alert" style={{ color: 'var(--color-danger)', margin: 0, fontSize: '0.85rem' }}>⚠ {message}</p>
          ))}
          {warnings.map((message, index) => (
            <p key={`warning-${index}`} role="status" style={{ color: 'var(--color-warning)', margin: 0, fontSize: '0.85rem' }}>ⓘ {message}</p>
          ))}
          <button type="button" className="ghost" onClick={clearMessages} style={{ justifySelf: 'start', padding: '0.2rem 0.4rem' }}>Clear messages</button>
        </div>
      ) : null}
    </section>
  )
}
