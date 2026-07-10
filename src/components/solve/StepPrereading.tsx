import { useState } from 'react'
import { BLANK_RE } from '../../lib/solve/passage'
import { matchTopicRule } from '../../lib/solve/gradeTopic'
import type { TopicGrade } from '../../lib/solve/gradeTopic'
import { supabase } from '../../lib/supabase'
import type { GradingRubric } from '../../lib/useProblem'
import type { IntroType, PrereadingState, StepVerdict } from './types'

/** Maps the 소재 nudge grade to a stuck-detection verdict (accept / reject_* / neutral). */
function topicVerdict(g: TopicGrade | 'none'): StepVerdict {
  if (g === 'accept') return 'accepted'
  if (g === 'ambiguous' || g === 'none') return 'neutral'
  return 'reject' // reject_too_narrow | reject_too_broad | reject_wrong
}

const INTRO_TYPES: IntroType[] = ['통념', '주장', '배경지식']

const INTRO_HINTS: Record<IntroType, string> = {
  통념: '흔히들 그렇게 여기지만… (뒤집힐 가능성)',
  주장: '글쓴이가 처음부터 밀고 가는 입장',
  배경지식: '사실·정보로 판을 까는 도입',
}

// 소재 채점 결과를 톤별 피드백 문구/색으로 매핑. 모두 넛지일 뿐 진행을 막지 않는다.
const TOPIC_FEEDBACK: Record<
  TopicGrade,
  { text: string; className: string }
> = {
  accept: {
    text: '좋아요, 방향을 잘 잡았어요.',
    className: 'text-sage-600',
  },
  reject_too_narrow: {
    text: '방향은 맞는데 조금 좁혀졌어요. 일단 넘어가요.',
    className: 'text-sage-600',
  },
  reject_too_broad: {
    text: '조금 더 구체적으로 볼까요? 첫 문장에서 뭘 얘기해요?',
    className: 'text-ink',
  },
  reject_wrong: {
    text: '첫 문장부터 다시 볼까요?',
    className: 'text-pink-600',
  },
  ambiguous: {
    text: '음, 소재를 조금 더 분명히 해볼까요?',
    className: 'text-ink-muted',
  },
}

/** Renders a sentence with its underscore-run blank shown as a styled slot. */
function BlankSentence({ sentence }: { sentence: string }) {
  const parts = sentence.split(BLANK_RE)
  return (
    <p className="text-lg leading-relaxed text-ink">
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <span className="mx-1 inline-block rounded-md bg-pink-50 px-3 py-0.5 align-middle text-sm font-bold tracking-widest text-pink-600">
              ____
            </span>
          )}
        </span>
      ))}
    </p>
  )
}

