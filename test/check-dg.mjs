// 대강 신청(/api/dg) 점검: 실제 D1 대신 node:sqlite 로 같은 표를 만들어 Worker 를 직접 부른다(인터넷 불필요).
// 실행: node test/check-dg.mjs
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import closedWorker from '../src/worker.js';   // 지금 올라가는 그대로(마감 상태)

// 선착순 규칙 점검은 '신청 받는 중' 상태로 본다: 마감 표시만 false 로 바꾼 사본을 불러온다
const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
assert.ok(src.includes('closed: true'), '마감 표시(closed: true)가 있어야 함');
const tmp = new URL('./.worker-open.mjs', import.meta.url);
writeFileSync(tmp, src.replace('closed: true', 'closed: false'));
const worker = (await import(tmp)).default;
rmSync(tmp);

// D1 흉내: prepare().bind().run()/all()/first() 만
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE dg (slot TEXT PRIMARY KEY, period TEXT NOT NULL, who TEXT NOT NULL, label TEXT NOT NULL, at TEXT NOT NULL, dev TEXT, UNIQUE(period, who))');
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
const call = (method, body, headers = {}, q = '', w = worker) =>
  w.fetch(new Request('https://x/api/dg' + q, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) }), env)
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

// 취소·수정: 신청한 기기(X-Dev) 또는 관리자 비밀번호만
const A = { 'X-Dev': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, B = { 'X-Dev': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
const q = slot => '?slot=' + encodeURIComponent(slot);
r = await call('DELETE', null, {}, q('수5|1신2'));
assert.equal(r.status, 403, '기기 표시 없는 신청(홍길동)은 관리자만 취소');
r = await call('DELETE', null, { 'X-Pw': 'pw' }, q('수5|1신2'));
assert.ok(r.ok);

r = await call('POST', { slot: '목4|1신1', label: '성춘향-과학' }, A);
const at0 = r.at;
r = await call('GET', null, A);
assert.equal(r.signups.find(x => x.slot === '목4|1신1').mine, true, '신청한 기기에는 내 신청으로 보임');
assert.ok(!JSON.stringify(r).includes('aaaaaaaa'), '기기 표시는 응답에 나오면 안 됨');
r = await call('GET', null, B);
assert.equal(r.signups[0].mine, false, '다른 기기에는 내 신청 아님');

r = await call('PATCH', { slot: '목4|1신1', label: '이몽룡-국어' }, B);
assert.equal(r.status, 403, '다른 기기는 수정 불가');
r = await call('DELETE', null, B, q('목4|1신1'));
assert.equal(r.status, 403, '다른 기기는 취소 불가');
r = await call('PATCH', { slot: '목4|1신1', label: '성춘향 - 물리' }, A);
assert.equal(r.label, '성춘향-물리');
r = await call('GET');
assert.equal(r.signups[0].label, '성춘향-물리'); assert.equal(r.signups[0].at, at0, '수정해도 신청 시각(선착순)은 그대로');

await call('POST', { slot: '목4|2전2', label: '이몽룡-국어' }, B);
r = await call('PATCH', { slot: '목4|1신1', label: '이몽룡-국어' }, A);
assert.equal(r.status, 409, '수정으로 같은 교시 두 칸을 만들 수 없음');
r = await call('PATCH', { slot: '목4|1신1', label: '이몽룡' }, A);
assert.equal(r.status, 400, '수정도 이름-과목 형식');
r = await call('PATCH', { slot: '목4|2전2', label: '변학도-사회' }, { 'X-Pw': 'pw' });
assert.ok(r.ok, '관리자는 남의 신청도 수정');

r = await call('DELETE', null, A, q('목4|1신1'));
assert.ok(r.ok, '신청한 기기에서 취소');
r = await call('DELETE', null, A, q('목4|1신1'));
assert.equal(r.status, 404);
await call('DELETE', null, { 'X-Pw': 'pw' }, q('목4|2전2'));
r = await call('GET');
assert.equal(r.signups.length, 0);

// 동시에 같은 칸을 누른 경우: 하나만 성공
const rs = await Promise.all(['가-가', '나-나', '다-다'].map(l => call('POST', { slot: '목2|2전3', label: l })));
assert.equal(rs.filter(x => x.ok).length, 1);

// 마감 상태: 신청한 기기도 못 바꾸고 관리자 비밀번호만 통한다
await call('POST', { slot: '목4|1신1', label: '성춘향-과학' }, A);
const shut = (method, body, headers, qs) => call(method, body, headers, qs, closedWorker);
r = await shut('GET', null, A);
assert.equal(r.closed, true, '화면이 마감을 알 수 있어야 함');
r = await shut('POST', { slot: '목1|1전3', label: '이몽룡-국어' }, B);
assert.equal(r.status, 403, '마감 뒤 새 신청 불가'); assert.match(r.error, /마감/);
r = await shut('PATCH', { slot: '목4|1신1', label: '성춘향-물리' }, A);
assert.equal(r.status, 403, '마감 뒤에는 신청한 기기도 수정 불가');
r = await shut('DELETE', null, A, q('목4|1신1'));
assert.equal(r.status, 403, '마감 뒤에는 신청한 기기도 취소 불가');
r = await shut('DELETE', null, { ...A, 'X-Pw': 'x' }, q('목4|1신1'));
assert.equal(r.status, 403, '틀린 비밀번호는 불가');
r = await shut('GET');
assert.equal(r.signups.find(x => x.slot === '목4|1신1').label, '성춘향-과학', '막힌 요청은 아무것도 바꾸지 않음');
r = await shut('PATCH', { slot: '목4|1신1', label: '성춘향-물리' }, { 'X-Pw': 'pw' });
assert.ok(r.ok, '관리자는 마감 뒤에도 수정');
r = await shut('POST', { slot: '목1|1전3', label: '이몽룡-국어' }, { 'X-Pw': 'pw' });
assert.ok(r.ok, '관리자는 마감 뒤에도 신청');
r = await shut('DELETE', null, { 'X-Pw': 'pw' }, q('목1|1전3'));
assert.ok(r.ok, '관리자는 마감 뒤에도 취소');

console.log('대강 신청 점검 통과');
