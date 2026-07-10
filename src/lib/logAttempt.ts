import { supabase } from './supabase'

// The five solve-flow steps that get persisted to `attempts.step`.
export type AttemptStep =
  | 'prereading'
  | 'polarity'
  | 'theme_recall'
  | 'choice_process'
  | 'result'
  // ── 순서(sentence-ordering) steps (free-text payload; no DB change) ──
  | 'order_predict'
  | 'order_scan' // legacy: kept in the union to avoid churn; no longer emitted.
  | 'order_eliminate'
  | 'order_arrange'
  | 'order_verify'
  | 'order_choice_process'
  // ── 어법(grammar) steps (free-text payload; no DB change) ──
  | 'grammar_diagnose'
  | 'grammar_subject' // legacy: no longer emitted (folded inline into grammar_diagnose)
  | 'grammar_choice_process'
  // ── 어휘(vocabulary) steps (free-text payload; no DB change) ──
  | 'vocab_topic'
  | 'vocab_polarity'
  | 'vocab_diagnose'
  | 'vocab_choice_process'
  // ── 삽입(sentence-insertion) steps (free-text payload; no DB change) ──
  // Legacy v1 ids — kept in the union to avoid churn; no longer emitted.
  | 'insert_pick'
  | 'insert_verify'
  | 'insert_cue'
  | 'insert_choice_process'
  // v2 5-phase ids. Only insert_topic / insert_analyze are emitted now;
  // insert_slotscan / insert_confirm / insert_recover land with Phases 3-5.
  | 'insert_topic'
  | 'insert_intro'
  | 'insert_analyze'
  | 'insert_slotscan'
  | 'insert_confirm'
  | 'insert_recover'
  // ── 무관(irrelevant-sentence / omit) steps (free-text payload; no DB change) ──
  | 'omit_topic'
  | 'omit_intro'
  | 'omit_scan'
  | 'omit_confirm'
  | 'omit_explain'
  | 'omit_recover'
  // ── Unified Recovery Loop (오답 회복) — payload.recovery: RecoveryLogPayload ──
  | 'recovery'

/**
 * Logs one solve-flow step to `attempts`. user_id is intentionally omitted so
 * the column default (auth.uid()) fills it under RLS.
 *
 * This NEVER throws: a failed log must not block the learner from advancing.
 */
export async function logAttempt(
  problemId: string,
  step: AttemptStep,
  payload: unknown,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('attempts')
      .insert({ problem_id: problemId, step, payload })
    if (error) {
      console.warn(`[logAttempt] ${step} failed:`, error.message)
      return { error: error.message }
    }
    return { error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[logAttempt] ${step} threw:`, message)
    return { error: message }
  }
}
