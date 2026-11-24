// 한파 신청 화면(/winter) 점검: 초성으로 교사 찾기 → 내 시간표에서 수업 고르기 → 신청 → 관리자 배정 → 실습실 시간표 반영까지
// 실제 Worker 코드와 가짜 D1·KV 로 확인. 실행: node test/check-winter-page.mjs   (playwright 필요, 크롬은 CHROME=경로, 인터넷 불필요)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import worker from '../src/worker.js';
import { fakeEnv } from './check-winter.mjs';   // 기준일도 2026-11-24(화)로 고정됨
const { chromium } = createRequire(import.meta.url)('playwright');

const HTML = fs.readFileSync(new URL('../public/winter.html', import.meta.url), 'utf8');
const env = fakeEnv();
let fail = 0;
const ok = (name, cond, info) => { console.log(`${cond ? '✅' : '❌'} ${name}`, cond ? '' : JSON.stringify(info)); if (!cond) fail++; };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
const asked = []; let answer = true;   // 확인 창: 뜬 문구를 모으고, answer 가 false 면 '취소'를 누른다
page.on('dialog', d => { asked.push(d.message()); return answer ? d.accept() : d.dismiss(); });
await page.route('**/*', async r => {
  const q = r.request(), u = new URL(q.url());
  if (u.pathname === '/winter') return r.fulfill({ contentType: 'text/html', body: HTML });
  if (u.pathname !== '/api/winter') return r.abort();
  const res = await worker.fetch(new Request(q.url(), { method: q.method(), headers: q.headers(), body: q.postData() || undefined }), env);
  return r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
});
await page.goto('https://fake.test/winter');   /* https: 기기 표시(crypto.randomUUID)는 보안 주소에서만 만들어짐 */
await page.waitForSelector('#grid .plan');
{ const f = await page.evaluate(() => { const vis = id => !!document.getElementById(id).offsetParent, y = id => document.getElementById(id).getBoundingClientRect().top;
    return { name: document.getElementById('teacher').value, steps: ['mytt', 'from'].filter(vis).join(), order: y('teacher') < y('vdate') && y('vdate') < y('grid'), gap: Math.round(document.querySelector('main h2').getBoundingClientRect().top - document.querySelector('.apply').getBoundingClientRect().bottom) }; });
  ok('첫 화면: 교사명 칸(비어 있음)만 있고 바로 아래가 실습실 시간표', f.name === '' && f.steps === '' && f.order && f.gap < 60, f); }
{ const t = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('.tabs button')].map(b => b.textContent + ':' + b.getAttribute('aria-selected')).join(), plans: document.querySelectorAll('#grid .plan').length, rooms: document.querySelectorAll('#grid .room').length }));
  ok('처음 화면은 배치도형(탭: 배치도형·목록형)', t.tabs === '배치도형:true,목록형:false' && t.plans === 5 && t.rooms === 0, t); }
await page.click('#tabTable'); await page.waitForSelector('#grid .ftable .room');   // 아래 점검은 목록형부터
const login = async () => { await page.fill('#pw', 'pw'); await page.click('#login'); await page.waitForSelector('#adminOn:not([hidden])'); };
const names = () => page.evaluate(() => document.getElementById('tlist').hidden ? [] : [...document.querySelectorAll('#tlist button')].map(b => b.textContent));
const over = () => page.evaluate(() => ['mytt', 'grid', 'list'].filter(id => [...document.querySelectorAll('#' + id + ', #' + id + ' .wrap')].some(w => w.scrollWidth > w.clientWidth + 1)).concat(document.documentElement.scrollWidth > innerWidth + 1 ? ['화면'] : []));

// 첫 화면: 안내 문구 없음. 오늘(11/24)이 아니라 이동 시작일 11/25(수)부터 보이고, 그 앞 날짜로는 넘어가지 않음
let s = await page.evaluate(() => ({ day: document.getElementById('vday').textContent, badges: [...document.querySelectorAll('#grid .badge')].map(b => b.textContent), free: document.querySelectorAll('#grid li.free').length,
  rows: document.querySelectorAll('#grid .room').length, from: document.getElementById('from').value, min: [document.getElementById('from').min, document.getElementById('vdate').min],
  note: document.getElementById('fromNote').textContent, pwTop: !!(document.getElementById('pw').compareDocumentPosition(document.getElementById('teacher')) & 4), hint: document.getElementById('adminHint').hidden, text: document.body.textContent.includes('요 며칠'), old: !!document.querySelector('#cls, #subject, #periods') }));
ok('첫 화면: 11/25(수), 실 23곳, 이용가능 3곳, 시작일 기본값·최솟값 11/25', s.day === '11/25(수)' && s.rows === 23 && s.badges.join() === '이용가능,이용가능,이용가능' && s.free === 12 && s.from === '2026-11-25' && s.min.join() === '2026-11-25,2026-11-25', s);
ok('안내 문구와 학급·과목·교시 입력 칸은 없음', !s.text && !s.old, s);
ok('관리자 비밀번호 칸이 맨 위(교사명 칸보다 앞)에 있고, 비밀번호 전에는 관리자 안내·빈 실 단추가 없음', s.pwTop && s.hint && !(await page.locator('#grid button[data-free]').count()), s);
ok('시작일 옆에 "11/25부터 일부 실습실 이용가능"', s.note === '11/25부터 일부 실습실 이용가능', s);
await page.click('#prev');
ok('◀ 를 눌러도 11/25 앞(오늘)으로는 가지 않음', (await page.textContent('#vday')) === '11/25(수)');
await page.fill('#vdate', '2026-11-24'); await page.dispatchEvent('#vdate', 'change');
ok('날짜 칸에 오늘을 직접 넣어도 11/25 로 돌아옴', (await page.textContent('#vday')) === '11/25(수)');

