// 대강 신청 화면(/dg)이 폰 폭에서 옆으로 넘기지 않고 다 보이는지 점검
// 실행: node test/check-dg-phone.mjs   (playwright 필요, 크롬은 CHROME=경로). 실제 칸 목록(src/worker.js 의 DG)으로 그림
import { createRequire } from 'node:module';
import fs from 'node:fs';
import worker from '../src/worker.js';
const { chromium } = createRequire(import.meta.url)('playwright');

const HTML = fs.readFileSync(new URL('../public/dg.html', import.meta.url), 'utf8');
// 가짜 D1: 신청 1건(긴 이름-과목, 이 기기 신청이라 수정·취소 단추까지 보임)
const signups = [{ slot: '목4|1신1', label: '남궁민수-신재생에너지', at: '11-13 15:33:20', mine: 1 }];
const env = { DG: { prepare: () => ({ bind: () => ({ all: async () => ({ results: signups }) }) }) } };
const apiBody = await (await worker.fetch(new Request('http://x/api/dg'), env)).text();

let fail = 0;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
for (const width of [360, 390, 1100]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  await page.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/dg') return r.fulfill({ contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/dg') return r.fulfill({ contentType: 'application/json', body: apiBody });
    return r.abort();
  });
  await page.goto('http://fake.test/dg'); await page.waitForSelector('#tbl table');
  const r = await page.evaluate(() => ({
    days: [...document.querySelectorAll('#tbl h2')].map(h => h.textContent),
    over: [...document.querySelectorAll('.wrap')].filter(w => w.scrollWidth > w.clientWidth + 1).length + (document.documentElement.scrollWidth > innerWidth + 1 ? 1 : 0),
    btns: document.querySelectorAll('#tbl button[data-slot]').length,
    mine: !!document.querySelector('#tbl button[data-del="목4|1신1"]'),
  }));
  const ok = r.over === 0 && r.days.join() === '11/18(수),11/19(목)' && r.btns === 12 && r.mine;
  console.log(`${ok ? '✅' : '❌'} 폭 ${width}px: 날짜별 표 ${r.days.join('·')}, 옆으로 넘치는 곳 ${r.over}, 신청 단추 ${r.btns}, 내 신청 취소 단추 ${r.mine}`);
  if (!ok) fail++;
  if (width === 390) await page.screenshot({ path: '/tmp/dg-390.png', fullPage: true });
  await page.close();
}
await browser.close();
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
process.exit(fail ? 1 : 0);
