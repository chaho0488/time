// 한파 신청 화면(/winter) 점검: 신청 → 관리자 배정 → 시간표 반영까지 실제 Worker 코드와 가짜 D1·KV 로 확인
// 실행: node test/check-winter-page.mjs   (playwright 필요, 크롬은 CHROME=경로, 인터넷 불필요)
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
await page.goto('https://fake.test/winter')   /* https: 기기 표시(crypto.randomUUID)는 보안 주소에서만 만들어짐 */; await page.waitForSelector('#grid table');

// 첫 화면: 오늘(11/24 화) 시간표, 이용가능 3곳이 맨 위
let s = await page.evaluate(() => ({ day: document.getElementById('vday').textContent, badges: [...document.querySelectorAll('#grid .badge')].length,
  top: [...document.querySelectorAll('#grid tbody tr')].slice(0, 3).map(tr => tr.querySelector('th').textContent.slice(0, 2)), rows: document.querySelectorAll('#grid tbody tr').length,
  over: document.documentElement.scrollWidth > innerWidth + 1 || document.getElementById('grid').scrollWidth > document.getElementById('grid').clientWidth + 1 }));
ok('첫 화면: 11/24(화), 실 23곳, 이용가능 2D·3B·3C 가 맨 위', s.day === '11/24(화)' && s.rows === 23 && s.badges === 3 && s.top.join() === '2D,3B,3C', s);
ok('폰 폭(390px)에서 화면도 실습실 시간표도 옆으로 넘치지 않음', !s.over, s);

// 빈 칸으로 신청하면 안내만 뜨고 저장되지 않음
await page.click('#send');
ok('빈 칸 신청은 막힘', (await page.textContent('#msg')).includes('교사명'));

// 신청: 11/25(수) 4·5교시 1전1 수학 홍길동
await page.fill('#teacher', '홍길동'); await page.selectOption('#cls', '1전1'); await page.fill('#subject', '수학');
await page.fill('#date', '2026-11-25'); await page.dispatchEvent('#date', 'change');
ok('수요일은 교시 칸 7개', (await page.locator('#periods input').count()) === 7);
await page.check('#periods input[value="4"]'); await page.check('#periods input[value="5"]');
await page.click('#send'); await page.waitForSelector('#list table');
s = await page.evaluate(() => ({ msg: document.getElementById('msg').textContent, rows: [...document.querySelectorAll('#list tbody tr')].map(tr => tr.textContent), day: document.getElementById('vday').textContent,
  sel: document.querySelectorAll('#list select').length, del: document.querySelectorAll('#list button[data-del]').length }));
ok('신청 2줄이 배정 대기로 보이고, 내 신청이라 취소 단추가 있으며, 시간표가 신청한 날로 바뀜', s.msg.startsWith('신청되었습니다') && s.rows.length === 2 && s.rows.every(t => t.includes('배정 대기')) && s.del === 2 && s.sel === 0 && s.day === '11/25(수)', s);

// 11/25(수) 시간표: 2D 는 1~3교시 전공 수업, 4~7교시 빈 실
s = await page.evaluate(() => [...document.querySelector('#grid tbody tr').querySelectorAll('td')].map(td => td.className));
ok('11/25(수) 2D: 1~3교시 전공 수업, 4~7교시 빈 실', s.join() === 'busy,busy,busy,free,free,free,free', s);

// 관리자: 비밀번호를 넣으면 배정 칸이 보이고, 빈 이용가능 실만 고를 수 있음 → 2D 배정
await page.fill('#pw', 'pw');
s = await page.evaluate(() => [...document.querySelector('#list select').options].map(o => o.value));
ok('배정 칸에는 그 시간에 빈 이용가능 실만(2D·3B·3C)', s.join() === ',2D,3B,3C', s);
await page.selectOption('#list select', '2D');
await page.waitForFunction(() => document.querySelector('#grid td.done'));
s = await page.evaluate(() => ({ cell: document.querySelector('#grid td.done').textContent, col: [...document.querySelector('#grid tbody tr').children].findIndex(td => td.classList.contains('done')),
  second: [...document.querySelectorAll('#list select')][1] && [...document.querySelectorAll('#list select')][1].options.length }));
ok('배정하면 시간표 2D 4교시 칸에 학급·과목·교사가 보임', s.cell.includes('1전1') && s.cell.includes('수학') && s.cell.includes('홍길동') && s.col === 4, s);

// 이용가능 표시 끄기: 3C 를 끄면 배지가 2개
await page.uncheck('#grid input[data-avail="3C"]');
await page.waitForFunction(() => document.querySelectorAll('#grid .badge').length === 2);
ok('관리자가 이용가능 표시를 끄면 바로 반영', true);

// 비밀번호를 지우면(다른 선생님 화면) 배정 결과가 글자로 보임
await page.fill('#pw', '');
s = await page.evaluate(() => document.querySelector('#list tbody tr').textContent);
ok('선생님 화면에는 배정된 실습실 이름이 보임', s.includes('2D 송변전배전설비운영실습실'), s);
s = await page.evaluate(() => ['grid', 'list'].filter(id => document.getElementById(id).scrollWidth > document.getElementById(id).clientWidth + 1));
ok('신청·배정 뒤에도 폰에서 표가 옆으로 넘치지 않음', !s.length, s);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-phone.png', fullPage: true });

await browser.close();
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
process.exit(fail ? 1 : 0);
