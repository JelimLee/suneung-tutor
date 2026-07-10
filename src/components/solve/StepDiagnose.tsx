import { useState } from 'react'
import { GRAMMAR_CATEGORIES, microKind } from '../../lib/solve/grammar'
import type {
  GrammarCategory,
  MicroAnswer,
  UnderlineLite,
} from '../../lib/solve/grammar'
import type { GrammarDiagnoseState, StepVerdict, ThemeGrade } from './types'

interface Props {
  underlines: UnderlineLite[]
  value: GrammarDiagnoseState
  onChange: (next: GrammarDiagnoseState) => void
  /** Frame-supplied category grader (uses FULL rubric; correct category stays out). */
  gradeCat: (num: number, cat: GrammarCategory) => StepVerdict
  /** Frame-supplied micro-check grader (uses FULL rubric; correct value stays out). */
  gradeMicroFn: (num: number, cat: GrammarCategory, micro: MicroAnswer) => StepVerdict
  /** Frame-supplied lenient subject-head grader (동사 only; head text stays out). */
  gradeHeadFn: (num: number, input: string) => ThemeGrade
  /** Fires on each grading action (wizard-internal stuck signal). */
  onGrade?: (value: string, verdict: StepVerdict) => void
}

/** ThemeGrade → StepVerdict for the stuck-signal channel. */
function toVerdict(g: ThemeGrade): StepVerdict {
  if (g === 'accept') return 'accepted'
  if (g === 'reject') return 'reject'
  return 'neutral'
}

/** Shared accept/reject micro nudge — never reveals the correct value. */
function MicroFeedback({ verdict }: { verdict?: StepVerdict }) {
  if (verdict === 'accepted') {
    return <p className="mt-2 text-sm font-medium text-sage-600">잘 봤어요 ✓</p>
  }
  if (verdict === 'reject') {
    return <p className="mt-2 text-sm font-medium text-pink-600">다시 볼까요?</p>
  }
  return null
}

/**
 * 어법 진단 — 각 밑줄이 "무엇을 물어보는지" 범주를 스스로 고르고, 그 범주에 맞는
 * 미시 점검(목적어 유무 / 절 완전성 / 주어 수일치 / 품사)을 같은 카드 안에서 바로
 * 이어서 한다. 모든 채점은 프레임 그레이더(gradeCat/gradeMicroFn/gradeHeadFn)로
 * 소프트하게만: 정답 범주·check_point·정답값·is_correct은 절대 노출하지 않는다 —
 * 오직 ✓ / "다시 볼까요" 넛지만. 미시 점검은 그 밑줄이 틀린 것인지가 아니라
 * 학생의 문법 분석이 맞는지를 채점한다.
 */
