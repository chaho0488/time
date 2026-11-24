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
page.on('dialog', d => d.accept());
await page.route('**/*', async r => {
  const q = r.request(), u = new URL(q.url());
  if (u.pathname === '/winter') return r.fulfill({ contentType: 'text/html', body: HTML });
  if (u.pathname !== '/api/winter') return r.abort();
  const res = await worker.fetch(new Request(q.url(), { method: q.method(), headers: q.headers(), body: q.postData() || undefined }), env);
  return r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
});
await page.goto('https://fake.test/winter');   /* https: 기기 표시(crypto.randomUUID)는 보안 주소에서만 만들어짐 */
await page.waitForSelector('#grid .room');
const login = async () => { await page.fill('#pw', 'pw'); await page.click('#login'); await page.waitForSelector('#adminOn:not([hidden])'); };
const names = () => page.evaluate(() => document.getElementById('tlist').hidden ? [] : [...document.querySelectorAll('#tlist button')].map(b => b.textContent));
const over = () => page.evaluate(() => ['mytt', 'grid', 'list'].filter(id => [...document.querySelectorAll('#' + id + ', #' + id + ' .wrap')].some(w => w.scrollWidth > w.clientWidth + 1)).concat(document.documentElement.scrollWidth > innerWidth + 1 ? ['화면'] : []));

// 첫 화면: 안내 문구 없음. 오늘(11/24)이 아니라 이동 시작일 11/25(수)부터 보이고, 그 앞 날짜로는 넘어가지 않음
let s = await page.evaluate(() => ({ day: document.getElementById('vday').textContent, badges: [...document.querySelectorAll('#grid .badge')].map(b => b.textContent), free: document.querySelectorAll('#grid li.free').length,
  rows: document.querySelectorAll('#grid .room').length, from: document.getElementById('from').value, min: [document.getElementById('from').min, document.getElementById('vdate').min],
  note: document.getElementById('fromNote').textContent, pwTop: !!(document.getElementById('pw').compareDocumentPosition(document.getElementById('teacher')) & 4), hint: document.getElementById('adminHint').hidden, text: document.body.textContent.includes('요 며칠'), old: !!document.querySelector('#cls, #subject, #periods') }));
ok('첫 화면: 11/25(수), 실 24곳, 이용가능 3곳 + 음악실, 시작일 기본값·최솟값 11/25', s.day === '11/25(수)' && s.rows === 24 && s.badges.join() === '이용가능,이용가능,이용가능,음악실' && s.free === 12 && s.from === '2026-11-25' && s.min.join() === '2026-11-25,2026-11-25', s);
ok('안내 문구와 학급·과목·교시 입력 칸은 없음', !s.text && !s.old, s);
ok('관리자 비밀번호 칸이 맨 위(교사명 칸보다 앞)에 있고, 비밀번호 전에는 관리자 안내·빈 실 단추가 없음', s.pwTop && s.hint && !(await page.locator('#grid button[data-free]').count()), s);
ok('시작일 옆에 "11/25부터 일부 실습실 이용가능"', s.note === '11/25부터 일부 실습실 이용가능', s);
await page.click('#prev');
ok('◀ 를 눌러도 11/25 앞(오늘)으로는 가지 않음', (await page.textContent('#vday')) === '11/25(수)');
await page.fill('#vdate', '2026-11-24'); await page.dispatchEvent('#vdate', 'change');
ok('날짜 칸에 오늘을 직접 넣어도 11/25 로 돌아옴', (await page.textContent('#vday')) === '11/25(수)');

