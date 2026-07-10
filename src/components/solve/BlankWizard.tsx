import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Problem } from '../../lib/useProblem'
import { findBlankSentence, segmentSentences } from '../../lib/solve/passage'
import { gradeMark } from '../../lib/solve/gradePolarity'
import {
  blankReselectCorrect,
  gradeChoiceSatisfies,
  gradeRelation,
} from '../../lib/solve/blank'
import { logAttempt } from '../../lib/logAttempt'
import WizardShell from './WizardShell'
import StepPrereading from './StepPrereading'
import StepPolarity from './StepPolarity'
import StepThemeRecall from './StepThemeRecall'
import StepChoiceProcess from './StepChoiceProcess'
import { AskButton, useWizard } from './wizardFrame'
import type { StepDef } from './wizardFrame'
import type {
  BlankRunState,
  RecoveryPriorJudgment,
  RecoveryQuestion,
  RecoveryReselect,
} from './types'

/** Fresh blank-run state (verbatim from the pre-refactor BlankWizard). */
function initBlankRun(problem: Problem): BlankRunState {
  const { sentence } = findBlankSentence(problem.passage)
  const sentences = segmentSentences(problem.passage).map((text, index) => ({
    index,
    text,
    mark: null,
  }))
  return {
    prereading: {
      topicWord: '',
      introType: null,
      blankSentence: sentence,
      topicGrade: null,
      agreeTag: null,
    },
    polarity: { sentences },
    themeRecall: {
      theme: '',
      referenceKeywords: [],
      overlapKeywords: [],
      overlapRatio: 0,
      graded: 'none',
      matchedKeywords: [],
    },
    choice: {
      eliminations: {},
      comparedNote: {},
      evidence: '',
      finalChoice: null,
    },
  }
}

/**
 * The four blank steps mapped 1:1 onto the generic wizard. Built as a factory so
 * logPayload/gradeResult can close over `problem` (rubric + answer). Payloads are
 * byte-identical to the pre-refactor logStep / handleChoiceComplete.
 */