export default function StepDiagnose({
  underlines,
  value,
  onChange,
  gradeCat,
  gradeMicroFn,
  gradeHeadFn,
  onGrade,
}: Props) {
  // Ephemeral head-grade feedback (동사). ThemeGrade only — no hidden value here.
  const [headGrades, setHeadGrades] = useState<Record<number, ThemeGrade>>({})

  function pick(num: number, cat: GrammarCategory) {
    const verdict = gradeCat(num, cat)
    // Switching category clears the prior micro answer/verdict (shape differs).
    onChange({
      ...value,
      picks: { ...value.picks, [num]: cat },
      graded: { ...value.graded, [num]: verdict },
      micro: { ...value.micro, [num]: {} },
      microGraded: { ...value.microGraded, [num]: 'neutral' },
    })
    setHeadGrades((h) => ({ ...h, [num]: 'none' }))
    onGrade?.(`${num}:${cat}`, verdict)
  }

  /** Merge a micro patch, recompute microGraded via the frame grader; returns it. */
  function updateMicro(num: number, patch: MicroAnswer): StepVerdict {
    const cat = value.picks[num]
    const nextMicro: MicroAnswer = { ...(value.micro[num] ?? {}), ...patch }
    const verdict = cat ? gradeMicroFn(num, cat, nextMicro) : 'neutral'
    onChange({
      ...value,
      micro: { ...value.micro, [num]: nextMicro },
      microGraded: { ...value.microGraded, [num]: verdict },
    })
    return verdict
  }

  function setSubjectInput(num: number, text: string) {
    // Editing invalidates the prior head grade until re-checked.
    setHeadGrades((h) => ({ ...h, [num]: 'none' }))
    updateMicro(num, { subjectInput: text })
  }

  function checkHead(num: number) {
    const input = value.micro[num]?.subjectInput ?? ''
    if (!input.trim()) return
    const g = gradeHeadFn(num, input)
    setHeadGrades((h) => ({ ...h, [num]: g }))
    // Recompute the combined micro verdict (head + number) too.
    updateMicro(num, {})
    onGrade?.(`${num}:${input}`, toVerdict(g))
  }

  function pickChip(num: number, patch: MicroAnswer, signal: string) {
    const v = updateMicro(num, patch)
    onGrade?.(`${num}:${signal}`, v)
  }

  function renderMicro(u: UnderlineLite) {
    const picked = value.picks[u.num]
    if (!picked) return null
    const kind = microKind(picked)
    const m: MicroAnswer = value.micro[u.num] ?? {}
    const microVerdict = value.microGraded[u.num]

    if (kind === null) {
      return (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          대명사·병렬 등은 무엇을 가리키는지 / 무엇과 나란한지 문맥으로
          확인하세요.
        </p>
      )
    }

    if (kind === 'object') {
      return (
        <div className="mt-3">
          <p className="text-sm font-semibold text-ink">
            이 준동사 뒤에 목적어가 있나요?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['있음', '없음'] as const).map((opt) => {
              const active = m.hasObject === opt
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => pickChip(u.num, { hasObject: opt }, opt)}
                  className={
                    'rounded-full border px-4 py-1.5 text-sm transition ' +
                    (active
                      ? 'border-pink bg-pink text-white'
                      : 'border-cream-200 bg-white/70 text-ink hover:border-pink')
                  }
                >
                  {opt}
                </button>
              )
            })}
          </div>
          {m.hasObject != null && <MicroFeedback verdict={microVerdict} />}
        </div>
      )
    }

    if (kind === 'clause') {
      return (
        <div className="mt-3">
          <p className="text-sm font-semibold text-ink">
            뒤 문장이 완전한가요? (빠진 명사 없이)
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['완전', '불완전'] as const).map((opt) => {
              const active = m.clause === opt
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => pickChip(u.num, { clause: opt }, opt)}
                  className={
                    'rounded-full border px-4 py-1.5 text-sm transition ' +
                    (active
                      ? 'border-pink bg-pink text-white'
                      : 'border-cream-200 bg-white/70 text-ink hover:border-pink')
                  }
                >
                  {opt}
                </button>
              )
            })}
          </div>
          {m.clause != null && <MicroFeedback verdict={microVerdict} />}
        </div>
      )
    }

    if (kind === 'pos') {
      return (
        <div className="mt-3">
          <p className="text-sm font-semibold text-ink">
            이 자리엔 부사가 맞아요, 형용사가 맞아요?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['부사', '형용사'] as const).map((opt) => {
              const active = m.pos === opt
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => pickChip(u.num, { pos: opt }, opt)}
                  className={
                    'rounded-full border px-4 py-1.5 text-sm transition ' +
                    (active
                      ? 'border-pink bg-pink text-white'
                      : 'border-cream-200 bg-white/70 text-ink hover:border-pink')
                  }
                >
                  {opt}
                </button>
              )
            })}
          </div>
          {m.pos != null && <MicroFeedback verdict={microVerdict} />}
        </div>
      )
    }

    // kind === 'subject' (동사): head text + 채점 + 단수/복수 chips (inlined from
    // the old StepSubjectHead). Head feedback is the lenient ThemeGrade; the
    // number feedback reflects the combined micro verdict (head + number).
    const input = m.subjectInput ?? ''
    const headGrade = headGrades[u.num] ?? 'none'
    return (
      <>
        <div className="mt-3">
          <label className="text-sm font-semibold text-ink">
            이 동사의 주어의 핵심 단어 하나?
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setSubjectInput(u.num, e.target.value)}
              placeholder="예: results"
              className="flex-1 rounded-xl border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/50 focus:border-pink"
            />
            <button
              type="button"
              onClick={() => checkHead(u.num)}
              disabled={!input.trim()}
              className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              채점하기
            </button>
          </div>
          {headGrade === 'accept' && (
            <p className="mt-2 text-sm font-medium text-sage-600">
              핵을 잘 잡았어요 👍
            </p>
          )}
          {headGrade === 'reject' && (
            <p className="mt-2 text-sm font-medium text-pink-600">
              주어의 진짜 핵을 다시 볼까요?
            </p>
          )}
        </div>

        <div className="mt-3">
          <p className="text-sm font-semibold text-ink">
            이 동사의 주어는 단수예요, 복수예요?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['단수', '복수'] as const).map((n) => {
              const active = m.number === n
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => pickChip(u.num, { number: n }, n)}
                  className={
                    'rounded-full border px-4 py-1.5 text-sm transition ' +
                    (active
                      ? 'border-pink bg-pink text-white'
                      : 'border-cream-200 bg-white/70 text-ink hover:border-pink')
                  }
                >
                  {n}
                </button>
              )
            })}
          </div>
          {m.number != null && <MicroFeedback verdict={microVerdict} />}
        </div>
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-ink">
          이 밑줄, <span className="text-pink-600">뭘 물어보는 것 같아요?</span>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          각 밑줄이 어떤 문법 요소를 건드리는지 골라보세요. 범주를 잡아야 무엇을
          확인해야 하는지 보여요. (예: 대동사 did가 be동사를 받으면 안 되죠 →
          &lsquo;동사&rsquo;)
        </p>
      </div>

      {underlines.length === 0 && (
        <p className="text-sm text-ink-muted">
          밑줄 정보를 불러오지 못했어요. 위 지문을 직접 보고 판단해 주세요.
        </p>
      )}

      <ul className="space-y-3">
        {underlines.map((u) => {
          const picked = value.picks[u.num] ?? null
          const graded = value.graded[u.num]
          return (
            <li
              key={u.num}
              className="rounded-2xl border border-cream-200 bg-white/60 p-4"
            >
              <p className="text-sm text-ink">
                <span className="mr-2 rounded-md bg-sage-50 px-2 py-0.5 text-xs font-bold text-sage-600">
                  {u.num}
                </span>
                <span className="font-semibold text-ink">{u.word}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {GRAMMAR_CATEGORIES.map((cat) => {
                  const active = picked === cat
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => pick(u.num, cat)}
                      className={
                        'rounded-full border px-3 py-1.5 text-sm transition ' +
                        (active
                          ? 'border-pink bg-pink text-white'
                          : 'border-cream-200 bg-white/70 text-ink hover:border-pink')
                      }
                    >
                      {cat}
                    </button>
                  )
                })}
              </div>
              {picked && graded === 'accepted' && (
                <p className="mt-2 text-sm font-medium text-sage-600">
                  범주를 잘 잡았어요 ✓
                </p>
              )}
              {picked && graded === 'reject' && (
                <p className="mt-2 text-sm font-medium text-pink-600">
                  음, 이 밑줄이 건드리는 게 그건지 다시 볼까요?
                </p>
              )}

              {renderMicro(u)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
