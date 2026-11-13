// 연쇄 교체(교사 3명 이상이 맞물리는 교체) 점검
// 실행: node test/check-chain.js   (playwright 필요, 크롬은 CHROME=경로 로 지정 가능. 인터넷·클라우드 불필요)
// 1) 실제 시간표: 김태욱 목3(2신3) → 한명민 목2 ↔ 목3 → 이문수 목2  (교사 3명, 목2·목3 안에서 맞물림)
// 2) 가상 교사를 한 명 붙여 교사 4명 연쇄도 찾고('교체 원하는 교사'로 좁힘), 저장 뒤 시간표가 겹치지 않는지 확인
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const DATE = '2026-11-19';   // 목요일
let fail = 0;
const ok = (name, cond, detail) => { console.log(`${cond ? '✅' : '❌'} ${name}`, cond ? '' : (detail || '')); if (!cond) fail++; };

// 연쇄 모드로 김태욱 목3의 후보를 찾아 교사 n명짜리 연쇄를 고르고, 추가·저장한 뒤 결과를 돌려준다
const RUN = ({ date, n, want }) => {
  localStorage.clear(); effClearCache(); S.records = []; S.wantTeachers = want || [];
  document.getElementById('teacherSel').value = '김태욱'; onTeacher('김태욱');
  document.getElementById('dateInput').value = date; onDate();
  setRound(1); clickSlot('목3');
  const one = S.swaps.map(g => g.teacher);                       // 1회 교체 후보(한명민은 목3 수업이 있어 여기엔 없어야 함)
  setRound(2);
  const chains = S.swaps.filter(g => g.chain).map(g => g.chain.map(l => `${l.tA}${l.kA}↔${l.tB}${l.kB}`).join(' → '));
  const i = S.swaps.findIndex(g => g.chain && g.chain.length === n - 1 && g.chain[0].tB === '한명민' && g.chain[0].kB === '목2' && g.chain[1].tB === '이문수' && g.chain[1].kB === '목2');
  if (i < 0) return { one, chains, picked: null };
  selectChain(i);
  const after = t => [...document.createRange().createContextualFragment(buildAfterTT(t, {})).querySelectorAll('td.diff-in')].map(td => td.textContent.trim().replace(/\s+/g, ' '));
  const who = [S.teacher, ...S.swaps[i].chain.map(l => l.tB)];
  const afterIn = Object.fromEntries(who.map(t => [t, after(t)]));   // 저장 전 '교체 후' 표의 초록 칸
  addRecord(); const added = S.records.length; saveSelToSwHist(); effClearCache();
  const day = t => Object.fromEntries(Object.entries(effSchedule(t, date)).filter(([k]) => k[0] === '목').map(([k, v]) => [k, v.class + (v.pendIn ? '(대기)' : '')]));
  // 저장 뒤: 목요일에 한 학급을 두 교사가 같은 교시에 맡는 칸, 강제 교체 대기로 남은 칸
  const seen = {}, dup = [], pend = [];
  for (const t of Object.keys(TIMETABLE)) for (const [k, v] of Object.entries(effSchedule(t, date))) {
    if (k[0] !== '목' || BLK.has(v.subject.trim())) continue;
    if (v.pendIn) pend.push(t + k);
    const key = k + '|' + v.class; if (seen[key]) dup.push(`${key} ${seen[key]}·${t}`); seen[key] = t;
  }
  return { one, chains, picked: i, added, afterIn, who, sched: Object.fromEntries(who.map(t => [t, day(t)])), dup, pend };
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  await page.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: HTML });
    return r.abort();   // 외부 라이브러리·클라우드는 막는다
  });
  await page.goto('http://fake.test/'); await page.waitForTimeout(500);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tt_reset_2sem_20260818', '1'); });
  await page.goto('http://fake.test/'); await page.waitForTimeout(800);

  // 0) 겹침 검사 자체가 믿을 만한지: 아무 기록도 없는 기본 시간표에서 겹치는 칸이 없어야 함
  const base = await page.evaluate((date) => { const seen = {}, dup = [];
    for (const t of Object.keys(TIMETABLE)) for (const [k, v] of Object.entries(effSchedule(t, date))) { if (k[0] !== '목' || BLK.has(v.subject.trim())) continue; const key = k + '|' + v.class; if (seen[key]) dup.push(`${key} ${seen[key]}·${t}`); seen[key] = t; }
    return dup; }, DATE);
  ok('기본 시간표(목요일)에 겹치는 칸 없음', base.length === 0, JSON.stringify(base));

  // 1) 교사 3명: 실제 시간표
  const a = await page.evaluate(RUN, { date: DATE, n: 3 });
  ok('1회 교체 목록에는 한명민 없음(목3 수업이 있어서)', !a.one.includes('한명민'), JSON.stringify(a.one));
  ok('연쇄 후보에 김태욱 목3↔한명민 목2 → 한명민 목3↔이문수 목2 있음', a.picked !== null, `후보 ${a.chains.length}건: ${a.chains.slice(0, 8).join(' | ')}`);
  if (a.picked !== null) {
    ok('교체 기록 2건 추가', a.added === 2, `추가 ${a.added}건`);
    ok("'교체 후' 표(저장 전)", JSON.stringify(a.afterIn) === JSON.stringify({ 김태욱: ['체육 2신3'], 한명민: ['HMI 2신1', 'HMI 2신3'], 이문수: ['역사 2신1'] }), JSON.stringify(a.afterIn));
    const s = a.sched;
    ok('김태욱: 목2 2신3, 목3 없음', s.김태욱.목2 === '2신3' && !s.김태욱.목3, JSON.stringify(s.김태욱));
    ok('한명민: 목2 2신1, 목3 2신3', s.한명민.목2 === '2신1' && s.한명민.목3 === '2신3', JSON.stringify(s.한명민));
    ok('이문수: 목2 없음, 목3 2신1', !s.이문수.목2 && s.이문수.목3 === '2신1', JSON.stringify(s.이문수));
    ok('저장 뒤 겹치는 칸·대기 칸 없음', !a.dup.length && !a.pend.length, JSON.stringify([a.dup, a.pend]));
  }

  // 2) 교사 4명: 이문수에게 목3 가상 수업(학급 '가상반')을 주고, 가상 교사가 그 학급을 이문수가 빈 교시에 맡게 함
  const free = await page.evaluate(() => {
    const k = ['금1', '금2', '금3', '금4', '금5', '월1', '월2'].find(k => !TIMETABLE['이문수'][k]);
    TIMETABLE['이문수']['목3'] = { subject: '역사', class: '가상반', room: '' };
    TIMETABLE['가상교사'] = { [k]: { subject: '가상', class: '가상반', room: '' } };
    return k;
  });
  const b = await page.evaluate(RUN, { date: DATE, n: 4, want: ['가상교사'] });
  ok('원하는 교사(가상교사)가 들어간 연쇄만 남음', b.chains.length > 0 && b.chains.every(c => c.includes('가상교사')), b.chains.slice(0, 5).join(' | '));
  ok(`교사 4명 연쇄 있음 (… → 이문수 목3↔가상교사 ${free})`, b.picked !== null, `후보 ${b.chains.length}건: ${b.chains.slice(0, 8).join(' | ')}`);
  if (b.picked !== null) {
    ok('교체 기록 3건 추가', b.added === 3, `추가 ${b.added}건`);
    const s = b.sched;
    ok('이문수: 목3 2신1(가상반 수업은 빠짐)', s.이문수.목3 === '2신1' && !s.이문수.목2, JSON.stringify(s.이문수));
    ok('가상교사: 목3 가상반', s.가상교사.목3 === '가상반', JSON.stringify(s.가상교사));
    ok('저장 뒤 겹치는 칸·대기 칸 없음', !b.dup.length && !b.pend.length, JSON.stringify([b.dup, b.pend]));
    const moved = await page.evaluate(([date, k]) => [(effSchedule('이문수', date)[k] || {}).class || null, (effSchedule('가상교사', date)[k] || {}).class || null], [DATE, free]);
    ok(`이문수 ${free}에 가상반, 가상교사 ${free} 없음`, moved[0] === '가상반' && moved[1] === null, JSON.stringify(moved));
  }

  // 3) 휴대폰 화면: 연쇄 교체 단추 → 후보 → 확인 → 추가
  await page.setViewportSize({ width: 420, height: 900 });
  const m = await page.evaluate((date) => {
    localStorage.clear(); effClearCache(); S.records = []; S.wantTeachers = []; setRound(1);
    delete TIMETABLE['이문수']['목3']; delete TIMETABLE['가상교사'];   // 2)에서 붙인 가상 수업 되돌림
    document.getElementById('teacherSel').value = '김태욱'; onTeacher('김태욱');
    document.getElementById('dateInput').value = date; onDate();
    M.tab = 'swap'; mPickSlot('목3');
    const hasBtn = document.getElementById('mBody').textContent.includes('연쇄 교체');
    setRound(2); mRender();
    const groups = document.querySelectorAll('#mBody .m-item').length;            // 첫 교체 상대 묶음 수
    M.chainGrp = '한명민|목2'; mRender();                                          // 한명민 목2 묶음을 펼침
    const items = document.querySelectorAll('#mBody .m-item').length - groups;     // 펼쳐진 연쇄 수
    const i = S.swaps.findIndex(g => g.chain && g.chain.length === 2 && g.chain[0].tB === '한명민' && g.chain[0].kB === '목2' && g.chain[1].tB === '이문수' && g.chain[1].kB === '목2');
    if (i < 0) return { hasBtn, groups, items, i };
    mPickChain(i);
    const step4 = document.getElementById('mBody').textContent.replace(/\s+/g, ' ');
    const tables = document.querySelectorAll('#mBody .m-tt').length;
    mAddRec();
    return { hasBtn, groups, items, i, step4ok: step4.includes('연쇄 교체 · 교사 3명') && step4.includes('이문수'), tables, recs: S.records.length };
  }, DATE);
  ok('폰: ③단계에 연쇄 교체 단추, 묶음 목록, 펼친 연쇄', m.hasBtn && m.groups > 0 && m.items > 0 && m.i >= 0, JSON.stringify(m));
  ok('폰: ④단계 확인 화면(교사 3명, 교체 후 표 3개)과 추가 2건', m.step4ok && m.tables === 3 && m.recs === 2, JSON.stringify(m));

  await browser.close();
  console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
  process.exit(fail ? 1 : 0);
})();
