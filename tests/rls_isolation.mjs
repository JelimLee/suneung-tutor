// tests/rls_isolation.mjs — T7 RLS 격리 배포 게이트 (이 테스트 없이 배포 금지)
//
// 검증 항목:
//   1. attempts   — 익명 세션 B가 세션 A의 행을 못 봄 (own-rows-only)
//   2. chat_messages — 익명 세션 B가 세션 A의 행을 못 봄
//   3. teacher_chunks — anon 직접 select 시 원문이 새지 않음 (zero-policy RLS)
//   4. problems   — anon 읽기 O / anon insert·update X
//
// 실행:
//   SUPABASE_SERVICE_ROLE_KEY=<service_role 키> node tests/rls_isolation.mjs
//
// 보안: service_role 키는 저장소·.env 에 두지 않는다(절대 규칙 2). 실행 시 env 로만 주입.
//       URL/anon 키는 공개값이므로 .env(VITE_SUPABASE_URL/ANON_KEY)에서 읽는다.

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, '/'))
const { createClient } = require('@supabase/supabase-js')

function envFromDotEnv() {
  const out = {}
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* .env optional */ }
  return out
}

const env = envFromDotEnv()
const URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !ANON) { console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 필요 (.env)'); process.exit(2) }
if (!SR) { console.error('SUPABASE_SERVICE_ROLE_KEY 환경변수 필요 (저장 금지, 실행 시 주입)'); process.exit(2) }

const MARK = '__RLS_TEST__'
const mk = (key, sk) => createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false, storageKey: sk } })
const results = []
const rec = (name, expected, actual, pass) => results.push({ name, expected, actual, pass })

const admin = mk(SR, 'adm')

// 공개 문제 하나를 대상으로 삼는다 (읽기 테스트 + 변조 시도 대상)
const { data: probs, error: probErr } = await admin.from('problems').select('id, passage').limit(1)
if (probErr || !probs?.length) { console.error('problems 시드 없음:', probErr?.message); process.exit(2) }
const PID = probs[0].id
const origPassage = probs[0].passage

const A = mk(ANON, 'A'); const B = mk(ANON, 'B'); const anon = mk(ANON, 'anon')
const { data: aAuth, error: aErr } = await A.auth.signInAnonymously()
const { data: bAuth, error: bErr } = await B.auth.signInAnonymously()
if (aErr || bErr) { console.error('익명 로그인 실패:', aErr?.message, bErr?.message); process.exit(1) }
const uidA = aAuth.user.id, uidB = bAuth.user.id
rec('0. 익명 세션 2개 uid 분리', 'A ≠ B', `${uidA.slice(0,8)} vs ${uidB.slice(0,8)}`, uidA !== uidB)

// 1. attempts 격리
const attemptRows = ['prereading', 'polarity', 'theme_recall'].map((step) => ({ problem_id: PID, step, payload: { [MARK]: true, step } }))
const { error: aInsErr } = await A.from('attempts').insert(attemptRows)
const { data: aOwn } = await A.from('attempts').select('id').eq('problem_id', PID).contains('payload', { [MARK]: true })
const { data: bSees } = await B.from('attempts').select('id').eq('problem_id', PID).contains('payload', { [MARK]: true })
rec('1. attempts: A 자기 행 insert/read', '3 rows', `${aOwn?.length ?? 0}${aInsErr ? ' ERR:' + aInsErr.message : ''}`, !aInsErr && (aOwn?.length ?? 0) === 3)
rec("1. attempts: B가 A 행 못 봄", '0 rows', `${bSees?.length ?? 0}`, (bSees?.length ?? 0) === 0)

