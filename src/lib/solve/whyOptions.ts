// Frame-level "왜 그렇게 생각했어요?" reason-button pattern — 0-token, rubric-matched.
//
// PATTERN (for future type authors: 어법/어휘/무관/삽입 …):
//   A rubric may carry `why_options` keyed by any decision-key string. Each key
//   maps to 3–4 options { id, label, correct } with EXACTLY ONE correct:true.
//   A student answers "왜 그렇게 생각했어요?" by TAPPING a reason chip
//   (recognition, not recall) — no free-text, no LLM. Grading is a pure client
//   lookup here, costing 0 tokens, exactly like 빈칸 소재 rule-matching.
//
//   The `correct` flag NEVER reaches a component: gradeWhyOption runs in the
//   FRAME layer against the FULL rubric (problem.grading_rubric), while steps
//   receive only the DISPLAY rubric whose options are neutralized to
//   correct:false (see rubricDisplay.toDisplayRubric). Components pass the picked
//   option id up; the wizard grades it and hands back a soft verdict.
//
//   To reuse for a new type: add `why_options[<yourKey>]` to that type's rubric,
//   render <ReasonButtons> in the step with the display rubric's options, and in
//   the wizard pass gradeReason={(id) => gradeWhyOption(problem.grading_rubric,
//   '<yourKey>', id)}. No new grading code — this is fully type-agnostic.

import type { GradingRubric } from '../useProblem'
import type { StepVerdict } from '../../components/solve/types'

/**
 * Grade a tapped reason option against the FULL rubric. Runs in the frame layer
 * so the `correct` flag never needs to reach a component.
 *   'accepted' — the picked option is the correct one.
 *   'reject'   — the option exists but is not correct.
 *   'neutral'  — no options for this key / option not found / no rubric.
 */
export function gradeWhyOption(
  rubric: GradingRubric | null,
  decisionKey: string,
  optionId: string,
): StepVerdict {
  const options = rubric?.why_options?.[decisionKey]
  if (!options || options.length === 0) return 'neutral'
  const opt = options.find((o) => o.id === optionId)
  if (!opt) return 'neutral'
  return opt.correct ? 'accepted' : 'reject'
}

/** The tapped option's label (for logging raw_input), or '' if not found. */
export function whyOptionLabel(
  rubric: GradingRubric | null,
  decisionKey: string,
  optionId: string | null,
): string {
  if (!optionId) return ''
  const options = rubric?.why_options?.[decisionKey]
  return options?.find((o) => o.id === optionId)?.label ?? ''
}

// ── Pairwise analogs (순서 배열 step). The pair `key`/`labels` are label-SORTED
// (A<B<C) so they never leak which block comes first; only the option `correct`
// flag encodes that, and it is graded here in the frame layer against the FULL
// rubric (never the neutralized display rubric).

export function gradePairWhy(
  rubric: GradingRubric | null,
  pairKey: string,
  optionId: string,
): StepVerdict {
  const pair = rubric?.pair_options?.find((p) => p.key === pairKey)
  if (!pair || pair.options.length === 0) return 'neutral'
  const opt = pair.options.find((o) => o.id === optionId)
  if (!opt) return 'neutral'
  return opt.correct ? 'accepted' : 'reject'
}

export function pairWhyLabel(
  rubric: GradingRubric | null,
  pairKey: string,
  optionId: string | null,
): string {
  if (!optionId) return ''
  const pair = rubric?.pair_options?.find((p) => p.key === pairKey)
  return pair?.options.find((o) => o.id === optionId)?.label ?? ''
}
