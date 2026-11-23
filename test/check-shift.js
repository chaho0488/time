// 교시 이동(11/26 목: 7교시 부담임 창체 → 1교시, 1~6교시 → 2~7교시) 점검: 교사·학급 시간표 모두 밀리고 다른 주는 그대로인지
// 실행: node test/check-shift.js   (playwright 필요, 가짜 서버라 인터넷·클라우드 불필요)
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
    const same = (a, b) => (a || {}).subject === (b || {}).subject && (a || {}).class === (b || {}).class;
    const out = { bad1: [], badShift: [], badOtherDay: [], badPrevWeek: [], badCw: [], n: 0 };
    for (const t of Object.keys(TIMETABLE)) {
      const a = effSchedule(t, '2026-11-26'), b = effSchedule(t, '2026-11-19'), T = TIMETABLE[t];
      const ca = T['목7'] && T['목7'].subject === 'CA' ? T['목7'] : null;
      // 1교시: 부담임(목7 CA)만 그 학급 창체, 나머지 교사는 빈 칸
      if (ca ? !(a['목1'] && a['목1'].subject === '창체' && a['목1'].class === ca.class) : !!a['목1']) out.bad1.push(t);
      for (let p = 2; p <= 7; p++) { out.n++; if (!same(a['목' + p], T['목' + (p - 1)])) out.badShift.push(t + '목' + p); }   // 2~7교시 = 원래 1~6교시
      for (const d of ['월', '화', '수', '금']) for (let p = 1; p <= 7; p++) if (!same(a[d + p], T[d + p])) out.badOtherDay.push(t + d + p);
      for (let p = 1; p <= 6; p++) if (!same(b['목' + p], T['목' + p])) out.badPrevWeek.push(t + '목' + p);   // 전 주(11/19) 1~6교시는 그대로
    }
    // 학급 주간표: 전 주 목요일 p교시 과목·교사가 이번 주 p+1교시에 그대로
    const classes = [...new Set(Object.values(TIMETABLE).flatMap(sc => Object.values(sc).map(s => s.class)))].filter(c => /^\d[전신]\d$/.test(c));
    out.nCls = classes.length;
    for (const c of classes) {
      const now = cwClassWeek(c, '2026-11-23'), prev = cwClassWeek(c, '2026-11-09');   // 11/12 주: 예외·기록 없는 기준 주
      for (let p = 2; p <= 7; p++) { const x = now['목' + p] || {}, y = prev['목' + (p - 1)] || {}; if (x.subject !== y.subject || x.teacher !== y.teacher) out.badCw.push(c + '목' + p); }
      const x1 = now['목1'] || {}, y7 = prev['목7'] || {};
      if (x1.subject !== '창체' || x1.teacher !== y7.teacher) out.badCw.push(c + '목1');
    }
    // 담임 HR ↔ 부담임 창체(같은 학급)는 경고 없이 교체: 보통 주(화7↔목7), 교시 이동 주(화7↔목1), 반대 방향, 다른 학급은 경고
    const fr = (iso, tA, kA, tB, kB) => { document.getElementById('dateInput').value = iso; effClearCache(); S.teacher = tA; S.keyA = kA; S.records = []; return swapForceReason(tB, kB); };
    out.frShift = fr('2026-11-24', '장승하', '화7', '박주란', '목1'); out.frNormal = fr('2026-11-10', '장승하', '화7', '박주란', '목7');
    out.frRev = fr('2026-11-26', '박주란', '목1', '장승하', '화7'); out.frOther = fr('2026-11-10', '장승하', '화7', '이용직', '화7');
    out.cand = (document.getElementById('dateInput').value = '2026-11-24', effClearCache(), S.teacher = '장승하', findSwaps('장승하', '화7').map(c => c.teacher + c.slots[0].key).join());
    S.teacher = ''; S.keyA = '';
    out.head = dayHeadHTML('목', '2026-11-26'); out.headPrev = dayHeadHTML('목', '2026-11-19'); out.headFri = dayHeadHTML('목', '2026-10-29');
    // 시간표 탭(조회 사이트와 같은 화면): 그날 일별표·그 주 주별표에만 안내 줄
    out.noteDay = mTT('t', '', { iso: '2026-11-26', kind: 'cls' }); out.noteWeek = mTT('t', '', { mon: '2026-11-23', kind: 'cls', who: '1전1' });
    out.noteOther = mTT('t', '', { iso: '2026-11-25', kind: 'cls' }) + mTT('t', '', { mon: '2026-11-16', kind: 'cls', who: '1전1' }) + mTT('t', '');
    // 데스크톱 학급 시간표(buildClassTT)는 계산 경로가 달라 따로 확인: 목요일 열의 과목을 화면 그대로 읽음
    const thu = iso => { document.getElementById('dateInput').value = iso; const t = document.createElement('template'); t.innerHTML = buildClassTT('2전1', null, {});
      return [...t.content.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('td.tc')]).filter(c => c.length === 5).map(c => (c[3].querySelector('.cs') || {}).textContent || ''); };
    out.tt = thu('2026-11-26'); out.ttPrev = thu('2026-11-12');
    return out;
  });
  ok('11/26 1교시: 부담임만 창체, 나머지 빈 칸', r.bad1.length === 0, r.bad1);
  ok(`11/26 2~7교시 = 원래 1~6교시 (${r.n}칸)`, r.badShift.length === 0, r.badShift);
  ok('11/23 주 다른 요일: 그대로', r.badOtherDay.length === 0, r.badOtherDay);
  ok('11/19(전 주) 1~6교시: 영향 없음', r.badPrevWeek.length === 0, r.badPrevWeek);
  ok(`학급 주간표 ${r.nCls}개 반: 1교시 창체(부담임), 2~7교시 밀림`, r.nCls > 0 && r.badCw.length === 0, r.badCw);
  ok("머리글: 11/26은 '교시 이동', 요일표 변경일은 '금요일표', 보통 날은 꼬리표 없음", r.head.includes('교시 이동') && !r.head.includes('요일표') && r.headPrev === '목' && r.headFri.includes('금요일표'), [r.head, r.headPrev, r.headFri]);
  ok('시간표 탭 안내 줄: 11/26 일별·그 주 주별에만', r.noteDay.includes('11/26 교시 이동') && r.noteWeek.includes('11/26 교시 이동') && !r.noteOther.includes('교시 이동'), [r.noteDay, r.noteOther]);
  ok('HR↔창체(같은 학급) 교체는 경고 없음: 교시 이동 주·보통 주·반대 방향', r.frShift === '' && r.frNormal === '' && r.frRev === '' && r.cand === '박주란목1', [r.frShift, r.frNormal, r.frRev, r.cand]);
  ok('다른 학급 HR끼리는 여전히 경고', r.frOther.includes('특수 수업'), r.frOther);
  ok('데스크톱 학급 시간표 2전1: 1교시 창체, 2~7교시 밀림', r.tt.length === 7 && r.tt[0] === '창체' && r.ttPrev.slice(0, 6).every(Boolean) && r.tt.slice(1).join('|') === r.ttPrev.slice(0, 6).join('|'), [r.tt, r.ttPrev]);
  await browser.close();
  console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
  process.exit(fail ? 1 : 0);
})();
