// 들머리 화면(/home) 점검: 각 사이트로 가는 링크 네 개가 맞는 주소로 걸려 있고, 다른 파일을 불러오지 않는지(가볍게 열림)
// 실행: node test/check-home.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('../public/home.html', import.meta.url), 'utf8');
const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*><b>([^<]+)<\/b>/g)].map(m => m[1] + ' ' + m[2]);
assert.deepEqual(links, ['/view 시간표 보기', '/dg 대강 신청', '/winter 교실 → 실습실 수업 장소 이동', '/ 관리자 (교체 탐색기) · 비밀번호 필요']);
assert.ok(html.includes('<h1>울산에너지고 시간표</h1>'));
assert.ok(!/<script|<link|<img|@import|url\(/.test(html), '스크립트·글꼴·그림을 불러오지 않음');
assert.ok(html.length < 4000, '4KB 미만');
for (const f of ['dg.html', 'winter.html']) assert.ok(fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8').includes('<a class="home" href="/home">← 울산에너지고 시간표</a>'), f + ' 에 돌아가기 링크');
console.log('✅ 들머리 화면 점검 통과');
