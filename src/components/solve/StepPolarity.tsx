import { useMemo, useState } from 'react'
import { gradeMark } from '../../lib/solve/gradePolarity'
import type { PolarityGrade } from '../../lib/solve/gradePolarity'
import type { GradingRubric } from '../../lib/useProblem'
import type {
  Polarity,
  PolarityState,
  SentenceMark,
  StepVerdict,
} from './types'

const OPTIONS: { mark: Polarity; label: string }[] = [
  { mark: '+', label: '같은편 (+)' },
  { mark: '-', label: '반대 (−)' },
  { mark: '?', label: '모름 (?)' },
]

function markClasses(active: boolean, mark: Polarity): string {
  if (!active) return 'border-cream-200 bg-white/60 text-ink-muted hover:border-pink'
  switch (mark) {
    case '+':
      return 'border-sage bg-sage-50 text-sage-600'
    case '-':
      return 'border-pink bg-pink-50 text-pink-600'
    default:
      return 'border-ink-muted/40 bg-cream-100 text-ink'
  }
}

/** Per-sentence soft feedback. accept/reject/skip render; unmarked/none render nothing. */
function VerdictLine({ grade }: { grade: PolarityGrade }) {
  if (grade === 'accept') {
    return (
      <p className="mt-2 text-xs font-medium text-sage-600">✓ 방향 일치</p>
    )
  }
  if (grade === 'reject') {
    return (
      <p className="mt-2 text-xs font-medium text-pink-600">
        이 문장 다시 볼까요?
      </p>
    )
  }
  if (grade === 'skip') {
    return (
      <p className="mt-2 text-xs text-ink-muted">
        모름으로 표시 — 정직해서 좋아요
      </p>
    )
  }
  return null
}

interface Props {
  value: PolarityState
  rubric: GradingRubric | null
  onChange: (next: PolarityState) => void
  /** Fires on each 채점하기 action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

export default function StepPolarity({
  value,
  rubric,
  onChange,
  onGrade,
}: Props) {
  const [checked, setChecked] = useState(false)
  const markedCount = value.sentences.filter((s) => s.mark !== null).length

  // Alignment guard: rubric.polarity is aligned to rubric.sentences (the
  // generation-time segmentation). We can only trust index-for-index grading
  // when that array has the SAME length as our own segmentation. Otherwise the
  // indices don't correspond and grading is skipped gracefully.
  const aligned =
    !!rubric?.polarity &&
    rubric.polarity.length === value.sentences.length

  const grades = useMemo<PolarityGrade[]>(
    () =>
      value.sentences.map((s) =>
        gradeMark(s.mark, aligned ? rubric!.polarity[s.index] : undefined),
      ),
    [value.sentences, aligned, rubric],
  )

  const matchCount = grades.filter((g) => g === 'accept').length

  // 채점하기: reveal verdicts AND emit a stuck signal. Verdict = reject if any
  // aligned sentence is wrong, else accepted. value = the marks the student set.
  function handleGrade() {
    setChecked(true)
    const marks = value.sentences.map((s) => s.mark ?? '_').join(',')
    const verdict: StepVerdict = grades.some((g) => g === 'reject')
      ? 'reject'
      : 'accepted'
    onGrade?.(marks, verdict)
  }

  function setMark(index: number, mark: Polarity) {
    const sentences: SentenceMark[] = value.sentences.map((s) =>
      s.index === index ? { ...s, mark: s.mark === mark ? null : mark } : s,
    )
    // Editing marks invalidates the revealed verdicts.
    if (checked) setChecked(false)
    onChange({ sentences })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          각 문장이 주제(빈칸 방향)와 <b className="text-sage-600">같은편(+)</b>인지{' '}
          <b className="text-pink-600">반대(−)</b>인지, 아니면{' '}
          <b>모름(?)</b>인지 표시하세요.
        </p>
        <span className="shrink-0 rounded-full bg-cream-100 px-3 py-1 text-xs font-semibold text-ink">
          {markedCount}/2 문장 표시됨
        </span>
      </div>

      <ul className="space-y-3">
        {value.sentences.map((s) => (
          <li
            key={s.index}
            className="rounded-2xl border border-cream-200 bg-white/60 p-4"
          >
            <p className="text-sm leading-relaxed text-ink">
              <span className="mr-2 font-semibold text-ink-muted">
                {s.index + 1}.
              </span>
              {s.text}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.mark}
                  type="button"
                  onClick={() => setMark(s.index, opt.mark)}
                  className={
                    'rounded-full border px-3 py-1 text-xs font-semibold transition ' +
                    markClasses(s.mark === opt.mark, opt.mark)
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {checked && aligned && <VerdictLine grade={grades[s.index]} />}
          </li>
        ))}
      </ul>

      {markedCount < 2 && (
        <p className="text-xs text-ink-muted">
          최소 2개 문장을 표시하면 다음으로 넘어갈 수 있어요.
        </p>
      )}

      {/* 채점 넛지 — rubric이 정렬돼 있을 때만. 절대 진행을 막지 않는다. */}
      {aligned && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleGrade}
            disabled={markedCount < 2}
            className="rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            채점하기
          </button>
          {checked && (
            <p className="text-sm font-medium text-ink">
              {value.sentences.length}문장 중 {matchCount}개 방향 일치
            </p>
          )}
        </div>
      )}
    </div>
  )
}
