// Solve-flow state shapes. Used ONLY by src/components/solve/* — never imported
// by the chat flow.

import type { TopicGrade } from '../../lib/solve/gradeTopic'
import type { GrammarCategory } from '../../lib/solve/grammar'

export type IntroType = '통념' | '주장' | '배경지식'
export type Polarity = '+' | '-' | '?'
export type ElimReason = '소재다름' | '방향반대' | '본문없음'

export interface SentenceMark {
  index: number
  text: string
  mark: Polarity | null
}

/**
 * Result of the 소재 nudge grading. `grader` records which path produced it:
 * 'rule' (client matcher), 'llm' (grade-topic fallback), or 'none' (no rubric /
 * grader errored). NONE of this gates advancing.
 */
export interface TopicGradeResult {
  rawInput: string
  graded: TopicGrade | 'none'
  grader: 'rule' | 'llm' | 'none'
  matchedAgainst: string | null
}

export interface PrereadingState {
  topicWord: string
  introType: IntroType | null
  blankSentence: string
  // 소재 채점 결과(넛지). null이면 아직 '확인'을 누르지 않았거나 rubric이 없음.
  topicGrade: TopicGradeResult | null
  // 서론유형이 '통념'일 때만 나오는 후속 태그(연구용). v1은 정오답 처리 안 함.
  agreeTag: 'agree' | 'disagree' | null
}

export interface PolarityState {
  sentences: SentenceMark[]
}

export type ThemeGrade = 'accept' | 'partial' | 'reject' | 'none'

export interface ThemeRecallState {
  theme: string
  referenceKeywords: string[]
  overlapKeywords: string[]
  overlapRatio: number
  // Soft grading result vs rubric.theme_keywords (넛지). 'none' when no rubric
  // (fell back to explanation-based overlap). NONE of this gates advancing.
  graded: ThemeGrade
  matchedKeywords: string[]
}

export interface ChoiceState {
  // choice indices are 1-based to match problems.answer
  eliminations: Record<number, ElimReason>
  comparedNote: Record<number, '유력' | '보류'>
  evidence: string
  finalChoice: number | null
}

export interface BlankRunState {
  prereading: PrereadingState
  polarity: PolarityState
  themeRecall: ThemeRecallState
  choice: ChoiceState
}

// ── 순서 run state ──────────────────────────────────────────────────────────

export type OrderLabel = 'A' | 'B' | 'C'

/**
 * 소거 step — blocks the student judges can NOT come first (eliminated), plus the
 * soft verdict from grading them against rubric.anchor.block. Nothing gates
 * advancing; graded is a nudge only.
 */
export interface OrderEliminateState {
  eliminated: OrderLabel[]
  graded: ThemeGrade
  // Tapped "왜 이 문단이 바로 다음에 못 오나" reason option id (넛지, research).
  reasonPick: string | null
}

export interface OrderArrangeState {
  order: OrderLabel[]
  positionsCorrect: number
  graded: ThemeGrade
  // Per-pair reason picks keyed by PairWhy.key (넛지, research). Replaces the old
  // whole-order reasonPick, which leaked the full-order conclusion.
  pairPicks: Record<string, string | null>
}

/**
 * 이어읽기(자기점검) — 정한 순서대로 읽어보고 자연스러운지 스스로 판단한다.
 * rubric과 하드 채점하지 않는다: '자연스러워요'가 정답을 뜻하지 않는다.
 */
export interface OrderVerifyState {
  naturalness: 'natural' | 'awkward' | null
  note: string
}

export interface OrderChoiceState {
  finalChoice: number | null
  evidence: string
}

export interface OrderRunState {
  given: string
  blocks: { label: OrderLabel; text: string }[]
  eliminate: OrderEliminateState
  arrange: OrderArrangeState
  verify: OrderVerifyState
  choice: OrderChoiceState
}

// ── 어법 run state ──────────────────────────────────────────────────────────

/**
 * 범주 진단 — per-underline category pick + its soft verdict, plus the inline
 * per-category micro-check (folded in from the old 주어 수일치 step). `graded`
 * holds the category verdict; `microGraded` the micro-check verdict. Both are
 * nudges (frame-layer graders); nothing gates advancing.
 */
