import type { OmitScanPick, StepVerdict } from './types'

interface Phase2Value {
  scan: Record<number, OmitScanPick>
  graded: Record<number, StepVerdict>
}

interface Props {
  /** Passage text before (1) — the topic-stating lead (context). */
  lead: string
  /** The 5 numbered sentence texts; index 0 == (1). */
  sentences: string[]
  value: Phase2Value
  onChange: (next: Phase2Value) => void
  /**
   * Frame-supplied grader over the FULL rubric. ANSWER-SAFE: '기여' on every
   * relevant sentence AND '의심' on the one irrelevant sentence both return
   * 'accepted', so a neutral-on-accept UI never singles out the answer.
   */
  gradeSentence: (num: number, pick: OmitScanPick) => StepVerdict
  /** Fires on each pick (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/**
 * 무관 Phase 2 — 문장별 주제기여 스캔. The learner walks each numbered sentence and
 * judges whether it 기여s to the 소재 they named, or is 의심스러운(off-topic). This is
 * the 삽입 슬롯 스캔의 거울상.
 *
 * ANTI-LEAK: per-sentence feedback NEVER identifies the answer. On a mismatch
 * ('reject') we show a soft, task-level question ("이 문장, 소재랑 어떻게 이어지죠?");
 * on 'accepted'/'neutral' we show NOTHING distinguishing — no green ✓, no "정답",
 * NO "아쉬워요". flow_without is never shown here. Nothing gates advancing.
 */
export default function StepOmitScan({
  lead,
  sentences,
  value,
  onChange,
  gradeSentence,
  onGrade,
}: Props) {
  function pick(num: number, opt: OmitScanPick) {
    const graded = gradeSentence(num, opt)
    onChange({
      scan: { ...value.scan, [num]: opt },
      graded: { ...value.graded, [num]: graded },
    })
    onGrade?.(`문장 ${num} ${opt}`, graded)
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-ink">
          문장을 하나씩 보며, 소재에 기여하는지 판단해요.
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          각 문장이 내가 잡은 소재를 밀고 나가면 ‘소재에 기여’, 흐름에서 겉도는 것
          같으면 ‘의심’을 눌러요. 하나만 빼고 모두 기여하는 게 보통이에요.
        </p>
      </div>

      {/* 도입부 (참조) */}
      {lead && (
        <div className="rounded-2xl border border-cream-200 bg-white/60 p-4">
          <p className="text-xs font-semibold text-ink-muted">도입부</p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{lead}</p>
        </div>
      )}

      {/* 번호 문장별 카드 */}
      <ul className="space-y-3">
        {sentences.map((text, i) => {
          const num = i + 1
          const call = value.scan[num] ?? null
          const verdict = value.graded[num]
          return (
            <li
              key={num}
              className="rounded-2xl border border-cream-200 bg-white/70 p-4"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage-50 text-sm font-bold text-sage-600">
                  ({num})
                </span>
                <p className="text-sm leading-relaxed text-ink">{text}</p>
              </div>

              <div className="mt-3 flex gap-2">
                {(['기여', '의심'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => pick(num, opt)}
                    className={
                      'rounded-full border px-4 py-1.5 text-sm font-semibold transition ' +
                      (call === opt
                        ? 'border-pink bg-pink text-white'
                        : 'border-cream-200 bg-white text-ink hover:border-pink/50')
                    }
                  >
                    {opt === '기여' ? '소재에 기여' : '의심'}
                  </button>
                ))}
              </div>

              {/* ANTI-LEAK: 불일치(reject)일 때만 부드러운 과제형 질문. accepted/neutral엔 표시 없음. */}
              {verdict === 'reject' && (
                <p className="mt-3 text-sm font-medium text-ink-muted">
                  이 문장, 소재랑 어떻게 이어지죠?
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
