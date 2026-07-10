import type { ReactNode } from 'react'

interface WizardShellProps {
  stepIdx: number
  stepLabels: string[]
  canProceed: boolean
  showNext: boolean
  onPrev: () => void
  onNext: () => void
  nextLabel?: string
  /** Contingent-chat affordance rendered in the footer (never gates). */
  askSlot?: ReactNode
  children: ReactNode
}

/**
 * Progress header (dots + current label) plus Prev/Next chrome for the blank
 * wizard. Next is disabled unless `canProceed`. On the final step the parent
 * hides Next (showNext=false) so the choice step drives its own completion.
 */
export default function WizardShell({
  stepIdx,
  stepLabels,
  canProceed,
  showNext,
  onPrev,
  onNext,
  nextLabel = '다음 →',
  askSlot,
  children,
}: WizardShellProps) {
  return (
    <div>
      {/* Progress header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {stepLabels.map((label, i) => (
            <span
              key={label}
              title={label}
              className={
                'h-2.5 w-2.5 rounded-full transition ' +
                (i < stepIdx
                  ? 'bg-pink'
                  : i === stepIdx
                    ? 'bg-pink ring-2 ring-pink-50'
                    : 'bg-cream-200')
              }
            />
          ))}
        </div>
        <span className="text-xs font-semibold text-ink-muted">
          {stepIdx + 1} / {stepLabels.length} · {stepLabels[stepIdx]}
        </span>
      </div>

      {/* Step body */}
      <div className="mt-5">{children}</div>

      {/* Chrome */}
      <div className="mt-8 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={stepIdx === 0}
          className="rounded-full px-4 py-2 text-sm font-medium text-ink-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← 이전
        </button>
        {/* Contingent-chat affordance — always clickable, never a gate. */}
        {askSlot && (
          <div className="flex min-w-0 flex-1 justify-center">{askSlot}</div>
        )}
        {showNext ? (
          <button
            type="button"
            onClick={onNext}
            disabled={!canProceed}
            className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {nextLabel}
          </button>
        ) : (
          // Keep the prev button pinned left when Next is hidden.
          <span aria-hidden className="w-px" />
        )}
      </div>
    </div>
  )
}
