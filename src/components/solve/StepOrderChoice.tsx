import { useRef, useState } from 'react'
import { parseCorrectOrder } from '../../lib/solve/order'
import RecoveryLoop from './RecoveryLoop'
import type {
  OrderChoiceState,
  OrderLabel,
  RecoveryLogPayload,
  RecoveryPriorJudgment,
  RecoveryQuestion,
  RecoveryReselect,
  StepVerdict,
} from './types'

interface Props {
  choices: string[]
  answer: number | null // 1-based
  explanation: string | null
  arrangeOrder: OrderLabel[]
  value: OrderChoiceState
  onChange: (next: OrderChoiceState) => void
  /** Fired exactly once when the learner commits the final choice. */
  onComplete: (finalState: OrderChoiceState) => void
  /** Fires on the final-answer commit (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
  // ── 오답 회복(RecoveryLoop) wiring — ALL built in OrderWizard from the FULL
  // rubric; this component reads NO rubric and only passes these through. ──
  /** 원칙4 diagnostic questions (signal axis), pre-bound to the wrong pick's first block. */
  recoveryQuestions: RecoveryQuestion[]
  /** The single re-selection UI + its frame-closure grader. */
  reselect: RecoveryReselect
  /** 원칙2 mirror — the student's OWN prior 순서 판단. */
  studentPriorJudgment: RecoveryPriorJudgment
  /** Fired on a correct reselect. No-op in the host — RecoveryLoop self-drives to
   * its own done screen and stays mounted; do NOT flip finalChoice (that would
   * swap in the first-try correct branch). retry_success logs via onRecoveryLog. */
  onRecoveryRetry: (pickNum: number) => void
  /** attempts.payload.recovery sink (persisted by the wizard). */
  onRecoveryLog: (payload: RecoveryLogPayload) => void
  /** Opaque snapshot for the chat handoff (never carries the answer/rubric). */
  handoffContext: unknown
  /** For RecoveryLoop's /chat/:id links. */
  problemId: string
}

/**
 * 순서 4단계(마지막) — 5개 선지 중 최종 답을 고르고 근거 한 줄. 배열 단계 결과와
 * 일치하는 선지를 제안으로 강조하되, 명시적 제출을 요구한다. 정답 commit → 성공
 * 배너 + 해설; 오답 commit → <RecoveryLoop>(정답 비노출, 프레임 클로저로만 채점).
 */
export default function StepOrderChoice({
  choices,
  answer,
  explanation,
  arrangeOrder,
  value,
  onChange,
  onComplete,
  onGrade,
  recoveryQuestions,
  reselect,
  studentPriorJudgment,
  onRecoveryRetry,
  onRecoveryLog,
  handoffContext,
  problemId,
}: Props) {
  const [picked, setPicked] = useState<number | null>(value.finalChoice)
  const completedRef = useRef(false)

  const arrangeStr = arrangeOrder.join('-')
  // 1-based index of the choice matching the student's arrangement (suggestion).
  const suggestedIdx =
    arrangeOrder.length > 0
      ? choices.findIndex((c) => parseCorrectOrder(c).join('-') === arrangeStr) +
        1
      : 0

  function commit() {
    if (picked === null) return
    const finalState: OrderChoiceState = { ...value, finalChoice: picked }
    onChange(finalState)
    const verdict: StepVerdict =
      answer !== null && picked === answer ? 'accepted' : 'reject'
    onGrade?.(String(picked), verdict)
    if (!completedRef.current) {
      completedRef.current = true
      onComplete(finalState)
    }
  }

  const committed = value.finalChoice !== null

  if (committed) {
    const selected = value.finalChoice as number
    const known = answer !== null
    const correct = known && selected === answer

    // WRONG commit → self-driving 오답 회복 loop. NO answer reveal (원칙3): the
    // component reads no rubric; every verdict arrives via injected frame
    // closures, and RecoveryLoop renders only process-level copy. onChatHandoff
    // is a no-op — persistence already flows through `log` (goHandoff calls it),
    // so firing it again here would double-log.
    if (known && !correct) {
      return (
        <RecoveryLoop
          studentPriorJudgment={studentPriorJudgment}
          initialAnswer={`${selected}. ${choices[selected - 1]}`}
          recoveryQuestions={recoveryQuestions}
          reselect={reselect}
          onRetry={(pickId) => onRecoveryRetry(Number(pickId))}
          onChatHandoff={() => {}}
          handoffContext={handoffContext}
          log={onRecoveryLog}
          problemId={problemId}
          explanation={explanation}
        />
      )
    }

    // CORRECT commit (or no answer info) → process-level success banner + 해설.
    return (
      <div className="space-y-4">
        <div
          className={
            'rounded-2xl border p-4 ' +
            (!known
              ? 'border-cream-200 bg-cream-100'
              : 'border-sage bg-sage-50')
          }
        >
          <p className="text-sm font-bold">
            {!known ? (
              <span className="text-ink">정답 정보 없음</span>
            ) : (
              <span className="text-sage-600">정답입니다 ✓</span>
            )}
          </p>
          <p className="mt-2 text-sm text-ink">
            내가 고른 답:{' '}
            <b>
              {selected}. {choices[selected - 1]}
            </b>
          </p>
          {value.evidence.trim() && (
            <p className="mt-2 text-xs text-ink-muted">
              내 근거: {value.evidence}
            </p>
          )}
        </div>

        {explanation && explanation.trim() && (
          <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
            <p className="text-xs font-semibold text-ink-muted">해설</p>
            <p className="mt-1 text-sm leading-relaxed text-ink">
              {explanation}
            </p>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          풀이 기록이 저장되었습니다. 더 궁금하면 튜터 챗으로 이어가세요.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">최종 답을 고르세요.</p>
      <ul className="space-y-2">
        {choices.map((choice, i) => {
          const idx = i + 1
          const isSuggested = idx === suggestedIdx
          const isPicked = idx === picked
          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => setPicked(idx)}
                className={
                  'w-full rounded-2xl border p-3 text-left text-sm transition ' +
                  (isPicked
                    ? 'border-pink bg-pink-50 text-ink'
                    : 'border-cream-200 bg-white/60 text-ink hover:border-pink')
                }
              >
                <span className="mr-2 font-semibold text-ink-muted">{idx}</span>
                {choice}
                {isSuggested && (
                  <span className="ml-2 rounded-full bg-sage-50 px-2 py-0.5 text-[11px] font-semibold text-sage-600">
                    내 배열과 일치
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <div>
        <label className="text-sm font-semibold text-ink">
          근거 한 줄{' '}
          <span className="font-normal text-ink-muted">
            (왜 그 순서인지 한 문장)
          </span>
        </label>
        <input
          type="text"
          value={value.evidence}
          onChange={(e) => onChange({ ...value, evidence: e.target.value })}
          placeholder="예: (C)가 CrossFit을 처음 소개하므로 주어진 글 다음에 온다"
          className="mt-2 w-full rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
        />
      </div>

      <button
        type="button"
        onClick={commit}
        disabled={picked === null}
        className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        제출하고 결과 보기 →
      </button>
    </div>
  )
}
