// 수업이 없어진 교시(11/19 목 7교시) 점검: 그 칸만 '귀가'로 바뀌고 나머지 교시·다른 주는 그대로인지
// 실행: node test/check-noclass.js   (playwright 필요, 가짜 서버라 인터넷·클라우드 불필요)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
let fail = 0;
const ok = (name, cond, info) => { console.log(`${cond ? '✅' : '❌'} ${name}`, cond ? '' : JSON.stringify(info)); if (!cond) fail++; };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  await page.route('**/*', r => new URL(r.request().url()).pathname === '/' ? r.fulfill({ contentType: 'text/html', body: HTML }) : r.abort());
  await page.goto('http://fake.test/'); await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('tt_reset_2sem_20260818', '1'); effClearCache();
    const out = { bad7: [], badOther: [], badPrevWeek: [] };
    for (const t of Object.keys(TIMETABLE)) {
      const a = effSchedule(t, '2026-11-19'), b = effSchedule(t, '2026-11-12');
      for (let p = 1; p <= 7; p++) {
        const k = '목' + p, base = TIMETABLE[t][k] || null;
        if (p === 7) { if (!a[k] || a[k].subject !== '귀가' || a[k].class) out.bad7.push(t); }          // 모든 교사: 7교시는 학급 없는 '귀가'
        else if ((a[k] || {}).class !== (base || {}).class || (a[k] || {}).subject !== (base || {}).subject) out.badOther.push(t + k);   // 1~6교시는 기본 시간표 그대로
        if ((b[k] || {}).subject !== (base || {}).subject) out.badPrevWeek.push(t + k);                    // 전 주(11/12)는 영향 없음
      }
    }
    const cw = cwClassWeek('2전1', '2026-11-16'); out.cw7 = cw['목7']; out.cw6 = (cw['목6'] || {}).subject || null;
    out.head = dayHeadHTML('목', '2026-11-19');   // 요일표를 바꾼 날이 아니므로 '○요일표' 꼬리표가 없어야 함
    return out;
  });
  ok('11/19 7교시: 모든 교사 귀가(학급 없음)', r.bad7.length === 0, r.bad7);
  ok('11/19 1~6교시: 기본 시간표 그대로', r.badOther.length === 0, r.badOther);
  ok('11/12(전 주): 영향 없음', r.badPrevWeek.length === 0, r.badPrevWeek);
  ok('학급 주간표 2전1 목7 = 귀가, 담당 없음', r.cw7 && r.cw7.subject === '귀가' && !r.cw7.teacher, r.cw7);
  ok('학급 주간표 2전1 목6 은 수업 있음', !!r.cw6 && r.cw6 !== '귀가', r.cw6);
  ok("머리글에 '요일표' 꼬리표 없음", r.head === '목', r.head);
  await browser.close();
  console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
  process.exit(fail ? 1 : 0);
})();
