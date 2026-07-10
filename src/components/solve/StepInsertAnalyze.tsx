import { useState } from 'react'
import type { StepVerdict, ThemeGrade } from './types'

/** Highlights whitespace-delimited words that hit one of `tokens`. */
function Highlighted({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length || !text) return <>{text}</>
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((part, i) => {
        const norm = part.toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
        const hit =
          norm.length >= 2 &&
          tokens.some((t) => norm.includes(t) || t.includes(norm))
        return hit ? (
          <mark
            key={i}
            className="rounded bg-sage-50 px-0.5 font-semibold text-sage-600"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
    </>
  )
}

interface CueValue {
  present: '있음' | '없음' | null
  graded: StepVerdict
}
interface AnaphorValue {
  // choice-id from anaphorChoices (e.g. 'contrast' | 'similar' | 'cause' | 'ref')
  pick: string | null
  graded: StepVerdict
}
interface PriorValue {
  input: string
  graded: ThemeGrade
  matched: string[]
}

interface Props {
  /** The insert sentence ONLY — no passage. */
  insertSentence: string
  cue: CueValue
  onCueChange: (next: CueValue) => void
  gradeCue: (pick: '있음' | '없음') => StepVerdict
  anaphorType: AnaphorValue
  onAnaphorChange: (next: AnaphorValue) => void
  gradeAnaphor: (pickId: string) => StepVerdict
  /** Option pills for Q2, computed by the frame via anaphorChoices(anaphor_type).
   * The component never reads the rubric — it renders id/label and passes id back. */
  anaphorOptions: { id: string; label: string }[]
  priorContent: PriorValue
  onPriorChange: (next: PriorValue) => void
  gradePrior: (input: string) => { graded: ThemeGrade; matched: string[] }
  /** Fires on each grading action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/**
 * 삽입 Phase 2 — 삽입 문장 분석. Shows ONLY the insert sentence, then walks the
 * backward-pointing cue: (Q1) is there an anaphor/connective at all (있음/없음,
 * deterministic grade); (Q2, revealed after Q1) what must precede it — 비슷/반대/원인;
 * (Q3) a free-text prediction of the content that must sit right before the slot,
 * soft-graded via `gradePrior`. The rubric never enters this component; nothing
 * gates advancing. Feedback praises the reasoning move, never the student.
 */
export default function StepInsertAnalyze({
  insertSentence,
  cue,
  onCueChange,
  gradeCue,
  anaphorType,
  onAnaphorChange,
  gradeAnaphor,
  anaphorOptions,
  priorContent,
  onPriorChange,
  gradePrior,
  onGrade,
}: Props) {
  const [priorChecked, setPriorChecked] = useState(
    priorContent.matched.length > 0 || priorContent.graded !== 'none',
  )

  function pickCue(present: '있음' | '없음') {
    const graded = gradeCue(present)
    onCueChange({ present, graded })
    onGrade?.(`지시어 ${present}`, graded)
  }

  function pickAnaphor(pickId: string) {
    const graded = gradeAnaphor(pickId)
    onAnaphorChange({ pick: pickId, graded })
    onGrade?.(pickId, graded)
  }

  function runPriorCheck() {
    const { graded, matched } = gradePrior(priorContent.input)
    onPriorChange({ input: priorContent.input, graded, matched })
    setPriorChecked(true)
    const verdict: StepVerdict =
      graded === 'accept' ? 'accepted' : graded === 'none' ? 'neutral' : 'reject'
    onGrade?.(priorContent.input, verdict)
  }

  return (
    <div className="space-y-6">
      {/* 삽입 문장만 노출 */}
      <div className="rounded-2xl border border-pink/40 bg-pink-50 p-4">
        <p className="text-xs font-semibold text-pink-600">삽입할 문장</p>
        <p className="mt-1 text-sm leading-relaxed text-ink">
          {insertSentence || '(삽입 문장이 없어요)'}
        </p>
      </div>

      {/* Q1 — 지시어/연결사 유무 */}
      <div>
        <label className="text-sm font-semibold text-ink">
          이 문장에 앞을 가리키는 말이 있나요?{' '}
          <span className="font-normal text-ink-muted">
            (지시어·연결사)
          </span>
        </label>
        <div className="mt-2 flex gap-2">
          {(['있음', '없음'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => pickCue(opt)}
              className={
                'rounded-full border px-5 py-2 text-sm font-semibold transition ' +
                (cue.present === opt
                  ? 'border-pink bg-pink text-white'
                  : 'border-cream-200 bg-white text-ink hover:border-pink/50')
              }
            >
              {opt}
            </button>
          ))}
        </div>
        {cue.present !== null && (
          <p className="mt-3 text-sm font-medium text-ink-muted">
            {cue.graded === 'accepted'
              ? '앞을 가리키는 신호를 잘 찾았어요.'
              : cue.graded === 'reject'
                ? '문장 안의 연결사·지시어를 한 번 더 살펴볼까요?'
                : '표시했어요. 이어서 살펴봐요.'}
          </p>
        )}
      </div>

      {/* Q2 — 앞연결 성격 (Q1 응답 후에만) */}
      {cue.present !== null && (
        <div>
          <label className="text-sm font-semibold text-ink">
            그 말은 앞에 뭐가 있어야 성립해요?
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {anaphorOptions.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => pickAnaphor(o.id)}
                className={
                  'rounded-full border px-4 py-2 text-sm font-semibold transition ' +
                  (anaphorType.pick === o.id
                    ? 'border-pink bg-pink text-white'
                    : 'border-cream-200 bg-white text-ink hover:border-pink/50')
                }
              >
                {o.label}
              </button>
            ))}
          </div>
          {anaphorType.pick !== null && (
            <p className="mt-3 text-sm font-medium text-ink-muted">
              {anaphorType.graded === 'accepted'
                ? '삽입 문장이 앞에 요구하는 관계를 정확히 잡았어요.'
                : anaphorType.graded === 'reject'
                  ? '이 연결이 앞과 어떤 관계를 만드는지 다시 볼까요?'
                  : '골랐어요. 이어서 앞 내용을 예측해봐요.'}
            </p>
          )}
        </div>
      )}

      {/* Q3 — 앞에 와야 할 내용 예측 */}
      <div>
        <label className="text-sm font-semibold text-ink">
          그럼 삽입 문장 바로 앞에는 어떤 내용이 와야 해요?
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={priorContent.input}
            onChange={(e) => {
              onPriorChange({ ...priorContent, input: e.target.value })
              if (priorChecked) setPriorChecked(false)
            }}
            placeholder="예: 앞선 주장을 뒷받침하는 구체적 사례"
            className="flex-1 rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
          <button
            type="button"
            onClick={runPriorCheck}
            disabled={!priorContent.input.trim()}
            className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            대조
          </button>
        </div>

        {priorChecked && (
          <div className="mt-4 space-y-3">
            {priorContent.graded === 'accept' && (
              <p className="text-sm font-medium text-sage-600">
                앞에 와야 할 내용을 제대로 예측했어요.
              </p>
            )}
            {priorContent.graded === 'reject' && (
              <p className="text-sm font-medium text-pink-600">
                삽입 문장이 무엇을 이어받는지 다시 읽어볼까요?
              </p>
            )}
            {priorContent.graded === 'none' && (
              <p className="text-sm font-medium text-ink-muted">
                적었으면 다음으로 넘어가도 돼요.
              </p>
            )}

            {priorContent.graded !== 'none' && (
              <>
                <p className="text-sm font-semibold text-sage-600">
                  겹치는 핵심어 {priorContent.matched.length}개
                  {priorContent.matched.length > 0 && (
                    <span className="ml-2 font-normal text-ink-muted">
                      {priorContent.matched.join(', ')}
                    </span>
                  )}
                </p>
                <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
                  <p className="text-xs font-semibold text-ink-muted">
                    내가 예측한 앞 내용
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink">
                    <Highlighted
                      text={priorContent.input}
                      tokens={priorContent.matched}
                    />
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
