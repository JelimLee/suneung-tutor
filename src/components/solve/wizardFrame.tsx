import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { GradingRubric, Problem } from '../../lib/useProblem'
import { logAttempt } from '../../lib/logAttempt'
import type { AttemptStep } from '../../lib/logAttempt'
import { toDisplayRubric } from '../../lib/solve/rubricDisplay'
import type {
  StepVerdict,
  WizardChatContext,
  WizardEntryTrigger,
} from './types'

// One grading submission on a step: what the student entered, the verdict it
// earned, and when. Powers the retry_same / retry stuck-signal detection.
export interface StepAttempt {
  value: string
  verdict: StepVerdict
  at: number
}
export type StuckLevel = 0 | 1 | 2 | 3

/**
 * Stuck-signal state machine for the CURRENT step. Strongest signal wins:
 *   3 retry_same — last two attempts share a value and the latest is a reject
 *                  (re-submitted the same thing, still not accepted).
 *   2 retry      — 2+ attempts with differing values, latest still not accepted.
 *   1 reject     — latest attempt is a reject.
 *   1 timeout    — >30s on the step with no resolving accept.
 *   0 none.
 */
export function computeStuck(
  hist: StepAttempt[],
  enteredAt: number | undefined,
  now: number,
): { level: StuckLevel; trigger: WizardEntryTrigger } {
  const last = hist[hist.length - 1]
  const prev = hist[hist.length - 2]

  if (last && prev && last.value === prev.value && last.verdict === 'reject') {
    return { level: 3, trigger: 'retry_same' }
  }
  if (hist.length >= 2 && last && last.verdict !== 'accepted') {
    const distinctValues = new Set(hist.map((a) => a.value)).size >= 2
    if (distinctValues) return { level: 2, trigger: 'retry' }
  }
  if (last && last.verdict === 'reject') {
    return { level: 1, trigger: 'reject' }
  }
  if (enteredAt !== undefined && now - enteredAt > 30000) {
    return { level: 1, trigger: 'timeout' }
  }
  return { level: 0, trigger: 'none' }
}

/**
 * The contingent "ask the teacher" affordance. Escalates with the stuck level —
 * never a gate, always clickable. Copy at level 3 is the active "이 부분이
 * 어려우면 같이 볼까요?".
 */
export function AskButton({
  level,
  onClick,
}: {
  level: StuckLevel
  onClick: () => void
}) {
  if (level === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-xs text-ink-muted underline decoration-ink-muted/40 underline-offset-2 transition hover:text-pink-600 hover:decoration-pink"
      >
        선생님께 물어보기
      </button>
    )
  }
  if (level === 3) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="animate-pulse rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white shadow-sm ring-2 ring-pink-50 transition hover:bg-pink-600"
      >
        이 부분이 어려우면 같이 볼까요?
      </button>
    )
  }
  // level 1–2: emphasized pink pill.
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-pink/50 bg-pink-50 px-4 py-2 text-sm font-semibold text-pink-600 transition hover:bg-pink hover:text-white"
    >
      막혔어요? 선생님께 물어보기
    </button>
  )
}

// ── Generic wizard orchestration ────────────────────────────────────────────

/** Args handed to a step's `render`. `logNow` is a forward-only logger for THIS
 * step (self-driving last steps call it with an explicit run override). */
export interface StepRenderArgs<R> {
  run: R
  problem: Problem
  /** Sanitized rubric (reasoning prose blanked) — the blessed input for every
   * step render. See rubricDisplay.ts. The FULL rubric stays reachable via
   * `problem.grading_rubric` in gradeResult/logPayload for grading. */
  displayRubric: GradingRubric | null
  setRun: (updater: (r: R) => R) => void
  recordGrade: (value: string, verdict: StepVerdict) => void
  logNow: (runOverride?: R) => void
  stepKey: string
}

/** One entry in a wizard's ordered step list. */
export interface StepDef<R> {
  key: string
  label: string
  render: (args: StepRenderArgs<R>) => ReactNode
  canProceed: (run: R) => boolean
  serializeInput: (run: R) => string
  gradeResult: (run: R, problem: Problem) => string
  logPayload: (
    run: R,
    timing: { timeToAnswerMs: number },
  ) =>
    | { step: AttemptStep; payload: unknown }
    | { step: AttemptStep; payload: unknown }[]
    | null
}

/** Round-trip payload the chat hands back on "다시 풀어보기" (router state only). */
export type WizardResumeState = {
  resumeSnapshot?: unknown
  resumeStep?: string
} | null

export interface UseWizardResult {
  stepIdx: number
  stepLabels: string[]
  canProceed: boolean
  showNext: boolean
  stuck: { level: StuckLevel; trigger: WizardEntryTrigger }
  body: ReactNode
  handleNext: () => void
  handlePrev: () => void
  askTeacher: () => void
}