// 수업 불가 실은 줄 전체가 회색으로 닫히고, 음악실(1층 프로젝트실)은 음악 수업이 들어 있음
s = await page.evaluate(() => { const rows = [...document.querySelectorAll('#grid .room')], code = r => r.querySelector('.code').textContent;
  const txt = li => [...li.querySelectorAll('b, small')].map(e => e.textContent).join('');   // 교시 번호는 빼고 학급·과목·교사만
  const p = rows.find(r => code(r) === '1P'), d = rows.find(r => code(r) === '2D');
  return { order: rows.slice(0, 4).map(code), closed: rows.filter(r => r.classList.contains('closed')).length, lab: rows.filter(r => r.querySelector('.shutlab')).length,
    notShut: rows.filter(r => r.classList.contains('closed')).reduce((n, r) => n + [...r.querySelectorAll('.strip li')].filter(li => !li.classList.contains('shut') && !li.classList.contains('out')).length, 0),
    music: [...p.querySelectorAll('.strip li')].map(txt), pClosed: p.classList.contains('closed'), pName: p.querySelector('.rname').textContent,
    name: d.querySelector('.rname').textContent, size: parseFloat(getComputedStyle(d.querySelector('.rname')).fontSize), nos: [...d.querySelectorAll('.strip li i')].map(i => i.textContent).join('') }; });
ok('실습실 이름이 전체 이름으로 크게(17px 이상) 나오고 칸마다 교시 번호가 있음', s.name === '송변전배전설비운영실습실' && s.size >= 17 && s.nos === '1234567', s);
ok('이용가능 3곳 → 음악실 → 나머지 20곳은 "수업 불가"로 회색(칸 전체)', s.order.join() === '2D,3B,3C,1P' && s.closed === 20 && s.lab === 20 && s.notShut === 0, s);
ok('음악실 줄: 프로젝트실(음악실), 11/25(수) 3·4·6·7교시 음악', !s.pClosed && s.pName === '프로젝트실(음악실)' && s.music.join('|') === '||1신2음악신지은|1전1음악신지은||1신1음악신지은|1신1음악신지은', s);

// 교사 찾기: 초성, 쓰는 도중의 글자, 이름 일부
await page.fill('#teacher', 'ㄱㄷ'); s = await names();
ok('초성 ㄱㄷ → 김동현·김동후', s.join() === '김동현,김동후', s);
await page.fill('#teacher', '김도'); s = await names();
ok('쓰는 도중(김도) → 김동현·김동후', s.join() === '김동현,김동후', s);
await page.fill('#teacher', 'ㅋㅋ'); ok('맞는 이름이 없으면 목록이 뜨지 않음', (await names()).length === 0);
await page.click('#send'); ok('교사를 고르지 않으면 신청이 막힘', (await page.textContent('#msg')).includes('교사명'));

// 음악 선생님: 음악 18칸은 이미 프로젝트실(1P)이라 고를 수 없고 HR 한 칸만 고를 수 있음
await page.fill('#teacher', 'ㅅㅈㅇ'); s = await names();
ok('초성 ㅅㅈㅇ → 신지은 포함', s.includes('신지은'), s);
await page.click('#tlist button[data-name="신지은"]');
s = await page.evaluate(() => ({ btn: document.querySelectorAll('#mytt button[data-slot]').length, lab: [...document.querySelectorAll('#mytt td.lab')].map(td => td.textContent) }));
ok('신지은: 음악 18칸은 "음악 · 1P" 회색, 고를 수 있는 칸은 HR 1칸', s.btn === 1 && s.lab.length === 18 && s.lab.every(t => t.endsWith('음악 · 1P')), s);

// 성준혁 선택 → 내 시간표(과학 18칸), 칸을 눌러 고름
await page.fill('#teacher', 'ㅅㅈㅎ'); await page.click('#tlist button[data-name="성준혁"]');
s = await page.evaluate(() => ({ v: document.getElementById('teacher').value, btn: document.querySelectorAll('#mytt button[data-slot]').length, hidden: document.getElementById('tlist').hidden,
  w3: document.querySelector('#mytt button[data-slot="수3"]').textContent }));
ok('이름을 고르면 그 교사의 시간표가 나옴 (수3 = 1신3 과학)', s.v === '성준혁' && s.btn === 18 && s.hidden && s.w3 === '1신3과학', s);
await page.click('#send'); ok('수업을 고르지 않으면 신청이 막힘', (await page.textContent('#msg')).includes('수업 칸'));
await page.click('#mytt button[data-slot="수3"]'); await page.click('#mytt button[data-slot="수4"]'); await page.click('#mytt button[data-slot="목2"]'); await page.click('#mytt button[data-slot="목2"]');
ok('누른 칸만 선택됨(다시 누르면 풀림)', (await page.evaluate(() => [...document.querySelectorAll('#mytt button.sel')].map(b => b.dataset.slot))).join() === '수3,수4');
ok('폰 폭(390px)에서 내 시간표·실습실 시간표가 옆으로 넘치지 않음', !(s = await over()).length, s);

