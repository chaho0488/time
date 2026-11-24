// 교체 탐색기의 '대강 신청'·'실습실 이동' 탭 점검: 탭을 누르면 그 신청 사이트(/dg, /winter)가 화면 안에 열리고, 다른 탭으로 돌아갈 수 있는지
// 실행: node test/check-site-tabs.js   (playwright 필요, 가짜 서버라 인터넷·클라우드 불필요)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
let fail = 0;
const ok = (name, cond, info) => { console.log(`${cond ? '✅' : '❌'} ${name}`, cond ? '' : JSON.stringify(info)); if (!cond) fail++; };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  await page.route('**/*', r => { const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({ contentType: 'text/html', body: HTML });
    if (p === '/dg' || p === '/winter' || p === '/view') return r.fulfill({ contentType: 'text/html', body: `<h1>site ${p}</h1>` });
    return r.abort(); });
  await page.goto('http://fake.test/'); await page.waitForTimeout(500);
  const st = () => page.evaluate(() => ({ panes: [...document.querySelectorAll('.tab-pane.active')].map(e => e.id).join(), btns: [...document.querySelectorAll('.hdr-tab.active')].map(e => e.id).join(),
    src: ['dgsite', 'winter'].map(t => document.querySelector('#tab-' + t + ' iframe').getAttribute('src') || '').join('|') }));
  let s = await st();
  ok('처음에는 교체 탐색 탭이고 신청 사이트는 아직 불러오지 않음', s.panes === 'tab-swap' && s.src === '|', s);
  ok('탭 이름: 대강 신청·실습실 이동', (await page.textContent('#tabBtn-dgsite')) === '대강 신청' && (await page.textContent('#tabBtn-winter')) === '실습실 이동');
  await page.evaluate(() => switchTab('winter')); s = await st();
  const h = await page.frameLocator('#tab-winter iframe').locator('h1').textContent();
  const box = await page.locator('#tab-winter iframe').boundingBox();
  ok('실습실 이동 탭: /winter 가 화면 안에 크게 열림', s.panes === 'tab-winter' && s.btns === 'tabBtn-winter' && s.src === '|/winter' && h === 'site /winter' && box.height > 500 && box.width > 1000, { s, h, box });
  await page.evaluate(() => switchTab('dgsite')); s = await st();
  ok('대강 신청 탭: /dg 가 열림', s.panes === 'tab-dgsite' && s.btns === 'tabBtn-dgsite' && s.src.startsWith('/dg|') && (await page.frameLocator('#tab-dgsite iframe').locator('h1').textContent()) === 'site /dg', s);
  await page.evaluate(() => switchTab('viewsite'));
  ok('시간표 조회 탭: /view 가 열림', (await page.textContent('#tabBtn-viewsite')) === '시간표 조회' && (await page.evaluate(() => document.querySelector('.tab-pane.active').id + '|' + document.querySelector('#tab-viewsite iframe').getAttribute('src'))) === 'tab-viewsite|/view' && (await page.frameLocator('#tab-viewsite iframe').locator('h1').textContent()) === 'site /view');
  await page.evaluate(() => switchTab('swap')); s = await st();
  ok('교체 탐색 탭으로 돌아옴', s.panes === 'tab-swap' && s.btns === 'tabBtn-swap', s);
  await browser.close();
  console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
  process.exit(fail ? 1 : 0);
})();
