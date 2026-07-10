import { useRef, useState } from 'react'
import type { UnderlineLite } from '../../lib/solve/grammar'
import type { WhyOption } from '../../lib/useProblem'
import ReasonButtons from './ReasonButtons'
import RecoveryLoop from './RecoveryLoop'
import type {
  GrammarChoiceState,
  RecoveryLogPayload,
  RecoveryPriorJudgment,
  RecoveryQuestion,
  RecoveryReselect,
  StepVerdict,
} from './types'

interface Props {
  underlines: UnderlineLite[]
  answer: number | null // 1-based num of the grammatically wrong underline
  explanation: string | null
  choices: string[]
  /** DISPLAY rubric why_options, keyed by underline num string (neutralized). */
  whyOptions: Record<string, WhyOption[]>
  value: GrammarChoiceState
  onChange: (next: GrammarChoiceState) => void
  /** Fired exactly once when the learner commits the final choice. */
  onComplete: (finalState: GrammarChoiceState) => void
  /** Fires on the final-answer commit (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
  /** Frame-supplied why-option grader (uses FULL rubric; correct flag stays out). */
  gradeReason: (pickedNum: number, id: string) => StepVerdict
  // ── 오답 회복(RecoveryLoop) wiring — ALL built in GrammarWizard from the FULL
  // rubric; this component reads NO rubric and only passes these through. ──
  /** 원칙4 diagnostic questions (category axis), pre-bound to the wrong pick. */
  recoveryQuestions: RecoveryQuestion[]
  /** The single re-selection UI + its frame-closure grader. */
  reselect: RecoveryReselect
  /** 원칙2 mirror — the student's OWN prior 범주 진단 judgment. */
  studentPriorJudgment: RecoveryPriorJudgment
  /** Fired on a correct reselect. No-op in the host — RecoveryLoop self-drives to
   * its own done screen and stays mounted; do NOT flip finalChoice (that would
   * swap in the first-try correct branch). retry_success logs via onRecoveryLog. */
  onRecoveryRetry: (pickNum: number) => void
  /** attempts.payload.recovery sink (persisted by the wizard). */
  onRecoveryLog: (payload: RecoveryLogPayload) => void
  /** Opaque snapshot for the chat handoff (never carries the answer/rubric). */
  handoffContext: unknown
  /** For RecoveryLoop's /chat/:id links. */
  problemId: string
}

/**
 * 어법 마지막 단계(self-drives) — 5개 밑줄 중 어법상 틀린 것을 고르고, 왜 틀렸는지
 * 근거 버튼 + 한 줄 근거를 남긴 뒤 제출한다. 제출 시 정오답 배너 + 해설.
 * why_options는 정답 밑줄에만 있으므로, 정답 num을 골랐을 때만 버튼이 뜬다(의도됨).
 */
