// 대강 신청 관리자 기능 점검: 날짜·결강 교사(여러 명)로 표 만들기, 표에 추가, 마감, 지난 내용 초기화 — API 와 화면
// 실행: node test/check-dg-admin.mjs   (playwright 필요, 크롬은 CHROME=경로, 인터넷 불필요)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { fakeEnv } from './check-winter.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const env = fakeEnv();
await env.DG.prepare('CREATE TABLE dg (slot TEXT PRIMARY KEY, period TEXT NOT NULL, who TEXT NOT NULL, label TEXT NOT NULL, at TEXT NOT NULL, dev TEXT, UNIQUE(period, who))').run();
const call = (method, body, headers = {}, q = '') => worker.fetch(new Request('https://x/api/dg' + q, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env)
  .then(async r => ({ status: r.status, ...(await r.json()) }));
const PW = { 'X-Pw': 'pw' }, A = { 'X-Dev': 'a'.repeat(20) };
const tt = (await (await worker.fetch(new Request('https://x/api/winter'), env)).json()).tt;
const lessons = (t, day) => Object.keys(tt[t]).filter(k => k[0] === day).sort();
const [t1, t2] = Object.keys(tt).filter(t => lessons(t, '금').length >= 2);   // 금요일 수업이 있는 교사 두 명

// ── API ──
let r = await call('GET');
assert.ok(r.cols.length > 0 && !r.admin && !('teachers' in r) && !('absent' in r), '처음에는 코드에 적힌 표, 관리자 정보는 내보내지 않음');
assert.equal((await call('PUT', { date: '2026-11-27', teachers: [t1] }, A)).status, 401, '비밀번호 없이 표를 만들 수 없음');
assert.equal((await call('DELETE', null, A, '?all=1')).status, 401, '비밀번호 없이 초기화할 수 없음');
assert.equal((await call('PUT', { date: '2026-11-28', teachers: [t1] }, PW)).status, 400, '토요일');
assert.equal((await call('PUT', { date: '2026-11-27', teachers: [] }, PW)).status, 400, '교사 없음');
assert.equal((await call('PUT', { date: '2026-11-27', teachers: ['없는사람'] }, PW)).status, 400, '목록에 없는 교사');
r = await call('PUT', { date: '2026-11-27', teachers: [t1, t2] }, PW);   // 11/27(금), 두 명
assert.equal(r.status, 200); assert.equal(r.title, '11/27(금) 대강 신청 (선착순)');
r = await call('GET');
const want = new Set([...lessons(t1, '금'), ...lessons(t2, '금')].map(k => '1127금' + k[1]));
assert.deepEqual(r.cols.map(c => c[0]), [...want].sort(), '두 교사의 금요일 수업 교시가 모두 칸으로');
assert.ok(r.cols.every(c => /^11\/27\(금\) [1-7]교시$/.test(c[1])));
for (const t of [t1, t2]) for (const k of lessons(t, '금')) { const [cls, subj] = tt[t][k].split('|'); assert.equal(r.rows.find(x => x[0] === cls)[1]['1127금' + k[1]], subj, `${t} ${k} ${cls} ${subj}`); }
assert.ok(!JSON.stringify(r).includes(t1), '결강 교사 이름은 공개 응답에 없음');
r = await call('GET', null, PW);
assert.deepEqual(r.absent, [`11/27(금) ${t1}`, `11/27(금) ${t2}`]); assert.ok(r.admin && r.teachers.includes(t1), '관리자에게는 결강 교사·교사 목록');
// 신청 → 표에 추가(신청 유지) → 새 표(신청 지움)
const slot = `${r.cols[0][0]}|${r.rows.find(x => x[1][r.cols[0][0]])[0]}`;
assert.equal((await call('POST', { slot, label: '홍길동-수학' }, A)).status, 200);
const t3 = Object.keys(tt).find(t => lessons(t, '월').length);
r = await call('PUT', { date: '2026-11-30', teachers: [t3], add: true }, PW);
assert.equal(r.status, 200); assert.equal(r.title, '11/27(금)·11/30(월) 대강 신청 (선착순)');
r = await call('GET');
assert.equal(r.signups.length, 1, '표에 추가해도 신청은 그대로'); assert.ok(r.cols.some(c => c[0].startsWith('1130월')));
assert.equal((await call('PUT', { date: '2026-11-30', teachers: [t3], add: true }, PW)).status, 400, '이미 있는 칸만이면 추가할 것이 없음');
// 마감
assert.equal((await call('PUT', { closed: true }, PW)).closed, true);
assert.equal((await call('GET')).closed, true);
assert.equal((await call('DELETE', null, A, '?slot=' + encodeURIComponent(slot))).status, 403, '마감 뒤에는 신청한 기기도 취소 불가');
assert.equal((await call('PUT', { closed: false }, PW)).closed, false);
// 새 표: 지난 신청 지움
assert.equal((await call('PUT', { date: '2026-11-30', teachers: [t3] }, PW)).status, 200);
r = await call('GET'); assert.equal(r.signups.length, 0, '새 표를 만들면 지난 신청이 지워짐'); assert.ok(r.cols.every(c => c[0].startsWith('1130월')));
// 초기화
assert.equal((await call('POST', { slot: `${r.cols[0][0]}|${r.rows.find(x => x[1][r.cols[0][0]])[0]}`, label: '홍길동-수학' }, A)).status, 200);
assert.equal((await call('DELETE', null, PW, '?all=1')).status, 200);
r = await call('GET'); assert.deepEqual([r.cols, r.rows, r.signups, r.title], [[], [], [], '대강 신청'], '초기화: 표·신청 모두 비움');
console.log('✅ /api/dg 관리자 기능 점검 통과');

// ── 화면 ──
let fail = 0;
const ok = (name, cond, info) => { console.log(`${cond ? '✅' : '❌'} ${name}`, cond ? '' : JSON.stringify(info)); if (!cond) fail++; };
const HTML = fs.readFileSync(new URL('../public/dg.html', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
const asked = []; page.on('dialog', d => { asked.push(d.message()); return d.accept(); });
await page.route('**/*', async q => { const rq = q.request(), u = new URL(rq.url());
  if (u.pathname === '/dg') return q.fulfill({ contentType: 'text/html', body: HTML });
  if (u.pathname !== '/api/dg') return q.abort();
  const res = await worker.fetch(new Request(rq.url(), { method: rq.method(), headers: rq.headers(), body: rq.postData() || undefined }), env);
  return q.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() }); });
await page.goto('https://fake.test/dg'); await page.waitForSelector('#tbl .box');
ok('초기화된 상태: "지금 받고 있는 대강 신청이 없습니다", 관리자 칸은 숨김', (await page.textContent('#tbl')).includes('지금 받고 있는 대강 신청이 없습니다') && await page.evaluate(() => document.getElementById('adminBox').hidden));
ok('비밀번호 칸 옆에 "관리자 로그인" 단추', (await page.textContent('#login')) === '관리자 로그인' && await page.evaluate(() => !!document.getElementById('login').offsetParent && !document.getElementById('adminOn').offsetParent));
await page.click('#login'); ok('비밀번호 없이 누르면 "비밀번호를 입력해 주세요"', (await page.textContent('#adminMsg')) === '비밀번호를 입력해 주세요');
await page.fill('#pw', '틀림'); await page.waitForTimeout(600);
ok('입력만 하고 단추를 누르지 않으면 아무 일도 없음', await page.evaluate(() => document.getElementById('adminBox').hidden && document.getElementById('adminOn').hidden));
await page.click('#login'); await page.waitForFunction(() => document.getElementById('adminMsg').textContent.includes('맞지'));
ok('틀린 비밀번호: "비밀번호가 맞지 않습니다", 관리자 칸은 열리지 않음', await page.evaluate(() => document.getElementById('adminBox').hidden && document.getElementById('adminOn').hidden));
ok('한글로 친 비밀번호는 "한/영 키를 확인해 주세요"', (await page.textContent('#adminMsg')).includes('한/영 키'));
await page.fill('#pw', 'wrong'); await page.click('#login'); await page.waitForFunction(() => document.getElementById('adminMsg').textContent === '비밀번호가 맞지 않습니다');
ok('영문 틀린 비밀번호: 서버가 확인한 뒤 "비밀번호가 맞지 않습니다"', await page.evaluate(() => document.getElementById('adminBox').hidden));
await page.fill('#pw', 'pw'); await page.press('#pw', 'Enter'); await page.waitForSelector('#adminBox:not([hidden])');
ok('맞는 비밀번호(Enter 도 됨): "관리자 로그인됨"과 로그아웃 단추, 입력 칸은 숨음', await page.evaluate(() => document.getElementById('adminOn').textContent.includes('관리자 로그인됨') && !!document.getElementById('logout').offsetParent && !document.getElementById('pw').offsetParent && !document.getElementById('adminMsg').textContent));
await page.click('#logout'); await page.waitForSelector('#adminBox', { state: 'hidden' });
ok('로그아웃하면 관리자 칸이 닫히고 다시 로그인 단추', await page.evaluate(() => !!document.getElementById('login').offsetParent));
await page.fill('#pw', 'pw'); await page.click('#login'); await page.waitForSelector('#adminBox:not([hidden])');
await page.click('#dNew'); ok('날짜 없이 누르면 "날짜를 골라 주세요"', (await page.textContent('#amsg')) === '날짜를 골라 주세요');
await page.fill('#dDate', '2026-11-27'); await page.fill('#dT', '없는사람'); await page.click('#dAdd');
ok('목록에 없는 이름은 추가되지 않음', (await page.textContent('#amsg')).includes('목록에 없는 교사') && (await page.locator('#dPicked .chip').count()) === 0);
await page.fill('#dT', t1); await page.press('#dT', 'Enter'); await page.fill('#dT', t2); await page.click('#dAdd');
ok('결강 교사를 여러 명 추가(Enter·단추)', (await page.locator('#dPicked .chip').allTextContents()).map(x => x.replace('✕', '')).join() === [t1, t2].join());
await page.click('#dNew'); await page.waitForSelector('#tbl table');
let v = await page.evaluate(() => ({ title: document.getElementById('title').textContent, h2: [...document.querySelectorAll('#tbl h2')].map(e => e.textContent).join(), open: document.querySelectorAll('#tbl td.open').length, msg: document.getElementById('amsg').textContent, now: document.getElementById('dNow').textContent, chips: document.querySelectorAll('#dPicked .chip').length }));
const cells = new Set([t1, t2].flatMap(t => lessons(t, '금').map(k => k + tt[t][k].split('|')[0]))).size;
ok('날짜와 교사를 고르면 그날 수업 칸이 자동으로 만들어짐(제목·칸 수·지금 표 안내)', v.title === '11/27(금) 대강 신청 (선착순)' && v.h2 === '11/27(금)' && v.open === cells && v.msg.startsWith(`${cells}칸을 만들었습니다`) && v.now.includes(t1) && v.now.includes(t2) && v.chips === 0, { v, cells });
await page.fill('#dDate', '2026-11-30'); await page.fill('#dT', t3); await page.click('#dMore'); await page.waitForFunction(() => document.querySelectorAll('#tbl h2').length === 2);
ok('"지금 표에 추가": 다른 날짜가 표 아래에 붙음', (await page.locator('#tbl h2').allTextContents()).join() === '11/27(금),11/30(월)');
await page.click('#dClose'); await page.waitForFunction(() => !document.getElementById('closed').hidden);
ok('"신청 마감하기" → 마감 안내, 단추는 "마감 풀기"', (await page.textContent('#dClose')).startsWith('마감 풀기'));
await page.click('#dClose'); await page.waitForFunction(() => document.getElementById('closed').hidden);
await page.click('#dReset'); await page.waitForFunction(() => document.getElementById('tbl').textContent.includes('지금 받고 있는 대강 신청이 없습니다'));
ok('"지난 내용 초기화": 확인 창 뒤 표가 비워짐', asked.at(-1).startsWith('지난 내용을 초기화할까요?') && (await page.textContent('#amsg')) === '초기화했습니다', asked);
await browser.close();
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
process.exit(fail ? 1 : 0);