export interface GrammarDiagnoseState {
  picks: Record<number, GrammarCategory | null>
  graded: Record<number, StepVerdict> // category verdict
  micro: Record<
    number,
    {
      hasObject?: '있음' | '없음' | null
      clause?: '완전' | '불완전' | null
      pos?: '부사' | '형용사' | null
      subjectInput?: string
      number?: '단수' | '복수' | null
    }
  >
  microGraded: Record<number, StepVerdict> // micro-check verdict
}

export interface GrammarChoiceState {
  finalChoice: number | null // 1-based underline num judged grammatically wrong
  reasonPick: string | null // tapped why-option id (only the answer num has options)
  evidence: string
}

export interface GrammarRunState {
  underlines: { num: number; word: string }[]
  diagnose: GrammarDiagnoseState
  choice: GrammarChoiceState
}

// ── 어휘 run state ──────────────────────────────────────────────────────────

/** Step 1 — the student's read of the whole-passage polarity. */
export interface VocabPolarityState {
  passagePick: '+' | '-' | null
}

/** Step 1 (NEW) — 소재 파악: free-text one-liner soft-graded vs rubric.topic. */
export interface VocabTopicState {
  input: string
  graded: ThemeGrade
  matched: string[]
}

/**
 * Step 3 — per-underline conflict finding. Q1: does the word match or clash with
 * the passage direction. Only when '충돌' is picked do we reveal Q2 (negation).
 * `*Graded` hold soft frame verdicts; nothing gates advancing.
 */
export interface VocabDiagnoseState {
  conflict: Record<number, '맞음' | '충돌' | null>
  conflictGraded: Record<number, StepVerdict>
  negation: Record<number, '있음' | '없음' | null>   // only for 충돌 underlines
  negGraded: Record<number, StepVerdict>
}

export interface VocabChoiceState {
  finalChoice: number | null // 1-based underline num judged the wrong word
  reasonPick: string | null // tapped why-option id (only the answer num has options)
  evidence: string
}

export interface VocabRunState {
  underlines: { num: number; word: string }[]
  topic: VocabTopicState
  polarity: VocabPolarityState
  diagnose: VocabDiagnoseState
  choice: VocabChoiceState
}

// ── 삽입 run state ──────────────────────────────────────────────────────────

/**
 * 삽입(sentence-insertion) run state — v2 5-phase scaffolding. The student builds
 * the answer from the top down: read the intro & name the topic (P1), analyse the
 * insert sentence's backward-pointing cue (P2), then scan/eliminate slots and
 * commit (P3-5, added in later tasks). Only phase1/phase2 are wired now; phase3-5
 * are optional so later tasks extend them without churning P1/P2.
 */
export interface InsertRunState {
  segments: string[]
  insertSentence: string
  // ── Phase 1: 소재 파악 (intro-only) ──
  phase1: {
    topic: { input: string; graded: ThemeGrade; matched: string[] }
    conceptCount: { pick: number | null; graded: StepVerdict }
    // 도입 유형(통념/주장/배경지식/통념반박) — 학생이 스스로 고르고 soft 채점.
    intro: {
      pick: '통념' | '주장' | '배경지식' | '통념반박' | null
      graded: StepVerdict
    }
  }
  // ── Phase 2: 삽입 문장 분석 ──
  phase2: {
    cue: { present: '있음' | '없음' | null; graded: StepVerdict }
    anaphorType: {
      // choice-id from anaphorChoices (e.g. 'contrast' | 'similar' | 'cause' | 'ref')
      pick: string | null
      graded: StepVerdict
    }
    priorContent: { input: string; graded: ThemeGrade; matched: string[] }
  }
  // ── Phase 3: 슬롯 소거 스캔 (5슬롯 순차 O/X) ──
  phase3: {
    // student's per-slot 자연스러움/어색함 call (1-based slot keys)
    slotJudgment: Record<number, '자연스러움' | '어색함'>
    // internal-only per-slot verdict; NEVER rendered as a ✓ that IDs the answer
    slotGraded: Record<number, StepVerdict>
  }
  // ── Phase 4: 답 확정 + 자기 언어 정리 ──
  phase4: {
    // the ONE slot the student commits to (from the non-eliminated candidates)
    pick: { slot: number | null }
    // set on commit: correct (pick === answer) → terminal; wrong → routes to P5
    outcome: 'correct' | 'wrong' | null
    // reflective one-liner, lenient overlap vs reasoning_keywords. Only surfaced
    // on the correct branch; never gates advancing.
    reasoning: { input: string; graded: ThemeGrade; matched: string[] }
  }
  // ── Phase 5: 오답 회복 (self-driving recovery loop) ──
  // Re-judges the committed wrong slot, re-checks the backward signal, then either
  // routes the student to a tutor handoff (signal not internalized) or lets them
  // re-select a non-eliminated slot until they land on the answer.
  phase5: {
    sub: '5a' | '5b1' | '5b2' | '5c' | 'handoff' | 'done'
    currentWrong: number | null
    rejudge: '자연스러움' | '어색함' | null
    anaphorPick: string | null
    anaphorLabel: string | null
    signalPick: '만족함' | '만족 안 함' | null
    retryCount: number
    reselect: { slot: number | null }
    reasoning: { input: string; graded: ThemeGrade; matched: string[] }
    eliminated: number[]
  }
}

