// 한파 수업 장소 이동 신청(/api/winter) 점검: 실제 D1·KV 대신 node:sqlite 와 Map 으로 Worker 를 직접 부른다(인터넷 불필요).
// 실행: node test/check-winter.mjs
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

Date.now = () => Date.parse('2026-11-24T03:00:00Z');   // 점검 기준일: 2026-11-24(화) 한국 시각 낮 12시

// D1 흉내: prepare().bind().run()/all()/first(), batch(한 묶음 = 전부 되거나 전부 안 됨)
export function fakeEnv() {
  const db = new DatabaseSync(':memory:');
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
    async batch(sts) {
      db.exec('BEGIN');
      try { for (const s of sts) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return [];
    },
  };
  const kv = new Map();
  return { DG: D1, DATA: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, APP_PW: 'pw', ASSETS: { fetch: () => new Response('asset') } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = fakeEnv();
  const call = (method, body, headers = {}, q = '') =>
    worker.fetch(new Request('https://x/api/winter' + q, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) }), env)
      .then(async r => ({ status: r.status, ...(await r.json()) }));
  const A = { 'X-Dev': 'a'.repeat(20) }, B = { 'X-Dev': 'b'.repeat(20) }, PW = { 'X-Pw': 'pw' };
  const req = (o = {}) => ({ teacher: '홍길동', cls: '1전1', subject: '수학', date: '2026-11-25', periods: [4, 5], ...o });

  let r = await call('GET');
  assert.equal(r.status, 200);
  assert.equal(r.rooms.length, 23, '실습실 23곳');
  assert.deepEqual(r.avail, { '2D': '2026-11-25', '3B': '2026-11-25', '3C': '2026-11-25' }, '처음에는 2D·3B·3C 가 11/25부터 이용가능');
  assert.equal(r.today, '2026-11-24');
  assert.equal(Object.values(r.base).reduce((n, v) => n + Object.keys(v).length, 0), 273, '전공 수업 칸 273개');
  assert.equal(r.base['2D']['수1'], '3전2 선택 이선영');
  for (const c of ['2D', '3B', '3C']) assert.deepEqual(Object.keys(r.base[c]).sort(), ['화3', '화4', '화5', '화6', '수1', '수2', '수3', '금1', '금2', '금3', '금4', '금5'].sort(), c + ' 전공 수업은 화3~6·수1~3·금1~5');

  // 신청: 잘못된 값은 저장하지 않음
  assert.equal((await call('POST', req({ teacher: '' }), A)).status, 400);
  assert.equal((await call('POST', req({ cls: '9전9' }), A)).status, 400);
  assert.equal((await call('POST', req({ subject: ' ' }), A)).status, 400);
  assert.equal((await call('POST', req({ date: '2026-11-28' }), A)).status, 400, '토요일');
  assert.equal((await call('POST', req({ date: '2026-11-23' }), A)).status, 400, '지난 날짜');
  assert.equal((await call('POST', req({ date: '2027-03-02' }), A)).status, 400, '60일 뒤');
  assert.equal((await call('POST', req({ date: '2026-11-27', periods: [6] }), A)).status, 400, '금요일은 5교시까지');
  assert.equal((await call('POST', req({ periods: [] }), A)).status, 400);
  assert.equal((await call('GET')).reqs.length, 0);

  // 신청 2시간 → 2줄, 같은 학급·같은 교사의 같은 교시는 다시 못 넣고 한 묶음 전체가 저장되지 않음
  r = await call('POST', req(), A);
  assert.deepEqual([r.status, r.count], [200, 2]);
  r = await call('POST', req({ teacher: '김철수', periods: [3, 4] }), B);
  assert.equal(r.status, 409, '1전1 4교시가 겹침');
  r = await call('POST', req({ cls: '1전2', periods: [5, 6] }), B);
  assert.equal(r.status, 409, '홍길동 5교시가 겹침');
  r = await call('GET', null, A);
  assert.equal(r.reqs.length, 2, '겹친 신청은 한 줄도 저장되지 않음');
  assert.ok(r.reqs.every(x => x.mine && x.room === null && !('dev' in x)), '내 신청 표시, 기기 값은 내보내지 않음');
  const [id4, id5] = r.reqs.map(x => x.id);
  assert.equal((await call('POST', req({ teacher: '김철수', cls: '1전2', periods: [4] }), B)).status, 200);
  const idB = (await call('GET')).reqs.find(x => x.cls === '1전2').id;

  // 배정: 관리자만, 이용가능 실만, 전공 수업·다른 배정이 없는 시간만
  assert.equal((await call('PATCH', { id: id4, room: '2D' }, A)).status, 401, '비밀번호 없이 배정 불가');
  assert.equal((await call('PATCH', { id: id4, room: '2A' }, PW)).status, 400, '이용가능 표시가 없는 실');
  assert.equal((await call('PATCH', { id: id4, room: '9Z' }, PW)).status, 400);
  assert.equal((await call('PATCH', { id: id4, room: '2D' }, PW)).status, 200);
  assert.equal((await call('PATCH', { id: idB, room: '2D' }, PW)).status, 409, '같은 시간 같은 실에 두 번 배정 불가');
  assert.equal((await call('PATCH', { id: idB, room: '3B' }, PW)).status, 200);
  assert.equal((await call('PATCH', { id: id5, room: '2D' }, PW)).status, 200, '다른 교시는 같은 실 가능');
  r = await call('POST', req({ teacher: '이영희', cls: '2전1', periods: [1] }), B);
  const idW = (await call('GET')).reqs.find(x => x.cls === '2전1').id;
  r = await call('PATCH', { id: idW, room: '2D' }, PW);
  assert.equal(r.status, 409, '수1 2D 는 전공 수업(3전2 선택)');
  assert.match(r.error, /3전2 선택/);
  assert.equal((await call('PATCH', { id: id4, room: '' }, PW)).status, 200, '배정 취소');
  assert.equal((await call('GET')).reqs.find(x => x.id === id4).room, null);

  // 이용 시작일 전 날짜에는 배정되지 않음: 오늘(11/24) 신청을 2D 에 배정 불가
  await call('POST', req({ teacher: '최오늘', cls: '2신1', date: '2026-11-24', periods: [1] }), B);
  const idT = (await call('GET')).reqs.find(x => x.date === '2026-11-24').id;
  r = await call('PATCH', { id: idT, room: '2D' }, PW);
  assert.equal(r.status, 400, '11/24 에는 2D 가 아직 이용가능이 아님');

  // 이용가능 실 바꾸기: 관리자만
  const D = '2026-11-25';
  assert.equal((await call('PUT', { avail: { '2A': D } }, A)).status, 401);
  assert.equal((await call('PUT', { avail: { '9Z': D } }, PW)).status, 400);
  assert.equal((await call('PUT', { avail: { '2A': '내일' } }, PW)).status, 400);
  assert.equal((await call('PUT', { avail: ['2A'] }, PW)).status, 400);
  r = await call('PUT', { avail: { '3C': D, '2A': D, '2D': '2026-11-24', '3B': D } }, PW);
  assert.deepEqual(Object.keys(r.avail), ['2A', '2D', '3B', '3C'], '실 순서대로 저장');
  assert.equal((await call('PATCH', { id: idT, room: '2D' }, PW)).status, 200, '시작일을 11/24 로 당기면 그날도 배정됨');
  assert.equal((await call('PATCH', { id: id4, room: '2A' }, PW)).status, 409, '수4 2A 는 전공 수업(유압)');
  assert.equal((await call('PATCH', { id: id5, room: '2A' }, PW)).status, 200, '이용가능으로 바꾼 뒤에는 배정됨(수5 2A 는 빈 시간)');

  // 교시가 옮겨진 날(11/26 목): 3A 는 원래 목2·3 태양 → 그날은 3·4교시가 전공 수업, 2교시는 빈 시간
  await call('PUT', { avail: { '3A': '2026-11-25' } }, PW);
  await call('POST', req({ teacher: '박민수', cls: '2전2', date: '2026-11-26', periods: [2, 3] }), B);
  const sh = (await call('GET')).reqs.filter(x => x.date === '2026-11-26');
  assert.equal((await call('PATCH', { id: sh[0].id, room: '3A' }, PW)).status, 200, '11/26 2교시 3A 는 비어 있음');
  assert.equal((await call('PATCH', { id: sh[1].id, room: '3A' }, PW)).status, 409, '11/26 3교시 3A 는 전공 수업');

  // 취소: 신청한 기기 또는 관리자
  assert.equal((await call('DELETE', null, B, '?id=' + id5)).status, 403, '다른 기기는 취소 불가');
  assert.equal((await call('DELETE', null, A, '?id=' + id5)).status, 200);
  assert.equal((await call('DELETE', null, A, '?id=' + id5)).status, 404);
  assert.equal((await call('DELETE', null, PW, '?id=' + idB)).status, 200, '관리자는 모두 취소 가능');

  // 동시에 같은 칸 신청: 하나만 저장
  const both = await Promise.all([call('POST', req({ teacher: '가나다', cls: '3전1', periods: [7] }), A), call('POST', req({ teacher: '라마바', cls: '3전1', periods: [7] }), B)]);
  assert.deepEqual(both.map(x => x.status).sort(), [200, 409]);
  console.log('✅ /api/winter 점검 통과');
}
