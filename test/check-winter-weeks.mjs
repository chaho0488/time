// /winter 주 바꾸기 점검: 이번 주뿐 아니라 다음 주·그 뒤 주도 신청되고, 주마다 따로 보이는지
// 실제 Worker 코드와 가짜 D1·KV 로 확인. 실행: node test/check-winter-weeks.mjs   (playwright 필요, 크롬은 CHROME=경로, 인터넷 불필요)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import worker from '../src/worker.js';
import { fakeEnv } from './check-winter.mjs';
Date.now = () => Date.parse('2026-11-25T03:00:00Z');   // 기준일: 2026-11-25(수) — 이번 주 = 11/23~11/27
const { chromium } = createRequire(import.meta.url)('playwright');
const HTML = fs.readFileSync(new URL('../public/winter.html', import.meta.url), 'utf8');
const env = fakeEnv();
let fail = 0;
const ok = (name, cond, info) => { console.log(`${cond ? '✅' : '❌'} ${name}`, cond ? '' : JSON.stringify(info)); if (!cond) fail++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
page.on('dialog', d => d.accept());
await page.route('**/*', async r => {
  const q = r.request(), u = new URL(q.url());
  if (u.pathname === '/winter') return r.fulfill({ contentType: 'text/html', body: HTML });
  if (u.pathname !== '/api/winter') return r.abort();
  const res = await worker.fetch(new Request(q.url(), { method: q.method(), headers: q.headers(), body: q.postData() || undefined }), env);
  return r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
});
const reqs = async () => (await (await worker.fetch(new Request('https://x/api/winter'), env)).json()).reqs.map(r => `${r.wk} ${r.slot} ${r.room}`);
const st = () => page.evaluate(() => ({ from: document.getElementById('from').value, head: [...document.querySelectorAll('#mytt thead th')].map(t => t.textContent).join(' '),
  hint: document.querySelector('#mytt .hint').textContent, blocked: [...document.querySelectorAll('#mytt td.lab small')].filter(t => /다음 주|시작일 전/.test(t.textContent)).length,
  prevOff: document.querySelector('#weekBtns [data-week="prev"]').disabled, thisOn: document.querySelector('#weekBtns [data-week="this"]').getAttribute('aria-pressed'),
  mon1: document.querySelector('#mytt [data-slot="월1"]') ? document.querySelector('#mytt [data-slot="월1"]').textContent : '', wed4: document.querySelector('#mytt [data-slot="수4"]').textContent }));
const week = w => page.click(`#weekBtns [data-week="${w}"]`);
const apply = async (slot, room) => { await page.click(`#mytt button[data-slot="${slot}"]`); await page.click(`#pop .pr[data-room="${room}"]`); await page.waitForFunction(() => /신청되었습니다/.test(document.getElementById('msg').textContent));
  await page.evaluate(() => { if (document.getElementById('moreNo')) document.getElementById('moreNo').click(); document.getElementById('msg').textContent = ''; }); };

await page.goto('https://fake.test/winter'); await page.waitForSelector('#grid .plan');
await page.fill('#teacher', '성준혁'); await page.click('#tlist button'); await page.click('#noticeOk');
let v = await st();
ok('처음은 이번 주(11/23~11/27): 시작일 11/25, 월·화 8칸은 막힘, "앞 주"는 꺼짐', v.from === '2026-11-25' && v.head.includes('수11/25') && v.blocked === 8 && v.prevOff && v.thisOn === 'true' && v.hint.includes('이번 주(11/23(월)~11/27(금)) 수업을 신청합니다'), v);
await apply('수4', '2D');

await week('next'); v = await st();
ok('"다음 주": 시작일 11/30(월), 머리줄 11/30~12/4, 월·화 수업도 모두 고를 수 있음, 이번 주 신청(수4)은 이 주에는 없음', v.from === '2026-11-30' && v.head.includes('월11/30') && v.head.includes('금12/4') && v.blocked === 0 && !v.prevOff && v.thisOn === 'false' && v.mon1.includes('과학') && v.wed4.includes('과학') && v.hint.includes('다음 주(11/30(월)~12/4(금)) 수업을 신청합니다'), v);
await apply('월1', '2D'); await apply('수4', '2D');   // 같은 수4·같은 실이지만 주가 달라 신청됨

await week('next'); v = await st();
ok('한 번 더 "다음 주": 12/7 주(주 제한 없음)', v.from === '2026-12-07' && v.head.includes('월12/7') && v.hint.includes('12/7 주(12/7(월)~12/11(금)) 수업을 신청합니다') && v.wed4.includes('과학'), v);
await apply('수4', '3B');
ok('저장: 주마다 따로(이번 주 수4, 다음 주 월1·수4, 12/7 주 수4)', (await reqs()).join() === '2026-11-23 수4 2D,2026-11-30 월1 2D,2026-11-30 수4 2D,2026-12-07 수4 3B', await reqs());

await week('prev'); v = await st();
ok('"앞 주": 11/30 주로 돌아오고 그 주 신청 2건이 초록색(실 이름)으로 보임', v.from === '2026-11-30' && v.mon1.includes('2D') && v.wed4.includes('2D'), v);
const mine = await page.evaluate(() => document.querySelector('#mytt .mine b').textContent);
ok('아래 "실습실에서 하는 수업"도 보고 있는 주의 것만(2건)', mine.includes('2건'), mine);
await week('this'); v = await st();
ok('"이번 주": 11/25로 돌아옴, 이번 주 신청(수4 → 2D)만 보임', v.from === '2026-11-25' && v.wed4.includes('2D') && v.blocked === 8 && v.prevOff, v);

// 실습실 시간표: 보는 날짜가 속한 주의 신청만
const strip = async iso => { await page.fill('#vdate', iso); await page.dispatchEvent('#vdate', 'change'); await page.click('#grid .pr[data-plan="2D"]'); const t = await page.evaluate(() => [...document.querySelectorAll('#rpop .strip li.done')].map(l => l.textContent).join(' | ')); await page.click('#rpopClose'); return t; };
const a = await strip('2026-11-30'), b = await strip('2026-12-09'), c = await strip('2026-12-14');
ok('실습실 시간표 2D: 11/30(월)에는 월1 신청, 12/9(수, 12/7 주)에는 없음(그 주 수4는 3B), 12/14 주에도 없음', a.includes('1신1') && b === '' && c === '', { a, b, c });
// 신청 내역: 다른 주 신청에는 주 표시
await page.click('#tabList'); await page.click('#list button[data-open]');
const det = await page.evaluate(() => [...document.querySelectorAll('#list tr.d tbody tr')].map(t => t.children[3].textContent));
ok('신청 내역: 이번 주 → 다음 주 → 12/7 주 순, 뒤 주에는 주 이름 표시', det.length === 4 && !det[0].includes('주') && det[1].includes('다음 주') && det[2].includes('다음 주') && det[3].includes('12/7 주'), det);
// 신청 내역 '자세히'에서 한 건씩 골라 취소
{ const boxes = await page.locator('#list input[data-one]').count();
  await page.check('#list tr.d tbody tr:nth-child(2) input[data-one]');
  let s1 = await page.evaluate(() => ({ btn: document.getElementById('bulkDel').textContent, some: document.querySelector('#list input[data-pick]').indeterminate, all: document.getElementById('pickAllReq').checked }));
  ok('자세히 줄마다 선택 칸(4개). 한 건만 고르면 "선택한 신청 취소 (1건)", 교사 줄 칸은 일부 선택(−) 표시', boxes === 4 && s1.btn === '선택한 신청 취소 (1건)' && s1.some && !s1.all, { boxes, ...s1 });
  await page.check('#list input[data-pick]'); s1 = await page.textContent('#bulkDel');
  await page.uncheck('#list input[data-pick]'); const s0 = await page.textContent('#bulkDel');
  ok('교사 줄 칸은 그 교사 신청 전체(4건)를 고르고 풀기', s1 === '선택한 신청 취소 (4건)' && s0 === '선택한 신청 취소', { s1, s0 });
  await page.check('#list tr.d tbody tr:nth-child(2) input[data-one]'); await page.click('#bulkDel'); await page.waitForFunction(() => document.querySelectorAll('#list tr.d tbody tr').length === 3);
  ok('고른 한 건(다음 주 월1)만 취소되고 나머지 3건은 남음', (await reqs()).join() === '2026-11-23 수4 2D,2026-11-30 수4 2D,2026-12-07 수4 3B', await reqs()); }
if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT + '-list.png' }); await page.click('#tabPlan'); await week('next'); await page.screenshot({ path: process.env.SHOT + '-next.png' }); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: process.env.SHOT + '-next-ph.png' }); }
await browser.close();
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
process.exit(fail ? 1 : 0);
