import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { StepVerdict, ThemeGrade } from './types'

/** Highlights whitespace-delimited words that hit one of `tokens` — only the
 * STUDENT's overlapping words are ever shown. */
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

interface ReasonValue {
  input: string
  graded: ThemeGrade
  matched: string[]
}

interface Props {
  selected: number // the confirmed irrelevant sentence (== answer)
  explanation: string | null
  problemId: string
  value: ReasonValue
  onChange: (next: ReasonValue) => void
  /** Lenient reason grader over the FULL rubric (why_unrelated). Never blocks. */
  gradeReason: (input: string) => { graded: ThemeGrade; matched: string[] }
  /** Fires on the check (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
  /** Wizard-supplied logger for the omit_explain attempt. */
  logExplain: (payload: unknown) => void
}

/**
 * 무관 Phase 4 — 왜 무관인지 자기설명. A generative one-liner: "왜 이 문장이 무관한지".
 * MUST be a fill-in (textarea), never buttons — the "왜 버튼 못 씀" principle: the
 * mechanism has to come from the student, not a menu. gradeOmitReason is Tier-3
 * lenient (never blocks). When the attempt is too weak ("딴 얘기" level) we surface
 * the 튜터챗 link to push toward the mechanism. Terminal (+ 해설 + chat). raw_input
 * is logged.
 */
export default function StepOmitExplain({
  selected,
  explanation,
  problemId,
  value,
  onChange,
  gradeReason,
  onGrade,
  logExplain,
}: Props) {
  const enterRef = useRef(Date.now())
  const [checked, setChecked] = useState(
    value.matched.length > 0 || value.graded !== 'none',
  )

  function runCheck() {
    const { graded, matched } = gradeReason(value.input)
    onChange({ ...value, graded, matched })
    setChecked(true)
    const verdict: StepVerdict =
      graded === 'accept' ? 'accepted' : graded === 'none' ? 'neutral' : 'reject'
    onGrade?.(value.input, verdict)
    logExplain({
      raw_input: value.input,
      graded,
      grader: 'tier3',
      matched_against: 'why_unrelated',
      matched,
      input_mode: 'fill_in',
      selected,
      time_to_answer_ms: Date.now() - enterRef.current,
    })
  }

  const g = value.graded
  // "딴 얘기" 수준(약함)이면 튜터챗으로 메커니즘을 밀어준다.
  const weak = checked && (g === 'partial' || g === 'reject')

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-sage bg-sage-50 p-4">
        <p className="text-sm font-bold text-sage-600">
          무관한 문장: <b>({selected})</b>
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          이제 왜 이 문장이 소재에서 겉도는지, 내 말로 한 줄 정리해봐요.
        </p>
      </div>

      {/* 자기설명 — MUST be fill-in, never buttons. */}
      <div>
        <label className="text-sm font-semibold text-ink">
          왜 이 문장이 무관한가요?{' '}
          <span className="font-normal text-ink-muted">(내 말로 한 문장)</span>
        </label>
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            rows={3}
            value={value.input}
            onChange={(e) => {
              onChange({ ...value, input: e.target.value })
              if (checked) setChecked(false)
            }}
            placeholder="예: 다른 문장들은 실패의 학습 효과를 말하는데, 이 문장만 실패를 피하는 방법을 얘기해서 주제와 어긋나요"
            className="w-full resize-none rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
          <button
            type="button"
            onClick={runCheck}
            disabled={!value.input.trim()}
            className="self-start rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            정리
          </button>
        </div>

        {checked && (
          <div className="mt-4 space-y-3">
            {g === 'accept' && (
              <p className="text-sm font-medium text-sage-600">
                무관한 이유의 핵심을 잘 짚었어요.
              </p>
            )}
            {g === 'partial' && (
              <p className="text-sm font-medium text-ink-muted">
                내 말로 잘 적었어요. 다른 문장들과 ‘무엇이’ 달라서 겉도는지 한
                단어만 더 붙여볼까요?
              </p>
            )}
            {g === 'reject' && (
              <p className="text-sm font-medium text-ink-muted">
                떠오르는 대로 적어도 좋아요. 이 문장이 소재의 어느 지점에서
                벗어나는지 떠올려볼까요?
              </p>
            )}
            {g === 'none' && (
              <p className="text-sm font-medium text-ink-muted">
                적었으면 충분해요.
              </p>
            )}

            {value.matched.length > 0 && (
              <>
                <p className="text-sm font-semibold text-sage-600">
                  겹치는 핵심어 {value.matched.length}개
                </p>
                <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
                  <p className="text-xs font-semibold text-ink-muted">
                    내가 쓴 설명
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink">
                    <Highlighted text={value.input} tokens={value.matched} />
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 약한 설명이면 튜터챗으로 메커니즘 밀어주기. */}
      {weak && (
        <div className="rounded-2xl border border-pink/40 bg-pink-50 p-4">
          <p className="text-sm leading-relaxed text-ink">
            이 문장이 왜 겉도는지 튜터와 한 번 더 말로 풀어보면 확실해져요.
          </p>
          <Link
            to={`/chat/${problemId}`}
            className="mt-3 inline-block rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
          >
            튜터와 이유 다듬기 →
          </Link>
        </div>
      )}

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
