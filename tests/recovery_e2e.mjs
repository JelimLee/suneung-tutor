// Playwright e2e for the unified RecoveryLoop wired onto the 4 legacy wizard
// types (빈칸 / 순서 / 어법 / 어휘). Drives each wizard's CURRENT flow to the
// terminal choice step, commits a WRONG answer to mount <RecoveryLoop>, then
// exercises both reachable recovery outcomes:
//   • retry_success — re-select the CORRECT option → process closes.
//   • retry_fail    — re-select a WRONG (non-answer) option → straight to handoff
//                     (1-retry hard cap: no return to a question).
//
// chat_handoff (a recoveryQuestion routing to 'handoff') is NOT structurally
// reachable for these 4 types — none of their recoveryQuestions set route:
// 'handoff' (all are plain 'continue' graders). That outcome is 삽입-specific
// (signal-gap route) and is reported, not faked.
//
// Anti-leak is scoped to the WIZARD FLOW container ([class*="bg-cream-100/40"]),
// NOT the whole page: Solve.tsx renders the full passage in a separate context
// box above the wizard, so the answer word legitimately appears there.
//
// retry_success terminal UI: onRecoveryRetry is now a NO-OP in all 4 wizards, so
// a correct re-select NO LONGER flips the parent finalChoice. RecoveryLoop is
// self-contained — it drives its OWN state to `done` and stays mounted (the
// terminal's committed && !correct branch keeps rendering it). The done screen
// paints its process-praise copy ("스스로 다시 짚어서 답을 찾았어요.") PLUS the
// 해설 box (explanation prose only — never the answer number/text). This test
// asserts: (1) that done copy APPEARS, (2) the 해설 box is present, (3) the
// answer number/text is NOT revealed beyond the 해설 prose, (4) the terminal
// first-try 정답입니다 ✓ banner does NOT render (would signal a flip regression).
// The SAFETY property — no answer/해설 leak BEFORE a correct re-select — still holds.

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const SCRATCH =
  '/private/tmp/claude-501/-Users-macbook-projects-suneung-tutor/8b3710be-22a1-4059-8449-822d8aa1e2bb/scratchpad'
const BASE = process.env.BASE ?? process.env.BASE_URL ?? 'http://localhost:5174'
const REGION = '[class*="bg-cream-100/40"]' // the wizard flow card (excludes passage)

// ── env for REST (attempts logging assertions) ──────────────────────────────
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const SUPA_URL = /VITE_SUPABASE_URL=(.+)/.exec(env)[1].trim()
const ANON = /VITE_SUPABASE_ANON_KEY=(.+)/.exec(env)[1].trim()
const PROJECT_REF = new URL(SUPA_URL).host.split('.')[0]
const AUTH_KEY = `sb-${PROJECT_REF}-auth-token`

// ── result accounting, per type + a NOTES bucket ────────────────────────────
const TYPES = ['빈칸', '순서', '어법', '어휘']
const results = {}
for (const t of TYPES)
  results[t] = { retry_success: [], retry_fail: [], antileak: [], logging: [] }