// 층마다 표 하나로 묶이고, 수업 불가 실은 줄 전체가 회색으로 닫힘. 음악실(프로젝트실)은 없음
s = await page.evaluate(() => { const rows = [...document.querySelectorAll('#grid .room')], code = r => r.querySelector('.code').textContent;
  const txt = li => [...li.querySelectorAll('b, small')].map(e => e.textContent).join('');   // 교시 번호는 빼고 학급·과목·교사만
  const d = rows.find(r => code(r) === '2D');
  return { order: rows.map(code).join(' '), floors: [...document.querySelectorAll('#grid .floor')].map(f => f.textContent), closed: rows.filter(r => r.classList.contains('closed')).length, lab: rows.filter(r => r.querySelector('.shutlab')).length,
    folded: rows.filter(r => r.classList.contains('closed') && !r.querySelector('.strip') && r.querySelector('.more')).length,
    tables: [...document.querySelectorAll('#grid .ftable')].map(t => t.querySelectorAll('.room').length).join(), loose: document.querySelectorAll('#grid > .room').length, music: document.getElementById('grid').textContent.includes('음악') || document.getElementById('grid').textContent.includes('프로젝트'),
    name: d.querySelector('.rname').textContent, size: parseFloat(getComputedStyle(d.querySelector('.rname')).fontSize), nos: [...d.querySelectorAll('.strip li i')].map(i => i.textContent).join('') }; });
ok('실습실 이름이 전체 이름으로 크게(17px 이상) 나오고 칸마다 교시 번호가 있음', s.name === '송변전배전설비운영실습실' && s.size >= 17 && s.nos === '1234567', s);
ok('층마다 표 하나(1층 4·2층 9·3층 6·4층 4실)로 묶이고 음악실은 없음, 실은 코드 순', s.floors.join() === '1층,2층이용가능 1곳,3층이용가능 2곳,4층' && s.tables === '4,9,6,4' && !s.loose && !s.music && s.order === '1A 1B 1C 1D 2A 2B 2C 2D 2E 2F 2G 2X 2Y 3A 3B 3C 3D 3E 3F 4A 4B 4C 4D', s);
ok('수업 불가 20곳은 회색 한 줄로 접혀 있음', s.closed === 20 && s.lab === 20 && s.folded === 20, s);