// ── 무관 run state ──────────────────────────────────────────────────────────

export type OmitIntroPick = '통념반박' | '주장' | '배경지식'
export type OmitScanPick = '기여' | '의심'

/**
 * 무관(irrelevant-sentence) run state — the 삽입 v3 거울상. The student reads the
 * intro & names the topic (P1), scans each numbered sentence for topic-relevance
 * (P2), commits the ONE irrelevant sentence (P3), explains why in their own words
 * (P4, fill-in), and — on a wrong commit — walks a diagnostic recovery loop (P5).
 * Every judgement runs through a frame-grader closure over the FULL rubric; no
 * step component reads the rubric. Machine mirrors InsertRunState.
 */
export interface OmitRunState {
  lead: string // passage text before the (1) marker (topic anchor).
  sentences: string[] // the 5 numbered sentence texts, index 0 == (1).
  // ── Phase 1: 사전 독해 (intro-only) ──
  phase1: {
    topic: { input: string; graded: ThemeGrade; matched: string[] }
    intro: { pick: OmitIntroPick | null; graded: StepVerdict }
  }
  // ── Phase 2: 문장별 주제기여 스캔 ──
  phase2: {
    // per-sentence 기여/의심 call (1-based sentence keys)
    scan: Record<number, OmitScanPick>
    // internal-only per-sentence verdict; NEVER rendered as a mark that IDs the answer
    graded: Record<number, StepVerdict>
  }
  // ── Phase 3: 무관 확정 + 빼보기 검증 ──
  phase3: {
    confirm: { pick: number | null }
    // set on commit: correct (pick === answer) → advance to P4; wrong → P5 (inline)
    outcome: 'correct' | 'wrong' | null
  }
  // ── Phase 4: 왜 무관인지 자기설명 (fill-in) — 정답 확정 후 ──
  phase4: {
    reason: { input: string; graded: ThemeGrade; matched: string[] }
  }
  // ── Phase 5: 오답 회복 (self-driving recovery loop) ──
  // Diagnose the committed wrong pick (trap-aware) then redirect: re-select until
  // the answer is found (done), or hand off to the tutor on repeated failure.
  phase5: {
    sub: 'diagnose' | 'reselect' | 'handoff' | 'done'
    currentWrong: number | null
    retryCount: number
    reselect: { pick: number | null }
  }
}

// ── Contingent-chat scaffold (data-only; no logic/components cross to chat) ──

/** Verdict a step's grading action produces, used for stuck-signal detection. */
export type StepVerdict = 'accepted' | 'reject' | 'neutral'

/** Which wizard step the student jumped to chat from. Blank uses the four keys
 * 'prereading' | 'polarity' | 'theme' | 'choice'; kept as a string so other
 * problem-type wizards can define their own step keys. */
export type WizardStepKey = string

/** Why the "ask the teacher" affordance fired at jump time. Intensity order:
 * retry_same (max) > retry > reject/timeout > none. */
export type WizardEntryTrigger =
  | 'retry_same'
  | 'retry'
  | 'reject'
  | 'timeout'
  | 'none'

/**
 * Plain, serializable snapshot handed wizard → chat via router state. Chat builds
 * its OWN prompt injection from this; it shares NO component or prompt logic with
 * the wizard (CLAUDE.md Rule 4). `snapshot` is the full `run` for round-tripping
 * back into the wizard on "다시 풀어보기".
 */
