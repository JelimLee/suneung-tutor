import { useState } from 'react'
import { computeOverlap, extractKeywords } from '../../lib/solve/theme'
import type { GradingRubric } from '../../lib/useProblem'
import type { StepVerdict, ThemeGrade, ThemeRecallState } from './types'

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
  value: ThemeRecallState
  rubric: GradingRubric | null
  explanation: string | null
  onChange: (next: ThemeRecallState) => void
  /** Fires on each 대조 action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

export default function StepThemeRecall({
  value,
  rubric,
  explanation,
  onChange,
  onGrade,
}: Props) {
  const [checked, setChecked] = useState(value.referenceKeywords.length > 0)

  // Soft threshold: pass when the student captured 2+ rubric keywords OR at
  // least half of their own theme tokens overlap. Pure nudge — never gates.
  const rubricKeywords = rubric?.theme_keywords ?? null

  function runCheck() {
    // Prefer the rubric's theme_keywords; fall back to explanation-derived
    // keywords when there is no rubric.
    const reference =
      rubricKeywords && rubricKeywords.length > 0
        ? rubricKeywords
        : extractKeywords(explanation ?? '')
    const themeTokens = extractKeywords(value.theme)
    const { overlap, ratio } = computeOverlap(themeTokens, reference)

    const matchedCount = overlap.length
    const graded: ThemeGrade = rubricKeywords
      ? matchedCount >= 2 || ratio >= 0.5
        ? 'accept'
        : matchedCount > 0
          ? 'partial'
          : 'reject'
      : 'none'

    onChange({
      ...value,
      referenceKeywords: reference,
      overlapKeywords: overlap,
      overlapRatio: ratio,
      matchedKeywords: overlap,
      graded,
    })
    setChecked(true)
    // accept → accepted; partial/reject → reject; none (no rubric) → neutral.
    const verdict: StepVerdict =
      graded === 'accept'
        ? 'accepted'
        : graded === 'none'
          ? 'neutral'
          : 'reject'
    onGrade?.(value.theme, verdict)
  }

  const hasExplanation = Boolean(explanation && explanation.trim())
  // Soft pass indicator, shown only when we graded against a rubric.
  const pass =
    rubricKeywords &&
    (value.overlapKeywords.length >= 2 || value.overlapRatio >= 0.5)

  return (
    <div className="space-y-5">
      <div>
        <label className="text-sm font-semibold text-ink">
          이 글의 주제를 한 줄로{' '}
          <span className="font-normal text-ink-muted">
            (지문을 다시 보지 말고 기억으로 적어보세요)
          </span>
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={value.theme}
            onChange={(e) => {
              onChange({ ...value, theme: e.target.value })
              if (checked) setChecked(false)
            }}
            placeholder="예: 사람은 상황에 따라 도덕 개념을 유연하게 적용한다"
            className="flex-1 rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
          <button
            type="button"
            onClick={runCheck}
            disabled={!value.theme.trim()}
            className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            대조
          </button>
        </div>
      </div>

      {checked && (
        <div className="space-y-4">
          {rubricKeywords && (
            <p
              className={
                'text-sm font-medium ' +
                (pass ? 'text-sage-600' : 'text-ink-muted')
              }
            >
              {pass
                ? '핵심어를 잘 담았어요 👍'
                : '핵심어를 조금 더 담아볼까요?'}
            </p>
          )}

          <p className="text-sm font-semibold text-sage-600">
            겹치는 핵심어 {value.overlapKeywords.length}개
            {value.overlapKeywords.length > 0 && (
              <span className="ml-2 font-normal text-ink-muted">
                {value.overlapKeywords.join(', ')}
              </span>
            )}
          </p>

          <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
            <p className="text-xs font-semibold text-ink-muted">내가 쓴 주제</p>
            <p className="mt-1 text-sm leading-relaxed text-ink">
              <Highlighted text={value.theme} tokens={value.overlapKeywords} />
            </p>
          </div>

          {hasExplanation ? (
            <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
              <p className="text-xs font-semibold text-ink-muted">
                모범 해설과 대조
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink">
                <Highlighted
                  text={explanation ?? ''}
                  tokens={value.overlapKeywords}
                />
              </p>
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              이 문제에는 대조할 해설이 없어요. 주제를 적었다면 다음으로 넘어가도
              됩니다.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
