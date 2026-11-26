// 원래 실습실에서 하는 수업을 다른 실습실로 옮기는 화면 점검: 내 시간표의 실습실 수업 칸도 눌리고, 옮기면 그 주에는 원래 실이 빈 실로 보인다.
// 실행: node test/check-winter-labmove.mjs   (playwright 필요, 크롬은 CHROME=경로, 인터넷 불필요)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import worker from '../src/worker.js';
import { fakeEnv } from './check-winter.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const HTML = fs.readFileSync(new URL('../public/winter.html', import.meta.url), 'utf8');
const env = { ...fakeEnv(), W_TODAY: '2026-11-30' };   // 기준일 11/30(월): 이번 주 = 11/30~12/4
await env.DATA.put('winterAvail2', JSON.stringify({ '2D': '2026-11-25', '3B': '2026-11-25', '3C': '2026-11-25', '4C': '2026-11-25' }));
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
await page.goto('https://fake.test/winter');
await page.waitForSelector('#grid .plan');
await page.fill('#teacher', '김동후'); await page.press('#teacher', 'Enter'); await page.waitForSelector('#mytt button[data-slot]');

// 1) 실습실 수업 칸(목4 = 1신1 자동, 원래 4C)도 눌리고 칸에 원래 실 코드가 보임
let s = await page.evaluate(() => ({ cell: document.querySelector('#mytt button[data-slot="목4"]')?.textContent, gray: [...document.querySelectorAll('#mytt td.lab')].map(t => t.textContent), hint: document.querySelector('#mytt .hint').textContent }));
ok('실습실 수업 칸(목4 1신1 자동 · 4C)이 눌리는 단추로 나옴', s.cell === '1신1자동 · 4C', s);
ok('안내 글에 실습실 수업도 옮길 수 있다고 나옴', s.hint.includes('원래 실습실에서 하는 수업') && !s.hint.includes('회색은 이미 실습실'), s.hint);

// 2) 누르면 실 고르기 창: 원래 실(4C)은 고를 수 없고 빈 실(2D 등)은 고를 수 있음
await page.click('#mytt button[data-slot="목4"]');
s = await page.evaluate(() => [...document.querySelectorAll('#pop .plan .pr:not(:disabled)')].map(b => b.dataset.room).sort().join());
ok('창에서 원래 실 4C 는 꺼져 있고 2D·3B·3C 를 고를 수 있음', s === '2D,3B,3C', s);
await page.click('#pop .plan .pr[data-room="2D"]');
await page.waitForFunction(() => document.getElementById('msg').textContent.includes('2D'));
if (await page.$('#moreNo')) await page.click('#moreNo');   // '다른 시간에도 비어 있음' 안내는 닫음
s = await page.evaluate(() => document.querySelector('#mytt button[data-slot="목4"]').textContent);
ok('신청 뒤 칸에 "4C→2D" 로 옮긴 실이 보임', s.includes('4C→2D'), s);
const g = await (await worker.fetch(new Request('https://x/api/winter'), env)).json();
ok('서버에 목4 김동후 → 2D 로 저장', g.reqs.some(r => r.teacher === '김동후' && r.slot === '목4' && r.room === '2D' && r.wk === '2026-11-30'), g.reqs);

// 3) 실습실 시간표(12/3 목, 목록형): 4C 4교시는 빈 실, 2D 4교시에는 옮겨 온 김동후 수업
await page.click('#tabTable'); await page.fill('#vdate', '2026-12-03'); await page.dispatchEvent('#vdate', 'change');
await page.waitForSelector('#grid .room[data-room="4C"] .strip li');
const li = (c, n) => page.evaluate(([c, n]) => { const e = document.querySelector(`#grid .room[data-room="${c}"] .strip li:nth-child(${n})`); return e.className + '|' + e.textContent; }, [c, n]);
s = [await li('4C', 4), await li('2D', 4), await li('4C', 5)];
ok('12/3: 4C 4교시는 빈 실, 2D 4교시는 1신1 자동 김동후, 4C 5교시는 그대로 전공 수업', s[0].startsWith('free|') && s[0].includes('빈 실') && s[1].startsWith('done|') && s[1].includes('김동후') && s[2].startsWith('busy|'), s);
// 다음 주(12/10)는 옮기지 않았으므로 4C 4교시는 원래 수업
await page.fill('#vdate', '2026-12-10'); await page.dispatchEvent('#vdate', 'change'); await page.waitForTimeout(200);
s = await li('4C', 4);
ok('다음 주 12/10: 4C 4교시는 원래 전공 수업', s.startsWith('busy|') && s.includes('김동후'), s);
ok('폰 폭(390px)에서 옆으로 넘치지 않음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

await browser.close();
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
process.exit(fail ? 1 : 0);
