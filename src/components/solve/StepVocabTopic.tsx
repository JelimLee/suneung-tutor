import { useState } from 'react'
import type { StepVerdict, ThemeGrade } from './types'

/** Highlights whitespace-delimited words that hit one of `tokens`. */
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

interface Props {
  value: { input: string; graded: ThemeGrade; matched: string[] }
  onChange: (next: { input: string; graded: ThemeGrade; matched: string[] }) => void
  grade: (input: string) => { graded: ThemeGrade; matched: string[] }
  /** Fires on each 대조 action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/**
 * 소재 파악 — the FIRST 어휘 step. Before hunting the ± sign, the student writes
 * in one line what the passage is about. Soft-graded via a `grade` closure (the
 * rubric never enters this component); nothing gates advancing.
 */
export default function StepVocabTopic({
  value,
  onChange,
  grade,
  onGrade,
}: Props) {
  const [checked, setChecked] = useState(value.matched.length > 0)

  function runCheck() {
    const { graded, matched } = grade(value.input)
    onChange({ input: value.input, graded, matched })
    setChecked(true)
    const verdict: StepVerdict =
      graded === 'accept'
        ? 'accepted'
        : graded === 'none'
          ? 'neutral'
          : 'reject'
    onGrade?.(value.input, verdict)
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="text-sm font-semibold text-ink">
          이 글, 무슨 내용이에요?
        </label>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          부호를 잡기 전에, 이 글이 무엇에 대한 글인지 한 줄로 적어보세요 (첫
          문장~1번 밑줄 전까지 읽고).
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={value.input}
            onChange={(e) => {
              onChange({ ...value, input: e.target.value })
              if (checked) setChecked(false)
            }}
            placeholder="예: 기술 발전이 노동의 의미를 어떻게 바꾸는가"
            className="flex-1 rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
          <button
            type="button"
            onClick={runCheck}
            disabled={!value.input.trim()}
            className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            대조
          </button>
        </div>
      </div>

      {checked && (
        <div className="space-y-4">
          {value.graded === 'accept' && (
            <p className="text-sm font-medium text-sage-600">
              소재를 잘 잡았어요 👍
            </p>
          )}
          {value.graded === 'partial' && (
            <p className="text-sm font-medium text-ink-muted">
              방향은 비슷해요. 조금 더 구체적으로?
            </p>
          )}
          {value.graded === 'reject' && (
            <p className="text-sm font-medium text-pink-600">다시 읽어볼까요?</p>
          )}
          {value.graded === 'none' && (
            <p className="text-sm font-medium text-ink-muted">
              적었으면 다음으로 넘어가도 돼요.
            </p>
          )}

          {value.graded !== 'none' && (
            <>
              <p className="text-sm font-semibold text-sage-600">
                겹치는 핵심어 {value.matched.length}개
                {value.matched.length > 0 && (
                  <span className="ml-2 font-normal text-ink-muted">
                    {value.matched.join(', ')}
                  </span>
                )}
              </p>

              <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
                <p className="text-xs font-semibold text-ink-muted">
                  내가 쓴 소재
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
  )
}
