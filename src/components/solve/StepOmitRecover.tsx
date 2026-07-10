import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { reconnectPair } from '../../lib/solve/omit'
import type { OmitRunState } from './types'

type Phase5Value = OmitRunState['phase5']

interface Props {
  /** The 5 numbered sentence texts; index 0 == (1). */
  sentences: string[]
  /** == problem.answer (1-based irrelevant sentence). */
  answer: number
  /** The Phase-3 committed WRONG pick that opened recovery. */
  wrongPick: number
  /** trap_sentences[num] diagnosis or null (generic) — frame closure, no rubric. */
  diagnose: (num: number) => string | null
  explanation: string | null
  problemId: string
  value: Phase5Value
  onChange: (next: Phase5Value) => void
  /** Fires ONCE at a terminal state (handoff/done), for logging. */
  onComplete: (finalState: Phase5Value) => void
  /** Fires on each grading action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: 'accepted' | 'reject' | 'neutral') => void
}

const HANDOFF_AT = 1 // ★조건1 1-retry 하드캡: 첫 재선택 오답이면 바로 튜터 이관(재진단 루프 없음).

/**
 * 무관 Phase 5 — 오답 회복. A self-driving loop that DIAGNOSES the wrong pick then
 * REDIRECTS (never "틀렸어 다시"). The 삽입 recovery 거울상:
 *   diagnose      show trap_sentences diagnosis if the pick is a trap (통념/회피 등),
 *                 else a generic "이 문장은 소재에 기여해요" nudge.
 *   reselect      re-pick the irrelevant sentence (the SINGLE retry — ★조건1
 *                 1-retry 하드캡); correct → done, wrong → tutor handoff
 *                 (HANDOFF_AT=1, no re-diagnosis loop).
 *   handoff       hand the mechanism gap to the tutor (mirror StepInsertRecover).
 *   done          success terminal (reconnect pair computed in code + 해설 + chat).
 * The component reads NO rubric — diagnosis/answer arrive via closures/props.
 */
export default function StepOmitRecover({
  sentences,
  answer,
  wrongPick,
  diagnose,
  explanation,
  problemId,
  value,
  onChange,
  onComplete,
  onGrade,
}: Props) {
  const total = sentences.length || 5

  // Seed once on mount: adopt the Phase-3 wrong pick and go straight to diagnosis.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (value.currentWrong === null) {
      onChange({
        ...value,
        currentWrong: wrongPick,
        sub: 'diagnose',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fire onComplete exactly once at a terminal state.
  const completedRef = useRef(false)
  useEffect(() => {
    if (
      (value.sub === 'handoff' || value.sub === 'done') &&
      !completedRef.current
    ) {
      completedRef.current = true
      onComplete(value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.sub])

  // Local reselect state, reset each time we re-open a (new) wrong pick.
  const [pick, setPick] = useState<number | null>(null)
  useEffect(() => {
    setPick(null)
  }, [value.currentWrong])

  // Seeding in-flight → wait for the effect.
  if (value.currentWrong === null) {
    return <div className="h-24" aria-hidden />
  }
  const cw = value.currentWrong

  // ── diagnose — trap-aware diagnosis, then send to reselect ──────────────────
  if (value.sub === 'diagnose') {
    const trap = diagnose(cw)
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
          <p className="text-xs font-semibold text-ink-muted">
            내가 무관하다고 본 문장 ({cw})
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink">
            {sentences[cw - 1] ?? ''}
          </p>
        </div>
        <div className="rounded-2xl border border-pink/40 bg-pink-50 p-4">
          <p className="text-sm leading-relaxed text-ink">
            {trap ??
              '이 문장은 소재를 밀고 나가는 데 기여하고 있어요. 소재에서 정말 겉도는 문장이 어디인지 다시 볼까요?'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...value, sub: 'reselect' })}
          className="rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
        >
          다시 골라볼게요 →
        </button>
      </div>
    )
  }

  // ── reselect — re-pick the irrelevant sentence ─────────────────────────────
  if (value.sub === 'reselect') {
    function commit() {
      if (pick === null) return
      if (pick === answer) {
        onGrade?.(String(pick), 'accepted')
        onChange({ ...value, reselect: { pick }, sub: 'done' })
      } else {
        const nextRetry = value.retryCount + 1
        onGrade?.(String(pick), 'reject')
        onChange({
          ...value,
          retryCount: nextRetry,
          currentWrong: pick,
          reselect: { pick },
          sub: nextRetry >= HANDOFF_AT ? 'handoff' : 'diagnose',
        })
      }
    }
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink">
            소재에서 겉도는 문장은 어느 것일까요?
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            소재를 밀고 나가는 문장들 사이에서 딴 얘기를 하는 한 문장을 골라요.
          </p>
        </div>
        <ul className="space-y-2">
          {Array.from({ length: total }, (_, i) => i + 1).map((num) => {
            const isPicked = pick === num
            return (
              <li key={num}>
                <button
                  type="button"
                  onClick={() => setPick(num)}
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
          disabled={pick === null}
          className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          이 문장이 무관해요 →
        </button>
      </div>
    )
  }

  // ── handoff — hand the mechanism gap to the tutor ──────────────────────────
  if (value.sub === 'handoff') {
    return (
      <div className="space-y-4 rounded-2xl border border-cream-200 bg-white/60 p-6">
        <h2 className="text-lg font-bold text-ink">
          이 부분은 튜터랑 같이 볼까요?
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          어떤 문장이 소재를 밀고, 어떤 문장이 겉도는지 튜터와 한 번 더 맞춰보면
          무관한 문장이 또렷해질 거예요.
        </p>
        <Link
          to={`/chat/${problemId}`}
          className="inline-block rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
        >
          튜터에게 질문하기 →
        </Link>
      </div>
    )
  }

  // ── done — success terminal (reconnect pair computed in code) ──────────────
  const [lo, hi] = reconnectPair(answer, total)
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-sage bg-sage-50 p-4">
        <p className="text-sm font-bold text-sage-600">
          스스로 다시 짚어서 무관한 문장을 찾았어요.
        </p>
        <p className="mt-2 text-sm text-ink">
          무관한 문장: <b>({answer})</b>
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          ({answer})를 빼면 ({lo}) → ({hi})가 자연스럽게 이어져요.
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
          className="inline-block rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
        >
          튜터에게 질문하기 →
        </Link>
        <span className="text-xs text-ink-muted">풀이 기록이 저장되었습니다.</span>
      </div>
    </div>
  )
}
