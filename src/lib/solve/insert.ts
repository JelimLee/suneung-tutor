// Pure utilities for the 삽입(sentence-insertion) wizard. No React. Deterministic
// nudges only — nothing here gates advancing.
//
// A 삽입 passage carries 5 slot markers "( ① )" … "( ⑤ )". The sentence to insert
// lives on `problem.insert_sentence`; `problem.answer` (1-5) is the correct slot.
// Position k (1-5) inserts BETWEEN segments[k-1] and segments[k].

import { CUES } from './order'
import { matchTopicRule } from './gradeTopic'
import { computeOverlap, extractKeywords } from './theme'
import type { GradingRubric } from '../useProblem'
import type { StepVerdict, ThemeGrade } from '../../components/solve/types'

/** Circled numeral → 1-based position. */
export const CIRCLED: Record<string, number> = {
  '①': 1,
  '②': 2,
  '③': 3,
  '④': 4,
  '⑤': 5,
}

/** Matches a "( ① )" slot marker (with optional inner whitespace). */
export const MARKER_RE = /\(\s*[①②③④⑤]\s*\)/g

export interface ParsedInsertPassage {
  segments: string[]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Splits the passage by the slot markers. For 5 markers you get 6 segments:
 * segments[0] = text before ①, segments[i] = between marker i and i+1,
 * segments[5] = after ⑤. Each segment is trimmed. Fallback: with <5 markers we
 * return whatever the split yields (the wizard guards on segments.length >= 2).
 */
export function parseInsertPassage(passage: string): ParsedInsertPassage {
  const text = (passage ?? '').replace(/\r/g, '')
  const segments = text.split(MARKER_RE).map((s) => s.trim())
  return { segments }
}

/** Simple sentence split; drops empties. */
function splitSentences(text: string): string[] {
  return (text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Last sentence of the segment BEFORE position k (the immediate 앞 context). */
export function frontSentence(segments: string[], k: number): string {
  const seg = segments[k - 1] ?? ''
  const s = splitSentences(seg)
  return s.length ? s[s.length - 1] : seg.trim()
}

/** First sentence of the segment AFTER position k (the immediate 뒤 context). */
export function backSentence(segments: string[], k: number): string {
  const seg = segments[k] ?? ''
  const s = splitSentences(seg)
  return s.length ? s[0] : seg.trim()
}

/**
 * Scans the whole insert sentence (not just the head) for a known
 * connective/referent from the shared CUES list; returns the first hit (original
 * casing) or null. Deterministic — used to grade whether the student SPOTTED a
 * cue, never to reveal the answer position.
 */
export function detectInsertCue(insertSentence: string): string | null {
  if (!insertSentence) return null
  for (const cue of CUES) {
    const re = new RegExp('\\b' + escapeRegExp(cue) + '\\b', 'i')
    if (re.test(insertSentence)) return cue
  }
  return null
}

/**
 * Grades the "있음/없음" cue-spotting judgement against the deterministic
 * detectInsertCue. This grades whether the learner correctly spotted a cue in the
 * sentence — NOT whether their position is right — so it is answer-safe.
 */
export function gradeCuePresence(
  insertSentence: string,
  pick: '있음' | '없음',
): StepVerdict {
  const hasCue = detectInsertCue(insertSentence) !== null
  return (pick === '있음') === hasCue ? 'accepted' : 'reject'
}

// ── v2 5-phase graders ──────────────────────────────────────────────────────
// All pure, all NUDGES. They read the FULL rubric (frame-grader closures pass it
// in); step components only ever see the returned verdict/grade.

/**
 * The first `n` sentences of the passage with every "( ① )…( ⑤ )" slot marker
 * removed. Phase 1 shows ONLY this intro (never the full passage) so the student
 * forms a topic read before seeing the slots. Split on sentence enders AFTER
 * stripping markers; empties dropped.
 */
export function introSentences(passage: string, n = 3): string {
  const stripped = (passage ?? '')
    .replace(/\r/g, '')
    .replace(MARKER_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const sentences = stripped
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return sentences.slice(0, n).join(' ')
}

/**
 * Phase 1 소재 grader — mirrors the 빈칸 소재 grader: structured-topic bucket match
 * (gradeTopic.ts) for the 3-tier verdict, theme.ts overlap for the matched-keyword
 * highlight list. 'none' when the rubric carries no topic text.
 *   rule accept        → accept
 *   rule reject_*       → reject
 *   rule ambiguous      → lean on overlap (>=2 accept / >=1 partial / else reject)
 */
export function gradeInsertTopic(
  rubric: GradingRubric | null,
  input: string,
): { graded: ThemeGrade; matched: string[] } {
  const topic = rubric?.topic
  const hasTopic = Boolean(
    topic && (topic.canonical || (topic.accept && topic.accept.length > 0)),
  )
  if (!topic || !hasTopic) return { graded: 'none', matched: [] }

  const reference = extractKeywords(
    [topic.canonical, ...(topic.accept ?? [])].join(' '),
  )
  const tokens = extractKeywords(input)
  const { overlap } = computeOverlap(tokens, reference)

  const ruled = matchTopicRule(input, topic)
  let graded: ThemeGrade
  if (ruled.graded === 'accept') graded = 'accept'
  else if (ruled.graded.startsWith('reject')) graded = 'reject'
  else graded = overlap.length >= 2 ? 'accept' : overlap.length >= 1 ? 'partial' : 'reject'

  return { graded, matched: overlap }
}

/**
 * Phase 1 개념 수 grader — compares the student's [2][3][4] pick to
 * rubric.concept_count. 'neutral' when the rubric has no count. Never reveals it.
 */
export function gradeConceptCount(
  rubric: GradingRubric | null,
  pick: number,
): StepVerdict {
  const truth = rubric?.concept_count
  if (typeof truth !== 'number') return 'neutral'
  return pick === truth ? 'accepted' : 'reject'
}

/**
 * Phase 1 도입 유형 grader — compares the student's 통념/주장/배경지식/통념반박 pick to
 * rubric.intro_type. Soft: 'neutral' when the rubric carries no intro_type (or one
 * outside the four solve-screen options); never reveals the truth.
 */
export function gradeIntroType(
  rubric: GradingRubric | null,
  pick: '통념' | '주장' | '배경지식' | '통념반박',
): StepVerdict {
  const truth = rubric?.intro_type
  if (!truth) return 'neutral'
  return pick === truth ? 'accepted' : 'reject'
}

/**
 * The ONE source of truth for the "삽입 문장은 앞에 뭐가 있어야 성립해요?" choice set.
 * Shared by Phase 2 Q2 and Phase 5b-1 so a definite_reference problem shows the
 * referent option in BOTH places. Returns the option pills (id/label) plus which
 * id is correct for THIS anaphor_type — the component only ever renders id/label;
 * the correctId is consumed by gradeAnaphorType (frame layer), never rendered.
 */
export function anaphorChoices(anaphorType: string | undefined): {
  options: { id: string; label: string }[]
  correctId: string
} {
  const threeWay = [
    { id: 'contrast', label: '반대·대조되는 내용' },
    { id: 'similar', label: '비슷한 내용' },
    { id: 'cause', label: '원인' },
  ]
  if (anaphorType === 'definite_reference') {
    return {
      options: [
        { id: 'ref', label: '그것이 가리킬 대상이 앞에 이미 나와 있어야' },
        { id: 'contrast', label: '반대되는 내용' },
        { id: 'cause', label: '원인' },
      ],
      correctId: 'ref',
    }
  }
  if (anaphorType === 'similar') return { options: threeWay, correctId: 'similar' }
  if (anaphorType === 'cause') return { options: threeWay, correctId: 'cause' }
  // 'contrast' AND default (undefined/unknown).
  return { options: threeWay, correctId: 'contrast' }
}

/**
 * Phase 2 앞연결 성격 grader (shared with Phase 5b-1). The learner picks an option
 * ID from anaphorChoices; we compare it to that helper's correctId, which is the
 * single source of truth derived from rubric.insertion_sentence.anaphor_type.
 * Returns accepted/reject (no 'neutral'): with a null rubric the default choice set
 * grades against 'contrast', which is a harmless nudge — it never reveals the slot.
 */
export function gradeAnaphorType(
  rubric: GradingRubric | null,
  pickId: string,
): StepVerdict {
  const { correctId } = anaphorChoices(rubric?.insertion_sentence?.anaphor_type)
  return pickId === correctId ? 'accepted' : 'reject'
}

/**
 * Phase 2 앞 내용 예측 grader — lenient 3-tier against
 * rubric.insertion_sentence.expected_prior_content (canonical + accept) via
 * theme.ts overlap. overlap>=1 → accept, else reject. 'none' when absent.
 */
export function gradePriorContent(
  rubric: GradingRubric | null,
  input: string,
): { graded: ThemeGrade; matched: string[] } {
  const epc = rubric?.insertion_sentence?.expected_prior_content
  const hasRef = Boolean(
    epc && (epc.canonical || (epc.accept && epc.accept.length > 0)),
  )
  if (!epc || !hasRef) return { graded: 'none', matched: [] }

  const reference = extractKeywords(
    [epc.canonical, ...(epc.accept ?? [])].join(' '),
  )
  const tokens = extractKeywords(input)
  const { overlap } = computeOverlap(tokens, reference)
  const graded: ThemeGrade = overlap.length >= 1 ? 'accept' : 'reject'
  return { graded, matched: overlap }
}

/**
 * Phase 3 슬롯 적합 grader — did the learner's 자연스러움/어색함 call on `slot`
 * match rubric.slot_fit[slot].fit? ANSWER-SAFE by construction: marking the ONE
 * fit:true slot 자연스러움 AND marking any fit:false slot 어색함 both return
 * 'accepted', so a neutral-on-accept UI never singles out the answer slot.
 *   pick 자연스러움 on a fit:true slot  → accepted
 *   pick 어색함     on a fit:false slot → accepted
 *   otherwise                          → reject
 *   'neutral' when the rubric carries no slot_fit for this slot.
 */
export function gradeSlotFit(
  rubric: GradingRubric | null,
  slot: number,
  pick: '자연스러움' | '어색함',
): StepVerdict {
  const slotFit = rubric?.slot_fit
  if (!Array.isArray(slotFit) || slotFit.length === 0) return 'neutral'
  const entry = slotFit.find((s) => s.slot === slot)
  if (!entry || typeof entry.fit !== 'boolean') return 'neutral'
  return (pick === '자연스러움') === entry.fit ? 'accepted' : 'reject'
}

/**
 * Passage with the insert sentence spliced at `slot` (1-5): position k sits
 * BETWEEN segments[k-1] and segments[k]. Returns the surrounding context split so
 * a component can highlight only the inserted sentence. Pure; never touches the
 * rubric, so it reveals nothing about correctness.
 *   before   = segments[0..slot-1] joined (everything up to the slot)
 *   inserted = the insert sentence
 *   after    = segments[slot..] joined (everything past the slot)
 */
export interface InsertPreview {
  before: string
  inserted: string
  after: string
}

export function splicePreview(
  segments: string[],
  insertSentence: string,
  slot: number,
): InsertPreview {
  const before = segments.slice(0, slot).join(' ').replace(/\s+/g, ' ').trim()
  const after = segments.slice(slot).join(' ').replace(/\s+/g, ' ').trim()
  return { before, inserted: (insertSentence ?? '').trim(), after }
}

/**
 * Phase 4 자기 언어 정리 grader — lenient 3-tier over rubric.reasoning_keywords via
 * theme.ts overlap. This is REFLECTIVE (never gates advancing) so it stays gentle:
 *   overlap >= 1                 → accept  (touched a reference idea)
 *   overlap 0 but wrote tokens   → partial (a real attempt, just no keyword hit)
 *   overlap 0 and empty/garbage  → reject
 *   no reasoning_keywords        → none
 * NEVER returns the keywords themselves — only the student's overlapping words.
 */
export function gradeReasoning(
  rubric: GradingRubric | null,
  input: string,
): { graded: ThemeGrade; matched: string[] } {
  const kws = rubric?.reasoning_keywords
  const hasRef = Array.isArray(kws) && kws.length > 0
  if (!hasRef) return { graded: 'none', matched: [] }

  const reference = extractKeywords(kws.join(' '))
  const tokens = extractKeywords(input)
  const { overlap } = computeOverlap(tokens, reference)
  const graded: ThemeGrade =
    overlap.length >= 1 ? 'accept' : tokens.length > 0 ? 'partial' : 'reject'
  return { graded, matched: overlap }
}

/**
 * Phase 5b-2 신호 충족 grader — does the 앞 문장 at `slot` actually satisfy the
 * insert sentence's backward signal? Compares the learner's 만족함/만족 안 함 call to
 * rubric.signal_check[slot].satisfies. ANSWER-SAFE: for any WRONG slot reaching
 * Phase 5, satisfies is false, so '만족 안 함' (they see the gap) is accepted.
 * 'neutral' when the rubric carries no signal_check entry for this slot.
 */
export function gradeSignalSatisfies(
  rubric: GradingRubric | null,
  slot: number,
  pick: '만족함' | '만족 안 함',
): StepVerdict {
  const list = rubric?.signal_check
  if (!Array.isArray(list) || list.length === 0) return 'neutral'
  const entry = list.find((s) => s.slot === slot) ?? list[slot - 1]
  if (!entry || typeof entry.satisfies !== 'boolean') return 'neutral'
  const correct: '만족함' | '만족 안 함' = entry.satisfies ? '만족함' : '만족 안 함'
  return pick === correct ? 'accepted' : 'reject'
}
