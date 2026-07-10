import { useRef, useState } from 'react'
import { reconnectPair } from '../../lib/solve/omit'
import StepOmitRecover from './StepOmitRecover'
import type { OmitRunState, StepVerdict } from './types'

interface Props {
  /** The 5 numbered sentence texts; index 0 == (1). */
  sentences: string[]
  answer: number | null // 1-based irrelevant sentence (== problem.answer)
  explanation: string | null
  problemId: string
  phase3: OmitRunState['phase3']
  onPhase3Change: (next: OmitRunState['phase3']) => void
  phase5: OmitRunState['phase5']
  onPhase5Change: (next: OmitRunState['phase5']) => void
  /** trap_sentences[num] diagnosis or null — frame closure, no rubric. */
  diagnose: (num: number) => string | null
  /** Fires on the commit (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
  /** Wizard-supplied logger for the omit_confirm attempt (keeps logAttempt out of
   * the component). Payload already carries time_to_answer_ms. */
  logConfirm: (payload: unknown) => void
  /** Wizard-supplied logger for the omit_recover attempt (wrong branch only). */
  logRecover: (payload: unknown) => void
}

/**
 * 무관 Phase 3 — 무관 확정 + 빼보기 검증. The student COMMITS the ONE irrelevant
 * sentence (discrete). The 삽입 답 확정의 거울상, but the reflective self-explanation
 * (Phase 4) is a SEPARATE step reached via the frame Next on a correct commit.
 *
 * - CORRECT (pick === answer): show the RECONNECT PAIR — computed in CODE from the
 *   answer ([answer-1]→[answer+1]), the hidden flow_without prose is never shown —
 *   ONLY after commit (blocked before). The frame then enables Next → Phase 4.
 * - WRONG (pick !== answer): render the Phase-5 recovery loop INLINE (StepOmitRecover):
 *   a diagnosis (trap-aware), never "아쉬워요"/"틀렸어 다시". canProceed stays false so
 *   the frame Next is disabled; the loop self-drives to done/handoff. The answer is
 *   never revealed until the student lands on it.
 */
export default function StepOmitConfirm({
  sentences,
  answer,
  explanation,
  problemId,
  phase3,
  onPhase3Change,
  phase5,
  onPhase5Change,
  diagnose,
  onGrade,
  logConfirm,
  logRecover,
}: Props) {
  const total = sentences.length || 5
  const [picked, setPicked] = useState<number | null>(phase3.confirm.pick)
  const enterRef = useRef(Date.now())
  const confirmLoggedRef = useRef(false)
  const recoverLoggedRef = useRef(false)

  function commit() {
    if (picked === null) return
    const outcome: 'correct' | 'wrong' =
      answer !== null && picked === answer ? 'correct' : 'wrong'
    onPhase3Change({ confirm: { pick: picked }, outcome })
    onGrade?.(String(picked), outcome === 'correct' ? 'accepted' : 'reject')
    if (!confirmLoggedRef.current) {
      confirmLoggedRef.current = true
      logConfirm({
        raw_input: String(picked),
        selected: picked,
        correct_answer: answer,
        is_correct: outcome === 'correct',
        graded: outcome,
        grader: 'tier1',
        matched_against: 'problem.answer',
        input_mode: 'button',
        time_to_answer_ms: Date.now() - enterRef.current,
      })
    }
  }

  const committed = phase3.outcome !== null

  // ── Pre-commit: sentence picker ────────────────────────────────────────────
  if (!committed) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink">
            글의 흐름과 무관한 문장은 어느 것일까요?
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            소재를 밀고 나가는 문장들 사이에서, 딴 얘기를 하는 한 문장을 골라
            확정하세요.
          </p>
        </div>
        <ul className="space-y-2">
          {Array.from({ length: total }, (_, i) => i + 1).map((num) => {
            const isPicked = picked === num
            return (
              <li key={num}>
                <button
                  type="button"
                  onClick={() => setPicked(num)}
                  className={
                    'flex w-full items-start gap-3 rounded-2xl border p-3 text-left text-sm transition ' +
                    (isPicked
                      ? 'border-pink bg-pink-50 text-ink'
                      : 'border-cream-200 bg-white/60 text-ink hover:border-pink')
                  }
                >
                  <span
                    className={
                      'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ' +
                      (isPicked ? 'bg-pink text-white' : 'bg-sage-50 text-sage-600')
                    }
                  >
                    ({num})
                  </span>
                  <span className="leading-relaxed">
                    {sentences[num - 1] ?? ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          onClick={commit}
          disabled={picked === null}
          className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          이 문장이 무관해요 →
        </button>
      </div>
    )
  }

  // ── Post-commit: WRONG branch — Phase-5 recovery loop (inline) ──────────────
  if (phase3.outcome === 'wrong') {
    return (
      <StepOmitRecover
        sentences={sentences}
        answer={answer as number}
        wrongPick={phase3.confirm.pick as number}
        diagnose={diagnose}
        explanation={explanation}
        problemId={problemId}
        value={phase5}
        onChange={onPhase5Change}
        onComplete={(fs) => {
          if (recoverLoggedRef.current) return
          recoverLoggedRef.current = true
          logRecover({
            raw_input: fs.reselect.pick != null ? String(fs.reselect.pick) : '',
            retry_count: fs.retryCount,
            retry_success: fs.sub === 'done',
            final_sub: fs.sub,
            handoff_reason:
              fs.sub === 'handoff' ? 'mechanism_understanding_gap' : undefined,
            graded: fs.sub === 'done' ? 'accepted' : 'handoff',
            grader: 'tier1',
            matched_against: 'problem.answer',
            input_mode: 'button',
            time_to_answer_ms: Date.now() - enterRef.current,
          })
        }}
        onGrade={onGrade}
      />
    )
  }

  // ── Post-commit: CORRECT branch — reconnect pair (computed) + advance cue ───
  const selected = phase3.confirm.pick as number
  const [lo, hi] = reconnectPair(selected, total)
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sage bg-sage-50 p-4">
        <p className="text-sm font-bold text-sage-600">
          소재에서 겉도는 문장을 정확히 짚었어요.
        </p>
        <p className="mt-2 text-sm text-ink">
          무관한 문장: <b>({selected})</b>
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          ({selected})를 빼면 ({lo}) → ({hi})가 자연스럽게 이어져요. 정말 그런지
          앞뒤를 눈으로 이어 읽어보세요.
        </p>
      </div>
      <p className="text-xs text-ink-muted">
        아래 “다음” 버튼을 눌러, 왜 이 문장이 무관한지 내 말로 정리해봐요.
      </p>
    </div>
  )
}
