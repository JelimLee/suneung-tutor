import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProblem } from '../lib/useProblem'

// Structural read of the wizard→chat router-state snapshot. Chat interprets NONE
// of the solve logic — it only reads these plain fields and passes `snapshot`
// straight through (CLAUDE.md Rule 4: data crosses, components/logic do not).
// Any wizard's step key (blank or 순서); unknown keys fall back to the raw key.
type WizardStepKey = string
type WizardContextState = {
  step: WizardStepKey
  studentInput: string
  gradeResult: string
  entryTrigger: string
  snapshot: unknown
}
type ChatLocationState = { wizardContext?: WizardContextState } | null

const WIZARD_STEP_LABELS: Record<string, string> = {
  // 빈칸
  prereading: '사전 독해',
  polarity: '문장 극성',
  theme: '주제 회상',
  choice: '선지 처리',
  // 순서
  eliminate: '소거',
  arrange: '배열',
  verify_read: '이어읽기',
  order_choice: '최종 선지',
  // 어법
  grammar_diagnose: '범주 진단',
  grammar_subject: '주어 수일치',
  grammar_choice: '틀린 밑줄',
  // 어휘
  vocab_topic: '소재 파악',
  vocab_polarity: '글 부호',
  vocab_diagnose: '밑줄 진단',
  vocab_choice: '틀린 낱말',
  // 삽입 (v2 5-phase)
  insert_topic: '소재 파악',
  insert_analyze: '삽입문 분석',
  insert_slotscan: '슬롯 소거',
  insert_confirm: '답 확정',
  insert_recover: '오답 회복',
  // 무관 (5-phase; 삽입 거울상)
  omit_topic: '사전 독해',
  omit_scan: '문장 스캔',
  omit_confirm: '무관 확정',
  omit_explain: '자기 설명',
  omit_recover: '오답 회복',
}

// Models whitelisted server-side. Anything else falls back to gpt-5.1.
const MODELS = ['gpt-5.1', 'claude-sonnet-5'] as const
type Model = (typeof MODELS)[number]

type Starter = { label: string; text: string }

// 층 1 폴백 — 사전독해 데이터가 없을 때 쓰는 일반 스타터.
const STARTERS: Starter[] = [
  { label: '이 문제 같이 풀어보기', text: '이 문제 같이 풀어보고 싶어요. 어디서부터 시작하면 될까요?' },
  { label: '내 풀이 진단받기', text: '제 풀이를 진단받고 싶어요. 무엇부터 말하면 될까요?' },
  { label: '비슷한 유형 설명 듣기', text: '이 유형 문제에 접근하는 방법을 알려주세요.' },
]

// 층 2 — AI 응답 뒤 quick reply. 대화 유지용이라 정답 직접 요청류는 넣지 않는다.
const QUICK_REPLIES = ['이해했어요', '다시 설명해줘', '예시 하나만']

// 층 1 개인화 — 이 문제의 사전독해 attempts(소재/서론유형)로 스타터를 만든다.
// 라벨은 focusing(결정적 지점 주의)만. funneling(답 유도) 금지.
// 사전독해 데이터가 없으면 [] 반환 → 호출부가 일반 STARTERS로 폴백.
function buildStarters(p?: { topic_word?: string; intro_type?: string }): Starter[] {
  if (!p) return []
  const out: Starter[] = []
  const topic = p.topic_word?.trim()
  const intro = p.intro_type?.trim()
  if (topic)
    out.push({
      label: `소재를 '${topic}'라고 잡았는데 맞을까?`,
      text: `제가 이 글의 소재를 '${topic}'라고 봤어요. 이 방향이 맞는지 지문에서 같이 확인하고 싶어요.`,
    })
  if (intro)
    out.push({
      label: `서론을 '${intro}'으로 봤어 — 방향 맞아?`,
      text: `서론 유형을 '${intro}'이라고 진단했는데, 이 방향이 맞는지 근거를 같이 찾아보고 싶어요.`,
    })
  const padders: Starter[] = [
    { label: '빈칸 앞 문장부터 같이 볼래', text: '빈칸 바로 앞 문장부터 같이 천천히 보면서 흐름을 확인하고 싶어요.' },
    { label: '내가 잡은 방향이 맞는지 근거를 같이 찾을래', text: '제가 잡은 방향이 맞는지, 지문에서 근거가 되는 문장을 같이 찾아보고 싶어요.' },
    { label: '헷갈리는 선지 두 개만 같이 비교할래', text: '헷갈리는 선지 두 개를 골라서 지문 근거로 같이 비교해보고 싶어요.' },
  ]
  for (const pad of padders) {
    if (out.length >= 3) break
    out.push(pad)
  }
  return out
}

