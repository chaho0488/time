// 대강 신청(/api/dg) 점검: 실제 D1 대신 node:sqlite 로 같은 표를 만들어 Worker 를 직접 부른다(인터넷 불필요).
// 실행: node test/check-dg.mjs
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

// D1 흉내: prepare().bind().run()/all()/first() 만
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE dg (slot TEXT PRIMARY KEY, period TEXT NOT NULL, who TEXT NOT NULL, label TEXT NOT NULL, at TEXT NOT NULL, UNIQUE(period, who))');
const D1 = {
  prepare(sql) {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      async run() { db.prepare(sql).run(...args); return {}; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async first() { return db.prepare(sql).get(...args) || null; },
    };
    return st;
  },
};
const env = { DG: D1, APP_PW: 'pw', ASSETS: { fetch: () => new Response('asset') } };
const call = (method, body, headers = {}, q = '') =>
  worker.fetch(new Request('https://x/api/dg' + q, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) }), env)
    .then(async r => ({ status: r.status, ...(await r.json()) }));

let r = await call('GET');
assert.equal(r.rows.length, 7);
assert.equal([...r.rows].reduce((n, [, c]) => n + Object.keys(c).length, 0), 13, '대강 칸 13개');
assert.deepEqual(Object.fromEntries(r.rows)['2전2'], { 수7: '영어', 목4: '영어' }, '2전2 영어는 수6이 아니라 수7');
assert.ok(!/김동후|이희섭|김성민/.test(JSON.stringify(r)), '공개 API에 교사 이름이 없어야 함');

r = await call('POST', { slot: '수5|1신2', label: ' 홍 길동 - 수학 ' });
assert.ok(r.ok); assert.equal(r.label, '홍길동-수학');

r = await call('POST', { slot: '수5|1신2', label: '이몽룡-국어' });
assert.equal(r.status, 409, '먼저 신청된 칸은 덮어쓸 수 없음'); assert.match(r.error, /홍길동-수학/);

r = await call('POST', { slot: '수5|2신2', label: '홍길동-체육' });
assert.equal(r.status, 409, '같은 교시 두 칸 금지'); assert.match(r.error, /이 교시에 이미/);

r = await call('POST', { slot: '수6|2전2', label: '이몽룡-국어' });
assert.equal(r.status, 400, '수업 없는 칸 금지');
r = await call('POST', { slot: '목3|1신2', label: '이몽룡-국어' });
assert.equal(r.status, 400);
r = await call('POST', { slot: '수5|2신2', label: '이몽룡' });
assert.equal(r.status, 400, '과목 없으면 거절');

r = await call('DELETE', null, { 'X-Pw': 'no' }, '?slot=' + encodeURIComponent('수5|1신2'));
assert.equal(r.status, 401, '비밀번호 없이 취소 금지');
r = await call('DELETE', null, { 'X-Pw': 'pw' }, '?slot=' + encodeURIComponent('수5|1신2'));
assert.ok(r.ok);
r = await call('GET');
assert.equal(r.signups.length, 0);

// 동시에 같은 칸을 누른 경우: 하나만 성공
const rs = await Promise.all(['가-가', '나-나', '다-다'].map(l => call('POST', { slot: '목2|2전3', label: l })));
assert.equal(rs.filter(x => x.ok).length, 1);

console.log('대강 신청 점검 통과');