// 2. chat_messages 격리
const chatRows = [{ problem_id: PID, role: 'user', content: MARK + ' q' }, { problem_id: PID, role: 'assistant', content: MARK + ' a' }]
const { error: aChatErr } = await A.from('chat_messages').insert(chatRows)
const { data: aChatOwn } = await A.from('chat_messages').select('id').eq('problem_id', PID).ilike('content', MARK + '%')
const { data: bChatSees } = await B.from('chat_messages').select('id').eq('problem_id', PID).ilike('content', MARK + '%')
rec('2. chat_messages: A 자기 행 insert/read', '2 rows', `${aChatOwn?.length ?? 0}${aChatErr ? ' ERR:' + aChatErr.message : ''}`, !aChatErr && (aChatOwn?.length ?? 0) === 2)
rec("2. chat_messages: B가 A 행 못 봄", '0 rows', `${bChatSees?.length ?? 0}`, (bChatSees?.length ?? 0) === 0)

// 3. teacher_chunks 원문 유출 금지 — 직접 select
const { data: tc, error: tcErr } = await anon.from('teacher_chunks').select('content').limit(3)
rec('3. teacher_chunks: anon 직접 select 차단', '0 rows / error', tcErr ? 'error ' + tcErr.code : `${tc?.length ?? 0} rows`, (tc?.length ?? 0) === 0)

// 3b. teacher_chunks: RPC 경유 유출 금지 (match_teacher_chunks 는 SECURITY INVOKER 여야 함).
//     직접-select 테스트가 놓치는 벡터 — 함수가 실수로 SECURITY DEFINER 로 바뀌면 여기서 잡힌다.
const qvec = Array(384).fill(0); qvec[0] = 1
const { data: tcRpc, error: tcRpcErr } = await anon.rpc('match_teacher_chunks', { query_embedding: qvec, match_count: 3 })
rec('3b. teacher_chunks: anon RPC 차단', '0 rows / error', tcRpcErr ? 'error ' + tcRpcErr.code : `${tcRpc?.length ?? 0} rows`, (tcRpc?.length ?? 0) === 0)

// 4a. problems 공개 읽기
const { data: pubRead, error: prErr } = await anon.from('problems').select('id').limit(2)
rec('4a. problems: anon 공개 읽기', '>=1 row', `${pubRead?.length ?? 0}${prErr ? ' err:' + prErr.code : ''}`, (pubRead?.length ?? 0) >= 1 && !prErr)

// 4b. problems anon insert 차단
const { data: insData, error: insErr } = await anon.from('problems').insert({ id: 'RLS_HACK_' + MARK, question_type: '빈칸', passage: 'hack' }).select()
rec('4b. problems: anon insert 차단', 'error / 0 rows', insErr ? 'blocked ' + insErr.code : `${insData?.length ?? 0} inserted`, !!insErr || (insData?.length ?? 0) === 0)

// 4c. problems anon update 차단
const { data: updData, error: updErr } = await anon.from('problems').update({ passage: '__HACKED__' }).eq('id', PID).select()
const { data: after } = await admin.from('problems').select('passage').eq('id', PID).single()
const unchanged = after?.passage === origPassage
rec('4c. problems: anon update 차단', '0 rows + 원문 유지', `${updData?.length ?? 0} rows${updErr ? ' ' + updErr.code : ''}; ${unchanged ? 'intact' : 'MUTATED'}`, (updErr || (updData?.length ?? 0) === 0) && unchanged)

// 정리 (service_role)
await admin.from('attempts').delete().contains('payload', { [MARK]: true })
await admin.from('chat_messages').delete().ilike('content', MARK + '%')
await admin.from('problems').delete().eq('id', 'RLS_HACK_' + MARK)
if (!unchanged) await admin.from('problems').update({ passage: origPassage }).eq('id', PID)

console.log('=== T7 RLS 격리 테스트 ===')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name}  →  ${r.actual}`)
const allPass = results.every((r) => r.pass)
console.log(`\n${allPass ? '✅ ALL GREEN — 배포 게이트 통과' : '❌ FAIL — RLS 수정 후 재검증'} (${results.filter(r => r.pass).length}/${results.length})`)
process.exit(allPass ? 0 : 1)