// 신청 → 신청 내역 2줄(배정 대기), 내 시간표의 그 칸은 '신청됨'
await page.click('#send'); await page.waitForSelector('#list table');
s = await page.evaluate(() => ({ msg: document.getElementById('msg').textContent, rows: [...document.querySelectorAll('#list tbody tr')].map(tr => [...tr.cells].map(c => c.textContent).join('|')),
  req: [...document.querySelectorAll('#mytt td.req')].map(td => td.textContent), del: document.querySelectorAll('#list button[data-del]').length, sel: document.querySelectorAll('#list select').length }));
ok('신청 2줄: 요일·교시·학급·과목·교사·시작일, 배정 대기, 내 신청이라 취소 단추', s.msg.startsWith('신청되었습니다') && s.rows.join() === '수 3교시|1신3|과학|성준혁|11/25(수)부터|배정 대기|취소,수 4교시|1신1|과학|성준혁|11/25(수)부터|배정 대기|취소' && s.del === 2 && s.sel === 0, s);
ok('내 시간표의 신청한 칸은 "신청됨"으로 바뀌고 다시 고를 수 없음', s.req.join() === '1신3신청됨,1신1신청됨', s);

// 관리자 로그인: 빈 칸·틀린 비밀번호는 안내가 뜨고 관리자 화면이 열리지 않음, 맞으면 '관리자 로그인됨'
s = await page.evaluate(() => ({ btn: document.getElementById('login').textContent, on: !document.getElementById('adminOn').offsetParent && !!document.getElementById('login').offsetParent }));
ok('맨 위에 "관리자 로그인" 단추가 있음', s.btn === '관리자 로그인' && s.on, s);
await page.click('#login');
ok('비밀번호 없이 누르면 "비밀번호를 입력해 주세요"', (await page.textContent('#adminMsg')) === '비밀번호를 입력해 주세요');
await page.fill('#pw', '틀림'); await page.click('#login'); await page.waitForFunction(() => document.getElementById('adminMsg').textContent.includes('맞지'));
ok('틀린 비밀번호: "비밀번호가 맞지 않습니다", 관리자 화면은 열리지 않음', (await page.locator('#list select').count()) === 0 && (await page.evaluate(() => document.getElementById('adminOn').hidden)));
await login();
s = await page.evaluate(() => ({ on: document.getElementById('adminOn').textContent, inHidden: !document.getElementById('adminIn').offsetParent && !document.getElementById('login').offsetParent && !!document.getElementById('logout').offsetParent, msg: document.getElementById('adminMsg').textContent, hint: document.getElementById('adminHint').hidden }));
ok('맞는 비밀번호: "관리자 로그인됨"과 로그아웃 단추·관리자 안내가 보임', s.on.includes('관리자 로그인됨') && s.on.includes('로그아웃') && s.inHidden && !s.msg && !s.hint, s);
// 관리자: 수3 은 세 곳 모두 전공 수업이라 빈 실 없음, 수4 는 2D·3B·3C 중에서 고름
s = await page.evaluate(() => [...document.querySelectorAll('#list select')].map(x => [...x.options].map(o => o.value).join('/')));
ok('배정 칸에는 그 요일교시에 빈 이용가능 실만 (수3: 없음, 수4: 2D·3B·3C)', s.join() === ',/2D/3B/3C' && (await page.textContent('#list tbody tr')).includes('빈 실 없음'), s);
// 빈 실 칸을 눌러 배정: 3B 수4 칸에 '대기 1건' → 누르면 그 시간 신청 목록 → 신청을 누르면 3B 에 배정
const cell3B = '#grid .room:nth-child(2) .strip li:nth-child(4)';
s = await page.evaluate(q => ({ code: document.querySelector('#grid .room:nth-child(2) .code').textContent, t: document.querySelector(q).textContent, hint: document.getElementById('adminHint').hidden,
  w5: document.querySelector('#grid .room:nth-child(2) .strip li:nth-child(5)').textContent }), cell3B);
