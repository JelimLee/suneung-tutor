import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { StepVerdict, ThemeGrade } from './types'

const NUMERALS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

/** Highlights whitespace-delimited words that hit one of `tokens` (mirrors the
 * Phase-1 소재 UI). Only the STUDENT's overlapping words are ever shown. */
function Highlighted({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length || !text) return <>{text}</>
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((part, i) => {
        const norm = part.toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
        const hit =
          norm.length >= 2 &&
          tokens.some((t) => norm.includes(t) || t.includes(norm))
        return hit ? (
          <mark
            key={i}
            className="rounded bg-sage-50 px-0.5 font-semibold text-sage-600"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
    </>
  )
}

interface Phase4Value {
  pick: { slot: number | null }
  outcome: 'correct' | 'wrong' | null
  reasoning: { input: string; graded: ThemeGrade; matched: string[] }
}

interface Props {
  /** 6 segments for 5 slots (only used for slot count here). */
  segments: string[]
  /** The student's Phase-3 per-slot calls; '어색함' slots are carried forward as
   * eliminated (grayed + disabled + 소거함). */
  slotJudgment: Record<number, '자연스러움' | '어색함'>
  answer: number | null // 1-based correct slot (== problem.answer)
  explanation: string | null
  problemId: string
  value: Phase4Value
  onChange: (next: Phase4Value) => void
  /** Fires exactly once when the learner commits a slot. */
  onComplete: (finalState: Phase4Value) => void
  /** Lenient reasoning grader over the FULL rubric (reasoning_keywords). */
  gradeReasoning: (input: string) => { graded: ThemeGrade; matched: string[] }
  /** Fires on the commit (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/**
 * 삽입 Phase 4 — 답 확정 + 자기 언어 정리. "그럼 어디에 넣어야 해요?" The student
 * COMMITS one of the surviving (non-eliminated) slots, then justifies it.
 * Self-driving like StepOrderChoice.
 *
 * - CORRECT (pick === answer): TERMINAL. Process-level confirmation (never a bare
 *   "정답"), then a reflective one-line fill-in graded leniently (never blocks),
 *   then the explanation + a chat link.
 * - WRONG (pick !== answer): a task-level nudge (NO "아쉬워요"/self-level copy),
 *   and the frame enables Next to advance into Phase 5 (오답 회복). The wrong pick
 *   is stored in state so Phase 5 can reference it. The answer is NEVER revealed.
 */
export default function StepInsertConfirm({
  segments,
  slotJudgment,
  answer,
  explanation,
  problemId,
  value,
  onChange,
  onComplete,
  gradeReasoning,
  onGrade,
}: Props) {
  const slotCount = Math.max(0, segments.length - 1)
  const slots = Array.from({ length: slotCount }, (_, i) => i + 1)
  const eliminated = (k: number) => slotJudgment[k] === '어색함'

  const [picked, setPicked] = useState<number | null>(value.pick.slot)
  const completedRef = useRef(false)
  // Local fill-in state (mirrors StepInsertTopic's "check → reveal" pattern).
  const [reasonChecked, setReasonChecked] = useState(
    value.reasoning.matched.length > 0 || value.reasoning.graded !== 'none',
  )

  function commit() {
    if (picked === null || eliminated(picked)) return
    const outcome: 'correct' | 'wrong' =
      answer !== null && picked === answer ? 'correct' : 'wrong'
    const finalState: Phase4Value = {
      ...value,
      pick: { slot: picked },
      outcome,
    }
    onChange(finalState)
    onGrade?.(String(picked), outcome === 'correct' ? 'accepted' : 'reject')
    if (!completedRef.current) {
      completedRef.current = true
      onComplete(finalState)
    }
  }

  function runReasonCheck() {
    const { graded, matched } = gradeReasoning(value.reasoning.input)
    onChange({ ...value, reasoning: { ...value.reasoning, graded, matched } })
    setReasonChecked(true)
  }

  const committed = value.outcome !== null

  // ── Pre-commit: candidate slot picker ──────────────────────────────────────
  if (!committed) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink">
            그럼 어디에 넣어야 해요?
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            남긴 자리 중 하나를 골라 답을 확정하세요. 뺀 자리(소거함)는 고를 수
            없어요.
          </p>
        </div>

        <ul className="space-y-2">
          {slots.map((k) => {
            const out = eliminated(k)
            const isPicked = picked === k
            return (
              <li key={k}>
                <button
                  type="button"
                  disabled={out}
                  onClick={() => setPicked(k)}
                  className={
                    'flex w-full items-center gap-3 rounded-2xl border p-3 text-left text-sm transition ' +
                    (out
                      ? 'cursor-not-allowed border-cream-200 bg-cream-100/60 opacity-60'
                      : isPicked
                        ? 'border-pink bg-pink-50 text-ink'
                        : 'border-cream-200 bg-white/60 text-ink hover:border-pink')
                  }
                >
                  <span
                    className={
                      'inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold ' +
                      (isPicked && !out
                        ? 'bg-pink text-white'
                        : 'bg-sage-50 text-sage-600')
                    }
                  >
                    {NUMERALS[k - 1]}
                  </span>
                  <span className="font-semibold">이 자리에 넣기</span>
                  {out && (
                    <span className="ml-auto rounded-full bg-ink/60 px-2 py-0.5 text-xs font-bold text-white">
                      소거함
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        <button
          type="button"
          onClick={commit}
          disabled={picked === null || eliminated(picked ?? -1)}
          className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          이 자리로 확정하기 →
        </button>
      </div>
    )
  }

  const selected = value.pick.slot as number

  // ── Post-commit: WRONG branch — task-level nudge, advance to Phase 5 ─────────
  if (value.outcome === 'wrong') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-cream-200 bg-cream-100/70 p-4">
          <p className="text-sm font-semibold text-ink">
            {NUMERALS[selected - 1]} 자리를 골랐어요.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            이 자리가 정말 맞을지, 앞뒤 연결을 다시 살펴봐요. 다음 단계에서 각
            자리의 뒤 문장을 함께 짚어볼게요.
          </p>
        </div>
        <p className="text-xs text-ink-muted">
          아래 “다음” 버튼으로 이어가세요.
        </p>
      </div>
    )
  }

  // ── Post-commit: CORRECT branch — TERMINAL ──────────────────────────────────
  const g = value.reasoning.graded
  return (
    <div className="space-y-5">
      {/* Process-level confirmation (frames the reasoning move, not a bare 정답). */}
      <div className="rounded-2xl border border-sage bg-sage-50 p-4">
        <p className="text-sm font-bold text-sage-600">
          앞의 연결 신호에 맞춰 정확한 자리에 넣었어요.
        </p>
        <p className="mt-2 text-sm text-ink">
          확정한 자리: <b>{NUMERALS[selected - 1]}</b>
        </p>
      </div>

      {/* 자기 언어 정리 — reflective fill-in, never blocks. */}
      <div>
        <label className="text-sm font-semibold text-ink">
          왜 그 자리인지 한 줄로 정리해봐요{' '}
          <span className="font-normal text-ink-muted">
            (내 말로 근거 한 문장)
          </span>
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={value.reasoning.input}
            onChange={(e) => {
              onChange({
                ...value,
                reasoning: { ...value.reasoning, input: e.target.value },
              })
              if (reasonChecked) setReasonChecked(false)
            }}
            placeholder="예: 앞에서 설명한 내용과 대조되는 신호가 있어서 그 뒤에 들어가요"
            className="flex-1 rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
          <button
            type="button"
            onClick={runReasonCheck}
            disabled={!value.reasoning.input.trim()}
            className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            정리
          </button>
        </div>

        {reasonChecked && (
          <div className="mt-4 space-y-3">
            {g === 'accept' && (
              <p className="text-sm font-medium text-sage-600">
                근거의 핵심을 잘 짚었어요.
              </p>
            )}
            {g === 'partial' && (
              <p className="text-sm font-medium text-ink-muted">
                내 말로 잘 정리했어요. 연결 신호를 한 단어만 더 넣어볼까요?
              </p>
            )}
            {g === 'reject' && (
              <p className="text-sm font-medium text-ink-muted">
                떠오르는 대로 적어도 좋아요. 앞뒤 문장의 연결을 떠올려볼까요?
              </p>
            )}
            {g === 'none' && (
              <p className="text-sm font-medium text-ink-muted">
                적었으면 충분해요.
              </p>
            )}

            {value.reasoning.matched.length > 0 && (
              <>
                <p className="text-sm font-semibold text-sage-600">
                  겹치는 핵심어 {value.reasoning.matched.length}개
                </p>
                <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
                  <p className="text-xs font-semibold text-ink-muted">
                    내가 쓴 근거
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink">
                    <Highlighted
                      text={value.reasoning.input}
                      tokens={value.reasoning.matched}
                    />
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Result banner + explanation. */}
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
        <span className="text-xs text-ink-muted">
          풀이 기록이 저장되었습니다.
        </span>
      </div>
    </div>
  )
}