// 배치도 탭: 기존 층별 표는 그대로 두고, 탭을 누르면 층마다 배치도 그림이 나옴. 이용가능 실만 눌림
{ let t = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('.tabs button')].map(b => b.textContent + ':' + b.getAttribute('aria-selected')).join(), plans: document.querySelectorAll('#grid .plan').length }));
  ok('목록형 탭에서는 배치도가 없음', t.tabs === '배치도형:false,목록형:true' && t.plans === 0, t);
  await page.click('#tabPlan');
  t = await page.evaluate(() => { const rs = [...document.querySelectorAll('#grid .pr')];
    return { plans: document.querySelectorAll('#grid .plan').length, floors: [...document.querySelectorAll('#grid .floor')].map(f => f.textContent).join(), rooms: rs.map(b => b.dataset.plan).sort().join(' '),
      on: rs.filter(b => !b.disabled).map(b => b.dataset.plan).sort().join(), onCls: rs.filter(b => b.classList.contains('on')).map(b => b.dataset.plan).sort().join(), never: rs.filter(b => b.classList.contains('never')).map(b => b.dataset.plan).sort().join(),
      free: [...document.querySelectorAll('#grid .pr em')].map(e => e.textContent).filter(x => x.includes('빈') || x.includes('대기')).join(), tabsInNav: !!document.querySelector('.nav .tabs') && Math.abs(document.querySelector('.tabs').getBoundingClientRect().top - document.getElementById('vdate').getBoundingClientRect().top) < 60, etc: [...document.querySelectorAll('#grid .pc:not(.pr) span')].map(e => e.textContent).filter(Boolean).length,
      order4: [...document.querySelectorAll('#grid .plan')][0].textContent.replace(/\s+/g, ' '), table: document.querySelectorAll('#grid .room').length, over: document.getElementById('grid').scrollWidth > document.getElementById('grid').clientWidth + 1 }; });
  ok('배치도: 4층 → 1층 순서로 5장(2층은 실습동 1·별관), 실습실 23곳이 모두 그림에 있음', t.plans === 5 && t.floors === '4층,3층이용가능 2곳,2층이용가능 1곳,1층' && t.rooms === '1A 1B 1C 1D 2A 2B 2C 2D 2E 2F 2G 2X 2Y 3A 3B 3C 3D 3E 3F 4A 4B 4C 4D' && t.etc > 20 && !t.table, t);
  ok('배치도: 이용가능 실(2D·3B·3C)만 호박색으로 눌리고, 교실 이용불가 6곳은 어둡게, "빈 N" 숫자는 없음(관리자가 아니면 "대기"도 없음), 보기 탭은 날짜 줄에', t.on === '2D,3B,3C' && t.onCls === '2D,3B,3C' && t.never === '1C,1D,2E,2X,2Y,4A' && t.free === '' && t.tabsInNav, t);
  ok('배치도 4층: 전공심화 동아리실 | 화장실·계단·4B·4A·계단 / 복도 / 4C·4D·약품실 | 체력단련실 순서', /^전공심화 동아리실.*화장실.*계단.*4B.*4A.*계단.*복도.*4C.*4D.*약품실.*체력단련실$/.test(t.order4) && !t.over, t);
  { const v = await page.evaluate(() => { const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0, nm = c => document.querySelector(`#grid .pr[data-plan="${c}"] span:not(.pcmark)`);
      const fits = [...document.querySelectorAll('#grid .pr')].filter(b => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1).map(b => b.dataset.plan);
      return { w: innerWidth, names: ['2D', '2F', '2X', '3B', '4B'].map(c => nm(c).textContent + (vis(nm(c)) ? '' : '(숨김)')).join(), all: [...document.querySelectorAll('#grid .pr')].every(b => vis(b.querySelector('span:not(.pcmark)'))), fits,
        pc: [...document.querySelectorAll('#grid .pr')].filter(b => b.querySelector('.pcmark')).map(b => b.dataset.plan).sort().join(), pcText: document.querySelector('#grid .pr .pcmark').textContent }; });
    ok('폰 폭(390px)에서도 배치도에 줄인 실 이름이 모두 보이고 칸 밖으로 넘치지 않음', v.w === 390 && v.names === '송변전,전기기기,생산자동화1,제어기기,전기설비1' && v.all && !v.fits.length, v);
    ok('PC 사용가능 실 7곳(2E·2G·2X·2Y·3B·3C·3F)에 PC 표시', v.pc === '2E,2G,2X,2Y,3B,3C,3F' && v.pcText === 'PC', v);
    // PC 화면(1920×910): 글자는 작게 고정, 4층~2층 배치도가 스크롤 없이 한 화면에 / 폰은 칸을 높이고 글자를 폭에 비례
    const sizes = async (w, hh) => { await page.setViewportSize({ width: w, height: hh }); return page.evaluate(() => { const px = q => Math.round(parseFloat(getComputedStyle(document.querySelector(q)).fontSize) * 10) / 10;
      return { code: px('#grid .pr[data-plan="2D"] b'), name: px('#grid .pr[data-plan="2D"] span:not(.pcmark)'), h1: px('h1'),
        bottom2: Math.round([...document.querySelectorAll('#grid .frow')][2].getBoundingClientRect().bottom), vh: innerHeight,
        fits: [...document.querySelectorAll('#grid .pr')].filter(b => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1).map(b => b.dataset.plan), over: document.documentElement.scrollWidth > innerWidth + 1 }; }); };
    const a = await sizes(390, 800), b = await sizes(760, 900), c = await sizes(1920, 910); if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-first.png' }); await page.setViewportSize({ width: 390, height: 800 });
    ok('배치도 글자: 폰에서도 실 코드 15px·이름 12px 이상, PC 에서는 코드 16px·이름 13px·제목 20px 로 작게, 어느 폭에서도 칸 밖으로 넘치지 않음', a.code >= 15 && a.name >= 12 && c.code === 16 && c.name === 13 && c.h1 === 20 && ![a, b, c].some(x => x.fits.length || x.over), { a, b, c });
    ok('PC 화면(1920×910) 첫 화면에 4층~2층 배치도가 스크롤 없이 모두 보임', c.bottom2 <= c.vh, c); }
  await page.click('#grid .pr[data-plan="2D"]');
  t = await page.evaluate(() => ({ rooms: [...document.querySelectorAll('#grid .room')].map(r => r.dataset.room).join(), cells: [...document.querySelectorAll('#grid .room .strip li')].map(li => li.className).join(), name: document.querySelector('#grid .room .rname').textContent,
    pressed: document.querySelector('#grid .pr[data-plan="2D"]').getAttribute('aria-pressed'), after: document.querySelector('#grid .ftable').previousElementSibling.classList.contains('plan') && !!document.querySelector('#grid .ftable').closest('.frow').querySelector('[data-plan="2D"]') }));
  ok('배치도에서 2D 를 누르면 그 층 배치도 아래에 2D 시간표만 나옴', t.rooms === '2D' && t.cells === 'busy,busy,busy,free,free,free,free' && t.name === '송변전배전설비운영실습실' && t.pressed === 'true' && t.after, t);
  await page.click('#grid .room .more');
  ok('"닫기"를 누르면 시간표가 닫힘', (await page.locator('#grid .room').count()) === 0);
  await page.click('#tabTable'); await page.waitForSelector('#grid .ftable .room');
  ok('목록형 탭으로 돌아오면 표 그대로(실 23곳), PC 실 이름 옆에도 PC 표시', (await page.locator('#grid .room').count()) === 23 && (await page.locator('#grid .plan').count()) === 0 && (await page.evaluate(() => [...document.querySelectorAll('#grid .room')].filter(r => r.querySelector('header .pcmark')).map(r => r.dataset.room).join())) === '2E,2G,2X,2Y,3B,3C,3F'); }
{ const d = await page.evaluate(() => { const bg = c => getComputedStyle(document.querySelector(`#grid .room[data-room="${c}"]`)).backgroundColor;
    return { never: [...document.querySelectorAll('#grid .room.never')].map(r => r.dataset.room).join(), labs: [...document.querySelectorAll('#grid .room.never .shutlab')].map(e => e.textContent).join(),
      dark: bg('1C'), plain: bg('1A'), plainLab: document.querySelector('#grid .room[data-room="1A"] .shutlab').textContent }; });
  ok('교실 이용불가 6곳(1C·1D·2E·2X·2Y·4A)은 다른 닫힌 실보다 어두운 음영, 표시는 "교실 이용불가"', d.never === '1C,1D,2E,2X,2Y,4A' && d.labs === Array(6).fill('교실 이용불가').join() && d.dark !== d.plain && d.plainLab === '수업 불가', d); }
