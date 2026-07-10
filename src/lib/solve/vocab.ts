// Pure utilities for the 어휘(vocabulary) wizard. No React. Deterministic nudges
// only — nothing here gates advancing. Mirrors src/lib/solve/grammar.ts.
//
// A 어휘 problem underlines 5 words; exactly one is the WRONG word (its polarity
// clashes with the passage direction). The FULL rubric carries passage_polarity,
// and per-underline sentence_has_negation + expected_polarity. The DISPLAY rubric
// exposes only {num, word} — the student must self-judge 글 부호 / negation /
// polarity. See rubricDisplay.ts.

import type { GradingRubric } from '../useProblem'
import type { StepVerdict, ThemeGrade } from '../../components/solve/types'
import { computeOverlap, extractKeywords } from './theme'

/** Screen-safe underline: only the number and the underlined word. */
export interface VocabUnderlineLite {
  num: number
  word: string
}

/**
 * The underlines to render. Prefers rubric.underlines (num + ground-truth word);
 * falls back to `choices` (num = i + 1, word = choices[i]). Never exposes any
 * hidden field — only {num, word}.
 */
export function parseUnderlines(
  rubric: GradingRubric | null,
  choices: string[],
): VocabUnderlineLite[] {
  if (rubric?.underlines && rubric.underlines.length > 0) {
    return rubric.underlines.map((u) => ({ num: u.num, word: u.word }))
  }
  return (choices ?? []).map((c, i) => ({ num: i + 1, word: c }))
}

/**
 * Soft-grade the student's one-line 소재 read against the FULL rubric's topic
 * (canonical + accept synonyms). Keyword-overlap NUDGE only — never gates.
 * Thresholds mirror StepThemeRecall: overlap>=2 or ratio>=0.5 → accept,
 * overlap>0 → partial, else reject. 'none' when the rubric carries no topic text.
 */
export function gradeVocabTopic(
  rubric: GradingRubric | null,
  input: string,
): { graded: ThemeGrade; matched: string[] } {
  // 어휘 rubric stores `topic` as a plain STRING (the 소재 one-liner) — unlike the
  // 빈칸 rubric whose `topic` is a structured {canonical, accept, …} object. The
  // shared GradingRubric type declares the structured shape, so read defensively.
  const topicVal = rubric?.topic as unknown
  const topicStr =
    typeof topicVal === 'string'
      ? topicVal
      : topicVal && typeof topicVal === 'object'
        ? ((topicVal as { canonical?: string }).canonical ?? '')
        : ''
  const reference = extractKeywords(topicStr)
  if (reference.length === 0) return { graded: 'none', matched: [] }
  const themeTokens = extractKeywords(input)
  const { overlap, ratio } = computeOverlap(themeTokens, reference)
  const graded: ThemeGrade =
    overlap.length >= 2 || ratio >= 0.5
      ? 'accept'
      : overlap.length > 0
        ? 'partial'
        : 'reject'
  return { graded, matched: overlap }
}

/**
 * Soft-grade the student's read of the WHOLE-passage polarity against the FULL
 * rubric. 'neutral' when the rubric has no passage_polarity. Never reveals it.
 */
export function gradePassagePolarity(
  rubric: GradingRubric | null,
  pick: '+' | '-',
): StepVerdict {
  const truth = rubric?.passage_polarity
  if (truth !== '+' && truth !== '-') return 'neutral'
  return pick === truth ? 'accepted' : 'reject'
}

/**
 * Soft-grade whether the student correctly spotted a negator in underline `num`'s
 * SENTENCE. 'neutral' when the field is absent. Never reveals the truth.
 */
export function gradeNegation(
  rubric: GradingRubric | null,
  num: number,
  pick: '있음' | '없음',
): StepVerdict {
  const u = rubric?.underlines?.[num - 1]
  if (typeof u?.sentence_has_negation !== 'boolean') return 'neutral'
  return (pick === '있음') === u.sentence_has_negation ? 'accepted' : 'reject'
}

/**
 * Soft-grade whether the student correctly judged underline `num` as matching
 * ('맞음') or clashing ('충돌') with the passage direction, vs the FULL rubric's
 * is_correct. 'neutral' when is_correct is absent. Never reveals the truth.
 */
export function gradeConflict(
  rubric: GradingRubric | null,
  num: number,
  pick: '맞음' | '충돌',
): StepVerdict {
  const u = rubric?.underlines?.[num - 1]
  if (typeof u?.is_correct !== 'boolean') return 'neutral'
  return (pick === '맞음') === u.is_correct ? 'accepted' : 'reject'
}

// ── Recovery-loop graders (오답 회복) ─────────────────────────────────────────
// Frame closures injected into <RecoveryLoop> for a WRONG 어휘 commit. They read
// ONLY rubric.recovery (axis='polarity'); the component reads no rubric. Each is
// PURE and defensive: it NEVER throws and NEVER blocks — 'neutral' whenever the
// recovery data is absent, mis-typed, or carries no item for `num`. reject is a
// soft nudge inside the loop, never a gate. See rubricDisplay.ts (strips recovery)
// and useProblem GradingRubric.recovery (axis='polarity' variant).

/** The polarity-recovery item for underline `num`, or null when unavailable. */
function vocabRecoveryItem(
  rubric: GradingRubric | null,
  num: number,
):
  | { num: number; sentence_polarity: '+' | '-'; word_polarity: '+' | '-'; fits: boolean }
  | null {
  const rec = rubric?.recovery
  if (!rec || rec.axis !== 'polarity') return null
  return rec.items.find((it) => it.num === num) ?? null
}

/** Q1 — the polarity of the SENTENCE containing underline `num`. */
export function gradeSentencePolarity(
  rubric: GradingRubric | null,
  num: number,
  pick: '+' | '-',
): StepVerdict {
  const it = vocabRecoveryItem(rubric, num)
  if (!it) return 'neutral'
  return pick === it.sentence_polarity ? 'accepted' : 'reject'
}

/** Q2 — the polarity of the underlined WORD itself. */
export function gradeWordPolarity(
  rubric: GradingRubric | null,
  num: number,
  pick: '+' | '-',
): StepVerdict {
  const it = vocabRecoveryItem(rubric, num)
  if (!it) return 'neutral'
  return pick === it.word_polarity ? 'accepted' : 'reject'
}

/** Q3 — does the word FIT its sentence? fits===true → '맞음' accepted; the answer
 * underline has fits===false → '충돌' accepted. */
export function gradeFits(
  rubric: GradingRubric | null,
  num: number,
  pick: '맞음' | '충돌',
): StepVerdict {
  const it = vocabRecoveryItem(rubric, num)
  if (!it) return 'neutral'
  return it.fits
    ? pick === '맞음'
      ? 'accepted'
      : 'reject'
    : pick === '충돌'
      ? 'accepted'
      : 'reject'
}

/** Reselect grader — the re-picked underline is correct iff it is the answer. */
export function vocabReselectCorrect(
  answer: number | null,
  pickNum: number,
): boolean {
  return answer !== null && pickNum === answer
}
