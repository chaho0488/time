// 저장 탭 대강·교체 내역의 일/주 조회와 ◀ ▶ 이동 점검
// 실행: node test/check-hist-nav.js   (playwright 필요, 가짜 서버라 인터넷·클라우드 불필요)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// 점검용 기록: 교체 3건(11/12 목, 11/16 월, 11/20 금 결강)·대강 2건(11/12 목, 11/17 화)
const SW = [
  { id: 1, date: '11/12(목)', dateISO_sw: '2026-11-12', tA: '이선영', kA: '목7', pA: '7교시', sA: 'CA', cA: '2신3', dateB: '11/17(화)', dateBISO: '2026-11-17', tB: '이희섭', kB: '화7', pB: '7교시', sB: 'HR', cB: '2신3' },
  { id: 2, date: '11/16(월)', dateISO_sw: '2026-11-16', tA: '정선화', kA: '월6', pA: '6교시', sA: '사회', cA: '2전1', dateB: '11/16(월)', dateBISO: '2026-11-16', tB: '김진영', kB: '월5', pB: '5교시', sB: '반도', cB: '2전1' },
  { id: 3, date: '11/20(금)', dateISO_sw: '2026-11-20', tA: '정선화', kA: '금4', pA: '4교시', sA: '사회', cA: '2전3', dateB: '11/23(월)', dateBISO: '2026-11-23', tB: '이문수', kB: '월1', pB: '1교시', sB: '역사', cB: '2전3' },
];
const DG = [
  { id: 11, date: '11/12(목)', dateISO: '2026-11-12', tA: '김정선', kA: '목7', pA: '7교시', sA: 'CA', cA: '3전3', tSub: '김동후', subjectSub: 'CA' },
  { id: 12, date: '11/17(화)', dateISO: '2026-11-17', tA: '정선화', kA: '화2', pA: '2교시', sA: '사회', cA: '2전2', tSub: '이문수', subjectSub: '역사' },
];
let fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✅' : '❌'} ${name}`, ok ? '' : `기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`); if (!ok) fail++; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  await page.route('**/*', r => new URL(r.request().url()).pathname === '/' ? r.fulfill({ contentType: 'text/html', body: HTML }) : r.abort());
  await page.goto('http://fake.test/'); await page.waitForTimeout(500);
  await page.evaluate(([sw, dg]) => { localStorage.setItem('tt_reset_2sem_20260818', '1'); swHistSave(sw); dgSaveHistory(dg);
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-swaphist')); }, [SW, DG]);
  // 칸의 현재 상태: 조회 기간·날짜 단추 글자·눌린 단위·표의 줄 수
  const st = col => page.evaluate(col => ({ from: document.getElementById(col + 'From').value, to: document.getElementById(col + 'To').value,
    lab: document.getElementById(col + 'BtnToday').textContent, unit: document.getElementById(col + 'UnitWeek').classList.contains('active') ? '주' : '일',
    rows: document.querySelectorAll(col === 'sw2' ? '.sw2-chk' : '.dg-hist-chk').length }), col);
  const click = sel => page.evaluate(sel => document.querySelector(sel).click(), sel);
  const btn = (col, fn, arg) => `button[onclick="${fn}('${col}',${arg})"]`;

  for (const [col, name, want] of [['sw2', '교체', { d: 1, w: 1, w2: 3, fri: 1 }], ['dgHist', '대강', { d: 1, w: 1, w2: 1, fri: 0 }]]) {
    await page.evaluate(col => swDayShow(col, '2026-11-12'), col);   // 기준: 11/12(목), 일 단위
    eq(`${name} 일: 11/12 하루`, await st(col), { from: '2026-11-12', to: '2026-11-12', lab: '11/12(목)', unit: '일', rows: want.d });
    await click(btn(col, 'swUnitSet', "'week'"));
    eq(`${name} 주: 11/9~11/13`, await st(col), { from: '2026-11-09', to: '2026-11-13', lab: '11/9(월)~11/13(금)', unit: '주', rows: want.w });
    await click(btn(col, 'swDayStep', 1));
    eq(`${name} 주 ▶: 11/16~11/20`, await st(col), { from: '2026-11-16', to: '2026-11-20', lab: '11/16(월)~11/20(금)', unit: '주', rows: want.w2 });
    await click(btn(col, 'swDayStep', -1)); await click(btn(col, 'swDayStep', -1));
    eq(`${name} 주 ◀◀: 11/2~11/6`, await st(col), { from: '2026-11-02', to: '2026-11-06', lab: '11/2(월)~11/6(금)', unit: '주', rows: 0 });
    await page.evaluate(col => swDayShow(col, '2026-11-20'), col);   // 금요일 기준
    await click(btn(col, 'swUnitSet', "'day'"));
    eq(`${name} 일로 되돌림: 11/20`, await st(col), { from: '2026-11-20', to: '2026-11-20', lab: '11/20(금)', unit: '일', rows: want.fri });
    await click(btn(col, 'swDayStep', 1));
    eq(`${name} 일 ▶: 주말 건너 11/23(월)`, (await st(col)).lab, '11/23(월)');
    await click(btn(col, 'swDayStep', -1));
    eq(`${name} 일 ◀: 11/20(금)`, (await st(col)).lab, '11/20(금)');
  }
  // 두 칸은 서로 영향을 주지 않음: 교체만 주 단위로 바꿔도 대강은 일 단위 그대로
  await click(btn('sw2', 'swUnitSet', "'week'"));
  eq('칸별 독립', [(await st('sw2')).unit, (await st('dgHist')).unit], ['주', '일']);
  // 오늘 단추: 주 단위로 보고 있어도 일 단위로 바뀌어 오늘 하루만
  await click(`button[onclick="swToday('sw2')"]`);
  const t = await page.evaluate(() => kstToday());
  const s = await st('sw2'); eq('오늘 = 오늘 하루(일 단위)', [s.from, s.to, s.unit], [t, t, '일']);
  await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  await browser.close();
  console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
  process.exit(fail ? 1 : 0);
})();
