import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Problem } from '../../lib/useProblem'
import {
  GRAMMAR_CATEGORIES,
  gradeCategory,
  gradeIsGrammatical,
  gradeMicro,
  gradeRecoveryCategory,
  gradeSubjectHead,
  grammarReselectCorrect,
  microKind,
  parseUnderlines,
} from '../../lib/solve/grammar'
import type { GrammarCategory } from '../../lib/solve/grammar'
import { gradeWhyOption } from '../../lib/solve/whyOptions'
import { logAttempt } from '../../lib/logAttempt'
import ComingSoon from './ComingSoon'
import WizardShell from './WizardShell'
import StepDiagnose from './StepDiagnose'
import StepGrammarChoice from './StepGrammarChoice'
import { AskButton, useWizard } from './wizardFrame'
import type { StepDef } from './wizardFrame'
import type {
  GrammarRunState,
  RecoveryPriorJudgment,
  RecoveryQuestion,
  RecoveryReselect,
} from './types'

/** Fresh 어법-run state seeded from the parsed underlines. */
function initGrammarRun(problem: Problem): GrammarRunState {
  const underlines = parseUnderlines(problem.grading_rubric, problem.choices)
  return {
    underlines,
    diagnose: { picks: {}, graded: {}, micro: {}, microGraded: {} },
    choice: { finalChoice: null, reasonPick: null, evidence: '' },
  }
}

/** The 어법 steps mapped onto the generic wizard: 범주 진단(inline micro) → 틀린 밑줄. */
function grammarSteps(problem: Problem): StepDef<GrammarRunState>[] {
  const rubric = problem.grading_rubric
  const steps: StepDef<GrammarRunState>[] = []

  // ── 1. 범주 진단 (diagnose) — 범주 + 범주별 인라인 미시 점검 ──────────────────
  steps.push({
    key: 'grammar_diagnose',
    label: '범주 진단',
    render: ({ run, setRun, recordGrade }) => (
      <StepDiagnose
        underlines={run.underlines}
        value={run.diagnose}
        onChange={(next) => setRun((r) => ({ ...r, diagnose: next }))}
        gradeCat={(num, cat) => gradeCategory(rubric, num, cat)}
        gradeMicroFn={(num, cat, micro) => gradeMicro(rubric, num, cat, micro)}
        gradeHeadFn={(num, input) => {
          const u = rubric?.underlines?.[num - 1]
          return gradeSubjectHead(input, u?.subject_head, u?.accept_subject)
        }}
        onGrade={(v, vd) => recordGrade(v, vd)}
      />
    ),
    canProceed: (run) =>
      run.underlines.length > 0 &&
      run.underlines.every((u) => {
        const cat = run.diagnose.picks[u.num]
        if (cat == null) return false
        const m = run.diagnose.micro[u.num] ?? {}
        switch (microKind(cat)) {
          case 'subject':
            return (m.subjectInput?.trim() ?? '') !== '' && m.number != null
          case 'object':
            return m.hasObject != null
          case 'clause':
            return m.clause != null
          case 'pos':
            return m.pos != null
          default:
            return true // 병렬 / 기타 → only the category pick is required
        }
      }),
    serializeInput: (run) =>
      run.underlines
        .map((u) => `${u.num}:${run.diagnose.picks[u.num] ?? '?'}`)
        .join(', '),
    gradeResult: (run) => {
      if (!rubric?.underlines) return 'none'
      const allMatch = run.underlines.every(
        (u) => gradeCategory(rubric, u.num, run.diagnose.picks[u.num]) === 'accepted',
      )
      return allMatch ? 'accepted' : 'reject'
    },
    logPayload: (run, timing) => ({
      step: 'grammar_diagnose',
      payload: {
        underlines: run.underlines.map((u) => {
          const picked = run.diagnose.picks[u.num] ?? null
          const micro = run.diagnose.micro[u.num] ?? {}
          return {
            num: u.num,
            picked,
            cat_graded: gradeCategory(rubric, u.num, picked),
            micro,
            micro_graded: gradeMicro(rubric, u.num, picked, micro),
          }
        }),
        time_to_answer_ms: timing.timeToAnswerMs,
      },
    }),
  })

  // ── 2. 틀린 밑줄 (choice) — 마지막, self-drives ──────────────────────────────
  steps.push({
    key: 'grammar_choice',
    label: '틀린 밑줄',
    render: ({ run, setRun, recordGrade, logNow, displayRubric }) => {
      // The student's committed WRONG pick (null until they submit). All recovery
      // props are built here from the FULL `rubric`; StepGrammarChoice reads none.
      const picked = run.choice.finalChoice

      // 원칙4 — the category axis, pre-bound to `picked`. Empty until committed.
      const recoveryQuestions: RecoveryQuestion[] =
        picked === null
          ? []
          : [
              {
                id: 'target',
                mode: 'fill_in',
                prompt: () =>
                  '이 밑줄이 받는 대상(주어/수식 대상)이 뭐예요? 한 줄로.',
                grade: () => 'neutral',
              },
              {
                id: 'cat',
                mode: 'button',
                options: GRAMMAR_CATEGORIES.map((c) => ({ id: c, label: c })),
                prompt: () => '그럼 이건 어떤 범주 문제예요?',
                grade: (input) =>
                  gradeRecoveryCategory(rubric, picked, input as GrammarCategory),
              },
              {
                id: 'is_gram',
                mode: 'button',
                options: [
                  { id: '맞음', label: '어법상 맞음' },
                  { id: '틀림', label: '어법상 틀림' },
                ],
                prompt: () =>
                  '그 관점에서 이 밑줄, 어법상 맞아요 틀려요?',
                grade: (input) =>
                  gradeIsGrammatical(rubric, picked, input as '맞음' | '틀림'),
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
        isCorrect: (id) => grammarReselectCorrect(problem.answer, Number(id)),
      }

      // 원칙2 mirror — the student's OWN 진단 범주 pick, never the answer.
      const studentPriorJudgment: RecoveryPriorJudgment =
        picked === null
          ? []
          : [
              {
                label: '진단에서',
                value: `${picked}번 밑줄을 '${
                  run.diagnose.picks[picked] ?? '?'
                }'(으)로 봤어요`,
              },
            ]

      // Opaque chat snapshot — mirrors WizardChatContext; carries NO answer/rubric.
      const handoffContext = {
        type: '어법',
        step: 'recovery',
        initialWrong: picked,
        snapshot: run,
      }

      return (
        <div className="space-y-5">
          <StepGrammarChoice
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
          step: 'grammar_choice_process',
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

export default function GrammarWizard({ problem }: { problem: Problem }) {
  const rubric = problem.grading_rubric
  const underlines = useMemo(
    () => parseUnderlines(rubric, problem.choices),
    [problem, rubric],
  )
  const steps = useMemo(() => grammarSteps(problem), [problem])
  const w = useWizard<GrammarRunState>({
    problem,
    initRun: initGrammarRun,
    steps,
  })

  // Combination subtype (no underlines) → no dedicated procedure yet.
  if (rubric?.combination || underlines.length === 0) {
    return <ComingSoon type="어법" />
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
