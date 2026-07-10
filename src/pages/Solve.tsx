import { Link, useParams } from 'react-router-dom'
import type { Problem } from '../lib/useProblem'
import { useProblem } from '../lib/useProblem'
import type { QuestionType } from '../types'
import { problemTypeTitle } from '../types'
import BlankWizard from '../components/solve/BlankWizard'
import OrderWizard from '../components/solve/OrderWizard'
import GrammarWizard from '../components/solve/GrammarWizard'
import VocabWizard from '../components/solve/VocabWizard'
import InsertWizard from '../components/solve/InsertWizard'
import OmitWizard from '../components/solve/OmitWizard'
import ComingSoon from '../components/solve/ComingSoon'

// Type-dispatched wizard registry. Each new problem-type flow adds one entry;
// unmapped types fall through to ComingSoon.
const WIZARDS: Partial<Record<QuestionType, React.FC<{ problem: Problem }>>> = {
  빈칸: BlankWizard,
  순서: OrderWizard,
  어법: GrammarWizard,
  어휘: VocabWizard,
  삽입: InsertWizard,
  무관: OmitWizard,
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-cream-200 bg-white/70 p-6 shadow-sm">
      {children}
    </div>
  )
}

export default function Solve() {
  const { problemId } = useParams<{ problemId: string }>()
  const { problem, loading, error } = useProblem(problemId)

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link to="/" className="text-sm text-ink-muted hover:text-ink">
        ← 문제 선택으로
      </Link>

      {loading && (
        <Card>
          <p className="text-sm text-ink-muted">문제를 불러오는 중…</p>
        </Card>
      )}

      {!loading && error && (
        <Card>
          <h1 className="text-lg font-semibold text-ink">
            문제를 불러오지 못했습니다
          </h1>
          <p className="mt-2 text-sm text-ink-muted">{error}</p>
        </Card>
      )}

      {!loading && !error && !problem && (
        <Card>
          <h1 className="text-lg font-semibold text-ink">
            문제를 찾을 수 없습니다
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            <code className="rounded bg-cream-100 px-2 py-0.5 text-pink-600">
              {problemId}
            </code>{' '}
            에 해당하는 문제가 없어요.
          </p>
        </Card>
      )}

      {!loading && !error && problem && (
        <>
          {/* Context: passage + question the wizard steps refer to */}
          <div className="mt-4 rounded-2xl border border-cream-200 bg-white/70 p-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-sage-50 px-2 py-0.5 text-xs font-semibold text-sage-600">
                {problem.question_type}
              </span>
              <h1 className="text-lg font-bold text-ink">
                {problemTypeTitle(problem.question_type)}
              </h1>
              {problem.exam_round && (
                <span className="text-xs text-ink-muted">
                  {problem.exam_round}
                </span>
              )}
              <code className="ml-auto rounded bg-cream-100 px-2 py-0.5 text-xs text-pink-600">
                {problem.id}
              </code>
            </div>
            {problem.question && (
              <p className="mt-4 text-sm font-semibold text-ink">
                {problem.question}
              </p>
            )}
            {/* 삽입·무관 wizards own passage exposure per-phase (intro-only →
                full passage). Showing the full passage (with slot ①~⑤ markers or
                the numbered (1)~(5) sentences) here would defeat the Phase-1
                scaffolding, so both suppress the context passage. */}
            {problem.question_type !== '삽입' &&
              problem.question_type !== '무관' && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {problem.passage}
              </p>
            )}
          </div>

          {/* Type-dispatched flow */}
          <div className="mt-6 rounded-2xl border border-cream-200 bg-cream-100/40 p-6 shadow-sm">
            {(() => {
              const W = WIZARDS[problem.question_type]
              return W ? (
                <W problem={problem} />
              ) : (
                <ComingSoon type={problem.question_type} />
              )
            })()}
          </div>
        </>
      )}
    </main>
  )
}
