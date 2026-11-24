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
  const D = '2026-11-25';
  const req = (o = {}) => ({ teacher: '성준혁', from: D, slots: ['수3', '수4'], ...o });

  let r = await call('GET');
  assert.equal(r.status, 200);
  assert.equal(r.rooms.length, 24, '실습실 23곳 + 1층 프로젝트실(음악실)');
  assert.deepEqual([r.start, r.fixed], [D, { '1P': '음악실' }]);
  assert.deepEqual(r.avail, { '2D': D, '3B': D, '3C': D }, '처음에는 2D·3B·3C 가 11/25부터 이용가능');
  assert.equal(r.today, '2026-11-24');
  assert.equal(r.admin, false, '비밀번호 없이는 관리자가 아님');
  assert.equal((await call('GET', null, { 'X-Pw': 'x' })).admin, false, '틀린 비밀번호');
  assert.equal((await call('GET', null, PW)).admin, true, '맞는 비밀번호면 관리자 로그인 확인');
  assert.equal(Object.keys(r.tt).length, 43, '교사 43명');
  assert.equal(r.tt['성준혁']['수3'], '1신3|과학|');
  assert.equal(r.tt['성준혁']['수4'], '1신1|과학|');
  assert.equal(r.tt['신지은']['수3'], '1신2|음악|1P', '음악은 1층 프로젝트실');
  assert.equal(r.tt['신지은']['화7'], '2신2|HR|', '음악 선생님의 HR 은 그대로');
  assert.equal(Object.keys(r.base['1P']).length, 18, '음악 18시간이 프로젝트실에');
  assert.equal(r.base['1P']['수4'], '1전1 음악 신지은');
  assert.equal(r.tt['김동후']['목4'], '1신1|자동|4C');
  assert.equal(Object.values(r.base).reduce((n, v) => n + Object.keys(v).length, 0), 273 + 18, '전공 수업 칸 273개 + 음악 18개');
  assert.equal(r.base['2D']['수1'], '3전2 선택 이선영');
  assert.equal(r.base['1B']['목1'], '3전3·3신1 배관 박은선·정재정', '두 반이 같이 쓰는 칸');
  for (const c of ['2D', '3B', '3C']) assert.deepEqual(Object.keys(r.base[c]).sort(), ['화3', '화4', '화5', '화6', '수1', '수2', '수3', '금1', '금2', '금3', '금4', '금5'].sort(), c + ' 전공 수업은 화3~6·수1~3·금1~5');
  // 수4 에 실습실 없는 수업이 있는 다른 교사 두 명(점검용)
  const others = Object.keys(r.tt).filter(t => t !== '성준혁' && r.tt[t]['수4'] && r.tt[t]['수4'].endsWith('|'));
  assert.ok(others.length >= 2);

  // 신청: 잘못된 값은 저장하지 않음
  assert.equal((await call('POST', req({ teacher: '홍길동' }), A)).status, 400, '목록에 없는 교사');
  assert.equal((await call('POST', req({ teacher: 'constructor' }), A)).status, 400);
  assert.equal((await call('POST', req({ from: '' }), A)).status, 400);
  assert.equal((await call('POST', req({ from: '2026-02-30' }), A)).status, 400, '없는 날짜');
  assert.equal((await call('POST', req({ from: '2026-11-23' }), A)).status, 400, '지난 날짜');
  assert.equal((await call('POST', req({ from: '2027-03-02' }), A)).status, 400, '60일 뒤');
  assert.equal((await call('POST', req({ slots: [] }), A)).status, 400);
  assert.equal((await call('POST', req({ from: '2026-11-24' }), A)).status, 400, '11/25 앞 날짜(오늘)는 신청 불가');
  assert.equal((await call('POST', req({ slots: ['월2'] }), A)).status, 400, '성준혁 선생님은 월2 수업이 없음');
  assert.equal((await call('POST', { teacher: '신지은', from: D, slots: ['수3'] }, A)).status, 400, '음악은 이미 프로젝트실에서 하므로 신청 불가');
  r = await call('POST', req({ teacher: '김동후', slots: ['목4'] }), A);
  assert.equal(r.status, 400, '이미 실습실(4C)에서 하는 수업은 신청 불가');
  assert.equal((await call('GET')).reqs.length, 0);

  // 신청 2칸 → 2줄(학급·과목은 시간표에서), 같은 수업을 다시 넣으면 한 묶음 전체가 저장되지 않음
  r = await call('POST', req(), A);
  assert.deepEqual([r.status, r.count], [200, 2]);
  r = await call('POST', req({ slots: ['수6', '수4'] }), B);
  assert.equal(r.status, 409, '수4 가 이미 신청됨');
  r = await call('GET', null, A);
  assert.deepEqual(r.reqs.map(x => [x.slot, x.cls, x.subject, x.from, x.room, x.mine]), [['수3', '1신3', '과학', D, null, true], ['수4', '1신1', '과학', D, null, true]], '겹친 묶음은 한 줄도 저장되지 않음');
  assert.ok(r.reqs.every(x => !('dev' in x)), '기기 값은 내보내지 않음');
  const [id3, id4] = r.reqs.map(x => x.id);
  assert.equal((await call('POST', { teacher: others[0], from: D, slots: ['수4'] }, B)).status, 200);
  const idB = (await call('GET')).reqs.find(x => x.teacher === others[0]).id;

  // 배정: 관리자만, 이용가능 실만, 전공 수업·다른 배정이 없는 시간만
  assert.equal((await call('PATCH', { id: id4, room: '2D' }, A)).status, 401, '비밀번호 없이 배정 불가');
  assert.equal((await call('PATCH', { id: id4, room: '2A' }, PW)).status, 400, '이용가능 표시가 없는 실');
  assert.equal((await call('PATCH', { id: id4, room: '9Z' }, PW)).status, 400);
  r = await call('PATCH', { id: id3, room: '2D' }, PW);
  assert.equal(r.status, 409, '수3 2D 는 전공 수업(3전2 선택)');
  assert.match(r.error, /3전2 선택/);
  assert.equal((await call('PATCH', { id: id4, room: '2D' }, PW)).status, 200);
  assert.equal((await call('PATCH', { id: idB, room: '2D' }, PW)).status, 409, '같은 요일교시 같은 실에 두 번 배정 불가');
  assert.equal((await call('PATCH', { id: idB, room: '3B' }, PW)).status, 200);
  assert.equal((await call('PATCH', { id: id4, room: '1P' }, PW)).status, 400, '음악실은 배정 대상이 아님');
  assert.equal((await call('PATCH', { id: id4, room: '' }, PW)).status, 200, '배정 취소');
  assert.equal((await call('GET')).reqs.find(x => x.id === id4).room, null);

  // 이용가능 실 바꾸기: 관리자만
  assert.equal((await call('PUT', { avail: { '2A': D } }, A)).status, 401);
  assert.equal((await call('PUT', { avail: { '9Z': D } }, PW)).status, 400);
  assert.equal((await call('PUT', { avail: { '2A': '내일' } }, PW)).status, 400);
  assert.equal((await call('PUT', { avail: ['2A'] }, PW)).status, 400);
  r = await call('PUT', { avail: { '3C': D, '2A': D, '2D': '2026-11-24', '3B': D } }, PW);
  assert.deepEqual(Object.keys(r.avail), ['2A', '2D', '3B', '3C'], '실 순서대로 저장');
  assert.equal((await call('PATCH', { id: id4, room: '2A' }, PW)).status, 409, '수4 2A 는 전공 수업(유압)');
  assert.equal((await call('PATCH', { id: id4, room: '3C' }, PW)).status, 200, '수4 3C 는 빈 시간');

  // 취소: 신청한 기기 또는 관리자
  assert.equal((await call('DELETE', null, B, '?id=' + id3)).status, 403, '다른 기기는 취소 불가');
  assert.equal((await call('DELETE', null, A, '?id=' + id3)).status, 200);
  assert.equal((await call('DELETE', null, A, '?id=' + id3)).status, 404);
  assert.equal((await call('DELETE', null, PW, '?id=' + idB)).status, 200, '관리자는 모두 취소 가능');

  // 동시에 같은 수업 신청: 하나만 저장
  const both = await Promise.all([call('POST', req({ slots: ['목2'] }), A), call('POST', req({ slots: ['목2'] }), B)]);
  assert.deepEqual(both.map(x => x.status).sort(), [200, 409]);
  console.log('✅ /api/winter 점검 통과');
}