await page.click('#grid .room[data-room="1A"] .more');
let s2 = await page.evaluate(() => { const r = document.querySelector('#grid .room[data-room="1A"]'); return { cells: [...r.querySelectorAll('.strip li')].map(li => li.className).join(), w4: r.querySelector('.strip li:nth-child(4) b').textContent, btn: r.querySelector('.more').textContent }; });
ok('"보기"를 누르면 그 실의 시간표가 회색으로 펼쳐짐 (1A 수4 = 3신1)', s2.cells === 'shut,shut,shut,shut,shut,shut,shut' && s2.w4 === '3신1' && s2.btn === '접기', s2);
await page.click('#grid .room[data-room="1A"] .more');

// 교사 찾기: 초성, 쓰는 도중의 글자, 이름 일부
await page.fill('#teacher', 'ㄱㄷ'); s = await names();
ok('초성 ㄱㄷ → 김동현·김동후', s.join() === '김동현,김동후', s);
await page.fill('#teacher', '김도'); s = await names();
ok('쓰는 도중(김도) → 김동현·김동후', s.join() === '김동현,김동후', s);
await page.fill('#teacher', 'ㅋㅋ'); ok('맞는 이름이 없으면 목록이 뜨지 않음', (await names()).length === 0);
ok('이름을 고르기 전에는 시작일·시간표가 나오지 않고 신청 단추는 아예 없음', !(await page.locator('#mytt, #from').evaluateAll(els => els.some(e => e.offsetParent))) && !(await page.locator('#send, #pickAll').count()));

// 음악 선생님: 음악 18칸은 이미 음악실에서 하므로 고를 수 없고 HR 한 칸만 고를 수 있음
await page.fill('#teacher', 'ㅅㅈㅇ'); s = await names();
ok('초성 ㅅㅈㅇ → 신지은 포함', s.includes('신지은'), s);
await page.click('#tlist button[data-name="신지은"]');
s = await page.evaluate(() => ({ btn: document.querySelectorAll('#mytt button[data-slot]').length, lab: [...document.querySelectorAll('#mytt td.lab')].map(td => td.textContent) }));
ok('신지은: 음악 18칸은 "음악 · 음악실" 회색, 고를 수 있는 칸은 HR 1칸', s.btn === 1 && s.lab.length === 18 && s.lab.every(t => t.endsWith('음악 · 음악실')), s);

// 성준혁 선택 → 내 시간표(과학 18칸), 칸을 눌러 고름
await page.fill('#teacher', 'ㅅㅈㅎ'); await page.click('#tlist button[data-name="성준혁"]');
s = await page.evaluate(() => ({ v: document.getElementById('teacher').value, btn: document.querySelectorAll('#mytt button[data-slot]').length, hidden: document.getElementById('tlist').hidden,
  w3: document.querySelector('#mytt button[data-slot="수3"]').textContent }));
