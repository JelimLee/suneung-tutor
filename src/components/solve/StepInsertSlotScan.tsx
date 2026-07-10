import { splicePreview } from '../../lib/solve/insert'
import type { StepVerdict } from './types'

const NUMERALS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

type SlotPick = '자연스러움' | '어색함'

interface Phase3Value {
  slotJudgment: Record<number, SlotPick>
  slotGraded: Record<number, StepVerdict>
}

interface Props {
  /** 6 segments for 5 slots: position k inserts BETWEEN segments[k-1] and segments[k]. */
  segments: string[]
  insertSentence: string
  value: Phase3Value
  onChange: (next: Phase3Value) => void
  /**
   * Frame-supplied grader over the FULL rubric. ANSWER-SAFE: 자연스러움 on the fit
   * slot AND 어색함 on any non-fit slot both return 'accepted', so a neutral-on-accept
   * UI never singles out the answer.
   */
  gradeSlot: (slot: number, pick: SlotPick) => StepVerdict
  /** Fires on each pick (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/**
 * 삽입 Phase 3 — 슬롯 소거 스캔. The learner walks the FULL passage slot by slot,
 * judging whether the insert sentence reads naturally THERE. Slots reveal
 * sequentially (② appears only after ① is answered). Slots judged 어색함 gray out
 * as the learner's own elimination, carried into Phase 4.
 *
 * ANTI-LEAK: per-slot feedback NEVER identifies the answer. On a mismatch ('reject')
 * we show a soft, task-level nudge ("이 자리 앞뒤를 한 번 더 볼까요?"); on 'accepted'
 * or 'neutral' we show NOTHING distinguishing — no green ✓, no "정답". The rubric
 * never enters this component; nothing here gates advancing.
 */
export default function StepInsertSlotScan({
  segments,
  insertSentence,
  value,
  onChange,
  gradeSlot,
  onGrade,
}: Props) {
  const slotCount = Math.max(0, segments.length - 1)
  const slots = Array.from({ length: slotCount }, (_, i) => i + 1)

  const judged = (k: number): boolean => value.slotJudgment[k] != null
  // Sequential reveal: slot k is visible once slot k-1 has been answered.
  const visible = (k: number): boolean => k === 1 || judged(k - 1)

  const judgedCount = slots.filter(judged).length
  const naturalCount = slots.filter(
    (k) => value.slotJudgment[k] === '자연스러움',
  ).length
  const allJudged = judgedCount >= slotCount
  const allEliminated = allJudged && naturalCount === 0

  function pick(k: number, opt: SlotPick) {
    const graded = gradeSlot(k, opt)
    onChange({
      slotJudgment: { ...value.slotJudgment, [k]: opt },
      slotGraded: { ...value.slotGraded, [k]: graded },
    })
    onGrade?.(`슬롯 ${k} ${opt}`, graded)
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-ink">
          이제 다섯 자리에 하나씩 넣어보고, 자연스러운지 판단해요.
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          한 자리씩 삽입 문장을 끼워 읽어보세요. 어색하면 빼고(소거), 자연스러운
          자리는 남겨서 다음 단계로 가져갑니다.
        </p>
      </div>

      {/* 삽입할 문장 (참조) */}
      <div className="rounded-2xl border border-pink/40 bg-pink-50 p-4">
        <p className="text-xs font-semibold text-pink-600">삽입할 문장</p>
        <p className="mt-1 text-sm leading-relaxed text-ink">
          {insertSentence || '(삽입 문장이 없어요)'}
        </p>
      </div>

      {/* 전체 지문 + 5개 슬롯 위치 (참조) */}
      <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
        <p className="text-xs font-semibold text-sage-600">지문 · 다섯 자리</p>
        <p className="mt-2 text-sm leading-relaxed text-ink">
          {segments.map((seg, i) => (
            <span key={i}>
              {seg}
              {i < segments.length - 1 && (
                <span className="mx-1 inline-block rounded-md bg-sage-50 px-1.5 py-0.5 text-xs font-bold text-sage-600">
                  {NUMERALS[i]}
                </span>
              )}
            </span>
          ))}
        </p>
      </div>

      {/* 슬롯별 순차 카드 */}
      <ul className="space-y-3">
        {slots.map((k) => {
          if (!visible(k)) return null
          const preview = splicePreview(segments, insertSentence, k)
          const call = value.slotJudgment[k] ?? null
          const verdict = value.slotGraded[k]
          const eliminated = call === '어색함'

          return (
            <li
              key={k}
              className={
                'rounded-2xl border p-4 transition ' +
                (eliminated
                  ? 'border-cream-200 bg-cream-100/60 opacity-60'
                  : 'border-cream-200 bg-white/70')
              }
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sage-50 text-sm font-bold text-sage-600">
                  {NUMERALS[k - 1]}
                </span>
                <span className="text-sm font-semibold text-ink">
                  이 자리에 넣어 읽어보면?
                </span>
                {eliminated && (
                  <span className="ml-auto rounded-full bg-ink/60 px-2 py-0.5 text-xs font-bold text-white">
                    소거함
                  </span>
                )}
              </div>

              {/* 스플라이스 미리보기: 삽입 문장을 핑크로 강조 */}
              <p
                className={
                  'mt-3 text-sm leading-relaxed ' +
                  (eliminated ? 'text-ink-muted/70' : 'text-ink-muted')
                }
              >
                {preview.before && <span>{preview.before} </span>}
                <mark
                  className={
                    'rounded bg-pink-50 px-1 font-semibold text-pink-600 ' +
                    (eliminated ? 'line-through' : '')
                  }
                >
                  {preview.inserted || '(삽입 문장 없음)'}
                </mark>
                {preview.after && <span> {preview.after}</span>}
              </p>

              <div className="mt-3 flex gap-2">
                {(['자연스러움', '어색함'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => pick(k, opt)}
                    className={
                      'rounded-full border px-4 py-1.5 text-sm font-semibold transition ' +
                      (call === opt
                        ? 'border-pink bg-pink text-white'
                        : 'border-cream-200 bg-white text-ink hover:border-pink/50')
                    }
                  >
                    {opt}
                  </button>
                ))}
              </div>

              {/* ANTI-LEAK: 불일치(reject)일 때만 부드러운 넛지. accepted/neutral엔 아무 표시 없음. */}
              {verdict === 'reject' && (
                <p className="mt-3 text-sm font-medium text-ink-muted">
                  이 자리 앞뒤를 한 번 더 볼까요?
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {allEliminated && (
        <p className="rounded-2xl border border-pink/40 bg-pink-50 px-4 py-3 text-sm font-medium text-pink-600">
          적어도 한 자리는 남겨두고 넘어가요. 다섯 자리를 모두 빼면 넣을 곳이
          없어요 — 가장 자연스러운 자리를 다시 살펴보세요.
        </p>
      )}
    </div>
  )
}