/**
 * Generic wizard engine extracted from the blank flow. Owns run state (mirrored
 * into a ref for fresh logging), per-step grading history, the stuck-signal
 * state machine, forward-only attempt logging, and chat hand-off. Behavior is
 * identical to the original BlankWizard; only the step definitions vary.
 */
export function useWizard<R>(config: {
  problem: Problem
  initRun: (p: Problem) => R
  steps: StepDef<R>[]
}): UseWizardResult {
  const { problem, steps } = config
  const navigate = useNavigate()
  const location = useLocation()

  // Resume-on-return: chat's "다시 풀어보기" navigates here with the full `run`
  // snapshot + the step to land on. Read once at mount (fresh component) so the
  // student re-enters the exact step with their prior input intact. No storage —
  // the round-trip is pure router state.
  const resume = (location.state as WizardResumeState) ?? null
  const resumeIdx = steps.findIndex((s) => s.key === resume?.resumeStep)
  const initialStepIdx = resumeIdx >= 0 ? resumeIdx : 0

  const [run, setRunState] = useState<R>(
    () => (resume?.resumeSnapshot as R) ?? config.initRun(problem),
  )
  // Mirror of `run` kept in sync on every setRun so logging always serializes
  // the latest committed run (no stale render-closure reads).
  const runRef = useRef<R>(run)
  function setRun(updater: (r: R) => R) {
    setRunState((prev) => {
      const next = updater(prev)
      runRef.current = next
      return next
    })
  }

  const [stepIdx, setStepIdx] = useState(initialStepIdx)

  // Per-step grading history — feeds the stuck-signal state machine. Reset on
  // fresh mount (including a resume); the student re-submits and it rebuilds.
  const [history, setHistory] = useState<Record<string, StepAttempt[]>>(() =>
    Object.fromEntries(steps.map((s) => [s.key, [] as StepAttempt[]])),
  )

  // Ticks so the time-based `timeout` signal re-evaluates without user input.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  // Steps already persisted to `attempts`. Forward-only: revisiting a step and
  // advancing again must not double-log.
  const submittedRef = useRef<Set<number>>(new Set())
  // Wall-clock ms when each step was (first) entered — powers time_to_answer_ms.
  const stepEnterRef = useRef<Record<number, number>>({
    [initialStepIdx]: Date.now(),
  })

  // Record entry time the first time a step becomes active.
  useEffect(() => {
    if (stepEnterRef.current[stepIdx] === undefined) {
      stepEnterRef.current[stepIdx] = Date.now()
    }
  }, [stepIdx])

  const stepKey = steps[stepIdx].key

  // Reasoning-blanked rubric handed to every step render (never the raw one).
  const displayRubric = useMemo(
    () => toDisplayRubric(problem.grading_rubric),
    [problem],
  )

  function recordGrade(value: string, verdict: StepVerdict) {
    setHistory((h) => ({
      ...h,
      [stepKey]: [...(h[stepKey] ?? []), { value, verdict, at: Date.now() }],
    }))
  }

  const stuck = useMemo(
    () =>
      computeStuck(
        history[stepKey] ?? [],
        stepEnterRef.current[stepIdx],
        nowTick,
      ),
    [history, stepKey, stepIdx, nowTick],
  )

  function askTeacher() {
    const step = steps[stepIdx]
    const ctx: WizardChatContext = {
      step: stepKey,
      studentInput: step.serializeInput(run),
      gradeResult: step.gradeResult(run, problem),
      entryTrigger: stuck.trigger,
      snapshot: run,
    }
    navigate('/chat/' + problem.id, { state: { wizardContext: ctx } })
  }

  const canProceed = steps[stepIdx].canProceed(run)

  function logStep(idx: number, runOverride?: R) {
    if (submittedRef.current.has(idx)) return
    submittedRef.current.add(idx)
    const timing = {
      timeToAnswerMs: Date.now() - (stepEnterRef.current[idx] ?? Date.now()),
    }
    const result = steps[idx].logPayload(runOverride ?? runRef.current, timing)
    if (result === null) return
    const entries = Array.isArray(result) ? result : [result]
    for (const entry of entries) {
      void logAttempt(problem.id, entry.step, entry.payload)
    }
  }

  function handleNext() {
    if (!canProceed) return
    logStep(stepIdx)
    setStepIdx((i) => Math.min(i + 1, steps.length - 1))
  }

  function handlePrev() {
    setStepIdx((i) => Math.max(i - 1, 0))
  }

  const body = steps[stepIdx].render({
    run,
    problem,
    displayRubric,
    setRun,
    recordGrade,
    logNow: (o?: R) => logStep(stepIdx, o),
    stepKey,
  })

  return {
    stepIdx,
    stepLabels: steps.map((s) => s.label),
    canProceed,
    showNext: stepIdx < steps.length - 1,
    stuck,
    body,
    handleNext,
    handlePrev,
    askTeacher,
  }
}
