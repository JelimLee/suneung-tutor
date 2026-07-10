import type { OrderLabel, OrderVerifyState, StepVerdict } from './types'

interface Props {
  value: OrderVerifyState
  given: string
  blocks: { label: OrderLabel; text: string }[]
  order: OrderLabel[]
  onChange: (next: OrderVerifyState) => void
  /** Fires on each 자연스러움 판단 (wizard-internal stuck signal). SELF-check —
   * 'awkward' → reject(막힘 신호), 'natural' → neutral(정답을 뜻하지 않음). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/**
 * 순서 4단계 — 이어읽기. 학생이 정한 순서대로 지문을 붙여 읽어보고 흐름이
 * 자연스러운지 스스로 판단한다(삽입의 "넣어보기"에 대응). rubric과 하드 채점하지
 * 않는다: '자연스러워요'가 정답을 뜻하지 않으므로 자동 accept 하지 않는다.
 */
export default function StepVerifyRead({
  value,
  given,
  blocks,
  order,
  onChange,
  onGrade,
}: Props) {
  const complete = blocks.length > 0 && order.length === blocks.length
  const byLabel = new Map(blocks.map((b) => [b.label, b.text]))

  function pick(naturalness: 'natural' | 'awkward') {
    onChange({ ...value, naturalness })
    onGrade?.(
      order.join('-') + (naturalness === 'awkward' ? ' (어색)' : ''),
      naturalness === 'awkward' ? 'reject' : 'neutral',
    )
  }

  if (!complete) {
    return (
      <div className="rounded-2xl border border-cream-200 bg-cream-100 p-4">
        <p className="text-sm text-ink-muted">
          먼저 배열을 마치고 오세요.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-ink">
        정한 순서대로 읽어볼까요? 말이 자연스럽게 이어져요?
      </p>

      {/* 학생이 정한 순서대로 이어붙인 지문 */}
      <div className="space-y-3 rounded-2xl border border-cream-200 bg-white/60 p-4 leading-relaxed">
        <p className="text-sm text-ink">
          <span className="mr-2 rounded-md bg-sage-50 px-2 py-0.5 text-xs font-bold text-sage-600">
            주어진 글
          </span>
          {given || '(자동 분해가 안 됐어요)'}
        </p>
        {order.map((label) => (
          <p key={label} className="text-sm text-ink">
            <span className="mr-2 rounded-md bg-sage-50 px-2 py-0.5 text-xs font-bold text-sage-600">
              ({label})
            </span>
            {byLabel.get(label) ?? ''}
          </p>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => pick('natural')}
          className={
            'rounded-full border px-5 py-2 text-sm font-semibold transition ' +
            (value.naturalness === 'natural'
              ? 'border-sage bg-sage-50 text-sage-600'
              : 'border-cream-200 bg-white/60 text-ink hover:border-sage')
          }
        >
          자연스럽게 이어져요
        </button>
        <button
          type="button"
          onClick={() => pick('awkward')}
          className={
            'rounded-full border px-5 py-2 text-sm font-semibold transition ' +
            (value.naturalness === 'awkward'
              ? 'border-pink bg-pink-50 text-pink-600'
              : 'border-cream-200 bg-white/60 text-ink hover:border-pink')
          }
        >
          어색한 데가 있어요
        </button>
      </div>

      {value.naturalness === 'awkward' && (
        <div>
          <label className="text-sm font-semibold text-ink">
            어디가 어색해요?{' '}
            <span className="font-normal text-ink-muted">(선택)</span>
          </label>
          <input
            type="text"
            value={value.note}
            onChange={(e) => onChange({ ...value, note: e.target.value })}
            placeholder="예: B 다음에 A가 오니 갑자기 튀어요"
            className="mt-2 w-full rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
          />
        </div>
      )}

      {value.naturalness === 'natural' && (
        <p className="text-xs text-ink-muted">
          자연스럽게 읽혔군요. 이제 최종 선지에서 답을 확정해 볼까요?
        </p>
      )}
    </div>
  )
}
