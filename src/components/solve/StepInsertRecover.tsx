import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { InsertRunState, StepVerdict, ThemeGrade } from './types'

const NUMERALS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

/** Highlights whitespace-delimited words that hit one of `tokens` (mirrors the
 * Phase-1/4 소재 UI). Only the STUDENT's overlapping words are ever shown. */
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

type Phase5Value = InsertRunState['phase5']

interface Props {
  segments: string[]
  /** == problem.answer (1-based correct slot). */
  answer: number
  /** The Phase-4 committed wrong pick. */
  wrongSlot: number
  /** Slots the student marked 어색함 in Phase 3 (seeded as eliminated). */
  phase3Eliminated: number[]
  /** The insert sentence's cue text (content from the VISIBLE insert sentence). */
  anaphorExpression: string
  /** Option pills from anaphorChoices(anaphor_type); component reads no rubric. */
  anaphorOptions: { id: string; label: string }[]
  gradeSlot: (slot: number, pick: '자연스러움' | '어색함') => StepVerdict
  gradeAnaphor: (pickId: string) => StepVerdict
  gradeSignal: (slot: number, pick: '만족함' | '만족 안 함') => StepVerdict
  gradeReasoning: (input: string) => { graded: ThemeGrade; matched: string[] }
  /** s => frontSentence(segments, s). */
  frontOf: (slot: number) => string
  explanation: string | null
  problemId: string
  value: Phase5Value
  onChange: (next: Phase5Value) => void
  /** Fires ONCE at a terminal state (handoff/done), for logging. */
  onComplete: (finalState: Phase5Value) => void
  /** Fires on each grading action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/**
 * 삽입 Phase 5 — 오답 회복. A self-driving recovery loop that re-opens the student's
 * committed WRONG slot and rebuilds the reasoning bottom-up:
 *   5a  re-judge the wrong slot (mirror Phase 3),
 *   5b1 re-state what the insert sentence's signal needs before it (== Phase 2 Q2),
 *   5b2 read the slot's 앞 문장 verbatim and decide if it satisfies that signal,
 *       → '만족 안 함' (sees the gap) → 5c re-select; '만족함' → tutor handoff,
 *   5c  re-pick a non-eliminated slot (the SINGLE retry — ★조건1 1-retry 하드캡);
 *       correct → done, wrong → tutor handoff (no loop back to 5a re-diagnosis).
 * The component reads NO rubric — every judgement runs through a frame closure and
 * returns only a verdict. Copy is process-praise on accept / task-level on reject;
 * never self-level. The answer is never revealed until the student lands on it.
 */
export default function StepInsertRecover({
  segments,
  answer,
  wrongSlot,
  phase3Eliminated,
  anaphorExpression,
  anaphorOptions,
  gradeSlot,
  gradeAnaphor,
  gradeSignal,
  gradeReasoning,
  frontOf,
  explanation,
  problemId,
  value,
  onChange,
  onComplete,
  onGrade,
}: Props) {
  const slotCount = Math.max(0, segments.length - 1)
  const slots = Array.from({ length: slotCount }, (_, i) => i + 1)

  // Seed once on mount: adopt the Phase-4 wrong slot + Phase-3 eliminations.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (value.currentWrong === null) {
      onChange({
        ...value,
        currentWrong: wrongSlot,
        sub: '5a',
        eliminated: [...new Set(phase3Eliminated)],
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fire onComplete exactly once when a terminal state is reached.
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

  // 5c local selection, reset each time we re-open a (new) wrong slot.
  const [pick5c, setPick5c] = useState<number | null>(null)
  useEffect(() => {
    setPick5c(null)
  }, [value.currentWrong])

  // done: reflective fill-in check-then-reveal (mirrors StepInsertConfirm).
  const [reasonChecked, setReasonChecked] = useState(
    value.reasoning.matched.length > 0 || value.reasoning.graded !== 'none',
  )

  // Seeding in-flight → wait for the effect (avoids a flash of NUMERALS[-1]).
  if (value.currentWrong === null) {
    return <div className="h-24" aria-hidden />
  }
  const cw = value.currentWrong
  const N = NUMERALS[cw - 1]

  // ── 5a — re-judge the committed wrong slot ─────────────────────────────────
  if (value.sub === '5a') {
    function pick5a(pick: '자연스러움' | '어색함') {
      const graded = gradeSlot(cw, pick)
      onGrade?.(`5a ${pick}`, graded)
      const eliminated =
        pick === '어색함'
          ? [...new Set([...value.eliminated, cw])]
          : value.eliminated
      onChange({ ...value, rejudge: pick, eliminated, sub: '5b1' })
    }
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink">
            3단계에서 이 자리({N})를 ‘자연스럽다’고 봤어요. 다시 볼까요?
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            같은 눈으로 한 번 더 — 이 자리에 넣었을 때 앞뒤가 정말 매끄러운지
            판단해봐요.
          </p>
        </div>
        <div className="flex gap-2">
          {(['자연스러움', '어색함'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => pick5a(opt)}
              className="rounded-full border border-cream-200 bg-white px-5 py-2 text-sm font-semibold text-ink transition hover:border-pink hover:bg-pink-50"
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── 5b1 — restate the backward signal (== Phase 2 Q2) ──────────────────────
  if (value.sub === '5b1') {
    function pick5b1(id: string) {
      const opt = anaphorOptions.find((o) => o.id === id)
      const graded = gradeAnaphor(id)
      onGrade?.(`5b1 ${id}`, graded)
      onChange({
        ...value,
        anaphorPick: id,
        anaphorLabel: opt?.label ?? id,
        sub: '5b2',
      })
    }
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink">신호부터 다시 짚어봐요</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink">
            삽입 문장의 ‘
            <b className="text-pink-600">{anaphorExpression || '연결 신호'}</b>’은
            앞에 뭐가 있어야 성립해요?
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {anaphorOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => pick5b1(o.id)}
              className="rounded-full border border-cream-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-pink hover:bg-pink-50"
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── 5b2 — read the 앞 문장 and decide if it satisfies the signal ────────────
  if (value.sub === '5b2') {
    function pick5b2(pick: '만족함' | '만족 안 함') {
      const graded = gradeSignal(cw, pick)
      onGrade?.(`5b2 ${pick}`, graded)
      onChange({
        ...value,
        signalPick: pick,
        sub: pick === '만족 안 함' ? '5c' : 'handoff',
      })
    }
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
          <p className="text-xs font-semibold text-ink-muted">
            슬롯 {N}의 바로 앞 문장
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink">
            {frontOf(cw) || '(앞 문장을 찾지 못했어요)'}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">
            이 문장이 ‘{value.anaphorLabel ?? '앞이 요구하는 내용'}’을(를) 담고
            있나요?
          </p>
          <div className="mt-2 flex gap-2">
            {(['만족함', '만족 안 함'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => pick5b2(opt)}
                className="rounded-full border border-cream-200 bg-white px-5 py-2 text-sm font-semibold text-ink transition hover:border-pink hover:bg-pink-50"
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── 5c — re-select a surviving slot ────────────────────────────────────────
  if (value.sub === '5c') {
    const isBlocked = (k: number) =>
      value.eliminated.includes(k) || k === cw
    function commit5c() {
      if (pick5c === null || isBlocked(pick5c)) return
      if (pick5c === answer) {
        onGrade?.(`5c ${pick5c}`, 'accepted')
        onChange({ ...value, reselect: { slot: pick5c }, sub: 'done' })
      } else {
        onGrade?.(`5c ${pick5c}`, 'reject')
        // ★조건1 1-retry 하드캡: 5c는 단 한 번의 재선택. 오답이면 재진단 루프로
        // 돌아가지 않고 즉시 튜터 이관한다(통일 RecoveryLoop과 동일한 캡).
        onChange({
          ...value,
          retryCount: value.retryCount + 1,
          reselect: { slot: pick5c },
          sub: 'handoff',
        })
      }
    }
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink">
            다시 어디에 넣어야 할까요?
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            앞 문장이 신호를 채우지 못한 자리는 답이 아니에요. 뺀 자리(소거함)는
            고를 수 없어요.
          </p>
        </div>
        <ul className="space-y-2">
          {slots.map((k) => {
            const out = isBlocked(k)
            const isPicked = pick5c === k
            return (
              <li key={k}>
                <button
                  type="button"
                  disabled={out}
                  onClick={() => setPick5c(k)}
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
          onClick={commit5c}
          disabled={pick5c === null || isBlocked(pick5c ?? -1)}
          className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          이 자리로 다시 확정 →
        </button>
      </div>
    )
  }

  // ── handoff — hand the signal-understanding gap to the tutor ────────────────
  if (value.sub === 'handoff') {
    return (
      <div className="space-y-4 rounded-2xl border border-cream-200 bg-white/60 p-6">
        <h2 className="text-lg font-bold text-ink">
          이 부분은 튜터랑 같이 볼까요?
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          앞 문장이 신호를 채운다고 봤는데, 그 판단을 튜터와 한 번 더 맞춰보면
          정확한 자리가 또렷해질 거예요.
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

  // ── done — success terminal ────────────────────────────────────────────────
  function runReasonCheck() {
    const { graded, matched } = gradeReasoning(value.reasoning.input)
    onChange({
      ...value,
      reasoning: { ...value.reasoning, graded, matched },
    })
    setReasonChecked(true)
  }
  const confirmed = NUMERALS[answer - 1]
  const g = value.reasoning.graded
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-sage bg-sage-50 p-4">
        <p className="text-sm font-bold text-sage-600">
          스스로 신호를 다시 짚어서 정확한 자리를 찾았어요.
        </p>
        <p className="mt-2 text-sm text-ink">
          확정한 자리: <b>{confirmed}</b>
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
            placeholder="예: 앞 문장이 신호가 가리키는 내용을 담고 있어서 그 뒤에 들어가요"
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
