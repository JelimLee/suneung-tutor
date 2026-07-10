// Pure utilities for the 어법(grammar) wizard. No React. Deterministic nudges
// only — nothing here gates advancing. Mirrors src/lib/solve/order.ts.
//
// A 어법 problem underlines 5 expressions; exactly one is grammatically WRONG.
// The FULL rubric carries per-underline diagnostics (category / check_point /
// is_correct / why / subject agreement data). The DISPLAY rubric exposes only
// {num, word} — the student must self-diagnose the category. See rubricDisplay.ts.

import type { GradingRubric, GrammarUnderline } from '../useProblem'
import type { StepVerdict, ThemeGrade } from '../../components/solve/types'

/** The six 어법 diagnostic categories. The chosen category is a GRADING KEY and
 * must never be shown on the solve screen (only graded via a frame grader). */
export const GRAMMAR_CATEGORIES = [
  '준동사',
  '관계사',
  '동사',
  '형용사부사',
  '병렬',
  '기타',
] as const
export type GrammarCategory = (typeof GRAMMAR_CATEGORIES)[number]

/** Screen-safe underline: only the number and the underlined word/phrase. */
export interface UnderlineLite {
  num: number
  word: string
}

/**
 * The underlines to render. Prefers rubric.underlines (num + ground-truth word);
 * falls back to `choices` (num = i + 1, word = choices[i]) when no rubric. Never
 * exposes any diagnostic field — only {num, word}.
 */
export function parseUnderlines(
  rubric: GradingRubric | null,
  choices: string[],
): UnderlineLite[] {
  if (rubric?.underlines && rubric.underlines.length > 0) {
    return rubric.underlines.map((u) => ({ num: u.num, word: u.word }))
  }
  return (choices ?? []).map((c, i) => ({ num: i + 1, word: c }))
}

/**
 * Soft-grade a category pick for underline `num` against the FULL rubric.
 *   'accepted' — pick matches the ground-truth category.
 *   'reject'   — a rubric exists for this underline but the pick differs.
 *   'neutral'  — no rubric / no underline entry.
 * Never reveals the correct category — only the verdict crosses.
 */
export function gradeCategory(
  rubric: GradingRubric | null,
  num: number,
  picked: GrammarCategory | null,
): StepVerdict {
  const u = rubric?.underlines?.[num - 1]
  if (!u || !u.category) return 'neutral'
  if (!picked) return 'reject'
  return picked === u.category ? 'accepted' : 'reject'
}

/** Lowercase, strip punctuation, collapse whitespace. Unicode-aware. */
function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * LENIENT subject-head grading (mirrors 빈칸 소재 leniency: 방향(핵) 맞으면 관대,
 * 범위 디테일 안 따짐). ACCEPT if the normalized input CONTAINS the normalized
 * subject_head token, OR equals/contains a full accept_subject entry — a head
 * match is enough even if the student adds objects or prepositional phrases.
 * REJECT if the head is absent. Crucially we do NOT accept a mere FRAGMENT of an
 * accept_subject phrase (e.g. "benefits" ⊂ "Balancing the benefits …") — that
 * would drop the head requirement; the student must include the head itself.
 * 'none' when there is no subject_head to grade against.
 */
export function gradeSubjectHead(
  input: string,
  subjectHead?: string,
  acceptSubject?: string[],
): ThemeGrade {
  if (!subjectHead) return 'none'
  const inp = normalize(input)
  if (!inp) return 'reject'
  const head = normalize(subjectHead)
  if (head && inp.includes(head)) return 'accept'
  for (const a of acceptSubject ?? []) {
    const na = normalize(a)
    // Student must type AT LEAST a full accept phrase (inp ⊇ na), never merely a
    // fragment of one (na ⊇ inp) — the latter would accept head-less fragments.
    if (na && (inp === na || inp.includes(na))) return 'accept'
  }
  return 'reject'
}

/**
 * The 동사(verb) underlines that carry subject-agreement data. Reads the FULL
 * rubric. No longer gates a dedicated step (folded inline into 범주 진단) —
 * kept as a harmless export.
 */
export function verbUnderlines(rubric: GradingRubric | null): GrammarUnderline[] {
  return (rubric?.underlines ?? []).filter(
    (u) => u.category === '동사' && !!u.subject_head,
  )
}

/** Which inline micro-diagnostic a category triggers. null = ungraded note. */
export type MicroKind = 'object' | 'clause' | 'subject' | 'pos' | null

