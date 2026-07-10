import type { StepVerdict } from './types'

interface Props {
  passagePick: '+' | '-' | null
  onChange: (pick: '+' | '-') => void
  /** Frame-supplied grader (uses FULL rubric; the correct polarity stays out). */
  grade: (pick: '+' | '-') => StepVerdict
  /** Fires on each grading action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/**
 * 어휘 1단계 — 글 전체의 부호(±)를 먼저 잡는다. 이 부호가 각 밑줄 낱말을 판단하는
 * 기준이 된다. 채점은 프레임 그레이더로 소프트하게만: 정답 부호는 절대 노출하지
 * 않고 ✓ / "다시 읽어볼까요" 넛지만.
 */
export default function StepPassagePolarity({
  passagePick,
  onChange,
  grade,
  onGrade,
}: Props) {
  const verdict = passagePick ? grade(passagePick) : null
  const chips: { v: '+' | '-'; label: string }[] = [
    { v: '+', label: '긍정 (+)' },
    { v: '-', label: '부정 (−)' },
  ]

  function pick(p: '+' | '-') {
    onChange(p)
    onGrade?.(p, grade(p))
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-ink">
          이 글은 전체적으로{' '}
          <span className="text-pink-600">어느 쪽이에요?</span>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          글쓴이가 이 소재를 좋게(긍정) 보는지 나쁘게(부정) 보는지 큰 방향을 먼저
          잡아보세요. 이 부호가 밑줄 낱말들이 맞는지 판단하는 기준이 돼요.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {chips.map((c) => {
          const active = passagePick === c.v
          return (
            <button
              key={c.v}
              type="button"
              onClick={() => pick(c.v)}
              className={
                'flex-1 rounded-2xl border px-6 py-4 text-base font-semibold transition ' +
                (active
                  ? 'border-pink bg-pink text-white'
                  : 'border-cream-200 bg-white/70 text-ink hover:border-pink')
              }
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {passagePick && verdict === 'accepted' && (
        <p className="text-sm font-medium text-sage-600">
          글 방향을 잘 잡았어요 ✓
        </p>
      )}
      {passagePick && verdict === 'reject' && (
        <p className="text-sm font-medium text-pink-600">
          다시 한 번 읽어볼까요?
        </p>
      )}
    </div>
  )
}
