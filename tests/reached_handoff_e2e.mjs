// Focused e2e: verify the `reached_handoff` boolean actually PERSISTS to
// attempts.payload.recovery in the DB, for BOTH recovery paths, on ONE wizard
// type (빈칸 SN2027_ch07_01, answer=1 'flexible').
//
//   • retry_fail    — wrong commit → recovery → WRONG re-select → handoff.
//        expect payload.recovery.reached_handoff === true
//               payload.recovery.recovery_outcome === 'retry_fail'
//   • retry_success — wrong commit → recovery → CORRECT re-select → done.
//        expect payload.recovery.reached_handoff === false
//               payload.recovery.recovery_outcome === 'retry_success'
//
// ISOLATION: each path runs in its OWN fresh browser context (fresh anon uid),
// so the attempts REST query (under RLS, using that context's own session
// token) returns ONLY that path's recovery row. No cross-contamination.
//
// Driving logic is lifted from tests/recovery_e2e.mjs (the 빈칸 driver).

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5174'
const REGION = '[class*="bg-cream-100/40"]' // wizard flow card (excludes passage)
const PID = 'SN2027_ch07_01'
const ANSWER_NUM = 1
const ANSWER_TEXT = 'flexible'

// ── env for REST ────────────────────────────────────────────────────────────
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const SUPA_URL = /VITE_SUPABASE_URL=(.+)/.exec(env)[1].trim()
const ANON = /VITE_SUPABASE_ANON_KEY=(.+)/.exec(env)[1].trim()
const PROJECT_REF = new URL(SUPA_URL).host.split('.')[0]
const AUTH_KEY = `sb-${PROJECT_REF}-auth-token`

const RESELECT_H = '다시 한 번 골라볼까요?'
const MIRROR_H = '잠깐, 앞에서 네가 한 판단을 다시 볼까요?'
const HANDOFF_H = '이 부분은 튜터랑 같이 볼까요?'
const DONE_H = '스스로 다시 짚어서 답을 찾았어요.'

// ── 빈칸 driver: reach terminal choice + commit the WRONG pick (5, creative) ──
async function driveBlankToWrongCommit(page) {
  const region = () => page.locator(REGION)
  const nextFooter = () =>
    page.getByRole('button', { name: '다음 →' }).first().click()

  await page.getByText('서론 유형').first().waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '주장' }).click()
  await nextFooter()
  await page.getByRole('button', { name: '같은편 (+)' }).nth(0).click()
  await page.getByRole('button', { name: '같은편 (+)' }).nth(1).click()
  await nextFooter()
  await page.locator('input[type="text"]').first().fill('상황에 따라 유연하게 적용한다')
  await nextFooter()
  for (const w of ['flexible', 'universal', 'automated']) {
    await page.locator('li', { hasText: w }).getByRole('button', { name: '소재다름' }).click()
  }
  await page.getByRole('button', { name: '2비교로 →' }).click()
  await page.locator('li', { hasText: 'beneficial' }).getByRole('button', { name: '유력' }).click()
  await page.locator('li', { hasText: 'creative' }).getByRole('button', { name: '보류' }).click()
  await page.getByRole('button', { name: '근거 쓰기 →' }).click()
  await page.locator('input[type="text"]').last().fill('방향이 유연함과 일치한다')
  await page.getByRole('button', { name: '결과 보기 →' }).click()
  await page.getByRole('button', { name: /creative/ }).click() // commit WRONG (5)
}

async function answerAllQuestions(page) {
  const region = () => page.locator(REGION)
  let guard = 0
  while (!(await page.getByText(RESELECT_H).isVisible()) && guard < 8) {
    const ta = page.getByPlaceholder('네 말로 한 줄 적어봐요')
    if (await ta.count()) {
      await ta.fill('앞 내용을 근거로 다시 짚어봤어요')
      await region().getByRole('button', { name: '확인', exact: true }).click()
    } else {
      await page.locator(`${REGION} div.flex.flex-wrap.gap-2 button`).first().click()
    }
    await page.getByRole('button', { name: /다음 →|다시 골라볼게요 →/ }).first().click()
    guard++
  }
  if (guard >= 8) throw new Error('never reached reselect (guard hit)')
}

async function reselectAndCommit(page, labelSubstr) {
  const region = () => page.locator(REGION)
  await region().getByRole('button').filter({ hasText: labelSubstr }).first().click()
  await page.getByRole('button', { name: '이걸로 확정 →' }).click()
}

