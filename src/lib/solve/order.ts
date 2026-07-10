// Pure utilities for the 순서(sentence-ordering) wizard. No React. Deterministic
// nudges only — nothing here gates advancing.
//
// A 순서 passage looks like:
//   [주어진 글] <given text…>
//   (A) <block text…>
//   (B) <block text…>
//   (C) <block text…>
// and `choices` are orderings like "(A)-(C)-(B)". `answer` is 1-based.

import type { StepVerdict, ThemeGrade } from '../../components/solve/types'
import type { GradingRubric } from '../useProblem'

export type OrderLabel = 'A' | 'B' | 'C'

export interface OrderBlock {
  label: OrderLabel
  text: string
}

export interface ParsedOrderPassage {
  given: string
  blocks: OrderBlock[]
}

// Matches the "[주어진 글]" marker (with optional inner whitespace).
const GIVEN_RE = /\[주어진\s*글\]\s*/
// Matches a "(A)" / "( B )" block marker; label captured in group 1.
const BLOCK_RE = /\(\s*([ABC])\s*\)/g

/**
 * Splits a 순서 passage into its given paragraph and the labelled blocks.
 * - `given` = text between the `[주어진 글]` marker (or index 0 if absent) and the
 *   first block marker.
 * - Each block's text runs to the next marker (or end). Only the FIRST occurrence
 *   of each label is treated as a marker. Blocks are sorted A,B,C for display.
 * Fallbacks never throw:
 *   - no `[주어진 글]` → given = text before the first block.
 *   - no block markers → given = whole passage, blocks = [].
 */
export function parseOrderPassage(passage: string): ParsedOrderPassage {
  const text = (passage ?? '').replace(/\r/g, '')

  // Collect block markers, keeping the first occurrence per label.
  const firstSeen = new Set<OrderLabel>()
  const markers: { label: OrderLabel; markerStart: number; contentStart: number }[] = []
  for (const m of text.matchAll(BLOCK_RE)) {
    const label = m[1] as OrderLabel
    if (firstSeen.has(label)) continue
    firstSeen.add(label)
    markers.push({
      label,
      markerStart: m.index ?? 0,
      contentStart: (m.index ?? 0) + m[0].length,
    })
  }
  markers.sort((a, b) => a.markerStart - b.markerStart)

  // No block markers at all → whole passage is the given text.
  if (markers.length === 0) {
    return { given: text.trim(), blocks: [] }
  }

  const firstBlockStart = markers[0].markerStart
  const givenMatch = GIVEN_RE.exec(text)
  const givenStart = givenMatch ? givenMatch.index + givenMatch[0].length : 0
  const given = text.slice(givenStart, firstBlockStart).trim()

  const blocks: OrderBlock[] = markers.map((mk, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].markerStart : text.length
    return { label: mk.label, text: text.slice(mk.contentStart, end).trim() }
  })
  blocks.sort((a, b) => a.label.localeCompare(b.label))

  return { given, blocks }
}

// Connectives / referents scanned as a SUGGESTION chip only (never auto-fills state).
// Exported so the 삽입 wizard reuses the same cue vocabulary (insert.ts).
export const CUES = [
  'However', 'But', 'Yet', 'Thus', 'Therefore', 'So', 'Instead',
  'In contrast', 'On the other hand', 'For example', 'In addition',
  'Moreover', 'Meanwhile', 'As a result', 'If', 'When',
  'This', 'That', 'These', 'Those', 'Such', 'It', 'They', 'Also',
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Scans the first ~6 words of a block for a known connective/referent and returns
 * the first hit (original casing from the CUES list) or null. Suggestion only.
 */
export function detectCue(blockText: string): string | null {
  if (!blockText) return null
  const head = blockText.trim().split(/\s+/).slice(0, 6).join(' ')
  for (const cue of CUES) {
    const re = new RegExp('\\b' + escapeRegExp(cue) + '\\b', 'i')
    if (re.test(head)) return cue
  }
  return null
}

/**
 * Compares a student's block ordering against the ground-truth ordering.
 * accept = full match; partial = some positions right AND the first block is the
 * right anchor; else reject.
 */
export function gradeOrder(
  studentOrder: string[],
  correctOrder: string[],
): { positionsCorrect: number; graded: ThemeGrade } {
  let positionsCorrect = 0
  const n = Math.min(studentOrder.length, correctOrder.length)
  for (let i = 0; i < n; i++) {
    if (studentOrder[i] === correctOrder[i]) positionsCorrect++
  }
  const fullMatch =
    studentOrder.length === correctOrder.length &&
    positionsCorrect === correctOrder.length
  if (fullMatch) return { positionsCorrect, graded: 'accept' }
  const anchorRight =
    studentOrder.length > 0 &&
    correctOrder.length > 0 &&
    studentOrder[0] === correctOrder[0]
  if (positionsCorrect > 0 && anchorRight) {
    return { positionsCorrect, graded: 'partial' }
  }
  return { positionsCorrect, graded: 'reject' }
}

// ── Recovery-loop graders (오답 회복) ─────────────────────────────────────────
// Frame closures injected into <RecoveryLoop> for a WRONG 순서 commit. They read
// ONLY rubric.recovery (axis='signal'); the component reads no rubric. Each is
// PURE and defensive: it NEVER throws and NEVER blocks — 'neutral' whenever the
// recovery data is absent, mis-typed, or carries no item for `label`. reject is a
// soft nudge inside the loop, never a gate. The fill_in refers_to question is a
// self-explanation prompt and is graded 'neutral' by the wizard (no grader here).
// See rubricDisplay.ts (strips recovery) and useProblem GradingRubric.recovery.

/** The signal-recovery item for block `label`, or null when unavailable. */
function orderRecoveryItem(
  rubric: GradingRubric | null,
  label: 'A' | 'B' | 'C',
):
  | { label: 'A' | 'B' | 'C'; opening_cue: string; refers_to: string; in_given: boolean; can_be_first: boolean }
  | null {
  const rec = rubric?.recovery
  if (!rec || rec.axis !== 'signal') return null
  return rec.items.find((it) => it.label === label) ?? null
}

/** Q2 — is what the block's opening cue refers to present in the 주어진 글?
 * in_given===true → '있음' accepted; false → '없음' accepted. */
export function gradeInGiven(
  rubric: GradingRubric | null,
  label: 'A' | 'B' | 'C',
  pick: '있음' | '없음',
): StepVerdict {
  const it = orderRecoveryItem(rubric, label)
  if (!it) return 'neutral'
  return it.in_given
    ? pick === '있음'
      ? 'accepted'
      : 'reject'
    : pick === '없음'
      ? 'accepted'
      : 'reject'
}

/** Reselect grader — the re-picked ordering (choice num) is correct iff it is the
 * answer. */
export function orderReselectCorrect(
  answer: number | null,
  pickNum: number,
): boolean {
  return answer !== null && pickNum === answer
}

/** "C-B-A" / "(C)-(B)-(A)" → ['C','B','A']. */
export function parseCorrectOrder(s: string): OrderLabel[] {
  if (!s) return []
  return s
    .replace(/[()\s]/g, '')
    .split('-')
    .map((p) => p.toUpperCase())
    .filter((p): p is OrderLabel => p === 'A' || p === 'B' || p === 'C')
}
