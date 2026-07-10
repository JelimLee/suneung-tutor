// Pure utilities for the 빈칸(blank) wizard recovery loop. No React. Deterministic
// nudges only — nothing here gates advancing. Mirrors the recovery-grader block of
// src/lib/solve/vocab.ts (axis='polarity'); blank's recovery axis is 'relation'.
//
// A 빈칸 problem hides one logical relation (재진술/대조/인과/예시) across the blank;
// exactly one of the 5 choices satisfies it. The FULL rubric carries
// recovery.relation + recovery.choice_satisfies (per-choice bool, choice_satisfies
// [answer]===true). The DISPLAY rubric strips recovery entirely (rubricDisplay.ts) —
// RecoveryLoop reads no rubric; these frame closures do. Each is PURE and defensive:
// it NEVER throws and NEVER blocks — 'neutral' whenever the recovery data is absent,
// mis-typed, or carries the wrong axis. reject is a soft nudge inside the loop, never
// a gate. See useProblem GradingRubric.recovery (axis='relation' variant).

import type { GradingRubric } from '../useProblem'
import type { StepVerdict } from '../../components/solve/types'

/** The relation-recovery record for this problem, or null when unavailable. */
function blankRecovery(
  rubric: GradingRubric | null,
):
  | {
      relation: '재진술' | '대조' | '인과' | '예시'
      choice_satisfies: Record<string, boolean>
    }
  | null {
  const rec = rubric?.recovery
  if (!rec || rec.axis !== 'relation') return null
  return rec
}

/** Q1 — the logical relation across the blank. accepted iff the pick matches. */
export function gradeRelation(
  rubric: GradingRubric | null,
  pick: '재진술' | '대조' | '인과' | '예시',
): StepVerdict {
  const rec = blankRecovery(rubric)
  if (!rec) return 'neutral'
  return pick === rec.relation ? 'accepted' : 'reject'
}

/** Q2 — does the student's committed choice satisfy that relation? The answer
 * choice has choice_satisfies[answer]===true → '만족' accepted; a distractor is
 * false → '불만족' accepted. 'neutral' when the choice has no recorded flag. */
export function gradeChoiceSatisfies(
  rubric: GradingRubric | null,
  choiceNum: number,
  pick: '만족' | '불만족',
): StepVerdict {
  const rec = blankRecovery(rubric)
  if (!rec) return 'neutral'
  const sat = rec.choice_satisfies[String(choiceNum)]
  if (typeof sat !== 'boolean') return 'neutral'
  return sat
    ? pick === '만족'
      ? 'accepted'
      : 'reject'
    : pick === '불만족'
      ? 'accepted'
      : 'reject'
}

/** Reselect grader — the re-picked choice is correct iff it is the answer. */
export function blankReselectCorrect(
  answer: number | null,
  pickNum: number,
): boolean {
  return answer !== null && pickNum === answer
}