function blankSteps(problem: Problem): StepDef<BlankRunState>[] {
  return [
    // ── 1. 사전 독해 (prereading) ────────────────────────────────────────────
    {
      key: 'prereading',
      label: '사전 독해',
      render: ({ run, setRun, recordGrade, displayRubric }) => (
        <StepPrereading
          value={run.prereading}
          rubric={displayRubric}
          passage={problem.passage}
          onChange={(next) => setRun((r) => ({ ...r, prereading: next }))}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      canProceed: (run) => run.prereading.introType !== null,
      serializeInput: (run) => run.prereading.topicWord,
      gradeResult: (run) => run.prereading.topicGrade?.graded ?? 'none',
      logPayload: (run, timing) => {
        const tg = run.prereading.topicGrade
        const selected = run.prereading.introType
        const correctIntro = problem.grading_rubric?.intro_type ?? null
        return {
          step: 'prereading',
          payload: {
            topic_word: run.prereading.topicWord,
            intro_type: run.prereading.introType,
            blank_sentence: run.prereading.blankSentence,
            topic_grading: {
              raw_input: tg?.rawInput ?? run.prereading.topicWord,
              graded: tg?.graded ?? 'none',
              grader: tg?.grader ?? 'none',
              matched_against: tg?.matchedAgainst ?? null,
              input_mode: 'text',
            },
            intro_grading: {
              selected,
              correct: correctIntro,
              is_correct:
                correctIntro === null ? null : selected === correctIntro,
              agree_tag: run.prereading.agreeTag,
            },
            time_to_answer_ms: timing.timeToAnswerMs,
          },
        }
      },
    },

    // ── 2. 문장 극성 (polarity) ──────────────────────────────────────────────
    {
      key: 'polarity',
      label: '문장 극성',
      render: ({ run, setRun, recordGrade, displayRubric }) => (
        <StepPolarity
          value={run.polarity}
          rubric={displayRubric}
          onChange={(next) => setRun((r) => ({ ...r, polarity: next }))}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      canProceed: (run) =>
        run.polarity.sentences.filter((s) => s.mark !== null).length >= 2,
      serializeInput: (run) =>
        run.polarity.sentences.map((s) => s.mark ?? '_').join(','),
      gradeResult: (run) => {
        const rubric = problem.grading_rubric
        const aligned =
          !!rubric?.polarity &&
          rubric.polarity.length === run.polarity.sentences.length
        if (!aligned) return 'none'
        const anyReject = run.polarity.sentences.some(
          (s) => gradeMark(s.mark, rubric!.polarity[s.index]) === 'reject',
        )
        return anyReject ? 'reject' : 'accept'
      },
      logPayload: (run, timing) => {
        const rubric = problem.grading_rubric
        // Alignment guard: only grade index-for-index when rubric.polarity
        // matches our own segmentation length; otherwise indices don't correspond.
        const aligned =
          !!rubric?.polarity &&
          rubric.polarity.length === run.polarity.sentences.length
        return {
          step: 'polarity',
          payload: {
            sentences: run.polarity.sentences.map((s) => ({
              index: s.index,
              mark: s.mark,
              text: s.text,
            })),
            polarity_grading: run.polarity.sentences.map((s) => {
              const correct = aligned ? rubric!.polarity[s.index] : undefined
              return {
                index: s.index,
                raw_input: s.mark,
                correct: correct ?? null,
                graded: gradeMark(s.mark, correct),
              }
            }),
            time_to_answer_ms: timing.timeToAnswerMs,
          },
        }
      },
    },

    // ── 3. 주제 회상 (theme) ─────────────────────────────────────────────────
    {
      key: 'theme',
      label: '주제 회상',
      render: ({ run, setRun, recordGrade, displayRubric }) => (
        <StepThemeRecall
          value={run.themeRecall}
          rubric={displayRubric}
          explanation={problem.explanation}
          onChange={(next) => setRun((r) => ({ ...r, themeRecall: next }))}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      canProceed: (run) => run.themeRecall.theme.trim().length > 0,
      serializeInput: (run) => run.themeRecall.theme,
      gradeResult: (run) => run.themeRecall.graded,
      logPayload: (run, timing) => {
        const tr = run.themeRecall
        return {
          step: 'theme_recall',
          payload: {
            theme: tr.theme,
            overlap_keywords: tr.overlapKeywords,
            overlap_ratio: tr.overlapRatio,
            reference_keywords: tr.referenceKeywords,
            raw_input: tr.theme,
            matched_keywords: tr.matchedKeywords,
            graded: tr.graded,
            time_to_answer_ms: timing.timeToAnswerMs,
          },
        }
      },
    },

    // ── 4. 선지 처리 (choice) ────────────────────────────────────────────────
    {
      key: 'choice',
      label: '선지 처리',
      render: ({ run, setRun, recordGrade, logNow }) => {
        const rubric = problem.grading_rubric
        // The student's committed WRONG pick (null until they submit). All recovery
        // props are built here from the FULL `rubric`; StepChoiceProcess reads none.
        const picked = run.choice.finalChoice

        // 원칙4 — the relation axis, pre-bound to `picked`. Empty until committed.
        const recoveryQuestions: RecoveryQuestion[] =
          picked === null
            ? []
            : [
                {
                  id: 'relation',
                  mode: 'button',
                  options: [
                    { id: '재진술', label: '재진술' },
                    { id: '대조', label: '대조' },
                    { id: '인과', label: '인과' },
                    { id: '예시', label: '예시' },
                  ],
                  prompt: () => '빈칸 앞뒤의 논리 관계는?',
                  grade: (input) =>
                    gradeRelation(
                      rubric,
                      input as '재진술' | '대조' | '인과' | '예시',
                    ),
                },
                {
                  id: 'satisfies',
                  mode: 'button',
                  options: [
                    { id: '만족', label: '그 관계를 만족' },
                    { id: '불만족', label: '만족 안 함' },
                  ],
                  prompt: () => '네가 고른 선지가 그 관계를 만족해요?',
                  grade: (input) =>
                    gradeChoiceSatisfies(rubric, picked, input as '만족' | '불만족'),
                },
              ]

        // The single reselect — all 5 선지 minus the already-committed wrong one.
        const reselect: RecoveryReselect = {
          kind: 'choice',
          options: problem.choices.map((c, i) => ({
            id: String(i + 1),
            label: `${i + 1}. ${c}`,
          })),
          excludeIds: picked !== null ? [String(picked)] : [],
          isCorrect: (id) => blankReselectCorrect(problem.answer, Number(id)),
        }

        // 원칙2 mirror — the student's OWN pick + (if written) their evidence line.
        const studentPriorJudgment: RecoveryPriorJudgment =
          picked === null
            ? []
            : [
                { label: '네가 고른 답', value: `${picked}번` },
                ...(run.choice.evidence.trim()
                  ? [{ label: '네가 쓴 근거', value: run.choice.evidence.trim() }]
                  : []),
              ]

        // Opaque chat snapshot — carries NO answer/rubric.
        const handoffContext = {
          type: '빈칸',
          step: 'recovery',
          initialWrong: picked,
          snapshot: run,
        }

        return (
          <div className="space-y-5">
            <StepChoiceProcess
              choices={problem.choices}
              answer={problem.answer}
              explanation={problem.explanation}
              value={run.choice}
              onChange={(next) => setRun((r) => ({ ...r, choice: next }))}
              // Pass the merged run explicitly so the two attempts serialize the
              // just-committed choice (avoids a stale setRun read).
              onComplete={(fs) => logNow({ ...run, choice: fs })}
              onGrade={(v, vd) => recordGrade(v, vd)}
              recoveryQuestions={recoveryQuestions}
              reselect={reselect}
              studentPriorJudgment={studentPriorJudgment}
              // No-op: RecoveryLoop is self-contained. On a correct re-select it
              // drives its OWN state to `done` and stays mounted (the terminal's
              // committed && !correct branch keeps rendering it). Flipping
              // finalChoice here would swap the terminal into its first-try
              // correct branch and unmount the process-praise done screen. The
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
      // Screen 5 completion → two attempts in sequence: choice_process then
      // result. No time_to_answer_ms (matches the original handleChoiceComplete).
      logPayload: (run) => {
        const fs = run.choice
        const eliminations = Object.entries(fs.eliminations).map(([k, v]) => ({
          choice_index: Number(k),
          reason: v,
        }))
        const compared = Object.entries(fs.comparedNote).map(([k, v]) => ({
          choice_index: Number(k),
          note: v,
        }))
        const selected = fs.finalChoice
        const is_correct = problem.answer !== null && selected === problem.answer
        return [
          {
            step: 'choice_process',
            payload: { eliminations, compared, evidence: fs.evidence },
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
    },
  ]
}

export default function BlankWizard({ problem }: { problem: Problem }) {
  const steps = useMemo(() => blankSteps(problem), [problem])
  const w = useWizard<BlankRunState>({
    problem,
    initRun: initBlankRun,
    steps,
  })

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
