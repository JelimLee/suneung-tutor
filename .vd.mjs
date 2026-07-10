import { chromium } from 'playwright'
const BASE='http://localhost:5174', PID='SN2027_ch06_03'
const browser=await chromium.launch(); const ctx=await browser.newContext(); const page=await ctx.newPage()
try{
  await page.goto(`${BASE}/solve/${PID}`)
  await page.getByText('무슨 내용이에요?',{exact:false}).first().waitFor({timeout:15000})
  for(const inp of ['소음 속에서 신호를 선별하는 동물의 청각 필터링','동물의 청각 신호 필터링','동물 소음 신호 선별 청각 필터링 메커니즘 진화']){
    await page.getByPlaceholder(/기술 발전/).fill(inp)
    await page.getByRole('button',{name:'대조',exact:true}).click()
    await page.waitForTimeout(300)
    const fbs=['소재를 잘 잡았어요','방향은 비슷해요','다시 읽어볼까요','적었으면 다음으로']
    let shown='(none)'
    for(const f of fbs){ if(await page.getByText(f,{exact:false}).first().isVisible().catch(()=>false)){shown=f;break} }
    const matched=await page.getByText(/겹치는 핵심어/).first().textContent().catch(()=>'')
    console.log(`input="${inp}"\n   → ${shown}  |  ${matched?.trim()||'(no match line)'}`)
  }
}catch(e){console.error('ERR',e)} finally{await browser.close()}
