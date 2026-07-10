import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { QuestionType } from '../types'
import type { GrammarCategory } from './solve/grammar'

export interface WhyOption {
  id: string
  label: string
  correct: boolean
}

/**
 * A single underlined expression in a 어법 problem. `num`/`word` are screen-safe;
 * EVERY other field is GRADING-ONLY and is stripped by toDisplayRubric before a
 * step render sees it (the student must self-diagnose the category). The
 * diagnostic fields are optional because the DISPLAY copy legitimately omits them.
 */
export interface GrammarUnderline {
  num: number
  word: string
  // ── HIDDEN from the solve screen (grading + chat only) ──
  category?: GrammarCategory // GRADING KEY — never rendered
  check_point?: string
  is_correct?: boolean
  why?: string
  // Only on 동사 수일치 underlines:
  subject_head?: string
  subject_number?: '단수' | '복수'
  accept_subject?: string[]
  // Per-category inline micro-diagnostic keys (HIDDEN — grading only):
  has_object?: boolean // 준동사: whether the verbal takes an object
  clause_complete?: boolean // 관계사: whether the following clause is complete
  correct_pos?: '부사' | '형용사' // 형용사부사: the part of speech this slot needs
  // Only on 어휘(vocabulary) underlines (HIDDEN — grading only):
  sentence_has_negation?: boolean // whether the underline's sentence carries a negator
  expected_polarity?: '+' | '-' // the polarity this slot should carry
}

/**
 * A single underlined word in a 어휘 problem. `num`/`word` are screen-safe; every
 * other field is GRADING-ONLY and is stripped by toDisplayRubric before a step
 * render sees it (the student must self-judge 글 부호 / negation / polarity).
 */
export interface VocabUnderline {
  num: number
  word: string
  // ── HIDDEN from the solve screen (grading + chat only) ──
  sentence_has_negation?: boolean
  expected_polarity?: '+' | '-'
  is_correct?: boolean
  why?: string
}

/**
 * A single "뭐가 먼저 와요?" pairwise reason question (순서). The `key` and
 * `labels` are label-SORTED (A<B<C) so nothing here encodes which block actually
 * comes first — only the `options[].correct` flag does, and that is graded in the
 * frame layer and neutralized before reaching components.
 */
export interface PairWhy {
  key: string // label-SORTED "B-C" — never encodes which is first
  labels: ('A' | 'B' | 'C')[] // sorted A<B<C
  question: string // "B와 C 중 뭐가 먼저 와요?"
  options: WhyOption[] // exactly 1 correct:true
}

/**
 * Formative-grading rubric stored on `problems.grading_rubric` (jsonb). May be
 * null for problems that have not been graded yet — every consumer must treat
 * a null rubric as "no grading, pure nudge".
 */
