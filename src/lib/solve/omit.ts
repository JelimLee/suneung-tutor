// Pure utilities for the 무관(irrelevant-sentence / omit) wizard — the 삽입 거울상.
// No React. Deterministic nudges only — nothing here gates advancing.
//
// A 무관 passage numbers its 5 body sentences with ASCII markers "(1)"…"(5)". The
// topic-stating lead sits BEFORE "(1)". `problem.answer` (1-5) is the irrelevant
// sentence; every OTHER sentence contributes to the topic (relevant = num≠answer).

import { matchTopicRule } from './gradeTopic'
import type { TopicGrade } from './gradeTopic'
import { computeOverlap, extractKeywords } from './theme'
import { gradeIntroType } from './insert'
import type { GradingRubric } from '../useProblem'
import type { StepVerdict, ThemeGrade } from '../../components/solve/types'

// Re-export the 삽입 grader — 도입 유형 grading is identical (pick vs rubric.intro_type).
export { gradeIntroType }

/** Matches a "(1)"…"(5)" sentence marker (with optional inner whitespace). */
export const OMIT_MARKER_RE = /\(\s*[1-5]\s*\)/g

export interface ParsedOmitPassage {
  /** Passage text BEFORE the (1) marker — the topic-stating lead (may be ''). */
  lead: string
  /** The numbered sentence texts; index 0 == sentence (1). Up to 5. */
  sentences: string[]
}

/**
 * Splits the passage on the (1)…(5) markers. For 5 markers you get a lead plus 5
 * sentences. Each piece is trimmed. Fallback: with fewer markers we return
 * whatever the split yields (the wizard guards on sentences.length).
 */
export function parseOmitSentences(passage: string): ParsedOmitPassage {
  const text = (passage ?? '').replace(/\r/g, '')
  const parts = text.split(OMIT_MARKER_RE).map((s) => s.trim())
  const lead = parts[0] ?? ''
  const sentences = parts.slice(1).filter((_, i) => i < 5)
  return { lead, sentences }
}

/**
 * The first `n` sentences of the passage with every (1)…(5) marker removed. Phase
 * 1 shows ONLY this intro (never the numbered sentences) so the student forms a
 * topic read before scanning. Mirrors insert.introSentences.
 */
