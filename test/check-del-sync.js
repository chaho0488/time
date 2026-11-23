// 저장 탭에서 지운 교체가 교체 탭에 바로 반영되는지 점검
// 실행: node test/check-del-sync.js   (playwright 필요, 인터넷·클라우드 불필요)
// 김태욱 목3 교체를 추가·저장 → 저장 탭에서 삭제 → 교체 탭으로 돌아오면 작성 중 목록·시간표·후보가 저장 전으로 돌아와야 함
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const DATE = '2026-12-03';   // 목요일
let fail = 0;
const ok = (name, cond, detail) => { console.log(`${cond ? '✅' : '❌'} ${name}`, cond ? '' : (detail || '')); if (!cond) fail++; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  page.on('dialog', d => d.accept());
  await page.route('**/*', r => new URL(r.request().url()).pathname === '/' ? r.fulfill({ contentType: 'text/html', body: HTML }) : r.abort());
  await page.goto('http://fake.test/'); await page.waitForTimeout(500);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tt_reset_2sem_20260818', '1'); });
  await page.goto('http://fake.test/'); await page.waitForTimeout(800);
  const r = await page.evaluate(date => {
    effClearCache(); S.records = []; S.wantTeachers = []; setRound(1);
    const snap = () => ({ cls: (effSchedule('김태욱', date)['목3'] || {}).class || null, cands: S.swaps.map(g => g.teacher + g.slots[0].key).join(','),
      recs: S.records.length, cnt: document.getElementById('recCnt').textContent });
    document.getElementById('teacherSel').value = '김태욱'; onTeacher('김태욱');
    document.getElementById('dateInput').value = date; onDate(); clickSlot('목3');
    const before = snap();
    addRecord(); const added = S.records.length; saveSelToSwHist();
    const saved = snap();
    switchTab('swaphist');
    swHistLoad().forEach(h => delSwHistRec(h.id));
    switchTab('swap');
    if (!S.keyA) clickSlot('목3');   // 저장할 때 교시 선택이 풀리므로 같은 교시를 다시 고름
    return { before, added, saved, after: snap(), left: swHistLoad().length };
  }, DATE);
  ok('교체 1건 이상 추가·저장되어 시간표가 바뀜', r.added > 0 && r.saved.cls !== r.before.cls, JSON.stringify(r));
  ok('저장 탭에서 지우면 기록 0건', r.left === 0, String(r.left));
  ok('교체 탭 작성 중 목록에서도 빠짐', r.after.recs === 0 && r.after.cnt === '0건', JSON.stringify(r.after));
  ok('시간표가 저장 전으로 돌아옴', r.after.cls === r.before.cls, JSON.stringify([r.before.cls, r.after.cls]));
  ok('같은 교시를 다시 고르면 교체 후보가 저장 전과 같음', r.after.cands === r.before.cands, `전 ${r.before.cands.slice(0, 80)} / 후 ${r.after.cands.slice(0, 80)}`);
  await browser.close();
  console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과'); process.exit(fail ? 1 : 0);
})();
