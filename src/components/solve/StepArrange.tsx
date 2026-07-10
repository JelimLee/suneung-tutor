import { useState } from 'react'
import { gradeOrder, parseCorrectOrder } from '../../lib/solve/order'
import type { GradingRubric } from '../../lib/useProblem'
import ReasonButtons from './ReasonButtons'
import type {
  OrderArrangeState,
  OrderLabel,
  StepVerdict,
  ThemeGrade,
} from './types'

interface Props {
  value: OrderArrangeState
  rubric: GradingRubric | null
  blocks: { label: OrderLabel; text: string }[]
  onChange: (next: OrderArrangeState) => void
  /** Fires on each 채점하기 action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
  /** Frame-supplied pairwise reason grader (uses FULL rubric; correct flag stays out). */
  gradePair?: (pairKey: string, optionId: string) => StepVerdict
}

/**
 * 순서 3단계 — 블록을 클릭해 배열한다. 채점하기 시 rubric.correct_order와 대조해
 * 소프트 피드백(넛지)만 보여준다. rubric의 추론/설명(referent_chains,
 * example_mapping, traps.why 등)은 SOLVE 화면에 절대 노출하지 않는다 — 채점·챗
 * 전용. 점수(위치 일치 칸 수)는 프로즈가 아니므로 표시한다.
 */
export default function StepArrange({
  value,
  rubric,
  blocks,
  onChange,
  onGrade,
  gradePair,
}: Props) {
  const [checked, setChecked] = useState(false)

  const hasRubric = Boolean(rubric?.correct_order)
  const correctOrder = parseCorrectOrder(rubric?.correct_order ?? '')
  const pairs = rubric?.pair_options ?? []
  const orderComplete =
    blocks.length > 0 && value.order.length === blocks.length

  function toggle(label: OrderLabel) {
    if (checked) setChecked(false)
    const placed = value.order.includes(label)
    const order = placed
      ? value.order.filter((l) => l !== label)
      : [...value.order, label]
    onChange({ ...value, order })
  }

  function reset() {
    if (checked) setChecked(false)
    onChange({ ...value, order: [] })
  }

  function handleGrade() {
    setChecked(true)
    if (!hasRubric) {
      onChange({ ...value, graded: 'none', positionsCorrect: 0 })
      onGrade?.(value.order.join('-'), 'neutral')
      return
    }
    const { positionsCorrect, graded } = gradeOrder(value.order, correctOrder)
    onChange({ ...value, positionsCorrect, graded })
    const verdict: StepVerdict = graded === 'accept' ? 'accepted' : 'reject'
    onGrade?.(value.order.join('-'), verdict)
  }

  const graded: ThemeGrade = value.graded

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        블록을 클릭한 순서대로 배열하세요.{' '}
        <span className="text-ink">이미 놓은 블록을 다시 누르면 빠집니다.</span>
      </p>

      {blocks.length === 0 && (
        <p className="text-sm text-ink-muted">
          자동 분해가 안 됐어요. 지문을 직접 보고 배열해 주세요.
        </p>
      )}

      {/* Current arrangement */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-muted">현재 배열:</span>
        {value.order.length === 0 ? (
          <span className="text-sm text-ink-muted/70">아직 없음</span>
        ) : (
          value.order.map((label, i) => (
            <span
              key={label}
              className="rounded-full bg-pink px-3 py-1 text-xs font-bold text-white"
            >
              {i + 1}. ({label})
            </span>
          ))
        )}
      </div>

      {/* Clickable blocks */}
      <ul className="space-y-2">
        {blocks.map((b) => {
          const pos = value.order.indexOf(b.label)
          const placed = pos >= 0
          return (
            <li key={b.label}>
              <button
                type="button"
                onClick={() => toggle(b.label)}
                className={
                  'w-full rounded-2xl border p-3 text-left transition ' +
                  (placed
                    ? 'border-pink bg-pink-50'
                    : 'border-cream-200 bg-white/60 hover:border-pink')
                }
              >
                <p className="text-sm text-ink">
                  <span className="mr-2 font-bold text-sage-600">
                    ({b.label})
                  </span>
                  {placed && (
                    <span className="mr-2 rounded-full bg-pink px-2 py-0.5 text-xs font-bold text-white">
                      {pos + 1}
                    </span>
                  )}
                  <span className="text-ink-muted">{b.text.slice(0, 90)}…</span>
                </p>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="flex items-center gap-2">
        {hasRubric && (
          <button
            type="button"
            onClick={handleGrade}
            disabled={value.order.length === 0}
            className="rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            채점하기
          </button>
        )}
        {value.order.length > 0 && (
          <button
            type="button"
            onClick={reset}
            className="rounded-full px-4 py-2 text-sm font-medium text-ink-muted transition hover:text-ink"
          >
            초기화
          </button>
        )}
      </div>

      {checked && hasRubric && (
        <div
          className={
            'rounded-2xl border p-4 ' +
            (graded === 'accept'
              ? 'border-sage bg-sage-50'
              : graded === 'partial'
                ? 'border-cream-200 bg-cream-100'
                : 'border-pink bg-pink-50')
          }
        >
          <p className="text-sm font-bold">
            {graded === 'accept' ? (
              <span className="text-sage-600">배열이 딱 맞아요 ✓</span>
            ) : graded === 'partial' ? (
              <span className="text-ink">
                시작은 맞았어요 — 뒤 순서를 다시 볼까요?
              </span>
            ) : (
              <span className="text-pink-600">배열을 다시 살펴볼까요?</span>
            )}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {value.order.length}칸 중 {value.positionsCorrect}칸 위치 일치
          </p>
        </div>
      )}

      {orderComplete && pairs.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink">
            두 문단씩, 뭐가 먼저 와야 하는지 근거를 골라볼까요?
          </p>
          {pairs.map((p) => {
            const picked = value.pairPicks[p.key] ?? null
            const verdict =
              picked && gradePair ? gradePair(p.key, picked) : null
            return (
              <ReasonButtons
                key={p.key}
                question={p.question}
                options={p.options}
                picked={picked}
                verdict={verdict}
                onPick={(id) => {
                  onChange({
                    ...value,
                    pairPicks: { ...value.pairPicks, [p.key]: id },
                  })
                  onGrade?.(id, gradePair ? gradePair(p.key, id) : 'neutral')
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