export default function StepGrammarChoice({
  underlines,
  answer,
  explanation,
  choices,
  whyOptions,
  value,
  onChange,
  onComplete,
  onGrade,
  gradeReason,
  recoveryQuestions,
  reselect,
  studentPriorJudgment,
  onRecoveryRetry,
  onRecoveryLog,
  handoffContext,
  problemId,
}: Props) {
  const [picked, setPicked] = useState<number | null>(value.finalChoice)
  const completedRef = useRef(false)

  const committed = value.finalChoice !== null

  if (committed) {
    const selected = value.finalChoice as number
    const known = answer !== null
    const correct = known && selected === answer
    const selectedWord =
      underlines.find((u) => u.num === selected)?.word ??
      choices[selected - 1] ??
      ''

    // WRONG commit → self-driving 오답 회복 loop. NO answer reveal (원칙3): the
    // component reads no rubric; every verdict arrives via injected frame
    // closures, and RecoveryLoop renders only process-level copy. onChatHandoff
    // is a no-op — persistence already flows through `log` (goHandoff calls it),
    // so firing it again here would double-log.
    if (known && !correct) {
      return (
        <RecoveryLoop
          studentPriorJudgment={studentPriorJudgment}
          initialAnswer={`${selected}번 '${selectedWord}'`}
          recoveryQuestions={recoveryQuestions}
          reselect={reselect}
          onRetry={(pickId) => onRecoveryRetry(Number(pickId))}
          onChatHandoff={() => {}}
          handoffContext={handoffContext}
          log={onRecoveryLog}
          problemId={problemId}
          explanation={explanation}
        />
      )
    }

    // CORRECT commit (or no answer info) → process-level success banner + 해설.
    return (
      <div className="space-y-4">
        <div
          className={
            'rounded-2xl border p-4 ' +
            (!known
              ? 'border-cream-200 bg-cream-100'
              : 'border-sage bg-sage-50')
          }
        >
          <p className="text-sm font-bold">
            {!known ? (
              <span className="text-ink">정답 정보 없음</span>
            ) : (
              <span className="text-sage-600">정답입니다 ✓</span>
            )}
          </p>
          <p className="mt-2 text-sm text-ink">
            내가 고른 밑줄:{' '}
            <b>
              {selected}. {selectedWord}
            </b>
          </p>
          {value.evidence.trim() && (
            <p className="mt-2 text-xs text-ink-muted">내 근거: {value.evidence}</p>
          )}
        </div>

        {explanation && explanation.trim() && (
          <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
            <p className="text-xs font-semibold text-ink-muted">해설</p>
            <p className="mt-1 text-sm leading-relaxed text-ink">{explanation}</p>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          풀이 기록이 저장되었습니다. 더 궁금하면 튜터 챗으로 이어가세요.
        </p>
      </div>
    )
  }

  const reasonOptions = picked !== null ? (whyOptions[String(picked)] ?? []) : []
  const reasonVerdict: StepVerdict | null =
    picked !== null && value.reasonPick
      ? gradeReason(picked, value.reasonPick)
      : null
  const pickedWord =
    picked !== null ? (underlines.find((u) => u.num === picked)?.word ?? '') : ''

  function selectNum(num: number) {
    setPicked(num)
    // Switching the target invalidates the prior reason pick.
    onChange({ ...value, reasonPick: null })
  }

  function commit() {
    if (picked === null) return
    const finalState: GrammarChoiceState = { ...value, finalChoice: picked }
    onChange(finalState)
    const verdict: StepVerdict =
      answer !== null && picked === answer ? 'accepted' : 'reject'
    onGrade?.(String(picked), verdict)
    if (!completedRef.current) {
      completedRef.current = true
      onComplete(finalState)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-ink">
        어법상 <span className="text-pink-600">틀린 밑줄</span>은?
      </p>

      <ul className="space-y-2">
        {underlines.map((u) => {
          const isPicked = u.num === picked
          return (
            <li key={u.num}>
              <button
                type="button"
                onClick={() => selectNum(u.num)}
                className={
                  'w-full rounded-2xl border p-3 text-left text-sm transition ' +
                  (isPicked
                    ? 'border-pink bg-pink-50 text-ink'
                    : 'border-cream-200 bg-white/60 text-ink hover:border-pink')
                }
              >
                <span className="mr-2 font-semibold text-ink-muted">{u.num}</span>
                {u.word}
              </button>
            </li>
          )
        })}
      </ul>

      {picked !== null && reasonOptions.length > 0 && (
        <ReasonButtons
          question={`${picked}번 '${pickedWord}'가 틀렸다고 봤네요. 왜요?`}
          options={reasonOptions}
          picked={value.reasonPick}
          verdict={reasonVerdict}
          onPick={(id) => onChange({ ...value, reasonPick: id })}
        />
      )}

      <div>
        <label className="text-sm font-semibold text-ink">
          근거 한 줄{' '}
          <span className="font-normal text-ink-muted">
            (왜 그 밑줄이 틀렸는지 한 문장)
          </span>
        </label>
        <input
          type="text"
          value={value.evidence}
          onChange={(e) => onChange({ ...value, evidence: e.target.value })}
          placeholder="예: 주어가 복수인데 단수 동사를 써서 수 일치가 안 맞아요"
          className="mt-2 w-full rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
        />
      </div>

      <button
        type="button"
        onClick={commit}
        disabled={picked === null}
        className="rounded-full bg-pink px-6 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        제출하고 결과 보기 →
      </button>
    </div>
  )
}
