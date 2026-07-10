import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getProblems, type Problem } from '../lib/useProblem'
import type { QuestionType } from '../types'

// Filter pills. '무관' exists in the data but has no dedicated pill; it shows
// only under 전체.
const FILTERS: QuestionType[] = ['빈칸', '순서', '삽입', '어법', '어휘']

function Difficulty({ level }: { level: number | null }) {
  if (level == null) return <span className="text-ink-muted/50">난이도 –</span>
  const max = 5
  const filled = Math.max(0, Math.min(max, level))
  return (
    <span className="tracking-tight text-pink-600" title={`난이도 ${filled}/${max}`}>
      {'●'.repeat(filled)}
      <span className="text-cream-200">{'○'.repeat(max - filled)}</span>
    </span>
  )
}

export default function ProblemSelect() {
  const navigate = useNavigate()
  const [problems, setProblems] = useState<Problem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<QuestionType | 'all'>('all')

  useEffect(() => {
    let cancelled = false
    getProblems()
      .then((rows) => {
        if (cancelled) return
        setProblems(rows)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '문제 목록을 불러오지 못했습니다.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible =
    filter === 'all'
      ? problems
      : problems.filter((p) => p.question_type === filter)

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <span className="inline-block rounded-full bg-pink px-4 py-1 text-sm font-semibold text-white">
          수능 영어 독해 튜터
        </span>
        <h1 className="mt-4 text-3xl font-bold text-ink">문제 선택</h1>
        <p className="mt-2 text-ink-muted">
          풀 문제를 고르세요. 빈칸 유형은 단계별 절차로 안내합니다.
        </p>
      </header>

      {/* Filter pills */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={
            'rounded-full px-4 py-1.5 text-sm font-semibold transition ' +
            (filter === 'all'
              ? 'bg-pink text-white'
              : 'bg-white/70 text-ink-muted hover:text-ink')
          }
        >
          전체
        </button>
        {FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={
              'rounded-full px-4 py-1.5 text-sm font-semibold transition ' +
              (filter === t
                ? 'bg-pink text-white'
                : 'bg-white/70 text-ink-muted hover:text-ink')
            }
          >
            {t}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-sm text-ink-muted">문제 목록을 불러오는 중…</p>
      )}
      {!loading && error && (
        <div className="rounded-2xl border border-cream-200 bg-white/70 p-5">
          <p className="text-sm text-ink-muted">{error}</p>
        </div>
      )}
      {!loading && !error && visible.length === 0 && (
        <p className="text-sm text-ink-muted">해당 유형의 문제가 없어요.</p>
      )}

      <ul className="space-y-3">
        {visible.map((p) => (
          <li key={p.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/solve/${p.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate(`/solve/${p.id}`)
                }
              }}
              className="block cursor-pointer rounded-2xl border border-cream-200 bg-white/70 p-4 shadow-sm transition hover:border-pink hover:shadow-md"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-sage-50 px-2 py-0.5 text-xs font-semibold text-sage-600">
                  {p.question_type}
                </span>
                <code className="text-xs text-ink-muted">{p.id}</code>
                <span className="ml-auto text-sm">
                  <Difficulty level={p.difficulty} />
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-ink-muted">
                  {p.exam_round ?? '출처 미상'}
                </span>
                <Link
                  to={`/chat/${p.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-full bg-cream-100 px-3 py-1 text-xs font-medium text-ink-muted hover:text-ink"
                >
                  튜터 챗
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
