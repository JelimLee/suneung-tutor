import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Problem } from '../../lib/useProblem'
import {
  gradeInGiven,
  orderReselectCorrect,
  parseCorrectOrder,
  parseOrderPassage,
} from '../../lib/solve/order'
import {
  gradeWhyOption,
  whyOptionLabel,
  gradePairWhy,
  pairWhyLabel,
} from '../../lib/solve/whyOptions'
import { logAttempt } from '../../lib/logAttempt'
import WizardShell from './WizardShell'
import StepEliminate from './StepEliminate'
import StepArrange from './StepArrange'
import StepVerifyRead from './StepVerifyRead'
import StepOrderChoice from './StepOrderChoice'
import { AskButton, useWizard } from './wizardFrame'
import type { StepDef } from './wizardFrame'
import type {
  OrderLabel,
  OrderRunState,
  RecoveryPriorJudgment,
  RecoveryQuestion,
  RecoveryReselect,
} from './types'

/** Fresh 순서-run state seeded from the parsed passage. */
function initOrderRun(problem: Problem): OrderRunState {
  const { given, blocks } = parseOrderPassage(problem.passage)
  return {
    given,
    blocks,
    eliminate: { eliminated: [], graded: 'none', reasonPick: null },
    arrange: { order: [], positionsCorrect: 0, graded: 'none', pairPicks: {} },
    verify: { naturalness: null, note: '' },
    choice: { finalChoice: null, evidence: '' },
  }
}