export function microKind(category: GrammarCategory | null): MicroKind {
  switch (category) {
    case '준동사':
      return 'object'
    case '관계사':
      return 'clause'
    case '동사':
      return 'subject'
    case '형용사부사':
      return 'pos'
    default:
      return null // 병렬 / 기타 / null
  }
}

/** The student's answer to whichever micro-check the picked category triggers. */
export interface MicroAnswer {
  hasObject?: '있음' | '없음' | null
  clause?: '완전' | '불완전' | null
  pos?: '부사' | '형용사' | null
  subjectInput?: string
  number?: '단수' | '복수' | null
}

/**
 * Soft-grade the student's inline grammatical ANALYSIS of underline `num` against
 * the FULL rubric, dispatched by the picked category. Grades the ANALYSIS, not
 * whether the underline is the wrong one. Never reveals the correct value — only
 * the verdict crosses. Returns 'neutral' whenever the relevant hidden field is
 * absent (nothing to grade against).
 */
export function gradeMicro(
  rubric: GradingRubric | null,
  num: number,
  category: GrammarCategory | null,
  micro: MicroAnswer,
): StepVerdict {
  const u = rubric?.underlines?.[num - 1]
  if (!u) return 'neutral'
  switch (microKind(category)) {
    case 'object': {
      if (typeof u.has_object !== 'boolean') return 'neutral'
      if (micro.hasObject == null) return 'reject'
      return (micro.hasObject === '있음') === u.has_object ? 'accepted' : 'reject'
    }
    case 'clause': {
      if (typeof u.clause_complete !== 'boolean') return 'neutral'
      if (micro.clause == null) return 'reject'
      return (micro.clause === '완전') === u.clause_complete
        ? 'accepted'
        : 'reject'
    }
    case 'subject': {
      const headGrade = gradeSubjectHead(
        micro.subjectInput ?? '',
        u.subject_head,
        u.accept_subject,
      )
      if (headGrade === 'reject') return 'reject'
      if (headGrade === 'accept' && micro.number === u.subject_number) {
        return 'accepted'
      }
      return 'neutral'
    }
    case 'pos': {
      if (!u.correct_pos) return 'neutral'
      if (micro.pos == null) return 'reject'
      return micro.pos === u.correct_pos ? 'accepted' : 'reject'
    }
    default:
      return 'neutral' // 병렬 / 기타
  }
}

// ── Recovery-loop graders (오답 회복) ─────────────────────────────────────────
// Frame closures injected into <RecoveryLoop> for a WRONG 어법 commit. They read
// ONLY rubric.recovery (axis='category'); the component reads no rubric. Each is
// PURE and defensive: it NEVER throws and NEVER blocks — 'neutral' whenever the
// recovery data is absent, mis-typed, or carries no item for `num`. reject is a
// soft nudge inside the loop, never a gate. See rubricDisplay.ts (strips recovery)
// and useProblem GradingRubric.recovery (axis='category' variant). The fill_in
// `target` question is a self-explanation → graded 'neutral' (no grader here).

/** The category-recovery item for underline `num`, or null when unavailable. */
function grammarRecoveryItem(
  rubric: GradingRubric | null,
  num: number,
): { num: number; target: string; category: string; is_grammatical: boolean } | null {
  const rec = rubric?.recovery
  if (!rec || rec.axis !== 'category') return null
  return rec.items.find((it) => it.num === num) ?? null
}

/** Q2 — the grammatical CATEGORY the underline tests. Accepted iff the pick
 * matches the ground-truth category for underline `num`. */
export function gradeRecoveryCategory(
  rubric: GradingRubric | null,
  num: number,
  pickCategory: GrammarCategory,
): StepVerdict {
  const it = grammarRecoveryItem(rubric, num)
  if (!it) return 'neutral'
  return it.category === pickCategory ? 'accepted' : 'reject'
}

/** Q3 — is the underline grammatical? is_grammatical===true → '맞음' accepted; the
 * answer underline has is_grammatical===false → '틀림' accepted. */
export function gradeIsGrammatical(
  rubric: GradingRubric | null,
  num: number,
  pick: '맞음' | '틀림',
): StepVerdict {
  const it = grammarRecoveryItem(rubric, num)
  if (!it) return 'neutral'
  return it.is_grammatical
    ? pick === '맞음'
      ? 'accepted'
      : 'reject'
    : pick === '틀림'
      ? 'accepted'
      : 'reject'
}

/** Reselect grader — the re-picked underline is correct iff it is the answer. */
export function grammarReselectCorrect(
  answer: number | null,
  pickNum: number,
): boolean {
  return answer !== null && pickNum === answer
}
