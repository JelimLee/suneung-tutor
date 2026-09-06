import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── e2e: 삽입(insert) + 무관(omit) Phase-5 오답 회복, ★조건3 1-retry 하드캡 재확인 ──
// Verifies the behavior change: reselect-wrong now goes STRAIGHT to handoff (no
// re-diagnosis loop), while the preserved features (삽입 self-explanation fill-in
// on done, 무관 reconnect-pair on done, diagnose/5a-5b flow) still work.

// Screenshot sink. Defaults to a repo-local, git-ignored folder so the test is
// runnable on any machine; override with SCRATCH=/some/dir.
const SCRATCH = process.env.SCRATCH ?? resolve(dirname(fileURLToPath(import.meta.url)), '../.e2e-artifacts')
mkdirSync(SCRATCH, { recursive: true })
const BASE = process.env.BASE ?? process.env.BASE_URL ?? 'http://localhost:5174'

const INSERT_ID = 'SN2027_ch11_01' // answer 4, anaphor contrast
const OMIT_ID = 'SN2027_ch09_01' // answer 4, traps on 1/2/3

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const SUPA_URL = /VITE_SUPABASE_URL=(.+)/.exec(env)[1].trim()
const ANON = /VITE_SUPABASE_ANON_KEY=(.+)/.exec(env)[1].trim()
const PROJECT_REF = new URL(SUPA_URL).host.split('.')[0]
const AUTH_KEY = `sb-${PROJECT_REF}-auth-token`

const results = { I: [], O: [], AL: [], L: [] }
const ok = (s, m) => (results[s].push(['PASS', m]), console.log(`  [PASS] ${s}: ${m}`))
const fail = (s, m) => (results[s].push(['FAIL', m]), console.log(`  [FAIL] ${s}: ${m}`))

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()

const bodyText = () => page.locator('body').innerText()
async function assertAbsent(sec, label, ...needles) {
  const txt = await bodyText()
  const hit = needles.filter((n) => txt.includes(n))
  if (hit.length === 0) ok(sec, `ANTI-LEAK: absent — ${label}`)
  else fail(sec, `LEAK: ${label} → present: ${hit.join(' | ')}`)
}

async function topicHeaderWait() {
  await page
    .getByText('이 지문은 뭘 다루고 있어요?', { exact: false })
    .first()
    .waitFor({ timeout: 15000 })
}

// ══════════════════ 삽입 helpers ═══════════════════════════════════════════════
async function insertToConfirm() {
  await page.goto(`${BASE}/solve/${INSERT_ID}`)
  await topicHeaderWait()
  // Phase 1 소재 파악
  await page
    .getByPlaceholder('예: 도덕 판단이 상황에 따라 달라지는 방식')
    .fill('이상화 모델의 두 유형 구분')
  await page.getByRole('button', { name: '대조', exact: true }).click()
  await page.getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('button', { name: '통념' }).first().click()
  await page.getByRole('button', { name: '다음 →' }).click()
  // Phase 2 삽입문 분석
  await page.getByText('앞을 가리키는 말이 있나요?', { exact: false }).waitFor()
  await page.getByRole('button', { name: '있음', exact: true }).click()
  await page.getByRole('button', { name: '반대·대조되는 내용', exact: true }).first().click()
  await page
    .getByPlaceholder('예: 앞선 주장을 뒷받침하는 구체적 사례')
    .fill('아리스토텔레스식 이상화에 대한 설명')
  await page.getByRole('button', { name: '대조', exact: true }).click()
  await page.getByRole('button', { name: '다음 →' }).click()
  // Phase 3 슬롯 소거: mark all 5 slots 자연스러움 (keep every slot a candidate)
  await page.getByText('다섯 자리에 하나씩', { exact: false }).waitFor()
  for (let k = 1; k <= 5; k++) {
    await page.getByRole('button', { name: '자연스러움', exact: true }).nth(k - 1).click()
  }
  await page.getByRole('button', { name: '다음 →' }).click()
  // Phase 4 답 확정 picker
  await page.getByText('그럼 어디에 넣어야 해요?', { exact: false }).waitFor()
}
// commit slot n at Phase-4 confirm
async function insertCommit(n) {
  await page.getByRole('button', { name: '이 자리에 넣기' }).nth(n - 1).click()
  await page.getByRole('button', { name: '이 자리로 확정하기 →' }).click()
}
// from Phase-4 wrong nudge → Phase-5 recovery
async function insertToRecover() {
  await page.getByText('자리를 골랐어요.', { exact: false }).waitFor()
  await page.getByRole('button', { name: '다음 →' }).click()
  await page.getByText('3단계에서 이 자리', { exact: false }).waitFor()
}
// walk 5a → 5b1 → 5b2, choosing the 5b2 option given
async function insertWalkTo5b2(signalPick) {
  await page.getByRole('button', { name: '어색함', exact: true }).click() // 5a
  await page.getByText('신호부터 다시 짚어봐요', { exact: false }).waitFor()
  await page.getByRole('button', { name: '반대·대조되는 내용', exact: true }).click() // 5b1
  await page.getByText('바로 앞 문장', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: signalPick, exact: true }).click() // 5b2
}
async function insertReselect(n) {
  await page.getByText('다시 어디에 넣어야 할까요?', { exact: false }).waitFor()
  await page.getByRole('button', { name: '이 자리에 넣기' }).nth(n - 1).click()
  await page.getByRole('button', { name: '이 자리로 다시 확정 →' }).click()
}