/** The four 순서 steps mapped onto the generic wizard. */
function orderSteps(problem: Problem): StepDef<OrderRunState>[] {
  return [
    // ── 1. 소거 (eliminate) ──────────────────────────────────────────────────
    {
      key: 'eliminate',
      label: '소거',
      render: ({ run, setRun, recordGrade, displayRubric }) => (
        <StepEliminate
          value={run.eliminate}
          rubric={displayRubric}
          given={run.given}
          blocks={run.blocks}
          onChange={(next) => setRun((r) => ({ ...r, eliminate: next }))}
          onGrade={(v, vd) => recordGrade(v, vd)}
          gradeReason={(id) =>
            gradeWhyOption(problem.grading_rubric, 'eliminate', id)
          }
        />
      ),
      canProceed: (run) => run.eliminate.eliminated.length >= 1,
      serializeInput: (run) => run.eliminate.eliminated.join(','),
      gradeResult: (run) => run.eliminate.graded,
      logPayload: (run, timing) => ({
        step: 'order_eliminate',
        payload: {
          eliminated: run.eliminate.eliminated,
          anchor_block: problem.grading_rubric?.anchor?.block ?? null,
          graded: run.eliminate.graded,
          // Reason button (research): what/how they justified the elimination.
          raw_input: whyOptionLabel(
            problem.grading_rubric,
            'eliminate',
            run.eliminate.reasonPick,
          ),
          reason_graded: run.eliminate.reasonPick
            ? gradeWhyOption(
                problem.grading_rubric,
                'eliminate',
                run.eliminate.reasonPick,
              )
            : 'none',
          why_option_id: run.eliminate.reasonPick,
          time_to_answer_ms: timing.timeToAnswerMs,
        },
      }),
    },

    // ── 2. 배열 (arrange) ────────────────────────────────────────────────────
    {
      key: 'arrange',
      label: '배열',
      render: ({ run, setRun, recordGrade, displayRubric }) => (
        <StepArrange
          value={run.arrange}
          rubric={displayRubric}
          blocks={run.blocks}
          onChange={(next) => setRun((r) => ({ ...r, arrange: next }))}
          onGrade={(v, vd) => recordGrade(v, vd)}
          gradePair={(pairKey, id) =>
            gradePairWhy(problem.grading_rubric, pairKey, id)
          }
        />
      ),
      canProceed: (run) =>
        run.blocks.length > 0 &&
        run.arrange.order.length === run.blocks.length,
      serializeInput: (run) => run.arrange.order.join('-'),
      gradeResult: (run) => run.arrange.graded,
      logPayload: (run, timing) => ({
        step: 'order_arrange',
        payload: {
          order: run.arrange.order.join('-'),
          positions_correct: run.arrange.positionsCorrect,
          graded: run.arrange.graded,
          correct_order: problem.grading_rubric?.correct_order ?? null,
          // Reason buttons (research): per-adjacent-pair "뭐가 먼저" justifications.
          pair_reasons: (problem.grading_rubric?.pair_options ?? []).map((p) => {
            const pick = run.arrange.pairPicks[p.key] ?? null
            return {
              pair: p.key,
              why_option_id: pick,
              label: pairWhyLabel(problem.grading_rubric, p.key, pick),
              graded: pick
                ? gradePairWhy(problem.grading_rubric, p.key, pick)
                : 'none',
            }
          }),
          time_to_answer_ms: timing.timeToAnswerMs,
        },
      }),
    },

    // ── 3. 이어읽기 (verify_read) — 정한 순서대로 붙여 읽고 자기점검 ──────────
    {
      key: 'verify_read',
      label: '이어읽기',
      render: ({ run, setRun, recordGrade }) => (
        <StepVerifyRead
          value={run.verify}
          given={run.given}
          blocks={run.blocks}
          order={run.arrange.order}
          onChange={(next) => setRun((r) => ({ ...r, verify: next }))}
          onGrade={(v, vd) => recordGrade(v, vd)}
        />
      ),
      canProceed: (run) => run.verify.naturalness !== null,
      serializeInput: (run) =>
        run.arrange.order.join('-') +
        (run.verify.naturalness === 'awkward' ? ' (어색)' : ''),
      gradeResult: (run) =>
        run.verify.naturalness === 'awkward' ? 'reject' : 'none',
      logPayload: (run, timing) => ({
        step: 'order_verify',
        payload: {
          order: run.arrange.order.join('-'),
          naturalness: run.verify.naturalness,
          note: run.verify.note,
          time_to_answer_ms: timing.timeToAnswerMs,
        },
      }),
    },

    // ── 4. 최종 선지 + 근거 (order_choice) — 마지막, self-drives ──────────────
    {
      key: 'order_choice',
      label: '최종 선지',
      render: ({ run, setRun, recordGrade, logNow }) => {
        const rubric = problem.grading_rubric
        // The student's committed WRONG pick (null until they submit). All recovery
        // props are built here from the FULL `rubric`; StepOrderChoice reads none.
        const picked = run.choice.finalChoice

        // The first block of the ordering the STUDENT chose — arrange.order[0]
        // preferred; else parse the picked choice string's first (A|B|C); else 'A'.
        const firstBlockLabel: OrderLabel =
          run.arrange.order[0] ??
          (picked !== null
            ? (parseCorrectOrder(problem.choices[picked - 1] ?? '')[0] ?? 'A')
            : 'A')

        // 원칙4 — the signal axis (first block only, no full re-arrange). Empty
        // until committed.
        const recoveryQuestions: RecoveryQuestion[] =
          picked === null
            ? []
            : [
                {
                  id: 'refers',
                  mode: 'fill_in',
                  prompt: () =>
                    '네가 첫 번째로 둔 문단, 그 시작 지시어/연결어는 뭘 가리켜요?',
                  grade: () => 'neutral',
                },
                {
                  id: 'in_given',
                  mode: 'button',
                  options: [
                    { id: '있음', label: '주어진 글에 있음' },
                    { id: '없음', label: '주어진 글에 없음' },
                  ],
                  prompt: () => "그게 '주어진 글'에 있어요?",
                  grade: (input) =>
                    gradeInGiven(rubric, firstBlockLabel, input as '있음' | '없음'),
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
          isCorrect: (id) => orderReselectCorrect(problem.answer, Number(id)),
        }

        // 원칙2 mirror — the student's OWN 순서 판단, never the answer.
        const studentPriorJudgment: RecoveryPriorJudgment =
          picked === null
            ? []
            : [
                { label: '네가 고른 순서', value: `${picked}번` },
                { label: '첫 문단을', value: `${firstBlockLabel}로 봤어요` },
              ]

        // Opaque chat snapshot — carries NO answer/rubric.
        const handoffContext = {
          type: '순서',
          step: 'recovery',
          initialWrong: picked,
          firstBlock: firstBlockLabel,
          snapshot: run,
        }

        return (
          <div className="space-y-5">
            <StepOrderChoice
              choices={problem.choices}
              answer={problem.answer}
              explanation={problem.explanation}
              arrangeOrder={run.arrange.order}
              value={run.choice}
              onChange={(next) => setRun((r) => ({ ...r, choice: next }))}
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
      // No time_to_answer_ms (matches blank's handleChoiceComplete).
      logPayload: (run) => {
        const selected = run.choice.finalChoice
        const is_correct =
          problem.answer !== null && selected === problem.answer
        return [
          {
            step: 'order_choice_process',
            payload: {
              selected,
              evidence: run.choice.evidence,
              picked_from_arrange: run.arrange.order.join('-'),
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
    },
  ]
}

export default function OrderWizard({ problem }: { problem: Problem }) {
  const steps = useMemo(() => orderSteps(problem), [problem])
  const w = useWizard<OrderRunState>({
    problem,
    initRun: initOrderRun,
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
