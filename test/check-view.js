// 관리자 앱과 조회 사이트(/view)가 같은 기록을 같은 모양으로 보여주는지 점검
// 실행: node test/check-view.js   (playwright 필요: npm i -D playwright, 크롬은 CHROME=경로 로 지정 가능)
// 가짜 서버를 붙여 실제 클라우드·인터넷 없이 돌아간다. 올리기 전에 한 번 돌려 "관리자에선 되는데 조회에선 안 되는" 유형을 잡는다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// 점검용 기록: 이문수 수7(11/11) 역사 2전3 ↔ 김진영 화4(11/10) 반도 2전3 (둘 다 상대 시간이 비어 있는 보통 교체)
const REC = { id: 1, savedAt: 1762700000000, tA: '이문수', kA: '수7', sA: '역사', cA: '2전3', dateISO_sw: '2026-11-11',
              tB: '김진영', kB: '화4', sB: '반도', cB: '2전3', dateBISO: '2026-11-10' };
// 각 모드에서 읽어 올 값: 이문수 화4(들어온 수업)·수7(빠진 수업), 김진영 수7(들어온 수업)
const PROBE = () => ({
  이문수_화4: (effSchedule('이문수', '2026-11-10')['화4'] || {}).class || null,
  이문수_수7: (effSchedule('이문수', '2026-11-11')['수7'] || {}).class || null,
  김진영_수7: (effSchedule('김진영', '2026-11-11')['수7'] || {}).subject || null,
});
const WANT = { 이문수_화4: '2전3', 이문수_수7: null, 김진영_수7: '반도' };

let fail = 0;
const check = (name, got) => {
  const ok = JSON.stringify(got) === JSON.stringify(WANT);
  console.log(`${ok ? '✅' : '❌'} ${name}`, ok ? '' : `기대 ${JSON.stringify(WANT)} / 실제 ${JSON.stringify(got)}`);
  if (!ok) fail++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });   // 폰 폭(조회 사이트는 항상 폰 화면)
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  await page.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/view' || u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/view') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ swHist: [REC], dgHist: [] }) });
    return r.abort();   // 외부 라이브러리·클라우드 등은 막는다(인터넷 없이 점검)
  });

  // 1) 조회 사이트: 클라우드(/api/view)에서 받은 기록이 시간표에 반영되는지
  await page.goto('http://fake.test/view'); await page.waitForTimeout(1200);
  check('조회 사이트(/view)', await page.evaluate(PROBE));
  const green = await page.evaluate(() => { M.ttKind = 't'; M.ttTOne = '이문수'; M.ttDate = '2026-11-10'; M.ttHl = M.ttDate; M.ttDayAll = false; mRender();
    return [...document.querySelectorAll('#mBody .m-tt td.diff-in')].map(td => td.textContent.trim().replace(/\s+/g, ' ')); });
  console.log(green.includes('역사 2전3') ? '✅ 조회 화면에 초록 칸(역사 2전3) 표시' : `❌ 조회 화면에 초록 칸 없음: ${JSON.stringify(green)}`);
  if (!green.includes('역사 2전3')) fail++;

  // 2) 관리자 앱: 같은 기록을 브라우저 저장소에 넣었을 때 같은 결과인지
  await page.goto('http://fake.test/'); await page.waitForTimeout(800);
  await page.evaluate((rec) => { localStorage.clear(); swHistSave([rec]); effClearCache(); }, REC);
  check('관리자 앱', await page.evaluate(PROBE));
  await browser.close();
  console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
  process.exit(fail ? 1 : 0);
})();
