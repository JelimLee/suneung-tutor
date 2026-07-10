// Client-side 0-token rule matcher for the 소재(topic) nudge in StepPrereading.
// Mirrors the bidirectional-substring matching used in solve/theme.ts. This is
// a NUDGE only — it never gates advancing. When the rules cannot decide, the
// caller falls back to the grade-topic Edge Function (LLM).

import type { GradingRubric } from '../useProblem'

export type TopicGrade =
  | 'accept'
  | 'reject_too_narrow'
  | 'reject_too_broad'
  | 'reject_wrong'
  | 'ambiguous'

/** Normalize: lowercase, keep hangul/ascii/digits, drop punctuation & spaces. */
function norm(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
}

/**
 * True if the normalized `word` and `entry` overlap by substring in either
 * direction with a minimum shared length of 2 (same rule as theme.ts). Because
 * one string must fully contain the other, the shared length equals the shorter
 * string's length, so requiring both >= 2 enforces the min-shared-length rule.
 */
function hit(word: string, entry: string): boolean {
  const a = norm(word)
  const b = norm(entry)
  if (a.length < 2 || b.length < 2) return false
  return a.includes(b) || b.includes(a)
}

/**
 * Rule-match the student's 소재 word against the rubric topic buckets.
 *
 * Two passes:
 *  1. EXACT (normalized equality), accept first. An explicit bucket listing must
 *     win over an incidental substring collision — e.g. `도덕` exactly in accept
 *     has to beat substring-matching "경직된 도덕관" in reject_wrong. Checking
 *     exact-accept first means a word the author explicitly accepts is accepted.
 *  2. SUBSTRING (bidirectional, min shared 2), rejects BEFORE accept. Catches
 *     trap words that appear only as substrings — e.g. `규칙` ⊂ "획일적 규칙 적용"
 *     (reject_wrong), or a broad word overlapping an accept phrase must still be
 *     rejected. accept is checked last here.
 */
export function matchTopicRule(
  word: string,
  topic: GradingRubric['topic'],
): { graded: TopicGrade; matched_against: string | null } {
  const w = norm(word)
  if (w.length < 2) return { graded: 'ambiguous', matched_against: null }

  // canonical counts as accept material alongside the accept array.
  const acceptEntries = [...(topic.accept ?? [])]
  if (topic.canonical) acceptEntries.push(topic.canonical)

  const rejectBuckets: { name: TopicGrade; entries: string[] }[] = [
    { name: 'reject_wrong', entries: topic.reject_wrong ?? [] },
    { name: 'reject_too_broad', entries: topic.reject_too_broad ?? [] },
    { name: 'reject_too_narrow', entries: topic.reject_too_narrow ?? [] },
  ]
  const accept: { name: TopicGrade; entries: string[] } = {
    name: 'accept',
    entries: acceptEntries,
  }

  // Pass 1 — exact equality, accept first.
  for (const b of [accept, ...rejectBuckets]) {
    if (b.entries.some((e) => norm(e) === w)) {
      return { graded: b.name, matched_against: b.name }
    }
  }
  // Pass 2 — substring, rejects before accept.
  for (const b of [...rejectBuckets, accept]) {
    if (b.entries.some((e) => hit(word, e))) {
      return { graded: b.name, matched_against: b.name }
    }
  }
  return { graded: 'ambiguous', matched_against: null }
}
