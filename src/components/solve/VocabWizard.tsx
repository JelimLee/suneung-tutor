import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Problem } from '../../lib/useProblem'
import {
  gradeConflict,
  gradeFits,
  gradeNegation,
  gradePassagePolarity,
  gradeSentencePolarity,
  gradeVocabTopic,
  gradeWordPolarity,
  parseUnderlines,
  vocabReselectCorrect,
} from '../../lib/solve/vocab'
import { gradeWhyOption } from '../../lib/solve/whyOptions'
import { logAttempt } from '../../lib/logAttempt'
import ComingSoon from './ComingSoon'
import WizardShell from './WizardShell'
import StepVocabTopic from './StepVocabTopic'
import StepPassagePolarity from './StepPassagePolarity'
import StepVocabDiagnose from './StepVocabDiagnose'
import StepVocabChoice from './StepVocabChoice'
import { AskButton, useWizard } from './wizardFrame'
import type { StepDef } from './wizardFrame'
import type {
  RecoveryPriorJudgment,
  RecoveryQuestion,
  RecoveryReselect,
  VocabRunState,
} from './types'

/** Fresh 어휘-run state seeded from the parsed underlines. */
function initVocabRun(problem: Problem): VocabRunState {
  const underlines = parseUnderlines(problem.grading_rubric, problem.choices)
  return {
    underlines,
    topic: { input: '', graded: 'none', matched: [] },
    polarity: { passagePick: null },
    diagnose: { conflict: {}, conflictGraded: {}, negation: {}, negGraded: {} },
    choice: { finalChoice: null, reasonPick: null, evidence: '' },
  }
}

