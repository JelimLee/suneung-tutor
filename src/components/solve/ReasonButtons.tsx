import { useMemo } from 'react'
import type { StepVerdict } from './types'

// Frame-level, type-agnostic reason-button UI for "왜 그렇게 생각했어요?".
// Reusable across ALL problem types (순서/어법/어휘/무관/삽입 …): it depends only
// on a flat { id, label } option list + a soft verdict computed elsewhere. It
// NEVER receives the `correct` flag (the display rubric neutralizes it) and NEVER
// reveals which option is correct — 'reject' feedback stays soft.

interface Option {
  id: string
  label: string
}

interface Props {
  question?: string
  options: Option[]
  picked: string | null
  verdict: StepVerdict | null
  onPick: (id: string) => void
}

/** Deterministic stable shuffle seeded by the option ids (no reshuffle on
 * re-render). Keeps the correct option from always landing first without any
 * randomness that would move chips around mid-interaction. */
function stableShuffle<T extends Option>(options: T[]): T[] {
  const seed = options.map((o) => o.id).join('|')
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return options
    .map((o, i) => {
      h = (h * 1103515245 + 12345) >>> 0
      return { o, k: (h ^ (i * 2654435761)) >>> 0 }
    })
    .sort((a, b) => a.k - b.k)
    .map((x) => x.o)
}

export default function ReasonButtons({
  question = '왜 그렇게 생각했어요?',
  options,
  picked,
  verdict,
  onPick,
}: Props) {
  const shuffled = useMemo(() => stableShuffle(options), [options])

  if (options.length === 0) return null

  return (
    <div className="rounded-2xl border border-cream-200 bg-cream-100/60 p-4">
      <p className="text-sm font-semibold text-ink">{question}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {shuffled.map((o) => {
          const active = picked === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              className={
                'rounded-full border px-3 py-1.5 text-sm transition ' +
                (active
                  ? 'border-pink bg-pink text-white'
                  : 'border-cream-200 bg-white/70 text-ink hover:border-pink')
              }
            >
              {o.label}
            </button>
          )
        })}
      </div>

      {picked && verdict === 'accepted' && (
        <p className="mt-3 text-sm font-medium text-sage-600">좋은 근거예요 ✓</p>
      )}
      {picked && verdict === 'reject' && (
        <p className="mt-3 text-sm font-medium text-pink-600">
          음, 그 근거는 다시 볼까요?
        </p>
      )}
    </div>
  )
}