export function omitIntro(passage: string, n = 2): string {
  const stripped = (passage ?? '')
    .replace(/\r/g, '')
    .replace(OMIT_MARKER_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const sentences = stripped
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return sentences.slice(0, n).join(' ')
}

/**
 * The adjacent pair that RECONNECTS when the answer sentence is removed. Computed
 * in CODE (never from the hidden flow_without prose): removing sentence `answer`
 * leaves (answer-1) → (answer+1). Clamped to [1,total]. Phase 3 shows this ONLY
 * after a correct commit.
 */
export function reconnectPair(answer: number, total = 5): [number, number] {
  const lo = Math.max(1, Math.min(total, answer - 1))
  const hi = Math.max(1, Math.min(total, answer + 1))
  return [lo, hi]
}

// ── Graders. All pure, all NUDGES. They read the FULL rubric (frame-grader ──────
// closures pass it in); step components only ever see the returned verdict/grade.

/** Maps a client-rule TopicGrade to the wizard's coarse ThemeGrade. */
export function topicGradeToTheme(g: TopicGrade): ThemeGrade {
  if (g === 'accept') return 'accept'
  if (g === 'ambiguous') return 'partial'
  return 'reject' // reject_too_narrow | reject_too_broad | reject_wrong
}

/**
 * Phase 1 소재 grader — mirrors the 빈칸/삽입 소재 grader: structured-topic bucket
 * match (gradeTopic.ts) for the 3-tier verdict, theme.ts overlap for the matched-
 * keyword highlight list. Returns `ambiguous` so the caller can fall back to the
 * grade-topic Edge Function (LLM). 'none' when the rubric carries no topic text.
 */
export function gradeOmitTopic(
  rubric: GradingRubric | null,
  input: string,
): { graded: ThemeGrade; matched: string[]; ambiguous: boolean } {
  const topic = rubric?.topic
  const hasTopic = Boolean(
    topic && (topic.canonical || (topic.accept && topic.accept.length > 0)),
  )
  if (!topic || !hasTopic) return { graded: 'none', matched: [], ambiguous: false }

  const reference = extractKeywords(
    [topic.canonical, ...(topic.accept ?? [])].join(' '),
  )
  const tokens = extractKeywords(input)
  const { overlap } = computeOverlap(tokens, reference)

  const ruled = matchTopicRule(input, topic)
  let graded: ThemeGrade
  let ambiguous = false
  if (ruled.graded === 'accept') graded = 'accept'
  else if (ruled.graded.startsWith('reject')) graded = 'reject'
  else {
    ambiguous = true
    graded =
      overlap.length >= 2 ? 'accept' : overlap.length >= 1 ? 'partial' : 'reject'
  }
  return { graded, matched: overlap, ambiguous }
}

/**
 * Phase 2 문장별 주제기여 grader — did the learner's 기여/의심 call on sentence `num`
 * match sentence_relevance? ANSWER-SAFE by construction: '의심' is correct ONLY on
 * the irrelevant (answer) sentence, '기여' correct on every other, so a neutral-on-
 * accept UI never singles out the answer.
 *   (pick === '의심') === !relevant  → accepted
 *   otherwise                        → reject
 *   'neutral' when the rubric carries no sentence_relevance for this num.
 */
export function gradeSentenceRelevance(
  rubric: GradingRubric | null,
  num: number,
  pick: '기여' | '의심',
): StepVerdict {
  const list = rubric?.sentence_relevance
  if (!Array.isArray(list) || list.length === 0) return 'neutral'
  const entry = list.find((s) => s.num === num) ?? list[num - 1]
  if (!entry || typeof entry.relevant !== 'boolean') return 'neutral'
  return (pick === '의심') === !entry.relevant ? 'accepted' : 'reject'
}

/** Phase 3 무관 확정 grader — commit pick vs problem.answer. */
export function gradeOmitConfirm(
  answer: number | null,
  pick: number,
): 'correct' | 'wrong' {
  return answer !== null && pick === answer ? 'correct' : 'wrong'
}

/**
 * Phase 4 자기설명 grader — lenient 3-tier over rubric.why_unrelated via theme.ts
 * overlap. REFLECTIVE (never gates advancing) so it stays gentle:
 *   overlap >= 1                 → accept  (touched the mechanism)
 *   overlap 0 but wrote tokens   → partial (a real attempt, "딴 얘기" level)
 *   overlap 0 and empty/garbage  → reject
 *   no why_unrelated             → none
 * NEVER returns the reason prose — only the student's overlapping words.
 */
export function gradeOmitReason(
  rubric: GradingRubric | null,
  input: string,
): { graded: ThemeGrade; matched: string[] } {
  const why = rubric?.why_unrelated
  const hasRef = Boolean(why && why.trim())
  if (!why || !hasRef) return { graded: 'none', matched: [] }

  const reference = extractKeywords(why)
  const tokens = extractKeywords(input)
  const { overlap } = computeOverlap(tokens, reference)
  const graded: ThemeGrade =
    overlap.length >= 1 ? 'accept' : tokens.length > 0 ? 'partial' : 'reject'
  return { graded, matched: overlap }
}

/**
 * Phase 5 routing — the diagnostic to show when the student wrongly picked
 * `pickedNum` as irrelevant. trap_sentences carries a per-wrong-pick diagnosis
 * (handles 통념 / 회피·선택적주의 mechanism-confusion cases); null when the pick is a
 * plainly-contributing sentence (→ the caller shows the generic nudge).
 */
export function omitTrapDiagnosis(
  rubric: GradingRubric | null,
  pickedNum: number,
): string | null {
  const traps = rubric?.trap_sentences
  if (!traps || typeof traps !== 'object') return null
  const v = traps[String(pickedNum)]
  return typeof v === 'string' && v.trim() ? v : null
}