// ══════════════════ 무관 helpers ══════════════════════════════════════════════
async function omitToConfirm() {
  await page.goto(`${BASE}/solve/${OMIT_ID}`)
  await topicHeaderWait()
  await page
    .getByPlaceholder('예: 실패가 학습에 도움이 되는 방식')
    .fill('자아의 사회적 의존성')
  await page.getByRole('button', { name: '대조', exact: true }).click()
  await page.getByRole('button', { name: '주장' }).first().click()
  // wait for Next to enable (topic graded non-reject + intro picked)
  const next = page.getByRole('button', { name: '다음 →' })
  await next.waitFor()
  for (let i = 0; i < 40 && (await next.isDisabled()); i++) await page.waitForTimeout(250)
  if (await next.isDisabled()) throw new Error('omit Phase-1 Next never enabled (topic rejected?)')
  await next.click()
  // Phase 2 문장 스캔: mark all 5 sentences 소재에 기여
  await page.getByText('소재에 기여하는지 판단', { exact: false }).waitFor()
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '소재에 기여', exact: true }).nth(i).click()
  }
  await page.getByRole('button', { name: '다음 →' }).click()
  // Phase 3 무관 확정 picker
  await page.getByText('무관한 문장은 어느 것일까요?', { exact: false }).waitFor()
}
const omitOption = (n) => page.getByRole('button', { name: new RegExp(`^\\(${n}\\)`) })
async function omitCommit(n) {
  await omitOption(n).first().click()
  await page.getByRole('button', { name: '이 문장이 무관해요 →' }).click()
}
async function omitDiagnoseToReselect() {
  await page.getByText('내가 무관하다고 본 문장', { exact: false }).waitFor()
  await page.getByRole('button', { name: '다시 골라볼게요 →' }).click()
  await page.getByText('소재에서 겉도는 문장은 어느 것일까요?', { exact: false }).waitFor()
}
async function omitReselect(n) {
  await omitOption(n).first().click()
  await page.getByRole('button', { name: '이 문장이 무관해요 →' }).click()
}

