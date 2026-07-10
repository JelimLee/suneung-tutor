import type { VocabUnderlineLite } from '../../lib/solve/vocab'
import type { StepVerdict, VocabDiagnoseState } from './types'

interface Props {
  underlines: VocabUnderlineLite[]
  value: VocabDiagnoseState
  onChange: (next: VocabDiagnoseState) => void
  /** Frame-supplied conflict grader (uses FULL rubric; truth stays out). */
  gradeConflict: (num: number, pick: '맞음' | '충돌') => StepVerdict
  /** Frame-supplied negation grader (uses FULL rubric; truth stays out). */
  gradeNeg: (num: number, pick: '있음' | '없음') => StepVerdict
  /** Fires on each grading action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/** Shared accept/reject micro nudge — never reveals the correct value. */
function MicroFeedback({ verdict }: { verdict?: StepVerdict }) {
  if (verdict === 'accepted') {
    return <p className="mt-2 text-sm font-medium text-sage-600">잘 봤어요 ✓</p>
  }
  if (verdict === 'reject') {
    return <p className="mt-2 text-sm font-medium text-pink-600">다시 볼까요?</p>
  }
  return null
}

/**
 * 어휘 진단 — 밑줄마다 글 방향과 맞는지 충돌하는지 먼저 판단하고(Q1), 충돌이라고
 * 본 낱말에 한해서만 "왜 충돌하는지"(부정어 유무, Q2)를 후속으로 묻는다. 대부분은
 * 맞고 딱 하나가 충돌한다. 낱말만 보지 말고 문장 전체를 읽게 강조한다. 채점은
 * 프레임 그레이더로 소프트하게만: 정답값·is_correct은 절대 노출하지 않고 넛지만.
 */
export default function StepVocabDiagnose({
  underlines,
  value,
  onChange,
  gradeConflict,
  gradeNeg,
  onGrade,
}: Props) {
  function setConflict(num: number, pick: '맞음' | '충돌') {
    const verdict = gradeConflict(num, pick)
    const next: VocabDiagnoseState = {
      ...value,
      conflict: { ...value.conflict, [num]: pick },
      conflictGraded: { ...value.conflictGraded, [num]: verdict },
    }
    // Switching away from 충돌 clears any lingering negation answer so a stale
    // pick doesn't count toward completion (canProceed reads negation[num] != null).
    if (pick === '맞음') {
      const restNeg = { ...value.negation }
      const restNegGraded = { ...value.negGraded }
      delete restNeg[num]
      delete restNegGraded[num]
      next.negation = restNeg
      next.negGraded = restNegGraded
    }
    onChange(next)
    onGrade?.(`${num}:conflict:${pick}`, verdict)
  }

  function setNegation(num: number, pick: '있음' | '없음') {
    const verdict = gradeNeg(num, pick)
    onChange({
      ...value,
      negation: { ...value.negation, [num]: pick },
      negGraded: { ...value.negGraded, [num]: verdict },
    })
    onGrade?.(`${num}:neg:${pick}`, verdict)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-ink">
          글 방향과 <span className="text-pink-600">충돌하는 낱말 하나</span>를
          찾는 거예요
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          대부분은 맞고 딱 하나가 충돌해요. 낱말만 보지 말고 문장 전체를 읽으세요.
        </p>
      </div>

      {underlines.length === 0 && (
        <p className="text-sm text-ink-muted">
          밑줄 정보를 불러오지 못했어요. 위 지문을 직접 보고 판단해 주세요.
        </p>
      )}

      <ul className="space-y-3">
        {underlines.map((u) => {
          const conflict = value.conflict[u.num] ?? null
          const neg = value.negation[u.num] ?? null
          return (
            <li
              key={u.num}
              className="rounded-2xl border border-cream-200 bg-white/60 p-4"
            >
              <p className="text-sm text-ink">
                <span className="mr-2 rounded-md bg-sage-50 px-2 py-0.5 text-xs font-bold text-sage-600">
                  {u.num}
                </span>
                <span className="font-semibold text-ink">{u.word}</span>
              </p>

              <div className="mt-3">
                <p className="text-sm font-semibold text-ink">
                  이 밑줄 낱말이 글 방향과 맞아요, 충돌해요?
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['맞음', '충돌'] as const).map((opt) => {
                    const active = conflict === opt
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setConflict(u.num, opt)}
                        className={
                          'rounded-full border px-4 py-1.5 text-sm transition ' +
                          (active
                            ? 'border-pink bg-pink text-white'
                            : 'border-cream-200 bg-white/70 text-ink hover:border-pink')
                        }
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
                {conflict != null && (
                  <MicroFeedback verdict={value.conflictGraded[u.num]} />
                )}
              </div>

              {conflict === '충돌' && (
                <div className="mt-3">
                  <p className="text-sm font-semibold text-ink">
                    왜 충돌하죠? 이 문장에 부정어(not·never·hardly 등)가 있어요?
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    부정어가 있으면 방향이 뒤집힌 거예요. 없으면 그냥 반대 방향
                    낱말이죠.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['있음', '없음'] as const).map((opt) => {
                      const active = neg === opt
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setNegation(u.num, opt)}
                          className={
                            'rounded-full border px-4 py-1.5 text-sm transition ' +
                            (active
                              ? 'border-pink bg-pink text-white'
                              : 'border-cream-200 bg-white/70 text-ink hover:border-pink')
                          }
                        >
                          {opt}
                        </button>
                      )
                    })}
                  </div>
                  {neg != null && <MicroFeedback verdict={value.negGraded[u.num]} />}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