/** The 어휘 steps: 소재 파악 → 글 부호 → 밑줄 진단(충돌/부정어) → 틀린 낱말. */
function vocabSteps(problem: Problem): StepDef<VocabRunState>[] {
  const rubric = problem.grading_rubric
  const steps: StepDef<VocabRunState>[] = []

  // ── 1. 소재 파악 (topic) — 한 줄 소재 소프트 채점 ────────────────────────────
  steps.push({
    key: 'vocab_topic',
    label: '소재 파악',
    render: ({ run, setRun, recordGrade }) => (
      <StepVocabTopic
        value={run.topic}
        onChange={(next) => setRun((r) => ({ ...r, topic: next }))}
        grade={(input) => gradeVocabTopic(rubric, input)}
        onGrade={(v, vd) => recordGrade(v, vd)}
      />
    ),
    canProceed: (run) => run.topic.input.trim().length > 0,
    serializeInput: (run) => run.topic.input,
    gradeResult: (run) => run.topic.graded,
    logPayload: (run) => ({
      step: 'vocab_topic',
      payload: {
        input: run.topic.input,
        graded: run.topic.graded,
        matched: run.topic.matched,
      },
    }),
  })

  // ── 2. 글 부호 (passage polarity) ──────────────────────────────────────────
  steps.push({
    key: 'vocab_polarity',
    label: '글 부호',
    render: ({ run, setRun, recordGrade }) => (
      <StepPassagePolarity
        passagePick={run.polarity.passagePick}
        onChange={(pick) =>
          setRun((r) => ({ ...r, polarity: { passagePick: pick } }))
        }
        grade={(pick) => gradePassagePolarity(rubric, pick)}
        onGrade={(v, vd) => recordGrade(v, vd)}
      />
    ),
    canProceed: (run) => run.polarity.passagePick != null,
    serializeInput: (run) => run.polarity.passagePick ?? '',
    gradeResult: (run) =>
      run.polarity.passagePick == null
        ? 'none'
        : gradePassagePolarity(rubric, run.polarity.passagePick),
    logPayload: (run) => ({
      step: 'vocab_polarity',
      payload: {
        pick: run.polarity.passagePick,
        graded: run.polarity.passagePick
          ? gradePassagePolarity(rubric, run.polarity.passagePick)
          : 'none',
      },
    }),
  })

  // ── 3. 밑줄 진단 (diagnose) — 밑줄마다 충돌 여부 + (충돌 시) 부정어 유무 ────────
  steps.push({
    key: 'vocab_diagnose',
    label: '밑줄 진단',
    render: ({ run, setRun, recordGrade }) => (
      <StepVocabDiagnose
        underlines={run.underlines}
        value={run.diagnose}
        onChange={(next) => setRun((r) => ({ ...r, diagnose: next }))}
        gradeConflict={(num, pick) => gradeConflict(rubric, num, pick)}
        gradeNeg={(num, pick) => gradeNegation(rubric, num, pick)}
        onGrade={(v, vd) => recordGrade(v, vd)}
      />
    ),
    canProceed: (run) =>
      run.underlines.length > 0 &&
      run.underlines.every(
        (u) =>
          run.diagnose.conflict[u.num] != null &&
          (run.diagnose.conflict[u.num] !== '충돌' ||
            run.diagnose.negation[u.num] != null),
      ),
    serializeInput: (run) =>
      run.underlines
        .map(
          (u) =>
            `${u.num}:${run.diagnose.conflict[u.num] ?? '?'}${
              run.diagnose.conflict[u.num] === '충돌'
                ? '/' + (run.diagnose.negation[u.num] ?? '?')
                : ''
            }`,
        )
        .join(', '),
    gradeResult: (run) => {
      if (!rubric?.underlines) return 'none'
      const allOk = run.underlines.every((u) => {
        const c = run.diagnose.conflict[u.num]
        if (c == null) return false
        if (gradeConflict(rubric, u.num, c) !== 'accepted') return false
        if (c === '충돌') {
          const n = run.diagnose.negation[u.num]
          if (n == null) return false
          if (gradeNegation(rubric, u.num, n) !== 'accepted') return false
        }
        return true
      })
      return allOk ? 'accepted' : 'reject'
    },
    logPayload: (run, timing) => ({
      step: 'vocab_diagnose',
      payload: {
        underlines: run.underlines.map((u) => {
          const conflict = run.diagnose.conflict[u.num] ?? null
          const negation =
            conflict === '충돌' ? (run.diagnose.negation[u.num] ?? null) : null
          return {
            num: u.num,
            conflict,
            conflict_graded: conflict
              ? gradeConflict(rubric, u.num, conflict)
              : 'none',
            negation,
            neg_graded: negation ? gradeNegation(rubric, u.num, negation) : 'none',
          }
        }),
        time_to_answer_ms: timing.timeToAnswerMs,
      },
    }),
  })

  // ── 4. 틀린 낱말 (choice) — 마지막, self-drives ──────────────────────────────
  steps.push({
    key: 'vocab_choice',
    label: '틀린 낱말',
    render: ({ run, setRun, recordGrade, logNow, displayRubric }) => {
      // The student's committed WRONG pick (null until they submit). All recovery
      // props are built here from the FULL `rubric`; StepVocabChoice reads none.
      const picked = run.choice.finalChoice
      const pickedWord =
        picked !== null
          ? (run.underlines.find((u) => u.num === picked)?.word ?? '')
          : ''

      // 원칙4 — the polarity axis, pre-bound to `picked`. Empty until committed.
      const recoveryQuestions: RecoveryQuestion[] =
        picked === null
          ? []
          : [
              {
                id: 'sent_pol',
                mode: 'button',
                options: [
                  { id: '+', label: '+ (긍정 방향)' },
                  { id: '-', label: '- (부정 방향)' },
                ],
                prompt: () =>
                  '네가 고른 그 낱말이 있는 문장, 방향은 +예요 −예요?',
                grade: (input) =>
                  gradeSentencePolarity(rubric, picked, input as '+' | '-'),
              },
              {
                id: 'word_pol',
                mode: 'button',
                options: [
                  { id: '+', label: '+ (긍정 뜻)' },
                  { id: '-', label: '- (부정 뜻)' },
                ],
                prompt: () => '그 낱말 자체의 방향은?',
                grade: (input) =>
                  gradeWordPolarity(rubric, picked, input as '+' | '-'),
              },
              {
                id: 'fits',
                mode: 'button',
                options: [
                  { id: '맞음', label: '맞음' },
                  { id: '충돌', label: '충돌' },
                ],
                prompt: () => '그럼 문장과 낱말, 서로 맞아요 충돌해요?',
                grade: (input) =>
                  gradeFits(rubric, picked, input as '맞음' | '충돌'),
              },
            ]

      // The single reselect — all 5 밑줄 minus the already-committed wrong one.
      const reselect: RecoveryReselect = {
        kind: 'underline',
        options: run.underlines.map((u) => ({
          id: String(u.num),
          label: `${u.num}. ${u.word}`,
        })),
        excludeIds: picked !== null ? [String(picked)] : [],
        isCorrect: (id) => vocabReselectCorrect(problem.answer, Number(id)),
      }

      // 원칙2 mirror — the student's OWN 3단계 진단, never the answer.
      const studentPriorJudgment: RecoveryPriorJudgment =
        picked === null
          ? []
          : [
              {
                label: '3단계에서',
                value: `${picked}번 '${pickedWord}'를 ${
                  run.diagnose.conflict[picked] ?? '충돌'
                }(으)로 봤어요`,
              },
            ]

      // Opaque chat snapshot — mirrors WizardChatContext; carries NO answer/rubric.
      const handoffContext = {
        type: '어휘',
        step: 'recovery',
        initialWrong: picked,
        snapshot: run,
      }

      return (
        <div className="space-y-5">
          <StepVocabChoice
            underlines={run.underlines}
            answer={problem.answer}
            explanation={problem.explanation}
            choices={problem.choices}
            whyOptions={displayRubric?.why_options ?? {}}
            value={run.choice}
            onChange={(next) => setRun((r) => ({ ...r, choice: next }))}
            onComplete={(fs) => logNow({ ...run, choice: fs })}
            onGrade={(v, vd) => recordGrade(v, vd)}
            gradeReason={(pickedNum, id) =>
              gradeWhyOption(rubric, String(pickedNum), id)
            }
            recoveryQuestions={recoveryQuestions}
            reselect={reselect}
            studentPriorJudgment={studentPriorJudgment}
            // No-op: RecoveryLoop is self-contained. On a correct re-select it
            // drives its OWN state to `done` and stays mounted (the terminal's
            // committed && !correct branch keeps rendering it). Flipping
            // finalChoice here would swap the terminal into its first-try correct
            // branch and unmount the process-praise done screen. The
            // retry_success is already logged via onRecoveryLog.
            onRecoveryRetry={() => {}}
            onRecoveryLog={(payload) => {
              void logAttempt(problem.id, 'recovery', { recovery: payload })
            }}
            handoffContext={handoffContext}
            problemId={problem.id}
          />
          {run.choice.finalChoice !== null &&
            (problem.answer === null ||
              run.choice.finalChoice === problem.answer) && (
              <Link
                to={`/chat/${problem.id}`}
                className="inline-block rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
              >
                튜터에게 질문하기 →
              </Link>
            )}
        </div>
      )
    },
    canProceed: () => true,
    serializeInput: (run) =>
      run.choice.finalChoice === null ? '' : String(run.choice.finalChoice),
    gradeResult: (run) =>
      run.choice.finalChoice === null
        ? 'none'
        : run.choice.finalChoice === problem.answer
          ? 'correct'
          : 'wrong',
    logPayload: (run) => {
      const selected = run.choice.finalChoice
      const is_correct = problem.answer !== null && selected === problem.answer
      const reason_graded =
        run.choice.reasonPick && selected !== null
          ? gradeWhyOption(rubric, String(selected), run.choice.reasonPick)
          : 'none'
      return [
        {
          step: 'vocab_choice_process',
          payload: {
            selected,
            reason_pick: run.choice.reasonPick,
            reason_graded,
            evidence: run.choice.evidence,
          },
        },
        {
          step: 'result',
          payload: {
            selected,
            correct_answer: problem.answer,
            is_correct,
          },
        },
      ]
    },
  })

  return steps
}

export default function VocabWizard({ problem }: { problem: Problem }) {
  const rubric = problem.grading_rubric
  const underlines = useMemo(
    () => parseUnderlines(rubric, problem.choices),
    [problem, rubric],
  )
  const steps = useMemo(() => vocabSteps(problem), [problem])
  const w = useWizard<VocabRunState>({
    problem,
    initRun: initVocabRun,
    steps,
  })

  // Combination subtype (no underlines) → no dedicated procedure yet.
  if (rubric?.combination || underlines.length === 0) {
    return <ComingSoon type="어휘" />
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
