import type { GradingRubric } from '../../lib/useProblem'
import ReasonButtons from './ReasonButtons'
import type {
  OrderEliminateState,
  OrderLabel,
  StepVerdict,
  ThemeGrade,
} from './types'

interface Props {
  value: OrderEliminateState
  rubric: GradingRubric | null
  given: string
  blocks: { label: OrderLabel; text: string }[]
  onChange: (next: OrderEliminateState) => void
  /** Fires on each 채점하기 action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
  /** Frame-supplied reason grader (uses FULL rubric; correct flag stays out). */
  gradeReason?: (optionId: string) => StepVerdict
}

/**
 * 순서 2단계 — 소거. 주어진 글 바로 다음에 "절대 올 수 없는" 단락을 고른다.
 * 채점하기 시 rubric.anchor.block(정답 첫 단락)과 소프트 대조(넛지). 어떤 단락이
 * 첫 번째인지는 절대 밝히지 않는다. rubric의 추론/설명 필드는 렌더하지 않는다
 * (display 룹릭에는 애초에 담기지도 않는다) — 오직 아래 소프트 문구만.
 */
export default function StepEliminate({
  value,
  rubric,
  given,
  blocks,
  onChange,
  onGrade,
  gradeReason,
}: Props) {
  const anchorBlock = rubric?.anchor?.block ?? null
  const graded: ThemeGrade = value.graded
  const reasonOptions = rubric?.why_options?.['eliminate'] ?? []
  const reasonVerdict: StepVerdict | null =
    value.reasonPick && gradeReason ? gradeReason(value.reasonPick) : null

  function toggle(label: OrderLabel) {
    const eliminated = value.eliminated.includes(label)
      ? value.eliminated.filter((l) => l !== label)
      : [...value.eliminated, label]
    // Any change invalidates a prior grade until re-checked.
    onChange({ ...value, eliminated, graded: 'none' })
  }

  function handleGrade() {
    if (!anchorBlock) return
    let next: ThemeGrade
    let verdict: StepVerdict
    if (value.eliminated.includes(anchorBlock)) {
      // Student eliminated the block that actually comes first — soft reject,
      // WITHOUT revealing which block is first.
      next = 'reject'
      verdict = 'reject'
    } else if (value.eliminated.length > 0) {
      next = 'accept'
      verdict = 'accepted'
    } else {
      next = 'none'
      verdict = 'neutral'
    }
    onChange({ ...value, graded: next })
    onGrade?.(value.eliminated.join(','), verdict)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
        <p className="text-xs font-semibold text-sage-600">[주어진 글]</p>
        {given ? (
          <p className="mt-2 text-sm leading-relaxed text-ink">{given}</p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            자동 분해가 안 됐어요. 위 지문을 직접 보고 판단해 주세요.
          </p>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">
          주어진 글 바로 다음에{' '}
          <span className="text-pink-600">절대 올 수 없는</span> 단락은?
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          어떤 단락이 말이 되려면 앞에 뭔가 나와 있어야 하죠. 그게 주어진 글에
          없으면 → 그 단락은 바로 다음에 못 와요. 그런 단락을 골라 빼세요.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          예: &lsquo;this stress(이 스트레스)&rsquo;로 시작하는 단락은 앞에
          스트레스 얘기가 먼저 나와야 하니 → 바로 다음엔 못 와요.
        </p>
      </div>

      {blocks.length === 0 && (
        <p className="text-sm text-ink-muted">
          자동 분해가 안 됐어요. 지문을 직접 보고 판단해 주세요.
        </p>
      )}

      <ul className="space-y-2">
        {blocks.map((b) => {
          const selected = value.eliminated.includes(b.label)
          return (
            <li key={b.label}>
              <button
                type="button"
                onClick={() => toggle(b.label)}
                className={
                  'w-full rounded-2xl border p-3 text-left transition ' +
                  (selected
                    ? 'border-pink bg-pink-50'
                    : 'border-cream-200 bg-white/60 hover:border-pink')
                }
              >
                <p className="text-sm leading-relaxed text-ink">
                  <span className="mr-2 rounded-md bg-sage-50 px-2 py-0.5 text-xs font-bold text-sage-600">
                    ({b.label})
                  </span>
                  {selected && (
                    <span className="mr-2 rounded-full bg-ink/60 px-2 py-0.5 text-xs font-bold text-white">
                      제거함
                    </span>
                  )}
                  <span className="text-ink-muted">{b.text}</span>
                </p>
              </button>
            </li>
          )
        })}
      </ul>

      {anchorBlock && (
        <button
          type="button"
          onClick={handleGrade}
          disabled={value.eliminated.length === 0}
          className="rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          채점하기
        </button>
      )}

      {graded !== 'none' && (
        <p
          className={
            'text-sm font-medium ' +
            (graded === 'accept' ? 'text-sage-600' : 'text-ink-muted')
          }
        >
          {graded === 'accept'
            ? '맞아요 — 그 단락이 가리키는 대상이 주어진 글에 없죠. 바로 다음엔 못 와요 👍'
            : '그건 올 수 있어요. 다시 볼까요?'}
        </p>
      )}

      {value.eliminated.length >= 1 && (
        <ReasonButtons
          question="왜 그 문단이 바로 다음에 못 온다고 봤어요?"
          options={reasonOptions}
          picked={value.reasonPick}
          verdict={reasonVerdict}
          onPick={(id) => {
            onChange({ ...value, reasonPick: id })
            onGrade?.(id, gradeReason ? gradeReason(id) : 'neutral')
          }}
        />
      )}
    </div>
  )
}
