import { problemTypeTitle } from '../../types'
import type { QuestionType } from '../../types'

/** Placeholder for question types whose dedicated procedure ships in T5. */
export default function ComingSoon({ type }: { type: QuestionType }) {
  return (
    <div className="rounded-2xl border border-cream-200 bg-white/60 p-8 text-center">
      <span className="inline-block rounded-full bg-sage px-3 py-1 text-sm font-semibold text-white">
        {problemTypeTitle(type)}
      </span>
      <h2 className="mt-4 text-lg font-bold text-ink">준비 중</h2>
      <p className="mt-2 text-sm text-ink-muted">
        {problemTypeTitle(type)} 유형의 전용 풀이 절차는 곧 추가됩니다. 지금은
        빈칸 유형만 단계별 풀이를 지원해요.
      </p>
    </div>
  )
}
