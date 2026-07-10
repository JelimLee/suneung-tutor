import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  RecoveryLogPayload,
  RecoveryPriorJudgment,
  RecoveryQuestion,
  RecoveryReselect,
  RecoveryRunState,
  StepVerdict,
} from './types'

interface Props {
  /** 원칙2 — the student's OWN prior judgments, shown first in the mirror. */
  studentPriorJudgment: RecoveryPriorJudgment
  /** The student's initial WRONG answer that opened recovery (their own pick). */
  initialAnswer: string
  /** 원칙4 — the type's existing diagnostic axis (the ONLY per-type variation). */
  recoveryQuestions: RecoveryQuestion[]
  /** The single re-selection UI + its frame-closure grader. */
  reselect: RecoveryReselect
  /** Fired once when the student re-selects CORRECTLY (process-level success). */
  onRetry: (pick: string) => void
  /** Fired once when the loop hands to the tutor. Reason is logged, never shown. */
  onChatHandoff: (reason: string) => void
  /** Opaque snapshot handed to chat via router state on handoff/done. */
  handoffContext: unknown
  /** attempts.payload.recovery sink — the host persists this via logAttempt. */
  log: (recovery: RecoveryLogPayload) => void
  /** For the /chat/:id handoff + done links. */
  problemId: string
  /** 해설 — rendered ONLY on the process-success done screen (never the answer). */
  explanation?: string | null
}

/**
 * 통일 오답 회복 루프 (Recovery Loop). A generic, self-driving diagnostic that
 * re-opens the student's committed WRONG answer and walks their OWN reasoning
 * back down — it NEVER re-teaches. State machine (원칙3 하드캡):
 *
 *   mirror → q[0] → q[1] → … → reselect (ONCE) → (correct ? done : handoff)
 *
 * A question may early-jump to `reselect` (or straight to `handoff`) on a
 * decisive answer, but `reselect` is spent AT MOST ONCE and a wrong reselect
 * goes STRAIGHT to handoff — there is no third pass through the questions and no
 * transition back to 'question' after 'reselect' (see enforcement below).
 *
 * Anti-leak (원칙1): the component reads NO rubric. Every verdict arrives via a
 * `grade`/`isCorrect` frame closure. It renders no correct answer, no
 * why/anchor/trap prose, and no handoff_reason — a reject shows only a soft,
 * non-revealing nudge; the answer number/text is never surfaced. The ONLY
 * exception is the DONE screen (reached only after a CORRECT re-select), which
 * shows the passed-in `explanation` 해설 prose — never the answer itself.
 */
