import { useMemo } from 'react'
import type { Problem } from '../../lib/useProblem'
import {
  anaphorChoices,
  frontSentence,
  gradeAnaphorType,
  gradeConceptCount,
  gradeCuePresence,
  gradeInsertTopic,
  gradeIntroType,
  gradePriorContent,
  gradeReasoning,
  gradeSignalSatisfies,
  gradeSlotFit,
  introSentences,
  parseInsertPassage,
} from '../../lib/solve/insert'
import ComingSoon from './ComingSoon'
import WizardShell from './WizardShell'
import StepInsertTopic from './StepInsertTopic'
import StepInsertAnalyze from './StepInsertAnalyze'
import StepInsertSlotScan from './StepInsertSlotScan'
import StepInsertConfirm from './StepInsertConfirm'
import StepInsertRecover from './StepInsertRecover'
import { AskButton, useWizard } from './wizardFrame'
import type { StepDef } from './wizardFrame'
import type { InsertRunState } from './types'

/** Fresh 삽입-run state seeded from the parsed passage + insert sentence. */
function initInsertRun(problem: Problem): InsertRunState {
  const { segments } = parseInsertPassage(problem.passage)
  return {
    segments,
    insertSentence: (problem.insert_sentence ?? '').trim(),
    phase1: {
      topic: { input: '', graded: 'none', matched: [] },
      conceptCount: { pick: null, graded: 'neutral' },
      intro: { pick: null, graded: 'neutral' },
    },
    phase2: {
      cue: { present: null, graded: 'neutral' },
      anaphorType: { pick: null, graded: 'neutral' },
      priorContent: { input: '', graded: 'none', matched: [] },
    },
    phase3: {
      slotJudgment: {},
      slotGraded: {},
    },
    phase4: {
      pick: { slot: null },
      outcome: null,
      reasoning: { input: '', graded: 'none', matched: [] },
    },
    phase5: {
      sub: '5a',
      currentWrong: null,
      rejudge: null,
      anaphorPick: null,
      anaphorLabel: null,
      signalPick: null,
      retryCount: 0,
      reselect: { slot: null },
      reasoning: { input: '', graded: 'none', matched: [] },
      eliminated: [],
    },
  }
}

/**
 * The 삽입 v2 steps. Phases 1-4 are wired: 소재 파악 (P1, intro-only), 삽입문 분석
 * (P2), 슬롯 소거 스캔 (P3), 답 확정 + 자기 언어 정리 (P4, self-driving terminal on
 * correct). The P4 WRONG branch advances into a Phase-5 (오답 회복) terminal
 * placeholder built next. All grading runs in frame closures over the FULL rubric;
 * step components see only verdicts.
 */