ok('관리자 화면: 3B 수4 빈 실 칸에 "대기 1건", 신청 없는 5교시 칸은 "빈 실"만', s.code === '3B' && s.t === '4빈 실대기 1건' && s.w5 === '5빈 실' && !s.hint, s);
await page.click('#grid .room:nth-child(2) .strip li:nth-child(5) button');
ok('신청 없는 빈 실을 누르면 "기다리는 신청이 없습니다"', (await page.textContent('#grid .putbox')).includes('기다리는 신청이 없습니다'));
await page.click(cell3B + ' button');
s = await page.evaluate(() => [...document.querySelectorAll('#grid .putbox button[data-put]:not(.x)')].map(b => b.textContent));
ok('빈 실을 누르면 그 시간에 기다리는 신청이 나옴 (1신1 과학 성준혁)', s.length === 1 && s[0].startsWith('1신1 과학 성준혁'), s);
await page.click('#grid .putbox button[data-put]:not(.x)');
await page.waitForFunction(q => document.querySelector(q).classList.contains('done'), cell3B);
ok('신청을 누르면 그 실에 배정되고 목록이 닫힘', (await page.textContent('#msg')) === '3B에 배정했습니다' && !(await page.locator('#grid .putbox').count()));
// 신청 내역의 목록으로도 실을 바꿀 수 있음: 3B → 2D
await page.selectOption('#list tbody tr:nth-child(2) select', '2D');
await page.waitForFunction(() => document.querySelector('#grid .room li.done') && document.querySelector('#grid .room').querySelector('li.done'));
s = await page.evaluate(() => ({ cells: [...document.querySelector('#grid .room').querySelectorAll('.strip li')].map(li => li.className), cell: [...document.querySelectorAll('#grid li.done b, #grid li.done small')].map(e => e.textContent).join(''),
  mine: [...document.querySelectorAll('#mytt td.req small')].map(e => e.textContent) }));
ok('11/25(수) 2D: 1~3 전공 수업·4교시 배정(1신1 과학 성준혁)·5~7 빈 실, 내 시간표에도 "2D 배정"', s.cells.join() === 'busy,busy,busy,done,free,free,free' && s.cell === '1신1과학성준혁' && s.mine.join() === '신청됨,2D 배정', s);
await page.click('#next');
ok('11/26(목): 수요일 배정은 보이지 않음', (await page.textContent('#vday')) === '11/26(목)' && (await page.evaluate(() => document.querySelectorAll('#grid li.done').length)) === 0);

// 이용가능 표시: 3C 를 끄면 그 줄이 회색으로 닫히고, 2A 를 켜면 열림
await page.uncheck('#grid input[data-avail="3C"]');
await page.waitForFunction(() => document.querySelectorAll('#grid .room.closed').length === 21);
await page.check('#grid input[data-avail="2A"]');
await page.waitForFunction(() => document.querySelectorAll('#grid .room.closed').length === 20);
ok('관리자가 이용가능 표시를 끄고 켜면 회색 닫힘이 바로 바뀜', true);

// 로그아웃하면(다른 선생님 화면) 배정 결과가 글자로 보임
await page.click('#logout'); await page.waitForSelector('#adminIn:not([hidden])');
s = await page.evaluate(() => document.querySelector('#list tbody tr:nth-child(2)').textContent);
ok('선생님 화면에는 배정된 실습실 이름이 보임', s.includes('2D 송변전배전설비운영'), s);
ok('신청·배정 뒤에도 폰에서 표가 옆으로 넘치지 않음', !(s = await over()).length, s);
if (process.env.SHOT) { await page.click('#prev'); await page.screenshot({ path: process.env.SHOT + '-phone.png', fullPage: true });
  await page.setViewportSize({ width: 1100, height: 900 }); await login(); await page.screenshot({ path: process.env.SHOT + '-pc.png', fullPage: true }); }

await browser.close();
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
process.exit(fail ? 1 : 0);