export interface WizardChatContext {
  step: WizardStepKey
  studentInput: string
  gradeResult: string
  entryTrigger: WizardEntryTrigger
  snapshot: unknown
}

// ── Recovery Loop (통일 오답 회복, 1-retry 하드캡) ────────────────────────────
// Generic self-driving recovery shared by every solve wizard. The component
// reads NO rubric: each judgement arrives as a frame closure returning ONLY a
// verdict (원칙1 진단 not 재교육). See RecoveryLoop.tsx + recovery_design.md.
// The 1-retry hard cap is STRUCTURAL — reselect happens at most once and never
// routes back to a question. Nothing here ever carries the correct answer/해설.

/**
 * 원칙2 mirror — the student's OWN prior-phase judgments, pulled from the
 * attempts log. Rendered as "네가 앞에서 X라고 했지?" before any question. Only
 * ever holds what the STUDENT committed earlier; never the correct answer.
 */
export type RecoveryPriorJudgment = { label: string; value: string }[]

/**
 * Where a graded answer routes next. 'continue' → next question (or the single
 * reselect if this was the last one); 'reselect' → early-jump to that single
 * re-selection (the 삽입 5b2 '만족 안 함' gap); 'handoff' → straight to the tutor.
 * reselect stays reachable at most once regardless of route.
 */
export type RecoveryRoute = 'continue' | 'reselect' | 'handoff'

/**
 * One diagnostic question along the type's existing axis (원칙4). `grade` is a
 * frame closure over the FULL rubric that returns ONLY a verdict. `mode:'fill_in'`
 * ("왜?"류) renders a text input; `mode:'button'` renders discrete `options`.
 * `route`/`handoffReason` let a decisive answer early-jump without breaking the
 * hard cap (reselect is still spent at most once).
 */
export interface RecoveryQuestion {
  id: string
  prompt: (prior: RecoveryPriorJudgment) => string
  mode: 'button' | 'fill_in'
  options?: { id: string; label: string }[]
  grade: (input: string) => StepVerdict
  route?: (input: string, verdict: StepVerdict) => RecoveryRoute
  handoffReason?: (input: string) => string
}

/**
 * The single re-selection UI. `isCorrect` is a frame closure (the component
 * reads no rubric). `excludeIds` blocks already-eliminated / committed-wrong
 * options so the student can't re-pick a dead end.
 */
export interface RecoveryReselect {
  kind: 'choice' | 'block' | 'underline'
  options: { id: string; label: string }[]
  isCorrect: (pickId: string) => boolean
  excludeIds?: string[]
}

/**
 * attempts.payload.recovery — the persisted recovery record. The host wizard
 * writes it via logAttempt; RecoveryLoop only calls the injected `log`.
 */
export interface RecoveryLogPayload {
  triggered: boolean
  initial_answer: string
  recovery_steps: {
    q_id: string
    raw: string
    graded: StepVerdict
    input_mode: 'button' | 'fill_in'
    time_ms: number
  }[]
  recovery_outcome: 'retry_success' | 'retry_fail' | 'chat_handoff'
  // 학생이 튜터-이관 화면에 실제로 도달했는지(원칙3 "1회 실패 → 챗 이관"의 데이터
  // 근거). TRUE = phase가 'handoff'에 도달 = retry_fail ∪ chat_handoff. 연구 집계에서
  // 합집합 규칙을 기억할 필요 없이 이 불린 카운트만으로 handoff 도달 수를 얻는다.
  reached_handoff: boolean
  handoff_reason: string | null
  retry_answer: string | null
}

/**
 * Internal run state of RecoveryLoop. The 1-retry hard cap is STRUCTURAL: once
 * `phase` reaches 'reselect' the only outgoing transitions are to 'done' |
 * 'handoff' — no handler assigns `phase:'question'` after 'reselect', and
 * `retryUsed` records that the single reselect was spent so it can never be
 * re-entered. There is no third pass through recoveryQuestions.
 */
export interface RecoveryRunState {
  phase: 'mirror' | 'question' | 'reselect' | 'done' | 'handoff'
  qIndex: number
  answers: Record<
    string,
    {
      raw: string
      graded: StepVerdict
      input_mode: 'button' | 'fill_in'
      time_ms: number
    }
  >
  retryUsed: boolean
  reselectPick: string | null
  outcome: 'retry_success' | 'retry_fail' | 'chat_handoff' | null
}
