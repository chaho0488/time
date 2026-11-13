// 관리자 앱 잠금 화면 점검: 비밀번호를 서버에서 확인하기 전에는 어떤 칸도 볼 수 없어야 함
// 실행: node test/check-gate.js   (playwright 필요, 크롬은 CHROME=경로 로 지정 가능). 가짜 서버로 돌아감
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const PW = 'right-pw';
let online = true;
let fail = 0;
const ok = (name, cond, info = '') => { console.log(`${cond ? '✅' : '❌'} ${name}`, cond ? '' : info); if (!cond) fail++; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', e => { console.log('❌ 페이지 오류', e.message); fail++; });
  await page.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/' || u.pathname === '/view') return r.fulfill({ contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/view') return r.fulfill({ contentType: 'application/json', body: '{"swHist":[],"dgHist":[]}' });
    if (u.pathname === '/api/data') {
      if (!online) return r.abort();
      return r.request().headers()['x-pw'] === PW ? r.fulfill({ contentType: 'application/json', body: 'null' }) : r.fulfill({ status: 401, body: '{}' });
    }
    return r.abort();
  });
  // 화면 가운데·구석 몇 곳이 모두 잠금 화면에 덮였는지 (덮였으면 결강교사·시간표 칸을 누를 수 없음)
  const covered = () => page.evaluate(() => [[5, 5], [innerWidth / 2, innerHeight / 2], [innerWidth - 5, innerHeight - 5], [100, 300]]
    .every(([x, y]) => !!document.elementFromPoint(x, y).closest('#appGate')));
  const gateOpen = () => page.evaluate(() => { const g = document.getElementById('appGate'); return !!g && getComputedStyle(g).display !== 'none'; });

  // 1) 처음 연 기기(비밀번호 없음)
  await page.goto('http://fake.test/'); await page.evaluate(() => localStorage.clear());
  await page.goto('http://fake.test/'); await page.waitForTimeout(1500);
  ok('비밀번호 없으면 화면 전체가 가려짐', await covered());
  ok("'나중에' 단추가 없음", !(await page.evaluate(() => [...document.querySelectorAll('#appGate button')].some(b => b.offsetParent && b.textContent.includes('나중에')))));
  ok('취소 단추도 안 보임', await page.evaluate(() => getComputedStyle(document.getElementById('gateCancel')).display === 'none'));
  await page.keyboard.press('Escape'); await page.mouse.click(5, 5);
  ok('Esc·바깥 클릭으로 안 닫힘', await covered());

  // 2) 틀린 비밀번호
  await page.fill('#gatePw', 'wrong'); await page.press('#gatePw', 'Enter'); await page.waitForTimeout(300);
  ok('틀린 비밀번호 → 그대로 잠김', await covered() && (await page.textContent('#gateErr')).includes('맞지 않습니다'));
  ok('틀린 비밀번호는 저장 안 함', await page.evaluate(() => !localStorage.getItem('tt_cloud_pw')));

  // 3) 인터넷 없음
  online = false;
  await page.fill('#gatePw', PW); await page.press('#gatePw', 'Enter'); await page.waitForTimeout(300);
  ok('오프라인에서 처음 입력 → 확인 못 하므로 잠김', await covered() && (await page.textContent('#gateErr')).includes('인터넷'));
  online = true;

  // 4) 맞는 비밀번호
  await page.fill('#gatePw', PW); await page.click('#appGate .tt-lock-btn'); await page.waitForTimeout(500);
  ok('맞는 비밀번호 → 열림', !(await gateOpen()));
  ok('맞는 비밀번호 저장', await page.evaluate(pw => localStorage.getItem('tt_cloud_pw') === pw, PW));

  // 5) ☁ 단추로 다시 열면 취소 가능
  await page.evaluate(() => cloudAskPw());
  ok('☁ 단추로 다시 입력: 잠금 화면 + 취소 단추', await gateOpen() && await page.isVisible('#gateCancel'));
  await page.click('#gateCancel');
  ok('취소하면 다시 열림', !(await gateOpen()));

  // 6) 확인된 비밀번호가 있는 기기: 다시 열면 바로 보임, 오프라인에서도
  online = false;
  await page.goto('http://fake.test/'); await page.waitForTimeout(800);
  ok('저장된 비밀번호 + 오프라인 → 바로 열림', !(await gateOpen()));
  online = true;

  // 7) 저장된 비밀번호가 틀려진 경우(비밀번호 변경 등) → 서버 401 → 다시 잠김, 취소 없음
  await page.evaluate(() => localStorage.setItem('tt_cloud_pw', 'old-pw'));
  await page.goto('http://fake.test/'); await page.waitForTimeout(1500);
  ok('저장된 비밀번호가 틀리면 다시 잠김', await covered() && !(await page.isVisible('#gateCancel')));

  // 8) 조회용 /view 는 잠금 없음
  await page.goto('http://fake.test/view'); await page.waitForTimeout(800);
  ok('조회용(/view)은 잠금 화면 없음', await page.evaluate(() => !document.getElementById('appGate')));

  await browser.close();
  console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 모두 통과');
  process.exit(fail ? 1 : 0);
})();