export interface GradingRubric {
  topic: {
    canonical: string
    accept: string[]
    reject_too_narrow: string[]
    reject_too_broad: string[]
    reject_wrong: string[]
    note: string
  }
  intro_type?: '통념' | '주장' | '배경지식' | '통념반박' | '기타'
  polarity: ('+' | '-' | '?')[] // aligned to segmentSentences order
  theme_keywords: string[]
  sentences: string[]
  // ── Optional 순서(sentence-ordering) fields. Absent on blank rubrics. ──
  type?: 'blank' | 'order' | 'grammar' | 'vocab' | 'insert' | 'omit'
  blocks?: {
    label: 'A' | 'B' | 'C'
    opening_cue: string
    refers_to: string
    role: string
  }[]
  correct_order?: string // e.g. "C-B-A"
  anchor?: { block: 'A' | 'B' | 'C'; why: string }
  traps?: { order: string; why: string }[]
  connective_keywords?: string[]
  referent_chains?: string[] // 지시대명사 추적 단서 문장들
  example_mapping?: string | null // 배경지식형 예시 분류, 아니면 null
  check_questions?: string[] // 학생 판단 질문 2~3
  // ── Frame-level "왜 그렇게 생각했어요?" reason buttons (0-token, rubric-matched).
  // Keyed by an arbitrary decision-key string (순서: 'eliminate'; future types add
  // their own keys). Each list has exactly 1 correct:true.
  // The `correct` flag is graded in the FRAME layer via gradeWhyOption and is
  // NEUTRALIZED before reaching any component (see rubricDisplay.toDisplayRubric).
  why_options?: Record<
    string,
    { id: string; label: string; correct: boolean }[]
  >
  pair_options?: PairWhy[] // 순서 only: per-adjacent-pair "뭐가 먼저?" reason chips. Replaces the whole-order arrange why (which leaked the conclusion).
  // ── Optional 어법(grammar) fields. Absent on blank/순서 rubrics. ──
  underlines?: GrammarUnderline[] // 5 underlined expressions; diagnostic fields stripped by toDisplayRubric.
  // ── Optional 어휘(vocabulary) fields. Absent on other rubrics. HIDDEN. ──
  passage_polarity?: '+' | '-' // overall passage direction; grading key for step 1.
  combination?: boolean // true = the "combination" subtype (no underlines) → wizard falls back to ComingSoon.
  note?: string // teacher reasoning note (grammar); HIDDEN — blanked by toDisplayRubric.
  // ── Optional 삽입(sentence-insertion) fields. Absent on other rubrics. ──
  // HIDDEN — connection_cues / distractor_traps are chat/reasoning only and are
  // blanked by toDisplayRubric; the solve screen never shows them.
  connection_cues?: { 앞연결: string; 뒤연결: string }
  distractor_traps?: Record<string, string>
  // ── 삽입 v2 (5-phase scaffolding). ALL optional, ALL HIDDEN — blanked/omitted
  // by toDisplayRubric; only frame-grader closures read them. ──
  concept_count?: number // Phase 1: 글에 등장하는 개념 수 (2/3/4).
  insertion_sentence?: {
    has_anaphor: boolean
    anaphor_expression: string // HIDDEN — never rendered.
    anaphor_type: 'contrast' | 'similar' | 'cause' | 'definite_reference'
    expected_prior_content: { canonical: string; accept: string[] }
  }
  slot_fit?: { slot: number; fit: boolean; why: string }[] // Phase 3. why HIDDEN.
  reasoning_keywords?: string[] // Phase 4: lenient overlap cache.
  // Phase 5 (오답 회복): per-slot signal-satisfaction diagnosis. satisfies/why_not
  // are HIDDEN — only frame-grader closures read them; never rendered.
  signal_check?: { slot: number; satisfies: boolean; why_not: string | null }[]
  // ── Optional 무관(irrelevant-sentence / omit) fields. Absent on other rubrics.
  // ALL of the following are HIDDEN — blanked/omitted by toDisplayRubric; only
  // frame-grader closures read them. (topic / intro_type / check_questions are
  // declared above and reused.) The 삽입 거울상: relevant = (num !== answer).
  sentence_relevance?: { num: number; relevant: boolean; why: string }[] // scan-step grading; relevant flag + why HIDDEN.
  why_unrelated?: string // Phase 4 lenient-overlap cache; HIDDEN prose.
  flow_without?: string // Phase 3 reconnect prose; HIDDEN (pair computed in code).
  trap_sentences?: Record<string, string> // Phase 5 per-wrong-pick diagnosis; keyed by "1".."5" (answer excluded). HIDDEN.
  // ── Unified Recovery Loop (오답 회복) grading data. Absent on 삽입/무관 (they reuse
  // signal_check / trap_sentences). ALL HIDDEN — stripped by toDisplayRubric; only
  // RecoveryLoop's frame-grader closures read it. Invariants (fits / is_grammatical /
  // can_be_first / choice_satisfies[answer]) are force-derived from answer/anchor in
  // generate-rubric; the LLM-judged parts (word_polarity / in_given / relation /
  // distractor choice_satisfies) are human-reviewed before storage.
  recovery?:
    | {
        axis: 'polarity' // 어휘
        items: { num: number; sentence_polarity: '+' | '-'; word_polarity: '+' | '-'; fits: boolean }[]
      }
    | {
        axis: 'category' // 어법
        items: { num: number; target: string; category: string; is_grammatical: boolean }[]
      }
    | {
        axis: 'signal' // 순서
        items: {
          label: 'A' | 'B' | 'C'
          opening_cue: string
          refers_to: string
          in_given: boolean
          can_be_first: boolean
        }[]
      }
    | {
        axis: 'relation' // 빈칸
        relation: '재진술' | '대조' | '인과' | '예시'
        choice_satisfies: Record<string, boolean>
      }
}

/**
 * Shared DATA layer for a single problem. This is the ONLY module shared
 * between the solve flow and the chat flow — no components or solve state cross
 * that boundary.
 */
export interface Problem {
  id: string
  question_type: QuestionType
  exam_round: string | null
  passage: string
  question: string | null
  choices: string[]
  answer: number | null // 1-based index into `choices` (matches DB convention)
  difficulty: number | null
  student_question: string | null
  explanation: string | null
  grading_rubric: GradingRubric | null
  // 삽입 유형: 지문의 ( ① )…( ⑤ ) 자리에 넣을 문장. select('*')로 함께 내려옴.
  insert_sentence?: string | null
}

export async function getProblem(id: string): Promise<Problem | null> {
  const { data, error } = await supabase
    .from('problems')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Problem | null) ?? null
}

export async function getProblems(): Promise<Problem[]> {
  const { data, error } = await supabase
    .from('problems')
    .select('*')
    .order('id')
  if (error) throw new Error(error.message)
  return (data as Problem[] | null) ?? []
}

export interface UseProblemResult {
  problem: Problem | null
  loading: boolean
  error: string | null
}

/**
 * Loads one problem by id. Mirrors the cancelled-guard pattern in useAnonAuth.
 * An undefined id short-circuits to a non-loading empty state.
 */
export function useProblem(problemId: string | undefined): UseProblemResult {
  const [state, setState] = useState<UseProblemResult>({
    problem: null,
    loading: Boolean(problemId),
    error: null,
  })

  useEffect(() => {
    if (!problemId) {
      setState({ problem: null, loading: false, error: null })
      return
    }

    let cancelled = false
    setState({ problem: null, loading: true, error: null })

    getProblem(problemId)
      .then((problem) => {
        if (cancelled) return
        setState({ problem, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message =
          err instanceof Error ? err.message : '문제를 불러오지 못했습니다.'
        setState({ problem: null, loading: false, error: message })
      })

    return () => {
      cancelled = true
    }
  }, [problemId])

  return state
}
