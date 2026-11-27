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
const env = { DG: D1, APP_PW: 'pw', ASSETS: { fetch: q => new Response('asset ' + new URL(q.url).pathname) } };
const api = (method, body, q = '') => worker.fetch(new Request('https://x/api/lunch' + q, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }), env)
  .then(async r => ({ status: r.status, ...(await r.json()) }));

let r = await api('GET');
assert.deepEqual(r.menus, ['전복솥밥', '갈비솥밥', '곤드레솥밥', '식사 불참']); assert.equal(r.list, undefined, '주문 화면용 조회에는 내역 없음');
r = await api('POST', { name: ' 홍 길동 ', menu: '갈비솥밥' });
assert.ok(r.ok); assert.equal(r.name, '홍길동', '띄어쓰기는 지움');
r = await api('POST', { name: '홍길동', menu: '전복솥밥' });
assert.ok(r.ok);
r = await api('GET');
assert.ok(!JSON.stringify(r).includes('홍길동'), '주문 화면용 조회에 이름이 나가지 않음');
r = await api('GET', null, '?all=1');
assert.equal(r.list.length, 1, '같은 이름은 한 사람'); assert.equal(r.list[0].menu, '전복솥밥', '다시 내면 메뉴가 바뀜');
assert.equal((await api('POST', { name: '이몽룡', menu: '짜장면' })).status, 400, '목록에 없는 메뉴 거절');
assert.equal((await api('POST', { name: '   ', menu: '갈비솥밥' })).status, 400, '빈 이름 거절');
assert.equal((await api('POST', { name: '가'.repeat(21), menu: '갈비솥밥' })).status, 400, '너무 긴 이름 거절');
assert.equal((await api('PUT', {})).status, 405);
assert.equal(await (await worker.fetch(new Request('https://x/lunch/admin'), env)).text(), 'asset /lunch', '/lunch/admin 은 같은 화면');
console.log('✅ API 규칙');

// 화면: 실제 worker + 위 가짜 D1 로 응답
let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { console.log('⚠ playwright 없음 — 화면 점검 건너뜀'); process.exit(0); }
const HTML = fs.readFileSync(new URL('../public/lunch.html', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
let fail = 0;
async function open(path, width) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  await page.route('**/*', async rt => {
    const q = rt.request(), u = new URL(q.url());
    if (u.pathname.startsWith('/lunch')) return rt.fulfill({ contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/lunch') {
      const res = await worker.fetch(new Request('https://x/api/lunch' + u.search, { method: q.method(), headers: q.headers(), body: q.postData() || undefined }), env);
      return rt.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    }
    return rt.abort();
  });
  await page.goto('http://fake.test' + path);
  return page;
}
const noOver = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
for (const width of [360, 1100]) {
  let page = await open('/lunch', width);
  await page.waitForSelector('input[name=menu]');
  await page.click('#go');
  assert.match(await page.textContent('#msg'), /이름을/, '이름 없이 제출하면 안내');
  await page.fill('#name', `김정선${width}`); await page.click('#go');
  assert.match(await page.textContent('#msg'), /메뉴를/, '메뉴 없이 제출하면 안내');
  await page.click('text=곤드레솥밥'); await page.click('#go');
  await page.waitForFunction(() => /접수/.test(document.getElementById('msg').textContent));
  assert.ok(!(await page.evaluate(() => document.body.innerText)).includes('홍길동'), '주문 화면에 다른 사람 이름이 없음');
  assert.ok(await noOver(page), `${width}px 주문 화면 넘침`);
  console.log(`✅ ${width}px 주문: ${await page.textContent('#msg')}`);
  await page.screenshot({ path: `/tmp/lunch-${width}.png`, fullPage: true });
  await page.reload(); await page.waitForSelector('input[name=menu]:checked');
  assert.equal(await page.inputValue('#name'), `김정선${width}`, '다시 열면 이름·메뉴가 채워짐');

  page = await open('/lunch/admin', width);
  await page.waitForFunction(() => /기준/.test(document.getElementById('when').textContent));
  const t = await page.textContent('#tally');
  assert.match(t, new RegExp(`김정선${width}`)); assert.match(t, /홍길동/);
  assert.ok(await page.isHidden('#order'), '결과 화면에는 주문 칸 없음');
  assert.ok(await noOver(page), `${width}px 결과 화면 넘침`);
  console.log(`✅ ${width}px 결과: 식사 ${await page.textContent('#eat')} · 불참 ${await page.textContent('#skip')}`);
  await page.screenshot({ path: `/tmp/lunch-admin-${width}.png`, fullPage: true });
}
await browser.close();
if (fail) process.exit(1);
