import { useRef, useState } from 'react'
import RecoveryLoop from './RecoveryLoop'
import type {
  ChoiceState,
  ElimReason,
  RecoveryLogPayload,
  RecoveryPriorJudgment,
  RecoveryQuestion,
  RecoveryReselect,
  StepVerdict,
} from './types'

type Phase = 'eliminate' | 'compare' | 'evidence' | 'result'

const ELIM_REASONS: ElimReason[] = ['소재다름', '방향반대', '본문없음']

interface Props {
  choices: string[]
  answer: number | null // 1-based
  explanation: string | null
  value: ChoiceState
  onChange: (next: ChoiceState) => void
  /** Fired exactly once when the learner commits a final choice. */
  onComplete: (finalState: ChoiceState) => void
  /** Fires on the final-answer commit (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
  // ── 오답 회복(RecoveryLoop) wiring — ALL built in BlankWizard from the FULL
  // rubric; this component reads NO rubric and only passes these through. ──
  /** 원칙4 diagnostic questions (relation axis), pre-bound to the wrong pick. */
  recoveryQuestions: RecoveryQuestion[]
  /** The single re-selection UI + its frame-closure grader. */
  reselect: RecoveryReselect
  /** 원칙2 mirror — the student's OWN prior 선지 처리 judgment. */
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

export default function StepChoiceProcess({
  choices,
  answer,
  explanation,
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
  const [phase, setPhase] = useState<Phase>('eliminate')
  const completedRef = useRef(false)

  const total = choices.length
  const targetElim = Math.max(0, total - 2)
  const eliminatedIdx = Object.keys(value.eliminations).map(Number)
  const eliminatedCount = eliminatedIdx.length
  // 1-based indices of the survivors (not eliminated).
  const remaining = choices
    .map((_, i) => i + 1)
    .filter((n) => !(n in value.eliminations))

  // --- eliminate phase helpers ---
  function toggleElim(idx: number, reason: ElimReason) {
    const next = { ...value.eliminations }
    if (next[idx] === reason) delete next[idx]
    else next[idx] = reason
    onChange({ ...value, eliminations: next })
  }

  // --- compare phase helpers ---
  function setNote(idx: number, note: '유력' | '보류') {
    const next = { ...value.comparedNote }
    if (next[idx] === note) delete next[idx]
    else next[idx] = note
    onChange({ ...value, comparedNote: next })
  }

  function commitFinal(idx: number) {
    const finalState: ChoiceState = { ...value, finalChoice: idx }
    onChange(finalState)
    const verdict: StepVerdict =
      answer !== null && idx === answer ? 'accepted' : 'reject'
    onGrade?.(String(idx), verdict)
    if (!completedRef.current) {
      completedRef.current = true
      onComplete(finalState)
    }
  }

  const canLeaveEliminate = eliminatedCount === targetElim
  const bothNoted = remaining.every((n) => value.comparedNote[n])
  const canLeaveCompare = remaining.length === 2 && bothNoted
  const canLeaveEvidence = value.evidence.trim().length > 0

  return (
    <div className="space-y-5">
      {/* Sub-phase progress */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(['eliminate', 'compare', 'evidence', 'result'] as Phase[]).map(
          (p, i) => {
            const labels = ['3제거', '2비교', '근거', '결과']
            const order: Phase[] = ['eliminate', 'compare', 'evidence', 'result']
            const active = phase === p
            const done = order.indexOf(phase) > i
            return (
              <span
                key={p}
                className={
                  'rounded-full px-3 py-1 font-semibold ' +
                  (active
                    ? 'bg-pink text-white'
                    : done
                      ? 'bg-sage-50 text-sage-600'
                      : 'bg-cream-100 text-ink-muted')
                }
              >
                {i + 1}. {labels[i]}
              </span>
            )
          },
        )}
      </div>

      {/* ELIMINATE */}
      {phase === 'eliminate' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            확실히 아닌 선지 <b className="text-ink">{targetElim}개</b>를 이유와
            함께 제거하세요. ({eliminatedCount}/{targetElim})
          </p>
          <ul className="space-y-2">
            {choices.map((choice, i) => {
              const idx = i + 1
              const elimReason = value.eliminations[idx]
              const isElim = idx in value.eliminations
              const lockOut = !isElim && eliminatedCount >= targetElim
              return (
                <li
                  key={idx}
                  className={
                    'rounded-2xl border p-3 transition ' +
                    (isElim
                      ? 'border-cream-200 bg-cream-100 opacity-70'
                      : 'border-cream-200 bg-white/60')
                  }
                >
                  <p className="text-sm text-ink">
                    <span className="mr-2 font-semibold text-ink-muted">
                      {idx}
                    </span>
                    <span className={isElim ? 'line-through' : ''}>
                      {choice}
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ELIM_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        disabled={lockOut}
                        onClick={() => toggleElim(idx, r)}
                        className={
                          'rounded-full border px-2.5 py-1 text-xs font-semibold transition ' +
                          (elimReason === r
                            ? 'border-pink bg-pink-50 text-pink-600'
                            : 'border-cream-200 bg-white text-ink-muted hover:border-pink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-cream-200')
                        }
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canLeaveEliminate}
              onClick={() => setPhase('compare')}
              className="rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              2비교로 →
            </button>
          </div>
        </div>
      )}

      {/* COMPARE */}
      {phase === 'compare' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            남은 두 선지를 <b className="text-sage-600">유력</b> /{' '}
            <b className="text-ink">보류</b>로 표시하세요.
          </p>
          <ul className="space-y-2">
            {remaining.map((idx) => (
              <li
                key={idx}
                className="rounded-2xl border border-cream-200 bg-white/60 p-3"
              >
                <p className="text-sm text-ink">
                  <span className="mr-2 font-semibold text-ink-muted">
                    {idx}
                  </span>
                  {choices[idx - 1]}
                </p>
                <div className="mt-2 flex gap-1.5">
                  {(['유력', '보류'] as const).map((note) => (
                    <button
                      key={note}
                      type="button"
                      onClick={() => setNote(idx, note)}
                      className={
                        'rounded-full border px-3 py-1 text-xs font-semibold transition ' +
                        (value.comparedNote[idx] === note
                          ? note === '유력'
                            ? 'border-sage bg-sage-50 text-sage-600'
                            : 'border-ink-muted/40 bg-cream-100 text-ink'
                          : 'border-cream-200 bg-white text-ink-muted hover:border-pink')
                      }
                    >
                      {note}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setPhase('eliminate')}
              className="rounded-full px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink"
            >
              ← 3제거
            </button>
            <button
              type="button"
              disabled={!canLeaveCompare}
              onClick={() => setPhase('evidence')}
              className="rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              근거 쓰기 →
            </button>
          </div>
        </div>
      )}

      {/* EVIDENCE */}
      {phase === 'evidence' && (
        <div className="space-y-3">
          <label className="text-sm font-semibold text-ink">
            근거 한 줄{' '}
            <span className="font-normal text-ink-muted">
              (왜 그 선지인지 본문 근거로 한 문장)
            </span>
          </label>
          <input
            type="text"
            value={value.evidence}
            onChange={(e) => onChange({ ...value, evidence: e.target.value })}
            placeholder="예: 상황에 따라 다르게 적용한다는 문장이 방향과 일치"
            className="w-full rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setPhase('compare')}
              className="rounded-full px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink"
            >
              ← 2비교
            </button>
            <button
              type="button"
              disabled={!canLeaveEvidence}
              onClick={() => setPhase('result')}
              className="rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              결과 보기 →
            </button>
          </div>
        </div>
      )}

      {/* RESULT */}
      {phase === 'result' && (
        <div className="space-y-4">
          {value.finalChoice === null ? (
            <>
              <p className="text-sm text-ink-muted">
                최종 답을 고르세요.
              </p>
              <ul className="space-y-2">
                {remaining.map((idx) => (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() => commitFinal(idx)}
                      className="w-full rounded-2xl border border-cream-200 bg-white/60 p-3 text-left text-sm text-ink transition hover:border-pink"
                    >
                      <span className="mr-2 font-semibold text-ink-muted">
                        {idx}
                      </span>
                      {choices[idx - 1]}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setPhase('evidence')}
                className="rounded-full px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink"
              >
                ← 근거
              </button>
            </>
          ) : (
            (() => {
              const selected = value.finalChoice
              const known = answer !== null
              const correct = known && selected === answer

              // WRONG commit → self-driving 오답 회복 loop. NO answer reveal: this
              // component reads no rubric; every verdict arrives via injected frame
              // closures, and RecoveryLoop renders only process-level copy.
              // onChatHandoff is a no-op — persistence already flows through `log`
              // (goHandoff calls it), so firing it again here would double-log.
              if (known && !correct) {
                return (
                  <RecoveryLoop
                    studentPriorJudgment={studentPriorJudgment}
                    initialAnswer={`${selected}번`}
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

              // CORRECT commit (or no answer info) → success banner + 해설.
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
            })()
          )}
        </div>
      )}
    </div>
  )
}
