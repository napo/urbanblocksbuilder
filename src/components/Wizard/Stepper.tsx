export type WizardStep = 'area' | 'configure' | 'results'

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'area', label: 'Define area' },
  { id: 'configure', label: 'Configure & run' },
  { id: 'results', label: 'Results' },
]

export interface StepperProps {
  current: WizardStep
  canNavigate: (step: WizardStep) => boolean
  onNavigate: (step: WizardStep) => void
}

export function Stepper({ current, canNavigate, onNavigate }: StepperProps) {
  const currentIndex = STEPS.findIndex((step) => step.id === current)

  return (
    <nav aria-label="Analysis steps" className="stepper">
      {STEPS.map((step, index) => {
        const state = index === currentIndex ? 'current' : index < currentIndex ? 'done' : 'upcoming'
        const enabled = canNavigate(step.id)
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="stepper-step"
              data-state={state}
              disabled={!enabled}
              aria-current={state === 'current' ? 'step' : undefined}
              onClick={() => enabled && onNavigate(step.id)}
            >
              <span className="dot" aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
              {step.label}
            </button>
            {index < STEPS.length - 1 ? <span className="stepper-connector" aria-hidden="true" /> : null}
          </div>
        )
      })}
    </nav>
  )
}
