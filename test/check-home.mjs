// 들머리 화면(/home) 점검: 각 사이트로 가는 링크 네 개, 메뉴 아래 주소와 복사 단추(누르면 전체 주소가 클립보드에), 다른 파일을 불러오지 않는지
// 실행: node test/check-home.mjs   (playwright 필요, 크롬은 CHROME=경로, 인터넷 불필요)
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const html = fs.readFileSync(new URL('../public/home.html', import.meta.url), 'utf8');
const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*><b>([^<]+)<\/b>/g)].map(m => m[1] + ' ' + m[2]);
assert.deepEqual(links, ['/view 시간표 보기', '/dg 대강 신청', '/winter 교실 → 실습실 수업 장소 이동', '/ 관리자 (교체 탐색기) · 비밀번호 필요']);
assert.ok(html.includes('<h1>울산에너지고 시간표</h1>'));
assert.ok(!/<script src|<link rel="stylesheet|<img|@import|url\(/.test(html), '스크립트·글꼴·그림 파일을 불러오지 않음(앱 설치 정보와 아이콘만 연결)');
// 앱으로 설치: 교체 탐색기와 다른 앱으로 잡히도록 id·이름·시작 주소가 따로 있어야 함
{ const m = JSON.parse(fs.readFileSync(new URL('../public/home.webmanifest', import.meta.url), 'utf8')), main = JSON.parse(fs.readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));
  assert.ok(html.includes('<link rel="manifest" href="/home.webmanifest">'));
  assert.deepEqual([m.id, m.name, m.start_url, m.display], ['/home', '울산에너지고 시간표', '/home', 'standalone']); assert.notEqual(m.name, main.name);
  for (const i of m.icons) { const b = fs.readFileSync(new URL('../public' + i.src, import.meta.url)); assert.equal(b.readUInt32BE(16) + 'x' + b.readUInt32BE(20), i.sizes, i.src + ' 크기'); } }
assert.ok(html.length < 9000, '9KB 미만');
for (const f of ['dg.html', 'winter.html']) assert.ok(fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8').includes('<a class="home" href="/home">← 울산에너지고 시간표</a>'), f + ' 에 돌아가기 링크');
// 교체 탐색기에는 신청 사이트 탭을 두지 않는다(무거워지지 않게)
assert.ok(!/tabBtn-(dgsite|winter|viewsite)|<iframe/.test(fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')), '교체 탐색기에 신청 사이트 탭·iframe 이 없음');

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: html }));
await page.goto('https://time.fake.test/home');
assert.deepEqual(await page.locator('.addr span').allTextContents(), ['time.fake.test/view', 'time.fake.test/dg', 'time.fake.test/winter', 'time.fake.test/'], '메뉴 아래에 주소');
assert.equal(await page.locator('.copy svg rect').count(), 4, '복사 단추 그림: 겹친 네모');
for (const [i, want] of [[0, '/view'], [1, '/dg'], [2, '/winter'], [3, '/']]) {
  await page.locator('.copy').nth(i).click();
  await page.waitForFunction(i => document.querySelectorAll('.addr em')[i].textContent === '복사했습니다', i);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://time.fake.test' + want);
}
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, '폰에서 옆으로 넘치지 않음');
assert.deepEqual(errs, []);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-home.png' });
await browser.close();
console.log('✅ 들머리 화면 점검 통과');