interface Props {
  value: PrereadingState
  rubric: GradingRubric | null
  passage: string
  onChange: (next: PrereadingState) => void
  /** Fires on each 소재 확인 grading action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

export default function StepPrereading({
  value,
  rubric,
  passage,
  onChange,
  onGrade,
}: Props) {
  const [checking, setChecking] = useState(false)

  const graded = value.topicGrade?.graded ?? null
  const feedback =
    graded && graded !== 'none' ? TOPIC_FEEDBACK[graded] : null

  async function runTopicCheck() {
    if (!rubric) return
    const word = value.topicWord.trim()
    if (!word) return

    // 1) 규칙 매처 우선 (0 토큰).
    const ruled = matchTopicRule(word, rubric.topic)
    if (ruled.graded !== 'ambiguous') {
      onChange({
        ...value,
        topicGrade: {
          rawInput: word,
          graded: ruled.graded,
          grader: 'rule',
          matchedAgainst: ruled.matched_against,
        },
      })
      onGrade?.(word, topicVerdict(ruled.graded))
      return
    }

    // 2) 애매하면 LLM 폴백 한 번.
    setChecking(true)
    try {
      const { data, error } = await supabase.functions.invoke('grade-topic', {
        body: { word, topic: rubric.topic, passage },
      })
      if (error || !data) {
        onChange({
          ...value,
          topicGrade: {
            rawInput: word,
            graded: 'ambiguous',
            grader: 'none',
            matchedAgainst: null,
          },
        })
        onGrade?.(word, topicVerdict('ambiguous'))
      } else {
        const llmGraded = (data.graded as TopicGrade) ?? 'ambiguous'
        onChange({
          ...value,
          topicGrade: {
            rawInput: word,
            graded: llmGraded,
            grader: 'llm',
            matchedAgainst: null,
          },
        })
        onGrade?.(word, topicVerdict(llmGraded))
      }
    } catch {
      onChange({
        ...value,
        topicGrade: {
          rawInput: word,
          graded: 'ambiguous',
          grader: 'none',
          matchedAgainst: null,
        },
      })
      onGrade?.(word, topicVerdict('ambiguous'))
    } finally {
      setChecking(false)
    }
  }

  const introMatch =
    rubric && value.introType ? value.introType === rubric.intro_type : null

  return (
    <div className="space-y-6">
      {/* (c) Blank sentence first — direction setting */}
      <section className="rounded-2xl border border-cream-200 bg-white/60 p-5">
        <h3 className="text-sm font-semibold text-ink">
          빈칸 문장 먼저 보기 · 방향 잡기
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          지문을 다 읽기 전에 빈칸이 든 문장부터 봅니다. 이 문장이 어느 방향을
          요구하는지 감을 잡아 두세요.
        </p>
        <div className="mt-4">
          <BlankSentence sentence={value.blankSentence} />
        </div>
      </section>

      {/* (a) 소재 한 단어 — NUDGE, never gates */}
      <section>
        <label className="text-sm font-semibold text-ink">
          소재 한 단어{' '}
          <span className="font-normal text-ink-muted">
            (이 글이 무엇에 관한 글인가요? 채점하지 않는 넛지입니다)
          </span>
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={value.topicWord}
            onChange={(e) => {
              // 입력이 바뀌면 이전 채점 피드백을 지운다.
              onChange({
                ...value,
                topicWord: e.target.value,
                topicGrade: null,
              })
            }}
            placeholder="예: 도덕, 사회자본, 리더십…"
            className="flex-1 rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
          {rubric && (
            <button
              type="button"
              onClick={() => void runTopicCheck()}
              disabled={!value.topicWord.trim() || checking}
              className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              확인
            </button>
          )}
        </div>
        {/* 채점 중: rule 매칭은 즉시라 checking 은 LLM 폴백(~10초)일 때만 true.
            멈춘 화면처럼 보이지 않게 스피너+안내 문구를 띄운다. */}
        {checking ? (
          <p className="mt-2 flex items-center gap-2 text-sm font-medium text-sage-600">
            <span
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-sage-600/30 border-t-sage-600"
              aria-hidden
            />
            선생님이 판단 중이에요…
          </p>
        ) : (
          feedback && (
            <p className={'mt-2 text-sm font-medium ' + feedback.className}>
              {feedback.text}
            </p>
          )
        )}
      </section>

      {/* (b) 서론 유형 — gates */}
      <section>
        <p className="text-sm font-semibold text-ink">
          서론 유형 <span className="font-normal text-ink-muted">(하나 선택)</span>
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {INTRO_TYPES.map((it) => {
            const active = value.introType === it
            return (
              <button
                key={it}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    introType: it,
                    // 통념이 아니면 후속 동의 태그를 초기화.
                    agreeTag: it === '통념' ? value.agreeTag : null,
                  })
                }
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
                  {it}
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-ink-muted">
                  {INTRO_HINTS[it]}
                </span>
              </button>
            )
          })}
        </div>

        {/* 소프트 체크: 골랐을 때만 가볍게. 절대 막지 않는다. */}
        {introMatch !== null && (
          <p
            className={
              'mt-2 text-xs ' +
              (introMatch ? 'text-sage-600' : 'text-ink-muted')
            }
          >
            {introMatch
              ? '서론 유형을 잘 봤어요.'
              : '한 번 더 볼까요? 첫 문장이 통념인지 주장인지 배경 설명인지.'}
          </p>
        )}

        {/* 통념 조건부: 글쓴이도 동의하는가 (연구용 태그, 정오답 처리 없음) */}
        {value.introType === '통념' && (
          <div className="mt-3 rounded-xl border border-cream-200 bg-white/60 p-3">
            <p className="text-xs font-semibold text-ink">
              이 통념에 글쓴이도 동의하나요?
            </p>
            <div className="mt-2 flex gap-2">
              {(['agree', 'disagree'] as const).map((tag) => {
                const active = value.agreeTag === tag
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onChange({ ...value, agreeTag: tag })}
                    className={
                      'rounded-full border px-4 py-1.5 text-xs font-semibold transition ' +
                      (active
                        ? 'border-pink bg-pink-50 text-pink-600'
                        : 'border-cream-200 bg-white text-ink hover:border-pink')
                    }
                  >
                    {tag === 'agree' ? '동의' : '동의 안 함'}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
