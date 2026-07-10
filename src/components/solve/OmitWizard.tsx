import { useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { logAttempt } from '../../lib/logAttempt'
import type { Problem } from '../../lib/useProblem'
import type { TopicGrade } from '../../lib/solve/gradeTopic'
import {
  gradeIntroType,
  gradeOmitReason,
  gradeOmitTopic,
  gradeSentenceRelevance,
  omitIntro,
  omitTrapDiagnosis,
  parseOmitSentences,
  topicGradeToTheme,
} from '../../lib/solve/omit'
import ComingSoon from './ComingSoon'
import WizardShell from './WizardShell'
import StepOmitTopic from './StepOmitTopic'
import StepOmitScan from './StepOmitScan'
import StepOmitConfirm from './StepOmitConfirm'
import StepOmitExplain from './StepOmitExplain'
import { AskButton, useWizard } from './wizardFrame'
import type { StepDef } from './wizardFrame'
import type { OmitRunState, ThemeGrade } from './types'

/** Fresh 무관-run state seeded from the parsed passage. */
function initOmitRun(problem: Problem): OmitRunState {
  const { lead, sentences } = parseOmitSentences(problem.passage)
  return {
    lead,
    sentences,
    phase1: {
      topic: { input: '', graded: 'none', matched: [] },
      intro: { pick: null, graded: 'neutral' },
    },
    phase2: { scan: {}, graded: {} },
    phase3: { confirm: { pick: null }, outcome: null },
    phase4: { reason: { input: '', graded: 'none', matched: [] } },
    phase5: { sub: 'diagnose', currentWrong: null, retryCount: 0, reselect: { pick: null } },
  }
}

/**
 * The 무관 5-phase steps — the 삽입 v3 거울상 on the SAME frame. Frame steps: 사전
 * 독해 (P1, intro-only + 소재 gating), 문장 스캔 (P2), 무관 확정 (P3; a CORRECT commit
 * advances → 자기 설명 P4, a WRONG commit renders the P5 오답 회복 loop inline), 자기
 * 설명 (P4, fill-in terminal). All grading runs in frame closures over the FULL
 * rubric; step components see only verdicts. The reconnect pair is computed in code
 * (never from flow_without). anti-leak enforced by toDisplayRubric (omit branch).
 */
function omitSteps(problem: Problem): StepDef<OmitRunState>[] {
  const rubric = problem.grading_rubric

  // Phase-1 소재 grader: 0-token client rule first (gradeOmitTopic); only when the
  // rule is ambiguous do we fall back to the grade-topic Edge LLM (like 빈칸). The
  // rubric's topic buckets stay captured in THIS closure — they never reach the
  // step component's props.
  async function gradeTopicWithFallback(
    input: string,
  ): Promise<{ graded: ThemeGrade; matched: string[] }> {
    const res = gradeOmitTopic(rubric, input)
    if (!res.ambiguous) return { graded: res.graded, matched: res.matched }
    try {
      const { data, error } = await supabase.functions.invoke('grade-topic', {
        body: { word: input, topic: rubric?.topic, passage: problem.passage },
      })
      if (error || !data) return { graded: res.graded, matched: res.matched }
      const llm = (data as { graded?: TopicGrade }).graded ?? 'ambiguous'
      return { graded: topicGradeToTheme(llm), matched: res.matched }
    } catch {
      return { graded: res.graded, matched: res.matched }
    }
  }

  return [
    // ── Phase 1. 사전 독해 (omit_topic) — 도입부만 노출 ──────────────────────────
    {
      key: 'omit_topic',
      label: '사전 독해',
      render: ({ run, setRun, recordGrade }) => (
        <StepOmitTopic
          intro={omitIntro(problem.passage)}
          topic={run.phase1.topic}
          onTopicChange={(next) =>
            setRun((r) => ({ ...r, phase1: { ...r.phase1, topic: next } }))
          }
          gradeTopic={(input) => gradeTopicWithFallback(input)}
          introPick={run.phase1.intro}
          onIntroChange={(next) =>
            setRun((r) => ({ ...r, phase1: { ...r.phase1, intro: next } }))
          }
          gradeIntro={(pick) => gradeIntroType(rubric, pick)}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      // GATE: 소재는 reject면 잠금(accept/partial/none 통과), 서론 유형 선택 필수.
      canProceed: (run) =>
        run.phase1.topic.input.trim().length > 0 &&
        run.phase1.topic.graded !== 'reject' &&
        run.phase1.intro.pick !== null,
      serializeInput: (run) =>
        `${run.phase1.topic.input} · 서론 ${run.phase1.intro.pick ?? '?'}`,
      gradeResult: (run) => run.phase1.topic.graded,
      logPayload: (run, timing) => [
        {
          step: 'omit_topic',
          payload: {
            raw_input: run.phase1.topic.input,
            graded: run.phase1.topic.graded,
            grader: 'tier2',
            matched_against: 'topic',
            matched: run.phase1.topic.matched,
            input_mode: 'fill_in',
            time_to_answer_ms: timing.timeToAnswerMs,
          },
        },
        {
          step: 'omit_intro',
          payload: {
            raw_input: run.phase1.intro.pick ?? '',
            graded: run.phase1.intro.graded,
            grader: 'tier1',
            matched_against: 'intro_type',
            input_mode: 'button',
            time_to_answer_ms: timing.timeToAnswerMs,
          },
        },
      ],
    },

    // ── Phase 2. 문장 스캔 (omit_scan) — (1)~(5) 각 문장 기여/의심 ────────────────
    {
      key: 'omit_scan',
      label: '문장 스캔',
      render: ({ run, setRun, recordGrade }) => (
        <StepOmitScan
          lead={run.lead}
          sentences={run.sentences}
          value={run.phase2}
          onChange={(next) => setRun((r) => ({ ...r, phase2: next }))}
          gradeSentence={(num, pick) =>
            gradeSentenceRelevance(rubric, num, pick)
          }
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      // 5개 문장 모두 판단해야 다음.
      canProceed: (run) =>
        Object.keys(run.phase2.scan).length >= run.sentences.length,
      serializeInput: (run) => {
        const suspects = Object.entries(run.phase2.scan)
          .filter(([, v]) => v === '의심')
          .map(([k]) => `(${k})`)
          .join(', ')
        return `의심 ${suspects || '없음'}`
      },
      // ANTI-LEAK: no per-sentence correctness leaves the wizard; chat gets a count.
      gradeResult: (run) => {
        const suspects = Object.values(run.phase2.scan).filter(
          (v) => v === '의심',
        ).length
        return `${suspects}문장 의심`
      },
      logPayload: (run, timing) => ({
        step: 'omit_scan',
        payload: {
          raw: { scan: run.phase2.scan },
          graded: { scanGraded: run.phase2.graded },
          grader: 'tier1',
          matched_against: 'sentence_relevance',
          input_mode: 'button',
          suspects: Object.entries(run.phase2.scan)
            .filter(([, v]) => v === '의심')
            .map(([k]) => Number(k)),
          time_to_answer_ms: timing.timeToAnswerMs,
        },
      }),
    },

    // ── Phase 3. 무관 확정 (omit_confirm) — correct→P4, wrong→P5 inline ──────────
    // Component logs omit_confirm on commit and omit_recover on the wrong branch's
    // terminal (branch-aware), so the frame logPayload is null.
    {
      key: 'omit_confirm',
      label: '무관 확정',
      render: ({ run, setRun, recordGrade }) => (
        <StepOmitConfirm
          sentences={run.sentences}
          answer={problem.answer}
          explanation={problem.explanation}
          problemId={problem.id}
          phase3={run.phase3}
          onPhase3Change={(next) => setRun((r) => ({ ...r, phase3: next }))}
          phase5={run.phase5}
          onPhase5Change={(next) => setRun((r) => ({ ...r, phase5: next }))}
          diagnose={(num) => omitTrapDiagnosis(rubric, num)}
          onGrade={(v, vd) => recordGrade(v, vd)}
          logConfirm={(payload) => {
            void logAttempt(problem.id, 'omit_confirm', payload)
          }}
          logRecover={(payload) => {
            void logAttempt(problem.id, 'omit_recover', payload)
          }}
        />
      ),
      // Correct → advance to 자기 설명. Wrong → inline recover (terminal). Pre-commit → false.
      canProceed: (run) => run.phase3.outcome === 'correct',
      serializeInput: (run) =>
        run.phase3.confirm.pick === null
          ? ''
          : `확정 (${run.phase3.confirm.pick})`,
      gradeResult: (run) =>
        run.phase3.outcome === null ? 'none' : run.phase3.outcome,
      logPayload: () => null,
    },

    // ── Phase 4. 자기 설명 (omit_explain) — fill-in terminal ─────────────────────
    // Component logs omit_explain directly on the check; frame logPayload is null.
    {
      key: 'omit_explain',
      label: '자기 설명',
      render: ({ run, setRun, recordGrade }) => (
        <StepOmitExplain
          selected={run.phase3.confirm.pick ?? (problem.answer as number)}
          explanation={problem.explanation}
          problemId={problem.id}
          value={run.phase4.reason}
          onChange={(next) =>
            setRun((r) => ({ ...r, phase4: { ...r.phase4, reason: next } }))
          }
          gradeReason={(input) => gradeOmitReason(rubric, input)}
          onGrade={(v, vd) => recordGrade(v, vd)}
          logExplain={(payload) => {
            void logAttempt(problem.id, 'omit_explain', payload)
          }}
        />
      ),
      // Terminal, self-driving — no frame Next.
      canProceed: () => false,
      serializeInput: (run) => run.phase4.reason.input,
      gradeResult: (run) => run.phase4.reason.graded,
      logPayload: () => null,
    },
  ]
}

export default function OmitWizard({ problem }: { problem: Problem }) {
  const steps = useMemo(() => omitSteps(problem), [problem])
  const parsed = useMemo(
    () => parseOmitSentences(problem.passage),
    [problem],
  )
  const w = useWizard<OmitRunState>({
    problem,
    initRun: initOmitRun,
    steps,
  })

  // Parse failed (no usable (1)…(5) markers) → no dedicated procedure.
  if (parsed.sentences.length < 2) {
    return <ComingSoon type="무관" />
  }

  return (
    <WizardShell
      stepIdx={w.stepIdx}
      stepLabels={w.stepLabels}
      canProceed={w.canProceed}
      showNext={w.showNext}
      onPrev={w.handlePrev}
      onNext={w.handleNext}
      askSlot={<AskButton level={w.stuck.level} onClick={w.askTeacher} />}
    >
      {w.body}
    </WizardShell>
  )
}
