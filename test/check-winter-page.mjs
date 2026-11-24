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
await page.waitForSelector('#grid table');
const names = () => page.evaluate(() => document.getElementById('tlist').hidden ? [] : [...document.querySelectorAll('#tlist button')].map(b => b.textContent));
const over = () => page.evaluate(() => ['mytt', 'grid', 'list'].filter(id => [...document.querySelectorAll('#' + id + ', #' + id + ' .wrap')].some(w => w.scrollWidth > w.clientWidth + 1)).concat(document.documentElement.scrollWidth > innerWidth + 1 ? ['화면'] : []));

// 첫 화면: 안내 문구 없음, 오늘(11/24 화) 시간표 — 2D·3B·3C 는 11/25부터라 오늘은 이용가능으로 나오지 않음
let s = await page.evaluate(() => ({ day: document.getElementById('vday').textContent, badges: document.querySelectorAll('#grid .badge').length, free: document.querySelectorAll('#grid td.free').length,
  soon: [...document.querySelectorAll('#grid .soon')].map(e => e.textContent), rows: document.querySelectorAll('#grid tbody tr').length, from: document.getElementById('from').value,
  note: document.getElementById('fromNote').textContent, text: document.body.textContent.includes('요 며칠'), old: !!document.querySelector('#cls, #subject, #periods') }));
ok('첫 화면: 11/24(화), 실 23곳, 이용가능 배지·빈 실 없음, 세 곳에 "11/25부터", 시작일 기본값 11/25', s.day === '11/24(화)' && s.rows === 23 && s.badges === 0 && s.free === 0 && s.soon.join() === '11/25부터,11/25부터,11/25부터' && s.from === '2026-11-25', s);
ok('안내 문구와 학급·과목·교시 입력 칸은 없음', !s.text && !s.old, s);
ok('시작일 옆에 "11/25부터 일부 실습실 이용가능"', s.note === '11/25부터 일부 실습실 이용가능', s);

// 교사 찾기: 초성, 쓰는 도중의 글자, 이름 일부
await page.fill('#teacher', 'ㄱㄷ'); s = await names();
ok('초성 ㄱㄷ → 김동현·김동후', s.join() === '김동현,김동후', s);
await page.fill('#teacher', '김도'); s = await names();
ok('쓰는 도중(김도) → 김동현·김동후', s.join() === '김동현,김동후', s);
await page.fill('#teacher', 'ㅅㅈㅇ'); s = await names();
ok('초성 ㅅㅈㅇ → 신지은 포함', s.includes('신지은'), s);
await page.fill('#teacher', 'ㅋㅋ'); ok('맞는 이름이 없으면 목록이 뜨지 않음', (await names()).length === 0);
await page.click('#send'); ok('교사를 고르지 않으면 신청이 막힘', (await page.textContent('#msg')).includes('교사명'));

// 신지은 선택 → 내 시간표(수업 19칸: 음악 18 + HR), 칸을 눌러 고름
await page.fill('#teacher', 'ㅅㅈㅇ'); await page.click('#tlist button[data-name="신지은"]');
s = await page.evaluate(() => ({ v: document.getElementById('teacher').value, btn: document.querySelectorAll('#mytt button[data-slot]').length, hidden: document.getElementById('tlist').hidden,
  w3: document.querySelector('#mytt button[data-slot="수3"]').textContent }));
ok('이름을 고르면 그 교사의 시간표가 나옴 (수3 = 1신2 음악)', s.v === '신지은' && s.btn === 19 && s.hidden && s.w3 === '1신2음악', s);
await page.click('#send'); ok('수업을 고르지 않으면 신청이 막힘', (await page.textContent('#msg')).includes('수업 칸'));
await page.click('#mytt button[data-slot="수3"]'); await page.click('#mytt button[data-slot="수4"]'); await page.click('#mytt button[data-slot="목1"]'); await page.click('#mytt button[data-slot="목1"]');
ok('누른 칸만 선택됨(다시 누르면 풀림)', (await page.evaluate(() => [...document.querySelectorAll('#mytt button.sel')].map(b => b.dataset.slot))).join() === '수3,수4');
ok('폰 폭(390px)에서 내 시간표·실습실 시간표가 옆으로 넘치지 않음', !(s = await over()).length, s);

