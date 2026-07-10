import { useState } from 'react'
import type { OmitIntroPick, StepVerdict, ThemeGrade } from './types'

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

interface TopicValue {
  input: string
  graded: ThemeGrade
  matched: string[]
}
interface IntroValue {
  pick: OmitIntroPick | null
  graded: StepVerdict
}

interface Props {
  /** The intro sentences ONLY (markers stripped) — never the numbered sentences. */
  intro: string
  topic: TopicValue
  onTopicChange: (next: TopicValue) => void
  /** Async grader (rule → grade-topic Edge fallback), supplied by the wizard so
   * the rubric's topic buckets stay in the frame closure, never in these props. */
  gradeTopic: (input: string) => Promise<{ graded: ThemeGrade; matched: string[] }>
  introPick: IntroValue
  onIntroChange: (next: IntroValue) => void
  gradeIntro: (pick: OmitIntroPick) => StepVerdict
  /** Fires on each grading action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

// 서론 유형 pill labels → schema intro_type. 무관은 삽입 거울상: [통념반박][주장][배경지식].
const INTRO_CHOICES: { pick: OmitIntroPick; label: string; hint: string }[] = [
  { pick: '통념반박', label: '통념+반박', hint: '통념을 세우고 곧장 뒤집기' },
  { pick: '주장', label: '주장', hint: '글쓴이가 처음부터 미는 입장' },
  { pick: '배경지식', label: '배경지식', hint: '사실·정보로 판을 까는 도입' },
]

/**
 * 무관 Phase 1 — 사전 독해. Shows ONLY the intro sentences, then asks (Q1) what the
 * passage is about (free-text; the async `gradeTopic` closure runs the 0-token
 * client rule and, only when ambiguous, the grade-topic Edge fallback like 빈칸)
 * and (Q2) how the passage opens (buttons, soft-graded). The rubric never enters
 * this component; nothing gates advancing. Feedback praises the reasoning move on
 * accept and stays task-level on reject — never self-level.
 */
export default function StepOmitTopic({
  intro,
  topic,
  onTopicChange,
  gradeTopic,
  introPick,
  onIntroChange,
  gradeIntro,
  onGrade,
}: Props) {
  const [checked, setChecked] = useState(
    topic.matched.length > 0 || topic.graded !== 'none',
  )
  const [checking, setChecking] = useState(false)

  async function runTopicCheck() {
    setChecking(true)
    try {
      const { graded, matched } = await gradeTopic(topic.input)
      onTopicChange({ input: topic.input, graded, matched })
      setChecked(true)
      const verdict: StepVerdict =
        graded === 'accept'
          ? 'accepted'
          : graded === 'none'
            ? 'neutral'
            : 'reject'
      onGrade?.(topic.input, verdict)
    } finally {
      setChecking(false)
    }
  }

  function pickIntro(pick: OmitIntroPick) {
    const graded = gradeIntro(pick)
    onIntroChange({ pick, graded })
    onGrade?.(`서론 ${pick}`, graded)
  }

  return (
    <div className="space-y-6">
      {/* 서론만 노출 (번호 문장 아님) */}
      <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
        <p className="text-xs font-semibold text-ink-muted">지문 도입부</p>
        <p className="mt-1 text-sm leading-relaxed text-ink">
          {intro || '(도입부를 불러오지 못했어요)'}
        </p>
      </div>

      {/* Q1 — 소재 */}
      <div>
        <label className="text-sm font-semibold text-ink">
          이 지문은 뭘 다루고 있어요?{' '}
          <span className="font-normal text-ink-muted">
            (도입부만 읽고 한 줄로)
          </span>
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={topic.input}
            onChange={(e) => {
              onTopicChange({ ...topic, input: e.target.value })
              if (checked) setChecked(false)
            }}
            placeholder="예: 실패가 학습에 도움이 되는 방식"
            className="flex-1 rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
          <button
            type="button"
            onClick={() => void runTopicCheck()}
            disabled={!topic.input.trim() || checking}
            className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            대조
          </button>
        </div>

        {checking ? (
          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-sage-600">
            <span
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-sage-600/30 border-t-sage-600"
              aria-hidden
            />
            선생님이 판단 중이에요…
          </p>
        ) : (
          checked && (
            <div className="mt-4 space-y-3">
              {topic.graded === 'accept' && (
                <p className="text-sm font-medium text-sage-600">
                  글이 무엇을 다루는지 정확히 짚었어요.
                </p>
              )}
              {topic.graded === 'partial' && (
                <p className="text-sm font-medium text-ink-muted">
                  방향은 비슷해요. 조금 더 구체적으로 적어볼까요?
                </p>
              )}
              {topic.graded === 'reject' && (
                <p className="text-sm font-medium text-pink-600">
                  도입부를 다시 읽어볼까요?
                </p>
              )}
              {topic.graded === 'none' && (
                <p className="text-sm font-medium text-ink-muted">
                  적었으면 다음으로 넘어가도 돼요.
                </p>
              )}

              {topic.graded !== 'none' && (
                <>
                  <p className="text-sm font-semibold text-sage-600">
                    겹치는 핵심어 {topic.matched.length}개
                    {topic.matched.length > 0 && (
                      <span className="ml-2 font-normal text-ink-muted">
                        {topic.matched.join(', ')}
                      </span>
                    )}
                  </p>
                  <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
                    <p className="text-xs font-semibold text-ink-muted">
                      내가 쓴 소재
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-ink">
                      <Highlighted text={topic.input} tokens={topic.matched} />
                    </p>
                  </div>
                </>
              )}
            </div>
          )
        )}
      </div>

      {/* Q2 — 서론 유형 */}
      <div>
        <label className="text-sm font-semibold text-ink">
          이 지문의 시작 유형은?
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {INTRO_CHOICES.map((c) => {
            const active = introPick.pick === c.pick
            return (
              <button
                key={c.pick}
                type="button"
                onClick={() => pickIntro(c.pick)}
                className={
                  'rounded-xl border px-3 py-3 text-left transition ' +
                  (active
                    ? 'border-pink bg-pink-50'
                    : 'border-cream-200 bg-white/60 hover:border-pink')
                }
              >
                <span
                  className={
                    'block text-sm font-semibold ' +
                    (active ? 'text-pink-600' : 'text-ink')
                  }
                >
                  {c.label}
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-ink-muted">
                  {c.hint}
                </span>
              </button>
            )
          })}
        </div>
        {introPick.pick !== null && (
          <p className="mt-3 text-sm font-medium text-ink-muted">
            {introPick.graded === 'accepted'
              ? '도입 방식을 정확히 봤어요.'
              : introPick.graded === 'reject'
                ? '도입 방식을 다시 볼까요?'
                : '골랐어요. 다음으로 넘어가도 돼요.'}
          </p>
        )}
      </div>
    </div>
  )
}
