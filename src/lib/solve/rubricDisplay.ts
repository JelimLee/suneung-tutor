// Display-rubric sanitizer — the structural guard behind CLAUDE.md's pedagogy
// rule: a rubric's REASONING/EXPLANATION prose is for GRADING and CHAT guidance
// only, and must NEVER pre-appear on the solve screen (spoon-feeding). The full
// rubric stays reachable in gradeResult/logPayload (which take `problem`); every
// STEP RENDER instead receives this sanitized copy.
//
// So the guard is inherited by every current AND future problem type (어법/어휘/
// 무관/삽입 clones), the wizard frame blanks reasoning fields ONCE, here, and
// hands the result to steps as `displayRubric`. When you add a new rubric field:
//   - if it is label/array grading data a step may legitimately show → KEEP it;
//   - if it is teacher reasoning/explanation prose → BLANK it below.

import type { GradingRubric } from '../useProblem'

/**
 * Returns a shallow copy of `r` with reasoning prose blanked, keeping the
 * label/array fields grading legitimately needs. Reasoning fields that imply the
 * answer (referent_chains, why, refers_to, role, notes, example_mapping) are
 * stripped; harmless grading anchors (accept/reject arrays, correct labels,
 * opening cue words, polarity/keywords) are kept.
 */
export function toDisplayRubric(
  r: GradingRubric | null,
): GradingRubric | null {
  if (!r) return null
  return {
    // KEEP as-is: pure grading data, no reasoning leak. 삽입은 도입 유형을 학생이
    // 스스로 고르므로(Phase 1 Q3) intro_type을 노출하지 않는다; 빈칸 등은 유지.
    type: r.type,
    intro_type:
      r.type === 'insert' || r.type === 'omit' ? undefined : r.intro_type,
    polarity: r.polarity,
    theme_keywords: r.theme_keywords,
    sentences: r.sentences,
    correct_order: r.correct_order,
    connective_keywords: r.connective_keywords,

    // KEEP accept/reject arrays (grading needs them); blank only the note prose.
    // For 어휘, fully blank topic (teacher content). Otherwise keep accept/reject
    // arrays for grading and blank only the note prose.
    topic:
      r.type === 'vocab' || r.type === 'insert' || r.type === 'omit'
        ? {
            canonical: '',
            accept: [],
            reject_too_narrow: [],
            reject_too_broad: [],
            reject_wrong: [],
            note: '',
          }
        : r.topic
          ? { ...r.topic, note: '' }
          : r.topic,

    // KEEP block for grading; drop the reasoning `why`.
    anchor: r.anchor ? { block: r.anchor.block, why: '' } : r.anchor,

    // KEEP order for trap-detection grading; drop the reasoning `why`.
    traps: r.traps?.map((t) => ({ order: t.order, why: '' })),

    // KEEP id+label so the display layer can render the reason chips, but FORCE
    // correct:false so the answer is never revealed. Grading uses the FULL
    // rubric via gradeWhyOption (frame layer), so the component never sees which
    // option is correct.
    why_options: r.why_options
      ? Object.fromEntries(
          Object.entries(r.why_options).map(([key, opts]) => [
            key,
            opts.map((o) => ({ id: o.id, label: o.label, correct: false })),
          ]),
        )
      : undefined,

    // KEEP key/labels/question + option id/label so the pairwise reason chips can
    // render, but FORCE correct:false exactly like why_options — the answer is
    // never revealed. Grading uses the FULL rubric via gradePairWhy (frame layer).
    pair_options: r.pair_options?.map((p) => ({
      key: p.key,
      labels: p.labels,
      question: p.question,
      options: p.options.map((o) => ({ id: o.id, label: o.label, correct: false })),
    })),

    // KEEP opening_cue (a harmless connective word); drop refers_to + role which
    // imply the ordering.
    blocks: r.blocks?.map((b) => ({
      label: b.label,
      opening_cue: b.opening_cue,
      refers_to: '',
      role: '',
    })),

    // ── 어법(grammar) ── KEEP the structural `combination` flag; expose ONLY
    // {num, word} per underline. category / check_point / is_correct / why /
    // subject_head / subject_number / accept_subject are ALL dropped so the
    // student self-diagnoses. `note` is teacher reasoning → blanked. why_options
    // is already neutralized generically above (correct → false).
    combination: r.combination,
    underlines: r.underlines?.map((u) => ({ num: u.num, word: u.word })),
    note: '',

    // ── 삽입(sentence-insertion) ── KEEP `type` (kept above). connection_cues and
    // distractor_traps are chat/reasoning-only and are BLANKED here (omitted →
    // undefined) so no interactive step or post-answer view can read them. The
    // insert steps never need the rubric at all — they use problem.answer,
    // problem.insert_sentence, the parsed passage, and deterministic cue detection.
    connection_cues: undefined,
    distractor_traps: undefined,

    // ── 삽입 v2/v3 reasoning — ALL blanked (omitted → undefined). topic is emptied
    // above (vocab/insert branch). concept_count, insertion_sentence (incl.
    // anaphor_expression / expected_prior_content), slot_fit (incl. why),
    // reasoning_keywords are grading/chat-only; every step grades via frame closures
    // over the FULL rubric. signal_check (satisfies / why_not) is Phase-5 grading
    // data and is simply NOT copied onto the display rubric (omitted → undefined),
    // so no step component can read it.
    concept_count: undefined,
    insertion_sentence: undefined,
    slot_fit: undefined,
    reasoning_keywords: undefined,

    // ── 무관(omit / irrelevant-sentence) — ALL blanked (omitted → undefined).
    // ANTI-LEAK top priority: sentence_relevance (relevant flags + why),
    // why_unrelated, flow_without, trap_sentences are grading/chat/Phase-5 data
    // and are NEVER copied onto the display rubric. topic is emptied above
    // (vocab/insert/omit branch), intro_type is undefined above, check_questions
    // is [] below. Every omit step grades via frame closures over the FULL rubric;
    // the reconnect pair is computed in code (omit.reconnectPair), never from
    // flow_without prose.
    sentence_relevance: undefined,
    why_unrelated: undefined,
    flow_without: undefined,
    trap_sentences: undefined,

    // ── Unified Recovery Loop grading data — ANTI-LEAK: NEVER copied onto the
    // display rubric (omitted → undefined). word_polarity / in_given / relation /
    // choice_satisfies / is_grammatical all imply or encode the answer; RecoveryLoop
    // grades exclusively via frame-grader closures over the FULL rubric, and its
    // component receives only StepVerdicts. A step must never read `recovery`.
    recovery: undefined,

    // BLANK: teacher reasoning/explanation prose. check_questions covers 삽입's
    // hidden self-check prompts too.
    referent_chains: [],
    example_mapping: null,
    check_questions: [],
  }
}