// Query attempts step=recovery for THIS context's own anon session (RLS-scoped).
async function fetchRecoveryRows(page) {
  const raw = await page.evaluate((k) => window.sessionStorage.getItem(k), AUTH_KEY)
  if (!raw) throw new Error('no auth token in sessionStorage')
  const token = JSON.parse(raw).access_token
  const url =
    `${SUPA_URL}/rest/v1/attempts?problem_id=eq.${PID}` +
    `&step=eq.recovery&select=step,payload,created_at&order=created_at`
  const resp = await fetch(url, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`REST ${resp.status}: ${await resp.text()}`)
  return await resp.json()
}

async function runPath(browser, { name, reselectLabel, terminalHeading }) {
  console.log(`\n================= PATH: ${name} =================`)
  const ctx = await browser.newContext() // FRESH anon uid → RLS isolation
  const page = await ctx.newPage()
  page.on('console', (m) => {
    const t = m.text()
    if (/recovery|error/i.test(t)) console.log('    [browser]', t)
  })

  await page.goto(`${BASE}/solve/${PID}`, { waitUntil: 'networkidle' })
  await driveBlankToWrongCommit(page)
  await page.getByText(MIRROR_H).waitFor({ timeout: 10000 })
  console.log('  mirror mounted (wrong commit registered)')
  await page.getByRole('button', { name: '다시 짚어볼게요 →' }).click()
  await answerAllQuestions(page)
  await reselectAndCommit(page, reselectLabel)
  await page.getByText(terminalHeading).waitFor({ timeout: 8000 }).catch(() => {})
  const termTxt = await page.locator(REGION).innerText().catch(() => '')
  console.log(`  terminal screen reached: "${terminalHeading}" present = ${termTxt.includes(terminalHeading)}`)

  // let the fire-and-forget recovery log land in the DB
  await page.waitForTimeout(3000)

  const rows = await fetchRecoveryRows(page)
  console.log(`  recovery rows for ${PID} in THIS context: ${rows.length}`)
  const row = rows[rows.length - 1] // latest
  if (!row) {
    await ctx.close()
    return { name, ok: false, reason: 'NO recovery attempts row found in DB', recovery: null }
  }
  const recovery = row?.payload?.recovery
  console.log(`\n  raw payload.recovery JSON (${name}):`)
  console.log(JSON.stringify(recovery, null, 2))
  await ctx.close()
  return { name, recovery, createdAt: row.created_at }
}

const browser = await chromium.launch()
const report = []
try {
  // retry_fail first, then retry_success — order doesn't matter (isolated ctxs).
  const failRes = await runPath(browser, {
    name: 'retry_fail',
    reselectLabel: 'universal', // WRONG re-select (non-answer)
    terminalHeading: HANDOFF_H,
  })
  const succRes = await runPath(browser, {
    name: 'retry_success',
    reselectLabel: 'flexible', // CORRECT re-select (answer #1)
    terminalHeading: DONE_H,
  })

  // ── assertions ────────────────────────────────────────────────────────────
  const asserts = []
  function A(label, cond) {
    asserts.push([label, cond])
    console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}`)
  }

  console.log('\n================= ASSERTIONS =================')
  const fr = failRes.recovery
  A('retry_fail: recovery row present in DB', !!fr)
  A(
    `retry_fail: reached_handoff === true (got ${JSON.stringify(fr?.reached_handoff)}, type ${typeof fr?.reached_handoff})`,
    fr?.reached_handoff === true,
  )
  A(
    `retry_fail: recovery_outcome === 'retry_fail' (got ${JSON.stringify(fr?.recovery_outcome)})`,
    fr?.recovery_outcome === 'retry_fail',
  )

  const sr = succRes.recovery
  A('retry_success: recovery row present in DB', !!sr)
  A(
    `retry_success: reached_handoff === false (got ${JSON.stringify(sr?.reached_handoff)}, type ${typeof sr?.reached_handoff})`,
    sr?.reached_handoff === false,
  )
  A(
    `retry_success: recovery_outcome === 'retry_success' (got ${JSON.stringify(sr?.recovery_outcome)})`,
    sr?.recovery_outcome === 'retry_success',
  )

  const overall = asserts.every(([, c]) => c)
  console.log('\n================= SUMMARY =================')
  console.log(`  problem: ${PID}   answer: #${ANSWER_NUM} (${ANSWER_TEXT})`)
  console.log(`  retry_fail    payload.recovery: ${JSON.stringify(fr)}`)
  console.log(`  retry_success payload.recovery: ${JSON.stringify(sr)}`)
  console.log(`\n  OVERALL: ${overall ? 'PASS' : 'FAIL'}`)
  process.exitCode = overall ? 0 : 1
} catch (err) {
  console.error('\n!! script error:', err)
  process.exitCode = 1
} finally {
  await browser.close()
}