ok('이름을 고르면 그 교사의 시간표가 나옴 (수3 = 1신3 과학)', s.v === '성준혁' && s.btn === 18 && s.hidden && s.w3 === '1신3과학', s);
ok('폰 폭(390px)에서 내 시간표·실습실 시간표가 옆으로 넘치지 않음', !(s = await over()).length, s);
// 수업 칸을 누르면 실 고르기 창: 그 시간에 비어 있는 실 목록 + 그 층 배치도, 실을 누르면 바로 신청
{ const popState = () => page.evaluate(() => { const p = document.getElementById('pop'); return { open: !p.hidden, title: document.getElementById('popTitle').textContent, text: document.getElementById('popBody').textContent,
    list: [...p.querySelectorAll('.rooms button')].map(b => b.dataset.room + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(), plan: [...p.querySelectorAll('.plan .pr:not(:disabled)')].map(b => b.dataset.room).sort().join(),
    floors: [...p.querySelectorAll('.pfl')].map(e => e.textContent).join(), inView: p.getBoundingClientRect().left >= 0 && p.getBoundingClientRect().right <= innerWidth + 1 }; });
  const cellText = k => page.evaluate(k => { const b = document.querySelector(`#mytt button[data-slot="${k}"]`); return b.textContent + '/' + b.className.trim(); }, k);
  ok('수업 칸을 누르기 전에는 창이 없음', !(await popState()).open);
  await page.click('#mytt button[data-slot="수3"]'); let v = await popState();
  ok('수3(세 실 모두 전공 수업): 창에 "비어 있는 실습실이 없습니다", 고를 실 없음', v.open && v.title === '수요일 3교시 · 1신3 과학' && v.text.includes('비어 있는 실습실이 없습니다') && v.list === '' && v.plan === '', v);
  await page.click('#mytt button[data-slot="수4"]'); v = await popState();
  ok('수4: 창에 빈 실 2D·3B·3C 목록과 그 실이 있는 3층·2층 배치도(같은 세 곳만 눌림), 화면 안에 들어옴', v.open && v.title === '수요일 4교시 · 1신1 과학' && v.list === '2D,3B,3C' && v.plan === '2D,3B,3C' && v.floors === '3층,2층' && v.inView && v.text.includes('11/25(수)부터'), v);
  // 창 옮기기: 제목 줄을 끌면 따라옴
  const at = () => page.evaluate(() => { const r = document.getElementById('pop').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
  await page.setViewportSize({ width: 1100, height: 900 }); const p0 = await at(), hb = await page.locator('#popHead').boundingBox();
  await page.mouse.move(hb.x + 40, hb.y + 10); await page.mouse.down(); await page.mouse.move(hb.x + 140, hb.y + 70, { steps: 4 }); await page.mouse.up(); const p1 = await at();
  ok('창 제목 줄을 끌면 창이 옮겨짐(오른쪽 100·아래 60)', p1[0] - p0[0] === 100 && p1[1] - p0[1] === 60, { p0, p1 });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.keyboard.press('Escape'); ok('Esc 로 창이 닫힘', !(await popState()).open);
  await page.click('#mytt button[data-slot="수4"]'); await page.click('#pop .plan .pr[data-room="3C"]');
  await page.waitForFunction(() => document.getElementById('pop').hidden && document.getElementById('msg').textContent.includes('3C'));
  v = { msg: await page.textContent('#msg'), cell: await cellText('수4'), room: (await (await worker.fetch(new Request('https://x/api/winter'), env)).json()).reqs.map(r => r.slot + r.cls + r.room).join() };
  ok('배치도에서 3C 를 누르면 바로 신청되고 창이 닫힘, 내 시간표 칸은 초록색 "3C"', v.msg === '수요일 4교시 1신1 → 3C 신청되었습니다' && v.cell === '1신13C/req' && v.room === '수41신13C', v);
  await page.click('#mytt button[data-slot="수4"]'); v = await popState();
  ok('신청한 칸을 다시 누르면 지금 고른 실(3C)이 표시되고 남은 빈 실(2D·3B)로 바꿀 수 있음', v.list === '3C*,2D,3B' && v.plan === '2D,3B' && v.text.includes('지금 고른 실: 3C') && v.text.includes('이 수업 신청 취소'), v);
  await page.click('#pop .rooms button[data-room="2D"]'); await page.waitForFunction(() => document.getElementById('msg').textContent.includes('2D'));
  ok('목록에서 2D 를 누르면 실이 바뀜', (await page.textContent('#msg')) === '수요일 4교시 1신1 → 2D (으)로 바꿨습니다' && (await cellText('수4')) === '1신12D/req');
  await page.click('#mytt button[data-slot="수4"]'); await page.click('#pop button[data-cancel]'); await page.waitForFunction(() => document.getElementById('msg').textContent === '신청을 취소했습니다');
  ok('창에서 "이 수업 신청 취소"를 누르면 취소되고 칸이 원래대로', (await cellText('수4')) === '1신1과학/' && !(await popState()).open && (await page.locator('#list tr.g').count()) === 0); }

// (아래 점검용) 실을 고르지 않은 신청 2건을 이 기기 이름으로 넣어 둔다: 예전 방식 신청·관리자 대신 배정 흐름 확인
{ const dev = await page.evaluate(() => localStorage.getItem('dgDev'));
  const r = await (await worker.fetch(new Request('https://x/api/winter', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dev': dev }, body: JSON.stringify({ teacher: '성준혁', from: '2026-11-25', slots: ['수3', '수4'] }) }), env)).json();
  if (!r.ok) console.log('점검용 신청 실패', r);
  await page.evaluate(() => load()); await page.waitForSelector('#list table'); }
let sum = await page.evaluate(() => ({ head: [...document.querySelectorAll('#list table.sum > thead th')].map(t => t.textContent.trim()).join('|'), rows: [...document.querySelectorAll('#list tr.g')].map(tr => [...tr.cells].map(c => c.textContent).join('|')), detail: document.querySelectorAll('#list tr.d').length }));
ok('신청 내역은 교사·과목·학반만 한 줄로(요일·교시 내역은 접혀 있음), 선생님 화면에는 선택 칸·일괄 취소 단추가 없음', sum.head === '|교사 ▲|과목|학반|' && sum.rows.join() === '|성준혁|과학|1신1, 1신3|자세히' && sum.detail === 0 && !(await page.locator('#bulkDel, #list input[type=checkbox]').count()), sum);
await page.click('#list button[data-open]');
s = await page.evaluate(() => ({ msg: document.getElementById('msg').textContent, rows: [...document.querySelectorAll('#list tr.d tbody tr')].map(tr => [...tr.cells].map(c => c.textContent).join('|')),
  req: [...document.querySelectorAll('#mytt button.req')].map(td => td.textContent), del: document.querySelectorAll('#list button[data-del]').length, sel: document.querySelectorAll('#list select').length }));
ok('"자세히"를 누르면 요일·교시별 2줄: 내 신청이라 실 선택 칸(수3 은 빈 실 없음, 수4 는 2D·3B·3C)과 취소 단추, 신청 뒤 "직접 고르세요" 안내', s.rows.length === 2 && s.rows[0].startsWith('수 3교시|1신3|11/25(수)부터|실 선택') && s.rows[0].includes('빈 실 없음') && s.rows[1].includes('2D') && s.rows[1].includes('3C') && s.del === 2 && s.sel === 2, s);
// 선생님이 직접 실을 고름(관리자 로그인 없이): 배치도에 "내 신청 1" → 3C → 4교시 빈 실 칸 → 내 신청을 눌러 3C 로, 그다음 신청 내역에서 선택 취소
{ const was = await page.evaluate(() => document.getElementById('tabPlan').getAttribute('aria-selected'));
  await page.click('#tabPlan');
  const w = await page.evaluate(() => [...document.querySelectorAll('#grid .pr em.wait')].map(e => e.closest('.pr').dataset.plan + ':' + e.textContent).sort().join());
  if (await page.evaluate(() => document.querySelector('#grid .pr[data-plan="3C"]').getAttribute('aria-pressed')) !== 'true') await page.click('#grid .pr[data-plan="3C"]');
  const free = await page.evaluate(() => [...document.querySelectorAll('#grid .room[data-room="3C"] .strip li')].map((li, i) => (li.querySelector('button[data-free]') ? i + 1 : '')).join(''));
  await page.click('#grid .room[data-room="3C"] .strip li:nth-child(4) button');
  const c = await page.evaluate(() => [...document.querySelectorAll('#grid .putbox button[data-put]:not(.x)')].map(b => b.textContent));
  await page.click('#grid .putbox button[data-put]:not(.x)');
  await page.waitForFunction(() => document.querySelector('#grid .room[data-room="3C"] .strip li:nth-child(4)').classList.contains('done'));
  const m = await page.textContent('#msg');
  ok('선생님이 직접 실을 고름: 배치도 빈 실에 "내 신청 1", 내 신청이 있는 4교시 칸만 눌리고, 누르면 3C 로 정해짐', w === '2D:내 신청 1,3B:내 신청 1,3C:내 신청 1' && free === '4' && c.length === 1 && c[0].startsWith('1신1 과학 성준혁') && m === '3C(으)로 정했습니다', { w, free, c, m });
  await page.selectOption('#list select >> nth=1', ''); await page.waitForFunction(() => document.getElementById('msg').textContent === '실 선택을 취소했습니다');
  await page.click('#grid .room[data-room="3C"] .more');
  if (was !== 'true') await page.click('#tabTable'); }
ok('실을 고르지 않은 내 신청 칸은 초록색 "실 선택 전"', s.req.join() === '1신3실 선택 전,1신1실 선택 전', s);

// 관리자 로그인: 빈 칸·틀린 비밀번호는 안내가 뜨고 관리자 화면이 열리지 않음, 맞으면 '관리자 로그인됨'
s = await page.evaluate(() => ({ btn: document.getElementById('login').textContent, on: !document.getElementById('adminOn').offsetParent && !!document.getElementById('login').offsetParent }));
ok('맨 위에 "관리자 로그인" 단추가 있음', s.btn === '관리자 로그인' && s.on, s);
await page.click('#login');
ok('비밀번호 없이 누르면 "비밀번호를 입력해 주세요"', (await page.textContent('#adminMsg')) === '비밀번호를 입력해 주세요');
await page.fill('#pw', '틀림'); await page.click('#login'); await page.waitForFunction(() => document.getElementById('adminMsg').textContent.includes('맞지'));
ok('틀린 비밀번호: "비밀번호가 맞지 않습니다", 관리자 화면은 열리지 않음', (await page.locator('#bulkDel').count()) === 0 && (await page.evaluate(() => document.getElementById('adminOn').hidden)));
await login();
s = await page.evaluate(() => ({ on: document.getElementById('adminOn').textContent, inHidden: !document.getElementById('adminIn').offsetParent && !document.getElementById('login').offsetParent && !!document.getElementById('logout').offsetParent, msg: document.getElementById('adminMsg').textContent, hint: document.getElementById('adminHint').hidden }));
ok('맞는 비밀번호: "관리자 로그인됨"과 로그아웃 단추·관리자 안내가 보임', s.on.includes('관리자 로그인됨') && s.on.includes('로그아웃') && s.inHidden && !s.msg && !s.hint, s);
// 관리자: 수3 은 세 곳 모두 전공 수업이라 빈 실 없음, 수4 는 2D·3B·3C 중에서 고름
s = await page.evaluate(() => [...document.querySelectorAll('#list select')].map(x => [...x.options].map(o => o.value).join('/')));
ok('배정 칸에는 그 요일교시에 빈 이용가능 실만 (수3: 없음, 수4: 2D·3B·3C)', s.join() === ',/2D/3B/3C' && (await page.textContent('#list tr.d tbody tr')).includes('빈 실 없음'), s);
// 배치도형(기본 화면)에서도 배정할 수 있음: 관리자에게는 기다리는 신청이 있는 실에 '대기 N', 실을 누르면 빈 실 칸 → 신청 목록
{ const was = await page.evaluate(() => document.getElementById('tabPlan').getAttribute('aria-selected'));
  await page.click('#tabPlan');
  const w = await page.evaluate(() => [...document.querySelectorAll('#grid .pr em.wait')].map(e => e.closest('.pr').dataset.plan + ':' + e.textContent).sort().join());
  if (await page.evaluate(() => document.querySelector('#grid .pr[data-plan="3B"]').getAttribute('aria-pressed')) !== 'true') await page.click('#grid .pr[data-plan="3B"]');
  await page.click('#grid .room[data-room="3B"] .strip li:nth-child(4) button');
  const c = await page.evaluate(() => [...document.querySelectorAll('#grid .putbox button[data-put]:not(.x)')].map(b => b.textContent));
  ok('배치도형(관리자): 기다리는 신청이 있는 빈 실에 "대기 1", 실 → 빈 실 칸을 누르면 신청한 반을 고를 수 있음', w === '2D:대기 1,3B:대기 1,3C:대기 1' && c.length === 1 && c[0].startsWith('1신1 과학 성준혁'), { w, c });
  await page.click('#grid .putbox button.x'); await page.click('#grid .room[data-room="3B"] .more');
  if (was !== 'true') await page.click('#tabTable'); }
// 빈 실 칸을 눌러 배정: 3B 수4 칸에 '대기 1건' → 누르면 그 시간 신청 목록 → 신청을 누르면 3B 에 배정
const cell3B = '#grid .room[data-room="3B"] .strip li:nth-child(4)';
s = await page.evaluate(q => ({ code: '3B', t: document.querySelector(q).textContent, hint: document.getElementById('adminHint').hidden,
  w5: document.querySelector('#grid .room[data-room="3B"] .strip li:nth-child(5)').textContent }), cell3B);
ok('관리자 화면: 3B 수4 빈 실 칸에 "대기 1건", 신청 없는 5교시 칸은 "빈 실"만', s.code === '3B' && s.t === '4빈 실대기 1건' && s.w5 === '5빈 실' && !s.hint, s);
await page.click('#grid .room[data-room="3B"] .strip li:nth-child(5) button');
ok('신청 없는 빈 실을 누르면 "실을 고르지 않은 신청이 없습니다"', (await page.textContent('#grid .putbox')).includes('실을 고르지 않은 신청이 없습니다'));
await page.click(cell3B + ' button');
s = await page.evaluate(() => [...document.querySelectorAll('#grid .putbox button[data-put]:not(.x)')].map(b => b.textContent));
ok('빈 실을 누르면 그 시간에 기다리는 신청이 나옴 (1신1 과학 성준혁)', s.length === 1 && s[0].startsWith('1신1 과학 성준혁'), s);
await page.click('#grid .putbox button[data-put]:not(.x)');
await page.waitForFunction(q => document.querySelector(q).classList.contains('done'), cell3B);
ok('신청을 누르면 그 실에 배정되고 목록이 닫힘', (await page.textContent('#msg')) === '3B(으)로 정했습니다' && !(await page.locator('#grid .putbox').count()));
// 신청 내역의 목록으로도 실을 바꿀 수 있음: 3B → 2D
await page.selectOption('#list tr.d tbody tr:nth-child(2) select', '2D');
await page.waitForFunction(() => document.querySelector('#grid .room[data-room="2D"] li.done'));
s = await page.evaluate(() => ({ cells: [...document.querySelectorAll('#grid .room[data-room="2D"] .strip li')].map(li => li.className), cell: [...document.querySelectorAll('#grid li.done b, #grid li.done small')].map(e => e.textContent).join(''),
  mine: [...document.querySelectorAll('#mytt button.req small')].map(e => e.textContent) }));
ok('11/25(수) 2D: 1~3 전공 수업·4교시 배정(1신1 과학 성준혁)·5~7 빈 실, 내 시간표에도 "2D 배정"', s.cells.join() === 'busy,busy,busy,done,free,free,free' && s.cell === '1신1과학성준혁' && s.mine.join() === '실 선택 전,2D', s);
await page.click('#next');
ok('11/26(목): 수요일 배정은 보이지 않음', (await page.textContent('#vday')) === '11/26(목)' && (await page.evaluate(() => document.querySelectorAll('#grid li.done').length)) === 0);

// 이용가능 표시: 3C 를 끄면 그 줄이 회색으로 닫히고, 2A 를 켜면 열림
await page.uncheck('#grid input[data-avail="3C"]');
await page.waitForFunction(() => document.querySelectorAll('#grid .room.closed').length === 21);
await page.check('#grid input[data-avail="2A"]');
await page.waitForFunction(() => document.querySelectorAll('#grid .room.closed').length === 20);
ok('보통 실은 이용가능으로 바꿀 때 확인 창이 뜨지 않음', !asked.some(m => m.includes('해제')), asked);
// 교실 이용불가 실을 풀려 하면 확인 창: 취소하면 그대로, 확인하면 이용가능으로
answer = false; await page.click('#grid input[data-avail="1C"]');
let n1 = await page.evaluate(() => ({ on: document.querySelector('#grid input[data-avail="1C"]').checked, never: document.querySelector('#grid .room[data-room="1C"]').classList.contains('never') }));
ok('이용불가 실 체크 → "교실 이용불가 실습실입니다 … 해제하시겠습니까?" 확인 창, 취소하면 그대로', asked.at(-1).includes('1C') && asked.at(-1).includes('교실 이용불가 실습실입니다') && asked.at(-1).includes('해제하시겠습니까') && !n1.on && n1.never, { asked, n1 });
answer = true; await page.click('#grid input[data-avail="1C"]');
await page.waitForFunction(() => document.querySelector('#grid .room[data-room="1C"]').classList.contains('open'));
ok('확인하면 이용가능으로 풀리고 어두운 음영이 없어짐', !(await page.evaluate(() => document.querySelector('#grid .room[data-room="1C"]').classList.contains('never'))));
await page.uncheck('#grid input[data-avail="1C"]');
await page.waitForFunction(() => document.querySelector('#grid .room[data-room="1C"]').classList.contains('never'));
ok('관리자가 이용가능 표시를 끄고 켜면 회색 닫힘이 바로 바뀜', true);

// 로그아웃하면(다른 선생님 화면) 배정 결과가 글자로 보임
await page.click('#logout'); await page.waitForSelector('#adminIn:not([hidden])');
s = await page.evaluate(() => document.querySelector('#list tr.d tbody tr:nth-child(2)').textContent);
ok('선생님 화면에는 배정된 실습실 이름이 보임', s.includes('2D 송변전배전설비운영'), s);
ok('신청·배정 뒤에도 폰에서 표가 옆으로 넘치지 않음', !(s = await over()).length, s);
// 정렬과 골라서 한 번에 취소: 다른 기기에서 두 분이 더 신청한 뒤 확인
{ const post = (teacher, slots) => worker.fetch(new Request('https://x/api/winter', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dev': 'z'.repeat(20) }, body: JSON.stringify({ teacher, from: '2026-11-25', slots }) }), env).then(r => r.json());
  const tt = (await (await worker.fetch(new Request('https://x/api/winter'), env)).json()).tt;
  const pick = t => Object.keys(tt[t]).filter(k => tt[t][k].endsWith('|')).slice(0, 2);
  // 김학선: 1학년 국A 한 칸 + 2학년 진로 한 칸(과목·학년이 달라도 신청 내역에는 한 줄이어야 함)
  const mixed = [pick('김학선').find(k => tt['김학선'][k].startsWith('1')), Object.keys(tt['김학선']).find(k => tt['김학선'][k].startsWith('2') && tt['김학선'][k].endsWith('|'))];
  for (const [t, sl] of [['정선화', pick('정선화')], ['김학선', mixed]]) { const r = await post(t, sl); if (!r.ok) console.log('점검용 신청 실패', t, r); }
  await page.reload(); await page.waitForSelector('#list tr.g');
  ok('다시 접속하면 전에 고른 교사 이름이 남아 있지 않음', (await page.inputValue('#teacher')) === '' && !(await page.locator('#from').evaluate(e => !!e.offsetParent)) && (await page.evaluate(() => localStorage.getItem('winterTeacher'))) === null);
  const col = i => page.evaluate(i => [...document.querySelectorAll('#list tr.g')].map(tr => tr.cells[i].textContent), i);
  let v = { names: await col(1), boxes: await page.locator('#list input[type=checkbox]').count(), bulk: await page.locator('#bulkDel').count() };
  ok('신청 내역 3줄: 교사 이름순. 관리자가 아니면 내 신청이 있어도 선택 칸과 "선택한 신청 취소" 단추가 없음', v.names.join() === '김학선,성준혁,정선화' && v.boxes === 0 && v.bulk === 0, v);
  { const k = await page.evaluate(() => [...document.querySelectorAll('#list tr.g')].map(tr => [...tr.cells].slice(1, 4).map(c => c.textContent).join('|')).find(x => x.startsWith('김학선')));
    ok('신청 내역은 교사 기준 한 줄: 김학선은 1학년 국A·2학년 진로를 신청해도 한 줄에 과목·학반이 함께', /^김학선\|국A, 진로\|1.+, 2.+$/.test(k), k); }
  await page.click('#list button[data-sort="teacher"]'); v = await col(1);
  ok('교사 제목을 다시 누르면 거꾸로 정렬', v.join() === '정선화,성준혁,김학선', v);
  await page.click('#list button[data-sort="subject"]'); v = { subj: await col(2), head: await page.evaluate(() => document.querySelector('#list th[aria-sort="ascending"]').textContent.trim()) };
  ok('과목 제목을 누르면 과목순', v.subj.join() === [...v.subj].sort((a, b) => a.localeCompare(b, 'ko')).join() && v.head === '과목 ▲', v);
  await page.click('#list button[data-sort="cls"]'); v = await col(3);
  ok('학반 제목을 누르면 학반순(1학년 → 2학년, 전기반 → 신재생반)', v.map(x => x.split(',')[0]).join() === [...v].map(x => x.split(',')[0]).sort((a, b) => (a[0] + (a[1] === '전' ? 0 : 1) + a[2]).localeCompare(b[0] + (b[1] === '전' ? 0 : 1) + b[2])).join(), v);
  // 관리자만 줄을 고를 수 있음 → 두 줄을 골라 한 번에 취소
  await login(); await page.waitForFunction(() => document.querySelectorAll('#list input[data-pick]').length === 3);
  ok('관리자로 로그인하면 줄마다 선택 칸과 꺼진 "선택한 신청 취소" 단추가 나옴', await page.evaluate(() => document.getElementById('bulkDel').disabled && !!document.getElementById('pickAllReq')));
  await page.check('#list input[data-pick^="정선화"]'); await page.check('#list input[data-pick^="김학선"]');
  v = await page.textContent('#bulkDel');
  ok('두 줄을 고르면 "선택한 신청 취소 (4건)"', v === '선택한 신청 취소 (4건)', v);
  answer = false; await page.click('#bulkDel'); await page.waitForTimeout(200);
  ok('확인 창에서 취소하면 그대로', asked.at(-1) === '선택한 신청 4건을 모두 취소할까요?' && (await page.locator('#list tr.g').count()) === 3, asked.at(-1));
  answer = true; await page.click('#bulkDel'); await page.waitForFunction(() => document.querySelectorAll('#list tr.g').length === 1);
  v = { names: await col(1), msg: await page.textContent('#msg'), left: (await (await worker.fetch(new Request('https://x/api/winter'), env)).json()).reqs.map(r => r.teacher).join() };
  ok('확인하면 고른 두 분의 신청 4건만 지워지고 나머지는 남음', v.names.join() === '성준혁' && v.msg === '4건을 취소했습니다' && v.left === '성준혁,성준혁', v);
  await page.check('#pickAllReq');
  ok('맨 위 체크로 전체 선택', (await page.textContent('#bulkDel')) === '선택한 신청 취소 (2건)');
  await page.uncheck('#pickAllReq'); await page.click('#logout'); await page.waitForSelector('#adminIn:not([hidden])'); }
ok('신청 내역이 폰에서 옆으로 넘치지 않음', !(s = await over()).length, s);
if (process.env.SHOT) { await page.click('#prev'); await page.screenshot({ path: process.env.SHOT + '-phone.png', fullPage: true });
  await page.click('#tabPlan'); await page.click('#grid .pr[data-plan="2D"]'); await page.screenshot({ path: process.env.SHOT + '-plan.png', fullPage: true });
  await page.setViewportSize({ width: 1100, height: 900 }); await login(); await page.screenshot({ path: process.env.SHOT + '-pc.png', fullPage: true }); }

await browser.close();
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
process.exit(fail ? 1 : 0);
