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

interface TopicValue {
  input: string
  graded: ThemeGrade
  matched: string[]
}
interface ConceptValue {
  pick: number | null
  graded: StepVerdict
}
type IntroPick = '통념' | '주장' | '배경지식' | '통념반박'
interface IntroValue {
  pick: IntroPick | null
  graded: StepVerdict
}

interface Props {
  /** The intro sentences ONLY (markers stripped) — never the full passage. */
  intro: string
  topic: TopicValue
  onTopicChange: (next: TopicValue) => void
  gradeTopic: (input: string) => { graded: ThemeGrade; matched: string[] }
  conceptCount: ConceptValue
  onConceptChange: (next: ConceptValue) => void
  gradeConcept: (pick: number) => StepVerdict
  introPick: IntroValue
  onIntroChange: (next: IntroValue) => void
  gradeIntro: (pick: IntroPick) => StepVerdict
  /** Fires on each grading action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

const CONCEPT_CHOICES = [2, 3, 4]

// 도입 유형 pill labels → schema intro_type. '통념+반박' shows the compound label
// but stores '통념반박'. Hints borrow the 빈칸 서론 spirit (StepPrereading).
const INTRO_CHOICES: { pick: IntroPick; label: string; hint: string }[] = [
  { pick: '통념', label: '통념', hint: '흔히들 그렇게 여기지만…' },
  { pick: '주장', label: '주장', hint: '글쓴이가 처음부터 미는 입장' },
  { pick: '배경지식', label: '배경지식', hint: '사실·정보로 판을 까는 도입' },
  { pick: '통념반박', label: '통념+반박', hint: '통념을 세우고 곧장 뒤집기' },
]

/**
 * 삽입 Phase 1 — 소재 파악. Shows ONLY the intro sentences, then asks (Q1) what the
 * passage is about (free-text, soft-graded via the `gradeTopic` closure) and (Q2)
 * how many concepts appear (buttons, soft-graded via `gradeConcept`). The rubric
 * never enters this component; nothing gates advancing. Feedback praises the
 * reasoning move on accept and stays task-level on reject — never self-level.
 */
export default function StepInsertTopic({
  intro,
  topic,
  onTopicChange,
  gradeTopic,
  conceptCount,
  onConceptChange,
  gradeConcept,
  introPick,
  onIntroChange,
  gradeIntro,
  onGrade,
}: Props) {
  const [checked, setChecked] = useState(
    topic.matched.length > 0 || topic.graded !== 'none',
  )

  function runTopicCheck() {
    const { graded, matched } = gradeTopic(topic.input)
    onTopicChange({ input: topic.input, graded, matched })
    setChecked(true)
    const verdict: StepVerdict =
      graded === 'accept' ? 'accepted' : graded === 'none' ? 'neutral' : 'reject'
    onGrade?.(topic.input, verdict)
  }

  function pickConcept(n: number) {
    const graded = gradeConcept(n)
    onConceptChange({ pick: n, graded })
    onGrade?.(`개념 ${n}개`, graded)
  }

  function pickIntro(pick: IntroPick) {
    const graded = gradeIntro(pick)
    onIntroChange({ pick, graded })
    onGrade?.(`도입 ${pick}`, graded)
  }

  return (
    <div className="space-y-6">
      {/* 서론만 노출 (지문 전체 아님) */}
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
            placeholder="예: 도덕 판단이 상황에 따라 달라지는 방식"
            className="flex-1 rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
          <button
            type="button"
            onClick={runTopicCheck}
            disabled={!topic.input.trim()}
            className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            대조
          </button>
        </div>

        {checked && (
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
        )}
      </div>

      {/* Q2 — 개념 수 */}
      <div>
        <label className="text-sm font-semibold text-ink">
          이 지문에 몇 개의 개념이 등장해요?
        </label>
        <div className="mt-2 flex gap-2">
          {CONCEPT_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => pickConcept(n)}
              className={
                'h-10 w-12 rounded-xl border text-sm font-bold transition ' +
                (conceptCount.pick === n
                  ? 'border-pink bg-pink text-white'
                  : 'border-cream-200 bg-white text-ink hover:border-pink/50')
              }
            >
              {n}
            </button>
          ))}
        </div>
        {conceptCount.pick !== null && (
          <p className="mt-3 text-sm font-medium text-ink-muted">
            {conceptCount.graded === 'accepted'
              ? '대비되는 개념의 수를 잘 셌어요.'
              : conceptCount.graded === 'reject'
                ? '도입부에서 맞서는 개념이 몇 개인지 다시 볼까요?'
                : '개념 수를 골랐어요. 다음으로 넘어가도 돼요.'}
          </p>
        )}
      </div>

      {/* Q3 — 도입 유형 */}
      <div>
        <label className="text-sm font-semibold text-ink">
          이 지문의 시작 유형은?
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