const notes = []
function ok(type, sec, msg) {
  results[type][sec].push(['PASS', msg])
  console.log(`  [PASS] ${type}/${sec}: ${msg}`)
}
function fail(type, sec, msg) {
  results[type][sec].push(['FAIL', msg])
  console.log(`  [FAIL] ${type}/${sec}: ${msg}`)
}
function note(msg) {
  notes.push(msg)
  console.log(`  [NOTE] ${msg}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()
page.on('console', (m) => {
  const t = m.text()
  if (/logAttempt|recovery|error/i.test(t)) console.log('    [browser]', t)
})
const region = () => page.locator(REGION)

// ── shared recovery helpers ─────────────────────────────────────────────────
const MIRROR_H = '잠깐, 앞에서 네가 한 판단을 다시 볼까요?'
const RESELECT_H = '다시 한 번 골라볼까요?'
const HANDOFF_H = '이 부분은 튜터랑 같이 볼까요?'
const DONE_H = '스스로 다시 짚어서 답을 찾았어요.'
const CORRECT_BANNER = '정답입니다 ✓'
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

/** Leak assertion scoped to the recovery region. `allowAnswer` on reselect only. */
async function leakCheck(cfg, screen, allowAnswer) {
  const txt = await region().innerText()
  const revealStrings = ['정답입니다', '아쉬워요', '해설', cfg.explanationSubstr]
  const leaked = revealStrings.filter((s) => s && txt.includes(s))
  if (leaked.length === 0)
    ok(cfg.type, 'antileak', `${screen}: no reveal strings (정답/아쉬워요/해설/해설prose)`)
  else fail(cfg.type, 'antileak', `${screen}: REVEAL LEAKED → ${leaked.join(', ')}`)
  if (!allowAnswer) {
    if (!txt.includes(cfg.answerText))
      ok(cfg.type, 'antileak', `${screen}: correct answer "${cfg.answerText}" absent`)
    else
      fail(cfg.type, 'antileak', `${screen}: correct answer "${cfg.answerText}" LEAKED`)
  }
}

/** Walk every recoveryQuestion (button → first option; fill_in → a Korean line). */
async function answerAllQuestions(cfg) {
  let guard = 0
  let checkedFirst = false
  while (!(await page.getByText(RESELECT_H).isVisible()) && guard < 8) {
    const ta = page.getByPlaceholder('네 말로 한 줄 적어봐요')
    if (await ta.count()) {
      await ta.fill('앞 내용을 근거로 다시 짚어봤어요')
      await region().getByRole('button', { name: '확인', exact: true }).click()
    } else {
      await page.locator(`${REGION} div.flex.flex-wrap.gap-2 button`).first().click()
    }
    if (!checkedFirst) {
      await leakCheck(cfg, 'question', false)
      checkedFirst = true
    }
    await page
      .getByRole('button', { name: /다음 →|다시 골라볼게요 →/ })
      .first()
      .click()
    guard++
  }
  if (guard >= 8) throw new Error(`${cfg.type}: never reached reselect (guard hit)`)
}

/** Click the reselect option whose label contains `labelSubstr`, then 확정. */
async function reselectAndCommit(labelSubstr) {
  await region().getByRole('button').filter({ hasText: labelSubstr }).first().click()
  await page.getByRole('button', { name: '이걸로 확정 →' }).click()
}

/** From a fresh load, drive `cfg` to the mounted RecoveryLoop mirror screen. */
async function driveToMirror(cfg) {
  await page.goto(`${BASE}/solve/${cfg.pid}`, { waitUntil: 'networkidle' })
  await cfg.drive() // type-specific: reaches terminal + commits the WRONG pick
  await page.getByText(MIRROR_H).waitFor({ timeout: 10000 })
}

async function getRecoveryRows(pid) {
  const raw = await page.evaluate((k) => window.sessionStorage.getItem(k), AUTH_KEY)
  if (!raw) return null
  const token = JSON.parse(raw).access_token
  const url = `${SUPA_URL}/rest/v1/attempts?problem_id=eq.${pid}&step=eq.recovery&select=payload,created_at&order=created_at`
  const resp = await fetch(url, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  return await resp.json()
}

// ── per-type drivers to the WRONG commit (current flows) ────────────────────
async function nextFooter() {
  await page.getByRole('button', { name: '다음 →' }).first().click()
}

async function driveBlank() {
  await page.getByText('서론 유형').first().waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '주장' }).click() // intro type gates
  await nextFooter()
  // polarity: mark 2 sentences +
  await page.getByRole('button', { name: '같은편 (+)' }).nth(0).click()
  await page.getByRole('button', { name: '같은편 (+)' }).nth(1).click()
  await nextFooter()
  // theme recall
  await page.locator('input[type="text"]').first().fill('상황에 따라 유연하게 적용한다')
  await nextFooter()
  // choice: eliminate 1/2/3, survivors 4/5, commit 5 (creative) = WRONG (ans 1)
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

async function driveGrammar() {
  await page.getByText('뭘 물어보는', { exact: false }).first().waitFor({ timeout: 15000 })
  // diagnose: pick 기타 (microKind null → only the category pick is required) ×5
  const gitas = page.getByRole('button', { name: '기타', exact: true })
  const n = await gitas.count()
  for (let i = 0; i < n; i++) await gitas.nth(i).click()
  await nextFooter()
  // choice: commit underline 1 'differently' = WRONG (ans 5 'are')
  await region().getByRole('button').filter({ hasText: 'differently' }).first().click()
  await page.getByRole('button', { name: '제출하고 결과 보기 →' }).click()
}

async function driveVocab() {
  await page.getByText('무슨 내용', { exact: false }).first().waitFor({ timeout: 15000 })
  await page.locator('input[type="text"]').first().fill('신체 성장의 측정과 패턴')
  await nextFooter()
  // passage polarity
  await page.getByRole('button', { name: '긍정 (+)' }).click()
  await nextFooter()
  // diagnose: 맞음 ×5
  const oks = page.getByRole('button', { name: '맞음', exact: true })
  const n = await oks.count()
  for (let i = 0; i < n; i++) await oks.nth(i).click()
  await nextFooter()
  // choice: commit underline 1 'includes' = WRONG (ans 4 'reversals')
  await region().getByRole('button').filter({ hasText: 'includes' }).first().click()
  await page.getByRole('button', { name: '제출하고 결과 보기 →' }).click()
}

async function driveOrder() {
  await page.getByText('절대 올 수 없는', { exact: false }).first().waitFor({ timeout: 15000 })
  // eliminate ≥1 block
  await region().getByRole('button').filter({ hasText: '(A)' }).first().click()
  await nextFooter()
  // arrange all blocks A,B,C
  for (const lbl of ['(A)', '(B)', '(C)']) {
    await region().getByRole('button').filter({ hasText: lbl }).first().click()
  }
  await nextFooter()
  // verify read
  await page.getByRole('button', { name: '자연스럽게 이어져요' }).click()
  await nextFooter()
  // choice: commit choice 1 '(A)-(C)-(B)' = WRONG (ans 5 '(C)-(B)-(A)')
  await region().getByRole('button').filter({ hasText: '(A)-(C)-(B)' }).first().click()
  await page.getByRole('button', { name: '제출하고 결과 보기 →' }).click()
}

// ── the four type configs ───────────────────────────────────────────────────
const CONFIGS = {
  빈칸: {
    type: '빈칸',
    pid: 'SN2027_ch07_01',
    drive: driveBlank,
    wrongPickText: '5번',
    priorLabel: '네가 고른 답',
    answerText: 'flexible',
    successLabel: 'flexible',
    failLabel: 'universal',
    explanationSubstr: '고정된 태도도',
  },
  순서: {
    type: '순서',
    pid: 'SN2027_ch10_01',
    drive: driveOrder,
    wrongPickText: '(A)-(C)-(B)',
    priorLabel: '네가 고른 순서',
    answerText: '(C)-(B)-(A)',
    successLabel: '(C)-(B)-(A)',
    failLabel: '(B)-(A)-(C)',
    explanationSubstr: '크로스핏 소개',
  },
  어법: {
    type: '어법',
    pid: 'SN2027_ch05_01',
    drive: driveGrammar,
    wrongPickText: 'differently',
    priorLabel: '진단에서',
    answerText: 'are',
    successLabel: 'are',
    failLabel: 'lengthening',
    explanationSubstr: '주어의 핵이',
  },
  어휘: {
    type: '어휘',
    pid: 'SN2027_ch06_01',
    drive: driveVocab,
    wrongPickText: 'includes',
    priorLabel: '3단계에서',
    answerText: 'reversals',
    successLabel: 'reversals',
    failLabel: 'physical',
    explanationSubstr: '일별 측정치는',
  },
}

// ── mirror assertions (원칙2: shows the student's OWN prior judgment + pick) ──
async function assertMirror(cfg) {
  const txt = await region().innerText()
  // 1. mirror mounts (NOT the old reveal banners)
  if (txt.includes(MIRROR_H)) ok(cfg.type, 'antileak', 'mirror mounts on wrong commit')
  else fail(cfg.type, 'antileak', 'mirror heading MISSING on wrong commit')
  for (const old of ['아쉬워요 ✗', CORRECT_BANNER]) {
    if (!txt.includes(old)) ok(cfg.type, 'antileak', `mirror: old reveal "${old}" ABSENT`)
    else fail(cfg.type, 'antileak', `mirror: old reveal "${old}" PRESENT`)
  }
  // 2. mirror shows student's OWN prior judgment + their wrong pick (not the answer)
  if (txt.includes(cfg.priorLabel))
    ok(cfg.type, 'antileak', `mirror shows prior-judgment label "${cfg.priorLabel}"`)
  else fail(cfg.type, 'antileak', `mirror MISSING prior-judgment label "${cfg.priorLabel}"`)
  if (txt.includes(cfg.wrongPickText))
    ok(cfg.type, 'antileak', `mirror shows student's WRONG pick "${cfg.wrongPickText}"`)
  else fail(cfg.type, 'antileak', `mirror MISSING student's wrong pick "${cfg.wrongPickText}"`)
  // full anti-leak (answer text absent on mirror)
  await leakCheck(cfg, 'mirror', false)
}

// ── run one type end to end ─────────────────────────────────────────────────
async function runType(cfg) {
  console.log(`\n================= ${cfg.type} (${cfg.pid}) =================`)

  // Guard: rubric.recovery must be stored (skip+report if absent).
  // Also pull the FULL explanation so the done-screen answer-leak check can strip
  // the 해설 prose (which legitimately CAN contain the answer word, e.g. flexible
  // / reversals) before asserting the answer is not otherwise revealed.
  const rr = await fetch(
    `${SUPA_URL}/rest/v1/problems?id=eq.${cfg.pid}&select=grading_rubric,explanation`,
    { headers: { apikey: ANON } },
  ).then((r) => r.json())
  cfg.explanationFull = rr?.[0]?.explanation ?? ''
  const rec = rr?.[0]?.grading_rubric?.recovery
  if (!rec || (typeof rec === 'object' && Object.keys(rec).length === 0)) {
    note(`${cfg.type} ${cfg.pid}: grading_rubric.recovery ABSENT — SKIPPED`)
    return
  }

  // ---- SCENARIO A: retry_success ------------------------------------------
  console.log(`\n-- ${cfg.type}: retry_success --`)
  await driveToMirror(cfg)
  await assertMirror(cfg)
  await page.getByRole('button', { name: '다시 짚어볼게요 →' }).click()
  await answerAllQuestions(cfg)
  // reselect screen — answer text is a legitimate OPTION here (allowAnswer=true),
  // but 해설 / correct-banner must NOT appear before the student re-selects.
  await leakCheck(cfg, 'reselect', true)
  await reselectAndCommit(cfg.successLabel)
  await page.waitForTimeout(700)
  const afterTxt = await region().innerText()
  const sawDone = afterTxt.includes(DONE_H)
  const sawBanner = afterTxt.includes(CORRECT_BANNER)
  if (sawDone) {
    // (1) RecoveryLoop's OWN process-praise done screen paints (no flip regression).
    ok(cfg.type, 'retry_success', `RecoveryLoop done screen "${DONE_H}" shown`)
    // (2) 해설 box present on the done screen (label + the explanation prose).
    const hasHaeseol =
      afterTxt.includes('해설') && afterTxt.includes(cfg.explanationSubstr)
    if (hasHaeseol)
      ok(
        cfg.type,
        'retry_success',
        `done screen shows 해설 box (label + prose "${cfg.explanationSubstr}")`,
      )
    else
      fail(
        cfg.type,
        'retry_success',
        `done screen MISSING 해설 (label=${afterTxt.includes('해설')} prose=${afterTxt.includes(cfg.explanationSubstr)})`,
      )
    // (3) terminal first-try banner must NOT render (proves no finalChoice flip).
    if (!sawBanner)
      ok(cfg.type, 'retry_success', 'done screen is RecoveryLoop (no terminal 정답입니다 ✓ banner)')
    else
      fail(cfg.type, 'retry_success', 'terminal 정답 banner PRESENT on done (finalChoice flip regression)')
    // (4) answer number/text NOT revealed beyond the 해설 prose. The explanation
    //     prose itself MAY contain the answer word (e.g. flexible/reversals) — strip
    //     it first, then assert the answer does not appear anywhere else on-screen.
    const withoutExpl = norm(afterTxt).split(norm(cfg.explanationFull)).join(' ')
    if (!withoutExpl.includes(cfg.answerText))
      ok(
        cfg.type,
        'retry_success',
        `answer "${cfg.answerText}" NOT revealed beyond 해설 prose`,
      )
    else
      fail(
        cfg.type,
        'retry_success',
        `answer "${cfg.answerText}" LEAKED on done screen outside 해설 prose`,
      )
  } else if (sawBanner) {
    fail(
      cfg.type,
      'retry_success',
      'terminal 정답 banner rendered instead of RecoveryLoop done (finalChoice flip not removed)',
    )
  } else {
    fail(cfg.type, 'retry_success', 'neither RecoveryLoop done copy nor 정답 banner after correct re-select')
  }
  await page.screenshot({ path: `${SCRATCH}/recovery_${cfg.type}_success.png` }).catch(() => {})
  await page.waitForTimeout(2200) // let fire-and-forget recovery log land

  // ---- SCENARIO B: retry_fail (fresh run, wrong re-select → handoff) -------
  console.log(`\n-- ${cfg.type}: retry_fail --`)
  await driveToMirror(cfg)
  await page.getByRole('button', { name: '다시 짚어볼게요 →' }).click()
  await answerAllQuestions(cfg)
  await reselectAndCommit(cfg.failLabel)
  await page.getByText(HANDOFF_H).waitFor({ timeout: 8000 }).catch(() => {})
  const failTxt = await region().innerText()
  // 1-retry hard cap PROOF: straight to handoff, NOT back to a question / reselect.
  const atHandoff = failTxt.includes(HANDOFF_H)
  const backToQuestion = failTxt.includes('되짚기')
  const backToReselect = failTxt.includes(RESELECT_H)
  if (atHandoff && !backToQuestion && !backToReselect)
    ok(
      cfg.type,
      'retry_fail',
      '1-retry CAP: wrong re-select → STRAIGHT to handoff (no question, no 2nd reselect)',
    )
  else
    fail(
      cfg.type,
      'retry_fail',
      `wrong re-select did NOT hard-cap (handoff=${atHandoff} question=${backToQuestion} reselect=${backToReselect})`,
    )
  // chat handoff link present
  const chatLink = page.locator(`a[href="/chat/${cfg.pid}"]`)
  if (await chatLink.count())
    ok(cfg.type, 'retry_fail', `/chat/${cfg.pid} handoff link present`)
  else fail(cfg.type, 'retry_fail', `/chat/${cfg.pid} handoff link MISSING`)
  // anti-leak on the handoff screen (answer must not be revealed here)
  await leakCheck(cfg, 'handoff', false)
  await page.screenshot({ path: `${SCRATCH}/recovery_${cfg.type}_fail.png` }).catch(() => {})
  await page.waitForTimeout(2200)

  // ---- LOGGING: attempts step='recovery' outcomes ------------------------
  console.log(`\n-- ${cfg.type}: logging --`)
  const rows = await getRecoveryRows(cfg.pid)
  if (!rows || !Array.isArray(rows)) {
    fail(cfg.type, 'logging', `could not read recovery attempts (rows=${JSON.stringify(rows)})`)
    return
  }
  const recs = rows.map((r) => r?.payload?.recovery).filter(Boolean)
  const outcomes = recs.map((r) => r.recovery_outcome)
  console.log(`    recovery outcomes for ${cfg.pid}:`, JSON.stringify(outcomes))
  const succ = recs.find((r) => r.recovery_outcome === 'retry_success')
  const flr = recs.find((r) => r.recovery_outcome === 'retry_fail')
  if (succ) ok(cfg.type, 'logging', 'attempts has recovery_outcome=retry_success')
  else fail(cfg.type, 'logging', 'NO retry_success recovery row logged')
  if (flr) ok(cfg.type, 'logging', 'attempts has recovery_outcome=retry_fail')
  else fail(cfg.type, 'logging', 'NO retry_fail recovery row logged')
  for (const [name, r] of [
    ['retry_success', succ],
    ['retry_fail', flr],
  ]) {
    if (!r) continue
    if (r.initial_answer && String(r.initial_answer).length > 0)
      ok(cfg.type, 'logging', `${name}: initial_answer populated ("${r.initial_answer}")`)
    else fail(cfg.type, 'logging', `${name}: initial_answer EMPTY`)
    if (Array.isArray(r.recovery_steps) && r.recovery_steps.length > 0)
      ok(
        cfg.type,
        'logging',
        `${name}: recovery_steps[] populated (${r.recovery_steps.length} step(s): ${r.recovery_steps
          .map((s) => s.q_id)
          .join(', ')})`,
      )
    else fail(cfg.type, 'logging', `${name}: recovery_steps[] EMPTY`)
  }
}

try {
  for (const t of TYPES) await runType(CONFIGS[t])
} catch (err) {
  console.error('\n!! script error:', err)
  await page.screenshot({ path: `${SCRATCH}/recovery_error.png` }).catch(() => {})
  process.exitCode = 1
} finally {
  console.log('\n\n===================== SUMMARY =====================')
  for (const t of TYPES) {
    const secs = results[t]
    const line = Object.entries(secs)
      .map(([s, arr]) => {
        if (arr.length === 0) return `${s}=SKIP`
        return `${s}=${arr.some((r) => r[0] === 'FAIL') ? 'FAIL' : 'PASS'}`
      })
      .join('  ')
    console.log(`${t}:  ${line}`)
  }
  console.log('\n--- per-type detail ---')
  for (const t of TYPES) {
    console.log(`\n[${t}]`)
    for (const [sec, arr] of Object.entries(results[t]))
      for (const [st, m] of arr) console.log(`   ${st}  ${sec}: ${m}`)
  }
  console.log('\n--- findings / notes ---')
  console.log(
    '  * chat_handoff is NOT structurally reachable for the 4 legacy types',
  )
  console.log(
    '    (no recoveryQuestion sets route:"handoff"); it is 삽입-specific (signal-gap route).',
  )
  for (const n of notes) console.log(`  * ${n}`)
  await browser.close()
}