export default function RecoveryLoop({
  studentPriorJudgment,
  initialAnswer,
  recoveryQuestions,
  reselect,
  onRetry,
  onChatHandoff,
  handoffContext,
  log,
  problemId,
  explanation,
}: Props) {
  const [state, setState] = useState<RecoveryRunState>({
    phase: 'mirror',
    qIndex: 0,
    answers: {},
    retryUsed: false,
    reselectPick: null,
    outcome: null,
  })

  // Wall-clock entry time for the CURRENT step, powering per-step time_ms.
  const enteredAtRef = useRef<number>(Date.now())
  useEffect(() => {
    enteredAtRef.current = Date.now()
  }, [state.phase, state.qIndex])

  // Local UI state for the active question / reselect, reset on every move.
  const [text, setText] = useState('')
  const [pending, setPending] = useState<{
    raw: string
    verdict: StepVerdict
    time_ms: number
  } | null>(null)
  useEffect(() => {
    setText('')
    setPending(null)
  }, [state.phase, state.qIndex])

  const [pick, setPick] = useState<string | null>(null)
  useEffect(() => {
    setPick(null)
  }, [state.phase])

  // ── payload builder (attempts.payload.recovery) ────────────────────────────
  function buildPayload(
    s: RecoveryRunState,
    extra?: { handoff_reason?: string | null; retry_answer?: string | null },
  ): RecoveryLogPayload {
    const steps = recoveryQuestions
      .filter((q) => s.answers[q.id])
      .map((q) => ({ q_id: q.id, ...s.answers[q.id] }))
    return {
      triggered: true,
      initial_answer: initialAnswer,
      recovery_steps: steps,
      recovery_outcome: s.outcome ?? 'chat_handoff',
      // 데이터 자기설명: 학생이 튜터-이관(handoff) 화면에 도달했는지. TRUE인 경우 =
      // 재선택 오답(retry_fail) ∪ 질문 route→handoff(chat_handoff). recovery_outcome
      // 라벨을 합집합으로 재구성하지 않고 이 불린만 세면 handoff 도달 수가 나온다.
      reached_handoff: s.phase === 'handoff',
      handoff_reason: extra?.handoff_reason ?? null,
      retry_answer: extra?.retry_answer ?? s.reselectPick ?? null,
    }
  }

  // ── transitions ────────────────────────────────────────────────────────────
  type Answers = RecoveryRunState['answers']

  function withAnswer(
    q: RecoveryQuestion,
    raw: string,
    verdict: StepVerdict,
    time_ms: number,
  ): Answers {
    return {
      ...state.answers,
      [q.id]: { raw, graded: verdict, input_mode: q.mode, time_ms },
    }
  }

  // The ONLY entry into reselect. Guarded by retryUsed so the single reselect is
  // structurally un-repeatable. Never called with phase already past reselect.
  function goToReselect(answers: Answers) {
    if (state.retryUsed) return
    setState((s) => ({ ...s, answers, phase: 'reselect' }))
  }

  function goHandoff(
    answers: Answers,
    reason: string,
    outcome: RecoveryRunState['outcome'],
    retry_answer: string | null,
  ) {
    const next: RecoveryRunState = { ...state, answers, phase: 'handoff', outcome }
    setState(next)
    onChatHandoff(reason)
    log(buildPayload(next, { handoff_reason: reason, retry_answer }))
  }

  function answerCurrent(q: RecoveryQuestion, raw: string) {
    const verdict = q.grade(raw)
    const time_ms = Date.now() - enteredAtRef.current
    const route = q.route ? q.route(raw, verdict) : 'continue'
    if (route === 'reselect') {
      goToReselect(withAnswer(q, raw, verdict, time_ms))
      return
    }
    if (route === 'handoff') {
      const reason = q.handoffReason ? q.handoffReason(raw) : `question:${q.id}`
      goHandoff(withAnswer(q, raw, verdict, time_ms), reason, 'chat_handoff', null)
      return
    }
    // 'continue' — stage the answer + feedback; the student proceeds explicitly.
    setPending({ raw, verdict, time_ms })
  }

  function proceed() {
    if (!pending) return
    const q = recoveryQuestions[state.qIndex]
    if (!q) return
    const answers = withAnswer(q, pending.raw, pending.verdict, pending.time_ms)
    const isLast = state.qIndex >= recoveryQuestions.length - 1
    if (isLast) {
      goToReselect(answers)
    } else {
      // phase STAYS 'question' — advancing the index, never leaving reselect here.
      setState((s) => ({ ...s, answers, qIndex: s.qIndex + 1 }))
    }
  }

  function startQuestions() {
    if (recoveryQuestions.length === 0) {
      goToReselect(state.answers)
      return
    }
    setState((s) => ({ ...s, phase: 'question', qIndex: 0 }))
  }

  function commitReselect(pickId: string) {
    const correct = reselect.isCorrect(pickId)
    const next: RecoveryRunState = {
      ...state,
      retryUsed: true,
      reselectPick: pickId,
      phase: correct ? 'done' : 'handoff',
      outcome: correct ? 'retry_success' : 'retry_fail',
    }
    setState(next)
    if (correct) {
      onRetry(pickId)
      log(buildPayload(next, { retry_answer: pickId }))
    } else {
      // Wrong reselect → STRAIGHT to handoff. No return to recoveryQuestions.
      const reason = 'reselect_wrong'
      onChatHandoff(reason)
      log(buildPayload(next, { handoff_reason: reason, retry_answer: pickId }))
    }
  }

  // ── mirror (원칙2) ─────────────────────────────────────────────────────────
  if (state.phase === 'mirror') {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink">
            잠깐, 앞에서 네가 한 판단을 다시 볼까요?
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            정답을 알려주는 게 아니라, 네가 이미 내린 판단을 같이 되짚어볼게요.
          </p>
        </div>
        <div className="space-y-2 rounded-2xl border border-cream-200 bg-white/60 p-4">
          {studentPriorJudgment.map((j, i) => (
            <p key={i} className="text-sm leading-relaxed text-ink">
              <span className="font-semibold text-ink-muted">{j.label} </span>
              <span>{j.value}</span>
            </p>
          ))}
          <p className="text-sm leading-relaxed text-ink">
            <span className="font-semibold text-ink-muted">네가 고른 답 </span>
            <b className="text-pink-600">{initialAnswer}</b>
          </p>
        </div>
        <button
          type="button"
          onClick={startQuestions}
          className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
        >
          다시 짚어볼게요 →
        </button>
      </div>
    )
  }

  // ── question (원칙1: 진단, soft nudge on reject, never reveals) ─────────────
  if (state.phase === 'question') {
    const q = recoveryQuestions[state.qIndex]
    if (!q) return <div className="h-24" aria-hidden />
    const isLast = state.qIndex >= recoveryQuestions.length - 1
    const promptText = q.prompt(studentPriorJudgment)
    return (
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold text-ink-muted">
            되짚기 {state.qIndex + 1} / {recoveryQuestions.length}
          </p>
          <h2 className="mt-1 text-base font-bold text-ink">{promptText}</h2>
        </div>

        {q.mode === 'button' ? (
          <div className="flex flex-wrap gap-2">
            {(q.options ?? []).map((o) => {
              const active = pending?.raw === o.id
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => answerCurrent(q, o.id)}
                  className={
                    'rounded-full border px-5 py-2 text-sm font-semibold transition ' +
                    (active
                      ? 'border-pink bg-pink text-white'
                      : 'border-cream-200 bg-white text-ink hover:border-pink hover:bg-pink-50')
                  }
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="네 말로 한 줄 적어봐요"
              className="w-full resize-none rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
            />
            <button
              type="button"
              onClick={() => text.trim() && answerCurrent(q, text.trim())}
              disabled={!text.trim()}
              className="rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              확인
            </button>
          </div>
        )}

        {pending && (
          <div className="space-y-3">
            {pending.verdict === 'accepted' ? (
              <p className="text-sm font-medium text-sage-600">
                좋아요, 이 판단으로 이어가볼게요.
              </p>
            ) : (
              <p className="text-sm font-medium text-ink-muted">
                음, 이 부분 한 번 더 짚어볼까요? 앞뒤를 천천히 다시 보고 골라도
                좋아요.
              </p>
            )}
            <button
              type="button"
              onClick={proceed}
              className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
            >
              {isLast ? '다시 골라볼게요 →' : '다음 →'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── reselect (하드캡: 정확히 1회, 오답이면 바로 handoff) ─────────────────────
  if (state.phase === 'reselect') {
    const opts = reselect.options.filter(
      (o) => !reselect.excludeIds?.includes(o.id),
    )
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink">다시 한 번 골라볼까요?</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            방금 되짚은 걸 바탕으로 골라봐요. 이번 한 번은 스스로 확정하는
            자리예요.
          </p>
        </div>
        <ul className="space-y-2">
          {opts.map((o) => {
            const isPicked = pick === o.id
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setPick(o.id)}
                  className={
                    'flex w-full items-start gap-3 rounded-2xl border p-3 text-left text-sm transition ' +
                    (isPicked
                      ? 'border-pink bg-pink-50 text-ink'
                      : 'border-cream-200 bg-white/60 text-ink hover:border-pink')
                  }
                >
                  <span
                    className={
                      'mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-sm font-bold ' +
                      (isPicked
                        ? 'bg-pink text-white'
                        : 'bg-sage-50 text-sage-600')
                    }
                  >
                    {o.id}
                  </span>
                  <span className="leading-relaxed">{o.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          onClick={() => pick && commitReselect(pick)}
          disabled={pick === null}
          className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          이걸로 확정 →
        </button>
      </div>
    )
  }

  // ── handoff — hand the gap to the tutor (reason never rendered) ─────────────
  if (state.phase === 'handoff') {
    return (
      <div className="space-y-4 rounded-2xl border border-cream-200 bg-white/60 p-6">
        <h2 className="text-lg font-bold text-ink">
          이 부분은 튜터랑 같이 볼까요?
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          여기는 혼자 짚기보다 튜터와 한 번 더 맞춰보면 훨씬 또렷해질 거예요.
          방금 되짚은 내용을 그대로 가져가서 이어서 물어볼 수 있어요.
        </p>
        <Link
          to={`/chat/${problemId}`}
          state={{ wizardContext: handoffContext }}
          className="inline-block rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
        >
          튜터에게 질문하기 →
        </Link>
      </div>
    )
  }

  // ── done — process-level success, NO answer reveal ─────────────────────────
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-sage bg-sage-50 p-4">
        <p className="text-sm font-bold text-sage-600">
          스스로 다시 짚어서 답을 찾았어요.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink">
          방금 네가 판단을 되짚어 근거를 다시 세운 그 과정이 핵심이에요. 이렇게
          스스로 바로잡는 힘이 진짜 실력이 돼요.
        </p>
      </div>
      {explanation && explanation.trim() && (
        <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
          <p className="text-xs font-semibold text-ink-muted">해설</p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{explanation}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/chat/${problemId}`}
          state={{ wizardContext: handoffContext }}
          className="inline-block rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
        >
          튜터에게 더 물어보기 →
        </Link>
        <span className="text-xs text-ink-muted">풀이 기록이 저장되었습니다.</span>
      </div>
    </div>
  )
}
