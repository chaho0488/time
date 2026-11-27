// 솥밥 메뉴 주문(/lunch) 점검: node:sqlite 로 D1 을 흉내 내 API 규칙을 보고, 폰·PC 폭에서 화면으로 제출까지 해 본다
// 실행: node test/check-lunch.mjs   (화면 점검은 playwright 필요, 크롬은 CHROME=경로)
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import worker from '../src/worker.js';

const db = new DatabaseSync(':memory:');
const D1 = { prepare(sql) { let a = []; const st = {
  bind(...x) { a = x; return st; },
  async run() { db.prepare(sql).run(...a); return {}; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) || null; } }; return st; } };
const env = { DG: D1, ASSETS: { fetch: () => new Response('asset') } };
const api = (method, body) => worker.fetch(new Request('https://x/api/lunch', { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }), env)
  .then(async r => ({ status: r.status, ...(await r.json()) }));

let r = await api('GET');
assert.deepEqual(r.menus, ['전복솥밥', '갈비솥밥', '곤드레솥밥', '식사 불참']); assert.equal(r.list.length, 0);
r = await api('POST', { name: ' 홍 길동 ', menu: '갈비솥밥' });
assert.ok(r.ok); assert.equal(r.name, '홍길동', '띄어쓰기는 지움');
r = await api('POST', { name: '홍길동', menu: '전복솥밥' });
assert.ok(r.ok);
r = await api('GET');
assert.equal(r.list.length, 1, '같은 이름은 한 사람'); assert.equal(r.list[0].menu, '전복솥밥', '다시 내면 메뉴가 바뀜');
assert.equal((await api('POST', { name: '이몽룡', menu: '짜장면' })).status, 400, '목록에 없는 메뉴 거절');
assert.equal((await api('POST', { name: '   ', menu: '갈비솥밥' })).status, 400, '빈 이름 거절');
assert.equal((await api('POST', { name: '가'.repeat(21), menu: '갈비솥밥' })).status, 400, '너무 긴 이름 거절');
assert.equal((await api('PUT', {})).status, 405);
console.log('✅ API 규칙');

// 화면: 실제 worker + 위 가짜 D1 로 응답
let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { console.log('⚠ playwright 없음 — 화면 점검 건너뜀'); process.exit(0); }
const HTML = fs.readFileSync(new URL('../public/lunch.html', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
let fail = 0;
for (const width of [360, 1100]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  await page.route('**/*', async rt => {
    const q = rt.request(), u = new URL(q.url());
    if (u.pathname === '/lunch') return rt.fulfill({ contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/lunch') {
      const res = await worker.fetch(new Request('https://x/api/lunch', { method: q.method(), headers: q.headers(), body: q.postData() || undefined }), env);
      return rt.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    }
    return rt.abort();
  });
  await page.goto('http://fake.test/lunch'); await page.waitForSelector('input[name=menu]');
  await page.click('#go');
  assert.match(await page.textContent('#msg'), /이름을/, '이름 없이 제출하면 안내');
  await page.fill('#name', `김정선${width}`); await page.click('#go');
  assert.match(await page.textContent('#msg'), /메뉴를/, '메뉴 없이 제출하면 안내');
  await page.click('text=곤드레솥밥'); await page.click('#go');
  await page.waitForFunction(() => /접수/.test(document.getElementById('msg').textContent));
  const t = await page.evaluate(() => ({ total: document.getElementById('total').textContent, tally: document.getElementById('tally').innerText, over: document.documentElement.scrollWidth > innerWidth + 1 }));
  assert.match(t.tally, new RegExp(`김정선${width}`)); assert.ok(!t.over, `${width}px 에서 옆으로 넘침`);
  console.log(`✅ ${width}px: ${await page.textContent('#msg')} / ${t.total}`);
  await page.screenshot({ path: `/tmp/lunch-${width}.png`, fullPage: true });
}
await browser.close();
if (fail) process.exit(1);