function insertSteps(problem: Problem): StepDef<InsertRunState>[] {
  const rubric = problem.grading_rubric
  // ONE source of truth for the "앞에 뭐가 있어야?" pills — shared by Phase 2 Q2 and
  // Phase 5b-1 so a definite_reference problem shows the referent option in both.
  const anaphorOptions = anaphorChoices(
    rubric?.insertion_sentence?.anaphor_type,
  ).options

  return [
    // ── Phase 1. 소재 파악 (insert_topic) — 도입부만 노출 ─────────────────────────
    {
      key: 'insert_topic',
      label: '소재 파악',
      render: ({ run, setRun, recordGrade }) => (
        <StepInsertTopic
          intro={introSentences(problem.passage)}
          topic={run.phase1.topic}
          onTopicChange={(next) =>
            setRun((r) => ({ ...r, phase1: { ...r.phase1, topic: next } }))
          }
          gradeTopic={(input) => gradeInsertTopic(rubric, input)}
          conceptCount={run.phase1.conceptCount}
          onConceptChange={(next) =>
            setRun((r) => ({
              ...r,
              phase1: { ...r.phase1, conceptCount: next },
            }))
          }
          gradeConcept={(pick) => gradeConceptCount(rubric, pick)}
          introPick={run.phase1.intro}
          onIntroChange={(next) =>
            setRun((r) => ({ ...r, phase1: { ...r.phase1, intro: next } }))
          }
          gradeIntro={(pick) => gradeIntroType(rubric, pick)}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      canProceed: (run) =>
        run.phase1.topic.input.trim().length > 0 &&
        run.phase1.conceptCount.pick !== null &&
        run.phase1.intro.pick !== null,
      serializeInput: (run) =>
        `${run.phase1.topic.input} · 개념 ${
          run.phase1.conceptCount.pick ?? '?'
        }개 · 도입 ${run.phase1.intro.pick ?? '?'}`,
      gradeResult: (run) => run.phase1.topic.graded,
      logPayload: (run, timing) => ({
        step: 'insert_topic',
        payload: {
          raw_input: run.phase1.topic.input,
          graded: run.phase1.topic.graded,
          matched: run.phase1.topic.matched,
          concept_count_pick: run.phase1.conceptCount.pick,
          concept_count_graded: run.phase1.conceptCount.graded,
          intro_pick: run.phase1.intro.pick,
          intro_graded: run.phase1.intro.graded,
          time_to_answer_ms: timing.timeToAnswerMs,
        },
      }),
    },

    // ── Phase 2. 삽입문 분석 (insert_analyze) — 삽입 문장만 노출 ──────────────────
    {
      key: 'insert_analyze',
      label: '삽입문 분석',
      render: ({ run, setRun, recordGrade }) => (
        <StepInsertAnalyze
          insertSentence={run.insertSentence}
          cue={run.phase2.cue}
          onCueChange={(next) =>
            setRun((r) => ({ ...r, phase2: { ...r.phase2, cue: next } }))
          }
          gradeCue={(pick) => gradeCuePresence(run.insertSentence, pick)}
          anaphorType={run.phase2.anaphorType}
          onAnaphorChange={(next) =>
            setRun((r) => ({
              ...r,
              phase2: { ...r.phase2, anaphorType: next },
            }))
          }
          gradeAnaphor={(pickId) => gradeAnaphorType(rubric, pickId)}
          anaphorOptions={anaphorOptions}
          priorContent={run.phase2.priorContent}
          onPriorChange={(next) =>
            setRun((r) => ({
              ...r,
              phase2: { ...r.phase2, priorContent: next },
            }))
          }
          gradePrior={(input) => gradePriorContent(rubric, input)}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      canProceed: (run) =>
        run.phase2.cue.present !== null &&
        run.phase2.anaphorType.pick !== null &&
        run.phase2.priorContent.input.trim().length > 0,
      serializeInput: (run) =>
        `지시어 ${run.phase2.cue.present ?? '?'} / 앞연결 ${
          run.phase2.anaphorType.pick ?? '?'
        } / ${run.phase2.priorContent.input}`,
      gradeResult: (run) => run.phase2.priorContent.graded,
      logPayload: (run, timing) => ({
        step: 'insert_analyze',
        payload: {
          cue_present: run.phase2.cue.present,
          cue_graded: run.phase2.cue.graded,
          anaphor_pick: run.phase2.anaphorType.pick,
          anaphor_graded: run.phase2.anaphorType.graded,
          raw_input: run.phase2.priorContent.input,
          graded: run.phase2.priorContent.graded,
          matched: run.phase2.priorContent.matched,
          time_to_answer_ms: timing.timeToAnswerMs,
        },
      }),
    },

    // ── Phase 3. 슬롯 소거 스캔 (insert_slotscan) — 전체 지문 5슬롯 순차 O/X ───────
    {
      key: 'insert_slotscan',
      label: '슬롯 소거',
      render: ({ run, setRun, recordGrade }) => (
        <StepInsertSlotScan
          segments={run.segments}
          insertSentence={run.insertSentence}
          value={run.phase3}
          onChange={(next) => setRun((r) => ({ ...r, phase3: next }))}
          // Frame-grader closure over the FULL rubric; component sees only verdicts.
          gradeSlot={(slot, pick) => gradeSlotFit(rubric, slot, pick)}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      // 5칸 모두 판단 + 적어도 한 자리는 '자연스러움'으로 남겨야 Phase 4에 후보가 있음.
      canProceed: (run) => {
        const slotCount = Math.max(0, run.segments.length - 1)
        const judged = Object.keys(run.phase3.slotJudgment).length
        const natural = Object.values(run.phase3.slotJudgment).filter(
          (v) => v === '자연스러움',
        ).length
        return judged >= slotCount && natural >= 1
      },
      serializeInput: (run) => {
        const kept = Object.entries(run.phase3.slotJudgment)
          .filter(([, v]) => v === '자연스러움')
          .map(([k]) => k)
          .join(', ')
        return `남긴 자리 ${kept || '없음'}`
      },
      // ANTI-LEAK: no per-slot correctness leaves the wizard; chat gets a neutral summary.
      gradeResult: (run) => {
        const eliminated = Object.values(run.phase3.slotJudgment).filter(
          (v) => v === '어색함',
        ).length
        return `${eliminated}자리 소거`
      },
      logPayload: (run, timing) => ({
        step: 'insert_slotscan',
        payload: {
          raw: { slotJudgment: run.phase3.slotJudgment },
          graded: { slotGraded: run.phase3.slotGraded },
          eliminated: Object.entries(run.phase3.slotJudgment)
            .filter(([, v]) => v === '어색함')
            .map(([k]) => Number(k)),
          time_to_answer_ms: timing.timeToAnswerMs,
        },
      }),
    },

    // ── Phase 4. 답 확정 + 자기 언어 정리 (insert_confirm) — self-drives ──────────
    // The student commits ONE surviving slot (Phase-3 '어색함' slots are grayed +
    // disabled + 소거함). Correct → TERMINAL (process framing + reflective fill-in +
    // 해설 + chat). Wrong → task-level nudge and the frame enables Next → Phase 5.
    {
      key: 'insert_confirm',
      label: '답 확정',
      render: ({ run, setRun, recordGrade, logNow }) => (
        <StepInsertConfirm
          segments={run.segments}
          slotJudgment={run.phase3.slotJudgment}
          answer={problem.answer}
          explanation={problem.explanation}
          problemId={problem.id}
          value={run.phase4}
          onChange={(next) => setRun((r) => ({ ...r, phase4: next }))}
          onComplete={(fs) => logNow({ ...run, phase4: fs })}
          // Frame-grader closure over the FULL rubric; component sees only verdicts.
          gradeReasoning={(input) => gradeReasoning(rubric, input)}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      // Correct → terminal (no Next). Wrong → advance into Phase 5. Pre-commit → false.
      canProceed: (run) => run.phase4.outcome === 'wrong',
      serializeInput: (run) =>
        run.phase4.pick.slot === null
          ? ''
          : `확정 자리 ${run.phase4.pick.slot}`,
      gradeResult: (run) =>
        run.phase4.outcome === null
          ? 'none'
          : run.phase4.pick.slot === problem.answer
            ? 'correct'
            : 'wrong',
      logPayload: (run) => {
        const selected = run.phase4.pick.slot
        const is_correct =
          problem.answer !== null && selected === problem.answer
        const candidates = Object.keys(run.phase3.slotJudgment)
          .map(Number)
          .filter((k) => run.phase3.slotJudgment[k] !== '어색함')
        return {
          step: 'insert_confirm',
          payload: {
            selected,
            correct_answer: problem.answer,
            is_correct,
            candidates,
            reasoning: {
              input: run.phase4.reasoning.input,
              graded: run.phase4.reasoning.graded,
            },
          },
        }
      },
    },

    // ── Phase 5. 오답 회복 (insert_recover) — self-driving recovery loop ──────────
    // The Phase-4 WRONG branch advances here. Re-judge the wrong slot → restate the
    // backward signal → read the 앞 문장 and check satisfaction → either hand off to
    // the tutor (signal not internalized) or re-select until the answer is found.
    // Terminal + self-driving: canProceed is false; the step logs itself via onComplete.
    {
      key: 'insert_recover',
      label: '오답 회복',
      render: ({ run, setRun, recordGrade, logNow }) => (
        <StepInsertRecover
          segments={run.segments}
          answer={problem.answer as number}
          wrongSlot={run.phase4.pick.slot as number}
          phase3Eliminated={Object.entries(run.phase3.slotJudgment)
            .filter(([, v]) => v === '어색함')
            .map(([k]) => Number(k))}
          anaphorExpression={
            rubric?.insertion_sentence?.anaphor_expression ?? ''
          }
          anaphorOptions={anaphorOptions}
          gradeSlot={(s, p) => gradeSlotFit(rubric, s, p)}
          gradeAnaphor={(id) => gradeAnaphorType(rubric, id)}
          gradeSignal={(s, p) => gradeSignalSatisfies(rubric, s, p)}
          gradeReasoning={(i) => gradeReasoning(rubric, i)}
          frontOf={(s) => frontSentence(run.segments, s)}
          explanation={problem.explanation}
          problemId={problem.id}
          value={run.phase5}
          onChange={(next) => setRun((r) => ({ ...r, phase5: next }))}
          onComplete={(fs) => logNow({ ...run, phase5: fs })}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      // Terminal, self-driving loop — no frame Next.
      canProceed: () => false,
      serializeInput: (run) => `재시도 ${run.phase5.retryCount}회`,
      gradeResult: (run) =>
        run.phase5.sub === 'done'
          ? 'recovered'
          : run.phase5.sub === 'handoff'
            ? 'handoff'
            : 'none',
      logPayload: (run) => ({
        step: 'insert_recover',
        payload: {
          retry_count: run.phase5.retryCount,
          retry_success: run.phase5.sub === 'done',
          handoff_reason:
            run.phase5.sub === 'handoff'
              ? 'signal_understanding_gap'
              : undefined,
          final_sub: run.phase5.sub,
          reasoning: {
            input: run.phase5.reasoning.input,
            graded: run.phase5.reasoning.graded,
          },
        },
      }),
    },
  ]
}

export default function InsertWizard({ problem }: { problem: Problem }) {
  const steps = useMemo(() => insertSteps(problem), [problem])
  const segments = useMemo(
    () => parseInsertPassage(problem.passage).segments,
    [problem],
  )
  const w = useWizard<InsertRunState>({
    problem,
    initRun: initInsertRun,
    steps,
  })

  // Parse failed (no usable markers) → no dedicated procedure.
  if (segments.length < 2) {
    return <ComingSoon type="삽입" />
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