try {
  // ═══════════ I-1. 삽입 happy path (first-try correct → normal done) ═══════════
  console.log('\n== I-1: 삽입 first-try CORRECT (normal confirm done) ==')
  await insertToConfirm()
  await insertCommit(4) // answer
  await page.getByText('정확한 자리에 넣었어요', { exact: false }).waitFor({ timeout: 5000 })
  ok('I', 'first-try correct → StepInsertConfirm terminal ("정확한 자리에 넣었어요")')
  if (await page.getByText('왜 그 자리인지 한 줄로 정리해봐요', { exact: false }).count())
    ok('I', 'first-try done: reflective fill-in (자기 언어 정리) present')
  else fail('I', 'first-try done: reflective fill-in MISSING')
  await page.screenshot({ path: `${SCRATCH}/insert_firsttry_correct.png` })

  // ═══════════ I-2. 삽입 recovery: reselect WRONG → HANDOFF (the cap) ═══════════
  console.log('\n== I-2: 삽입 recovery reselect WRONG → HANDOFF (★조건3 cap) ==')
  await insertToConfirm()
  await insertCommit(1) // wrong
  await insertToRecover()
  ok('I', 'recovery entry: Phase-5 5a opened after wrong commit ("3단계에서 이 자리")')
  await page.screenshot({ path: `${SCRATCH}/insert_recover_5a.png` })
  await insertWalkTo5b2('만족 안 함') // → 5c
  await insertReselect(2) // wrong, non-eliminated, non-answer
  await page.getByText('이 부분은 튜터랑 같이 볼까요?', { exact: false }).waitFor({ timeout: 5000 })
  ok('I', '5c reselect WRONG → handoff screen ("이 부분은 튜터랑 같이 볼까요?")')
  const afterCap = await bodyText()
  if (!afterCap.includes('3단계에서 이 자리') && !afterCap.includes('다시 어디에 넣어야'))
    ok('I', '★조건3 CAP HOLDS: did NOT loop back to 5a/5c re-diagnosis')
  else fail('I', '★조건3 CAP BROKEN: looped back to 5a/5c after wrong reselect')
  await assertAbsent('AL', '삽입 handoff shows no success/answer-reveal', '정확한 자리를 찾았어요', '정답입니다')
  await page.screenshot({ path: `${SCRATCH}/insert_recover_wrong_handoff.png` })

  // ═══════════ I-3. 삽입 recovery: reselect CORRECT → DONE ═════════════════════
  console.log('\n== I-3: 삽입 recovery reselect CORRECT → DONE ==')
  await insertToConfirm()
  await insertCommit(1) // wrong
  await insertToRecover()
  await insertWalkTo5b2('만족 안 함') // → 5c
  await insertReselect(4) // correct
  await page
    .getByText('스스로 신호를 다시 짚어서 정확한 자리를 찾았어요.', { exact: false })
    .waitFor({ timeout: 5000 })
  ok('I', 'reselect CORRECT → done ("스스로 신호를 다시 짚어서 정확한 자리를 찾았어요.")')
  if (await page.getByText('왜 그 자리인지 한 줄로 정리해봐요', { exact: false }).count())
    ok('I', 'recovery done: reflective fill-in (자기 언어 정리) STILL present (preserved)')
  else fail('I', 'recovery done: reflective fill-in MISSING (regression)')
  await page.screenshot({ path: `${SCRATCH}/insert_recover_correct_done.png` })

  // ═══════════ I-4. 삽입 5b2 '만족함' → HANDOFF directly (no reselect) ══════════
  console.log('\n== I-4: 삽입 5b2 만족함 → HANDOFF direct ==')
  await insertToConfirm()
  await insertCommit(1) // wrong
  await insertToRecover()
  await insertWalkTo5b2('만족함') // → handoff
  await page.getByText('이 부분은 튜터랑 같이 볼까요?', { exact: false }).waitFor({ timeout: 5000 })
  const afterSat = await bodyText()
  if (!afterSat.includes('다시 어디에 넣어야'))
    ok('I', '5b2 만족함 → handoff directly (no 5c reselect shown)')
  else fail('I', '5b2 만족함 did NOT hand off (5c reselect appeared)')

  // ═══════════ O-1. 무관 recovery: reselect WRONG → HANDOFF (the cap) ══════════
  console.log('\n== O-1: 무관 recovery reselect WRONG → HANDOFF (★조건3 cap) ==')
  await omitToConfirm()
  await omitCommit(1) // wrong (trap)
  await page.getByText('내가 무관하다고 본 문장', { exact: false }).waitFor({ timeout: 5000 })
  ok('O', 'recovery entry: diagnose panel opened after wrong commit')
  await page.screenshot({ path: `${SCRATCH}/omit_recover_diagnose.png` })
  await omitDiagnoseToReselect()
  await omitReselect(2) // wrong again
  await page.getByText('이 부분은 튜터랑 같이 볼까요?', { exact: false }).waitFor({ timeout: 5000 })
  ok('O', 'reselect WRONG → handoff screen ("이 부분은 튜터랑 같이 볼까요?")')
  const oAfterCap = await bodyText()
  if (!oAfterCap.includes('내가 무관하다고 본 문장') && !oAfterCap.includes('겉도는 문장은 어느 것'))
    ok('O', '★조건3 CAP HOLDS: did NOT loop back to diagnose/reselect')
  else fail('O', '★조건3 CAP BROKEN: looped back to diagnose after wrong reselect')
  await assertAbsent('AL', '무관 handoff shows no success/answer-reveal', '스스로 다시 짚어서', '무관한 문장: (4)')
  await page.screenshot({ path: `${SCRATCH}/omit_recover_wrong_handoff.png` })

  // ═══════════ O-2. 무관 recovery: reselect CORRECT → DONE + reconnect pair ═════
  console.log('\n== O-2: 무관 recovery reselect CORRECT → DONE ==')
  await omitToConfirm()
  await omitCommit(1) // wrong
  await omitDiagnoseToReselect()
  await omitReselect(4) // correct
  await page
    .getByText('스스로 다시 짚어서 무관한 문장을 찾았어요.', { exact: false })
    .waitFor({ timeout: 5000 })
  ok('O', 'reselect CORRECT → done ("스스로 다시 짚어서 무관한 문장을 찾았어요.")')
  const doneTxt = await bodyText()
  if (doneTxt.includes('(3)') && doneTxt.includes('(5)') && /\(3\).*→.*\(5\)/.test(doneTxt.replace(/\n/g, ' ')))
    ok('O', 'recovery done: reconnect pair line present ((3) → (5)) [preserved]')
  else fail('O', 'recovery done: reconnect pair line MISSING (regression)')
  await page.screenshot({ path: `${SCRATCH}/omit_recover_correct_done.png` })

  // ═══════════ L. attempts logging (insert_recover / omit_recover) ═════════════
  console.log('\n== L: attempts logging under RLS ==')
  await page.waitForTimeout(2500) // let fire-and-forget inserts land
  await page.goto(`${BASE}/solve/${INSERT_ID}`)
  await topicHeaderWait()
  const raw = await page.evaluate((k) => window.sessionStorage.getItem(k), AUTH_KEY)
  if (!raw) {
    fail('L', `no auth token in sessionStorage under ${AUTH_KEY}`)
  } else {
    const token = JSON.parse(raw).access_token
    for (const [id, step, sec] of [
      [INSERT_ID, 'insert_recover', 'L'],
      [OMIT_ID, 'omit_recover', 'L'],
    ]) {
      const url = `${SUPA_URL}/rest/v1/attempts?problem_id=eq.${id}&step=eq.${step}&select=step,payload,created_at&order=created_at`
      const resp = await fetch(url, {
        headers: { apikey: ANON, Authorization: `Bearer ${token}` },
      })
      const rows = await resp.json()
      const n = Array.isArray(rows) ? rows.length : 0
      if (n >= 1) {
        const subs = rows.map((r) => r.payload?.final_sub ?? '?').join(', ')
        ok(sec, `attempts: ${step} rows=${n} [final_sub: ${subs}]`)
      } else fail(sec, `attempts: ${step} MISSING (rows=${n}) ${JSON.stringify(rows).slice(0, 160)}`)
    }
  }
} catch (err) {
  console.error('\n!! script error:', err)
  await page.screenshot({ path: `${SCRATCH}/insert_omit_error.png` }).catch(() => {})
  fail('I', `script error: ${err.message}`)
  process.exitCode = 1
} finally {
  console.log('\n===== SUMMARY =====')
  const names = { I: '삽입 recovery', O: '무관 recovery', AL: 'anti-leak', L: 'logging' }
  for (const sec of ['I', 'O', 'AL', 'L']) {
    const anyFail = results[sec].some((r) => r[0] === 'FAIL')
    console.log(`${sec} (${names[sec]}): ${anyFail ? 'FAIL' : 'PASS'}`)
    for (const [st, m] of results[sec]) console.log(`   ${st}  ${m}`)
  }
  await browser.close()
}
