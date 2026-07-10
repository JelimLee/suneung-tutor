// Client-side 0-token grader for the 문장 극성(polarity) nudge in StepPolarity.
// Deterministic (no LLM). This is a NUDGE only — it never gates advancing.
//
// Truth table (student mark vs rubric-correct mark):
//   correct undefined/null                → 'none'      (no rubric for this sentence)
//   student null                          → 'unmarked'  (student left it blank)
//   student === correct                   → 'accept'    (direction matches)
//   student '?' and correct '+'|'-'       → 'skip'      (honest "don't know" — NOT wrong)
//   student '+'|'-' and correct differs   → 'reject'    (mismatch — soft "look again")
//     (includes correct '?' while student committed to a direction)

export type PolarityGrade = 'accept' | 'reject' | 'skip' | 'unmarked' | 'none'

export function gradeMark(
  student: '+' | '-' | '?' | null,
  correct: '+' | '-' | '?' | undefined,
): PolarityGrade {
  if (correct === undefined || correct === null) return 'none'
  if (student === null) return 'unmarked'
  if (student === correct) return 'accept'
  // Honest "don't know" against a directional answer is not a mistake.
  if (student === '?' && (correct === '+' || correct === '-')) return 'skip'
  // Student committed to a direction that disagrees with the rubric
  // (a different '+'/'-', or the rubric says '?').
  return 'reject'
}