// A user turn is just role + content. An assistant turn also carries the
// rendering metadata returned by the Edge Function so badges/indicators can be
// shown per-message.
type ChatTurn =
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string
      model?: string
      strategyTags?: string[]
      retrievedCount?: number
      error?: boolean
    }

// Shape returned by supabase.functions.invoke('tutor-chat', ...).
interface TutorChatResponse {
  answer: string
  model: string
  retrieved_ids: string[]
  strategy_tags: string[]
}

// Strip the trailing `[전략: ...]` line the model appends. The parsed tags come
// back separately in strategy_tags, so we only need the prose for display.
function stripStrategyLine(answer: string): string {
  return answer.replace(/\n*\[전략:[^\]]*\]\s*$/u, '').trimEnd()
}

export default function Chat() {
  const { problemId } = useParams<{ problemId: string }>()
  const { problem, loading, error } = useProblem(problemId)
  const location = useLocation()
  const navigate = useNavigate()

  // Wizard hand-off, if the student arrived from a solve step. Absent on direct
  // entries → the chat behaves exactly as before and sends no wizard fields.
  const wizardContext =
    (location.state as ChatLocationState)?.wizardContext ?? null
  // The wizard fields ride only the FIRST send; flipped once consumed.
  const contextConsumedRef = useRef(false)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [model, setModel] = useState<Model>('gpt-5.1')
  const [useRag, setUseRag] = useState(true)
  const [starters, setStarters] = useState<Starter[]>(STARTERS)

  const listEndRef = useRef<HTMLDivElement>(null)

  // Keep the newest message in view whenever the list or pending state changes.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, pending])

  // 층 1 개인화: 이 문제의 최신 사전독해 attempts(본인 것, RLS로 자동 격리)를 읽어
  // 스타터 버튼을 개인화한다. 학생 트랙 컴포넌트는 import하지 않고 데이터만 조회(격리 유지).
  useEffect(() => {
    if (!problemId) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('attempts')
        .select('payload')
        .eq('problem_id', problemId)
        .eq('step', 'prereading')
        .order('created_at', { ascending: false })
        .limit(1)
      if (cancelled) return
      const p = data?.[0]?.payload as
        | { topic_word?: string; intro_type?: string }
        | undefined
      const personalized = buildStarters(p)
      if (personalized.length) setStarters(personalized)
    })()
    return () => {
      cancelled = true
    }
  }, [problemId])

  async function send(
    override?: string,
    inputMode: 'button' | 'text' | 'quick_reply' = 'text',
  ) {
    const text = (typeof override === 'string' ? override : input).trim()
    if (!text || pending) return

    // OpenAI-style history: prior turns (excluding any error bubbles) plus the
    // new user message. This is exactly what the Edge Function expects.
    const history = turns
      .filter((t) => !('error' in t && t.error))
      .map((t) => ({ role: t.role, content: t.content }))

    const nextTurns: ChatTurn[] = [...turns, { role: 'user', content: text }]
    setTurns(nextTurns)
    setInput('')
    setPending(true)

    // First send from a wizard hand-off carries the continuity context + entry
    // logging fields; all later sends (and direct entries) omit them → the
    // nullable columns stay null.
    const body: Record<string, unknown> = {
      problem_id: problemId ?? null,
      messages: [...history, { role: 'user', content: text }],
      use_rag: useRag,
      model,
      input_mode: inputMode,
    }
    if (wizardContext && !contextConsumedRef.current) {
      body.wizard_context = {
        step: wizardContext.step,
        student_input: wizardContext.studentInput,
        grade_result: wizardContext.gradeResult,
      }
      body.chat_entry_point = wizardContext.step
      body.entry_trigger = wizardContext.entryTrigger
      body.wizard_state_snapshot = wizardContext.snapshot
      contextConsumedRef.current = true
    }

    try {
      const { data, error } = await supabase.functions.invoke<TutorChatResponse>(
        'tutor-chat',
        { body },
      )

      if (error || !data) {
        throw error ?? new Error('빈 응답을 받았습니다.')
      }

      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: stripStrategyLine(data.answer),
          model: data.model,
          strategyTags: data.strategy_tags ?? [],
          retrievedCount: data.retrieved_ids?.length ?? 0,
        },
      ])
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `응답을 받지 못했어요: ${message}`,
          error: true,
        },
      ])
    } finally {
      setPending(false)
    }
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter sends; Shift+Enter is free for future multi-line if needed.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  // 진입 차단: 문제/지문이 없으면 챗을 열지 않는다 (대리 풀이 방지의 기본 전제).
  if (loading) {
    return (
      <main className="mx-auto flex h-screen max-w-3xl items-center justify-center px-6">
        <p className="text-sm text-ink-muted">문제를 불러오는 중…</p>
      </main>
    )
  }
  if (!problem || !problem.passage?.trim()) {
    return (
      <main className="mx-auto flex h-screen max-w-3xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg font-bold text-ink">문제를 먼저 선택하세요</h1>
        <p className="max-w-sm text-sm text-ink-muted">
          {error
            ? `문제를 불러오지 못했어요: ${error}`
            : '튜터 챗은 특정 문제의 지문을 바탕으로 진행돼요. 문제를 골라 주세요.'}
        </p>
        <Link
          to="/"
          className="rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600"
        >
          문제 선택으로 가기
        </Link>
      </main>
    )
  }

  // 층 2 노출 조건: 마지막 턴이 (에러 아닌) AI 응답이고, 아직 초반(첫 3턴)일 때만.
  const assistantTurns = turns.filter(
    (t) => t.role === 'assistant' && !('error' in t && t.error),
  ).length
  const lastTurn = turns[turns.length - 1]
  const showQuickReplies =
    !pending &&
    lastTurn?.role === 'assistant' &&
    !('error' in lastTurn && lastTurn.error) &&
    assistantTurns <= 3

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col px-6 py-6">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-ink-muted hover:text-ink">
            ← 문제 선택
          </Link>
          <h1 className="mt-1 text-xl font-bold text-ink">
            {problem ? `${problem.question_type} 튜터 챗` : '튜터 챗'}
          </h1>
        </div>
        <code className="shrink-0 rounded bg-cream-100 px-2 py-0.5 text-xs text-pink-600">
          {problemId}
        </code>
      </header>

      {/* Controls: model toggle + RAG toggle */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="모델 선택"
          className="inline-flex rounded-full border border-cream-200 bg-white/70 p-0.5"
        >
          {MODELS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModel(m)}
              className={
                'rounded-full px-3 py-1 text-xs font-semibold transition ' +
                (model === m
                  ? 'bg-pink text-white'
                  : 'text-ink-muted hover:text-ink')
              }
            >
              {m}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setUseRag((v) => !v)}
          aria-pressed={useRag}
          className={
            'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ' +
            (useRag
              ? 'border-sage bg-sage-50 text-sage-600'
              : 'border-cream-200 bg-white/70 text-ink-muted hover:text-ink')
          }
        >
          <span
            className={
              'inline-block h-2 w-2 rounded-full ' +
              (useRag ? 'bg-sage' : 'bg-ink-muted/40')
            }
          />
          교사 설명 참고(RAG) {useRag ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Passage context (collapsible) */}
      {problem && (
        <details className="mt-3 rounded-2xl border border-cream-200 bg-white/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            지문 보기
            {problem.question ? (
              <span className="ml-2 font-normal text-ink-muted">
                {problem.question}
              </span>
            ) : null}
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {problem.passage}
          </p>
        </details>
      )}

      {/* Wizard hand-off banner — continuity cue + return path. */}
      {wizardContext && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-pink/30 bg-pink-50 px-4 py-3">
          <p className="min-w-0 text-sm text-ink">
            <span className="font-semibold text-pink-600">
              ‘{WIZARD_STEP_LABELS[wizardContext.step] ?? wizardContext.step}’
            </span>{' '}
            단계에서 이어왔어요
            {wizardContext.studentInput.trim() && (
              <>
                {' · 내가 쓴 것: '}
                <b className="text-ink">‘{wizardContext.studentInput}’</b>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() =>
              navigate('/solve/' + problemId, {
                state: {
                  resumeSnapshot: wizardContext.snapshot,
                  resumeStep: wizardContext.step,
                },
              })
            }
            className="shrink-0 rounded-full border border-pink/50 bg-white px-4 py-1.5 text-xs font-semibold text-pink-600 transition hover:bg-pink hover:text-white"
          >
            다시 풀어보기 →
          </button>
        </div>
      )}

      {/* Message list */}
      <div className="mt-4 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-cream-200 bg-white/40 p-4">
        {turns.length === 0 && !pending && (
          <div className="mt-8 flex flex-col items-center gap-3">
            <p className="text-sm text-ink-muted">어떻게 시작할까요?</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
              {starters.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => void send(s.text, 'button')}
                  className="rounded-full border border-pink/40 bg-pink-50 px-4 py-2 text-sm font-semibold text-pink-600 transition hover:bg-pink hover:text-white"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-pink px-4 py-2 text-sm text-white">
                {turn.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%]">
                <div
                  className={
                    'whitespace-pre-wrap rounded-2xl rounded-tl-sm px-4 py-2 text-sm ' +
                    (turn.error
                      ? 'bg-pink-50 text-pink-600'
                      : 'bg-white text-ink shadow-sm')
                  }
                >
                  {turn.content}
                </div>

                {!turn.error && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {turn.model && (
                      <span className="rounded-full bg-cream-100 px-2 py-0.5 text-[11px] text-ink-muted">
                        {turn.model}
                      </span>
                    )}
                    {turn.strategyTags?.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-sage-50 px-2 py-0.5 text-[11px] font-medium text-sage-600"
                      >
                        {tag}
                      </span>
                    ))}
                    {(turn.retrievedCount ?? 0) > 0 && (
                      <span className="text-[11px] text-ink-muted">
                        📚 참고한 교사 설명 {turn.retrievedCount}개
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {pending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-2 text-sm text-ink-muted shadow-sm">
              생각 중…
            </div>
          </div>
        )}

        <div ref={listEndRef} />
      </div>

      {/* 층 2 — quick reply (첫 3턴만 노출 후 사라짐) */}
      {showQuickReplies && (
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void send(q, 'quick_reply')}
              className="rounded-full border border-cream-200 bg-white/70 px-3 py-1 text-xs text-ink-muted transition hover:border-pink hover:text-pink-600"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="궁금한 점을 물어보세요…"
          disabled={pending}
          className="flex-1 rounded-full border border-cream-200 bg-white px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/60 focus:border-pink disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={pending || !input.trim()}
          className="shrink-0 rounded-full bg-pink px-5 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          보내기
        </button>
      </div>
    </main>
  )
}