// 신청 → 신청 내역 2줄(배정 대기), 내 시간표의 그 칸은 '신청됨'
await page.click('#send'); await page.waitForSelector('#list table');
s = await page.evaluate(() => ({ msg: document.getElementById('msg').textContent, rows: [...document.querySelectorAll('#list tbody tr')].map(tr => [...tr.cells].map(c => c.textContent).join('|')),
  req: [...document.querySelectorAll('#mytt td.req')].map(td => td.textContent), del: document.querySelectorAll('#list button[data-del]').length, sel: document.querySelectorAll('#list select').length }));
ok('신청 2줄: 요일·교시·학급·과목·교사·시작일, 배정 대기, 내 신청이라 취소 단추', s.msg.startsWith('신청되었습니다') && s.rows.join() === '수 3교시|1신2|음악|신지은|11/25(수)부터|배정 대기|취소,수 4교시|1전1|음악|신지은|11/25(수)부터|배정 대기|취소' && s.del === 2 && s.sel === 0, s);
ok('내 시간표의 신청한 칸은 "신청됨"으로 바뀌고 다시 고를 수 없음', s.req.join() === '1신2신청됨,1전1신청됨', s);

// 관리자: 수3 은 세 곳 모두 전공 수업이라 빈 실 없음, 수4 는 2D·3B·3C 중에서 고름
await page.fill('#pw', 'pw');
s = await page.evaluate(() => [...document.querySelectorAll('#list select')].map(x => [...x.options].map(o => o.value).join('/')));
ok('배정 칸에는 그 요일교시에 빈 이용가능 실만 (수3: 없음, 수4: 2D·3B·3C)', s.join() === ',/2D/3B/3C' && (await page.textContent('#list tbody tr')).includes('빈 실 없음'), s);
await page.selectOption('#list tbody tr:nth-child(2) select', '2D');
await page.waitForFunction(() => document.querySelector('#mytt td.req small') && [...document.querySelectorAll('#mytt td.req small')].some(e => e.textContent === '2D 배정'));
s = await page.evaluate(() => ({ today: document.querySelectorAll('#grid td.done').length }));
ok('오늘(11/24) 시간표에는 아직 배정이 보이지 않음(시작일 11/25)', s.today === 0, s);
await page.click('#next');
s = await page.evaluate(() => ({ day: document.getElementById('vday').textContent, cells: [...document.querySelector('#grid tbody tr').querySelectorAll('td')].map(td => td.className), badges: document.querySelectorAll('#grid .badge').length,
  top: [...document.querySelectorAll('#grid tbody tr')].slice(0, 3).map(tr => tr.querySelector('th').textContent.replace(/\s/g, '').slice(0, 2)), cell: document.querySelector('#grid td.done').textContent }));
ok('11/25(수): 이용가능 2D·3B·3C 가 맨 위, 2D 는 1~3 전공 수업·4교시 배정(1전1 음악 신지은)·5~7 빈 실', s.day === '11/25(수)' && s.cells.join() === 'busy,busy,busy,done,free,free,free' && s.badges === 3 && s.top.join() === '2D,3B,3C' && s.cell === '1전1음악 신지은', s);
await page.click('#next');
ok('11/26(목): 수요일 배정은 보이지 않음', (await page.evaluate(() => document.querySelectorAll('#grid td.done').length)) === 0);

// 이용가능 표시 끄기: 3C 를 끄면 배지가 2개
await page.uncheck('#grid input[data-avail="3C"]');
await page.waitForFunction(() => document.querySelectorAll('#grid .badge').length === 2);
ok('관리자가 이용가능 표시를 끄면 바로 반영', true);

// 비밀번호를 지우면(다른 선생님 화면) 배정 결과가 글자로 보임
await page.fill('#pw', '');
s = await page.evaluate(() => document.querySelector('#list tbody tr:nth-child(2)').textContent);
ok('선생님 화면에는 배정된 실습실 이름이 보임', s.includes('2D 송변전배전설비운영'), s);
ok('신청·배정 뒤에도 폰에서 표가 옆으로 넘치지 않음', !(s = await over()).length, s);
if (process.env.SHOT) { await page.click('#prev'); await page.screenshot({ path: process.env.SHOT + '-phone.png', fullPage: true }); }

await browser.close();
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
process.exit(fail ? 1 : 0);
