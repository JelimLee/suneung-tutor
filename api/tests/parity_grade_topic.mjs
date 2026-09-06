// Parity test: production Edge (supabase/functions/grade-topic) vs the FastAPI
// port (POST /grade-topic). Fires the same cases at both and diffs the grade.
//
// Both must agree on the graded DIRECTION (accept / reject_* / ambiguous):
//   - rule-tier & validation cases: exact `graded` match required (deterministic)
//   - llm-tier cases: coarse direction match (LLM output is non-deterministic)
//
// Env (falls back to repo-root .env):
//   SUPABASE_URL, SUPABASE_ANON_KEY   — mint an anon JWT + reach the Edge fn
//   FASTAPI_URL (default http://localhost:8000)
//
// Run:  node api/tests/parity_grade_topic.mjs
// The FastAPI server must be up (see api/README.md). No local OPENAI_API_KEY is
// needed for the rule/validation cases; the llm-tier case needs one on the
// FastAPI side to produce a non-ambiguous answer.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── env: process.env wins, else parse repo-root .env ────────────────────────
function loadEnv() {
  const env = { ...process.env }
  try {
    const txt = readFileSync(resolve(__dirname, '../../.env'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !env[m[1]]) env[m[1]] = m[2]
    }
  } catch {}
  return env
}
const env = loadEnv()
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
const FASTAPI_URL = (env.FASTAPI_URL || 'http://localhost:8000').replace(/\/$/, '')
const EDGE_URL = `${SUPABASE_URL}/functions/v1/grade-topic`

if (!SUPABASE_URL || !ANON) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY.')
  process.exit(2)
}

// ── shared rubric for the cases ─────────────────────────────────────────────
const TOPIC = {
  canonical: '도덕성',
  accept: ['도덕', '윤리'],
  reject_too_narrow: ['거짓말 금지'],
  reject_too_broad: ['가치'],
  reject_wrong: ['경제', '날씨'],
  note: '도덕적 판단의 보편성에 관한 글',
}
const PASSAGE = 'Morality is a system of principles. It guides how people ought to act.'

// tier: how the FastAPI port is expected to resolve the case.
//   rule       → tier-1 match, exact graded expected on both (Edge LLM should agree)
//   validation → request rejected before grading (400), exact match
//   llm        → tier-2 fallback, direction match only
const CASES = [
  { name: '정답 소재 (exact accept)',   word: '도덕',        tier: 'rule', expect: 'accept' },
  { name: '오답 소재 (exact reject)',   word: '경제',        tier: 'rule', expect: 'reject_wrong' },
  { name: '너무 넓음 (reject_too_broad)', word: '가치',      tier: 'rule', expect: 'reject_too_broad' },
  { name: '한/영 혼용 (substring accept)', word: 'ethics 윤리', tier: 'rule', expect: 'accept' },
  { name: '빈 입력 (validation)',       word: '',            tier: 'validation', expect: 400 },
  { name: '모호한 소재 (llm fallback)', word: '사회 규범',   tier: 'llm', expectDir: 'any' },
]

function direction(g) {
  if (g === 'accept') return 'accept'
  if (typeof g === 'string' && g.startsWith('reject_')) return 'reject'
  return 'ambiguous'
}

async function mintJwt() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: '{}',
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('anon signup failed: ' + JSON.stringify(data))
  return data.access_token
}

async function call(url, jwt, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

function verdict(c, edge, fast) {
  if (c.tier === 'validation') {
    return edge.status === c.expect && fast.status === c.expect
  }
  const eg = edge.json?.graded
  const fg = fast.json?.graded
  if (c.tier === 'rule') {
    // FastAPI must hit the exact bucket; Edge (LLM) must agree on direction.
    return fg === c.expect && direction(eg) === direction(c.expect)
  }
  // llm: both non-deterministic → require same direction family.
  return direction(eg) === direction(fg)
}

const pad = (s, n) => String(s ?? '').padEnd(n)

async function main() {
  const jwt = await mintJwt()
  console.log(`Edge:    ${EDGE_URL}`)
  console.log(`FastAPI: ${FASTAPI_URL}/grade-topic\n`)

  const rows = []
  let pass = 0
  for (const c of CASES) {
    const body = { word: c.word, topic: TOPIC, passage: PASSAGE }
    const [edge, fast] = await Promise.all([
      call(EDGE_URL, jwt, body),
      call(`${FASTAPI_URL}/grade-topic`, jwt, body),
    ])
    const ok = verdict(c, edge, fast)
    if (ok) pass++
    rows.push({
      name: c.name,
      tier: c.tier,
      edge: c.tier === 'validation' ? `HTTP ${edge.status}` : edge.json?.graded,
      edgeProv: edge.json?.provider ?? '-',
      fast: c.tier === 'validation' ? `HTTP ${fast.status}` : fast.json?.graded,
      fastProv: fast.json?.provider ?? '-',
      ok,
    })
  }

  console.log(
    pad('CASE', 30) + pad('TIER', 12) + pad('EDGE', 20) + pad('FASTAPI', 20) + 'RESULT',
  )
  console.log('-'.repeat(90))
  for (const r of rows) {
    console.log(
      pad(r.name, 30) +
        pad(r.tier, 12) +
        pad(`${r.edge} (${r.edgeProv})`, 20) +
        pad(`${r.fast} (${r.fastProv})`, 20) +
        (r.ok ? 'PASS' : 'FAIL'),
    )
  }
  console.log('-'.repeat(90))
  console.log(`${pass}/${CASES.length} PASS`)
  process.exit(pass === CASES.length ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
