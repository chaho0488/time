// 한파 수업 장소 이동 신청(/api/winter) 점검: 실제 D1·KV 대신 node:sqlite 와 Map 으로 Worker 를 직접 부른다(인터넷 불필요).
// 실행: node test/check-winter.mjs
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

Date.now = () => Date.parse('2026-11-24T03:00:00Z');   // 점검 기준일: 2026-11-24(화) 한국 시각 낮 12시

// D1 흉내: prepare().bind().run()/all()/first(), batch(한 묶음 = 전부 되거나 전부 안 됨)
// seed=true: 이용가능 실을 점검용 고정값(2D·3B·3C 11/25)으로 넣어 둔다 — 실제 기본값(W_AVAIL_DEFAULT)이 바뀌어도 점검은 그대로
export function fakeEnv(seed = true) {
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
  const kv = new Map(seed ? [['winterAvail2', JSON.stringify({ '2D': '2026-11-25', '3B': '2026-11-25', '3C': '2026-11-25' })]] : []);
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
  assert.equal(r.rooms.length, 23, '실습실 23곳(음악실은 목록에 없음)');
  assert.ok(r.start === D && !('fixed' in r) && !r.rooms.some(x => x[0] === '1P' || x[1].includes('음악')));
  assert.deepEqual(r.avail, { '2D': D, '3B': D, '3C': D }, '점검용 고정값: 2D·3B·3C 가 11/25부터 이용가능');
  // 저장된 값이 없을 때의 기본값 = 2026-11-24 실습실 현황표의 가능 시작일
  const def = (await (await worker.fetch(new Request('https://x/api/winter'), { ...env, DATA: { get: async () => null, put: async () => {} } })).json()).avail;   // 같은 표, 빈 KV
  assert.equal(Object.keys(def).length, 17, '날짜가 있는 실 17곳');
  assert.deepEqual([def['2A'], def['2D'], def['1A'], def['2G'], def['2C'], def['4D']], ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-30', '2026-12-02']);
  assert.ok(['1C', '1D', '2E', '2X', '2Y', '4A', '1P'].every(c => !(c in def)), 'X 인 실과 음악실은 이용가능 목록에 없음');
  assert.equal(r.today, '2026-11-24');
  assert.deepEqual(r.never, ['1C', '1D', '2E', '2X', '2Y', '4A'], '교실 이용불가 실습실(현황표 X)');
  assert.deepEqual(r.pc, ['2E', '2G', '2X', '2Y', '3B', '3C', '3F'], 'PC 사용가능 실 7곳');
  assert.equal(r.admin, false, '비밀번호 없이는 관리자가 아님');
  assert.equal((await call('GET', null, { 'X-Pw': 'x' })).admin, false, '틀린 비밀번호');
  assert.equal((await call('GET', null, PW)).admin, true, '맞는 비밀번호면 관리자 로그인 확인');
  assert.equal(Object.keys(r.tt).length, 43, '교사 43명');
  assert.equal(r.tt['성준혁']['수3'], '1신3|과학|');
  assert.equal(r.tt['성준혁']['수4'], '1신1|과학|');
  assert.equal(r.tt['신지은']['수3'], '1신2|음악|음악실', '음악 칸은 음악실로 표시(신청 대상 아님)');
  assert.equal(r.tt['신지은']['화7'], '2신2|HR|', '음악 선생님의 HR 은 그대로');
  assert.ok(!('1P' in r.base) && !('음악실' in r.base), '음악실은 실습실 시간표에 없음');
  assert.equal(r.tt['김동후']['목4'], '1신1|자동|4C');
  assert.equal(Object.values(r.base).reduce((n, v) => n + Object.keys(v).length, 0), 273, '전공 수업 칸 273개');
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
  assert.equal((await call('POST', { teacher: '신지은', from: D, slots: ['수3'] }, A)).status, 400, '음악은 이미 음악실에서 하므로 신청 불가');
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

  // 교체·대강 반영: 교체 탐색기 기록(KV 'data')이 그 날짜의 실습실 사용으로 바뀜
  { const lab = Object.keys(r.tt).flatMap(t => Object.entries(r.tt[t]).filter(([k, v]) => k[0] === '수' && v.endsWith('|2D')).map(([k, v]) => [t, k, ...v.split('|')])).sort((a, b) => a[1].localeCompare(b[1]));
    assert.ok(lab.length >= 2, '수요일 2D 전공 수업이 2칸 이상');
    const [t1, k1, c1, s1] = lab[0], [, k2] = lab[1], o = others[0], [oc, os] = r.tt[o]['수4'].split('|');
    await env.DATA.put('data', JSON.stringify({
      swHist: [{ id: 1, tA: t1, kA: k1, pA: k1[1] + '교시', cA: c1, sA: s1, dateISO_sw: D, tB: o, kB: '수4', pB: '4교시', cB: oc, sB: os, dateBISO: D },
               { id: 2, tA: t1, kA: k1, cA: c1, sA: s1, dateISO_sw: '2026-11-18', tB: o, kB: '수4', dateBISO: '2026-11-18' }],   // 이동 시작일(11/25) 전 기록은 빠짐
      dgHist: [{ id: 3, tA: lab[1][0], kA: k2, pA: k2[1] + '교시', cA: lab[1][2], sA: lab[1][3], tSub: '홍길동', subjectSub: lab[1][3], dateISO: D }] }));
    const m = (await call('GET')).moves;
    assert.deepEqual(Object.keys(m.room), [D], '11/25 기록만');
    assert.equal(m.room[D]['2D'][k1], null, '교체로 빠진 전공 수업: 그날 그 시간 2D 는 빔');
    assert.equal(m.room[D]['2D']['수4'], `${c1} ${s1} ${t1}`, '옮겨 온 시간에는 2D 를 씀');
    assert.equal(m.room[D]['2D'][k2], `${lab[1][2]} ${lab[1][3]} 홍길동(대강)`, '대강: 실은 그대로, 교사만 바뀜');
    assert.equal(m.out[D][t1 + '|' + k1], ''); assert.equal(m.out[D][o + '|수4'], ''); assert.equal(m.out[D][lab[1][0] + '|' + k2], '홍길동');
    await env.DATA.put('data', 'null');
    assert.deepEqual((await call('GET')).moves, { room: {}, out: {} }, '기록이 없으면 빈 값'); }

  // 신청하면서 바로 실 고르기: 한 칸만, 쓸 수 있는 실만, 이미 누가 고른 실은 안 됨
  { const t2 = others[1], C = { 'X-Dev': 'c'.repeat(20) }, k2 = Object.keys(r.tt[t2]).find(k => k !== '수4' && r.tt[t2][k].endsWith('|'));
    assert.equal((await call('POST', { teacher: t2, from: D, slots: ['수4', k2], room: '3C' }, C)).status, 400, '실을 고를 때는 한 칸씩');
    assert.equal((await call('POST', { teacher: t2, from: D, slots: ['수4'], room: '2A' }, C)).status, 400, '이용가능 표시가 없는 실');
    assert.equal((await call('POST', { teacher: t2, from: D, slots: ['수4'], room: '3C' }, C)).status, 200, '신청과 실 선택을 한 번에');
    const made = (await call('GET')).reqs.find(x => x.teacher === t2);
    assert.equal(made.room, '3C');
    assert.equal((await call('PATCH', { id: id4, room: '3C' }, A)).status, 409, '다른 선생님이 고른 실은 못 고름');
    assert.equal((await call('DELETE', null, C, '?id=' + made.id)).status, 200); }

  // 아직 안 열린 실(3C 가 11/27부터)은 선생님이 미리 잡을 수 없고, 관리자만 미리 배정할 수 있음
  { const t2 = others[1], C = { 'X-Dev': 'c'.repeat(20) };
    assert.equal((await call('PUT', { avail: { '2D': D, '3B': D, '3C': '2026-11-27' } }, PW)).status, 200);
    const x = await call('POST', { teacher: t2, from: D, slots: ['수4'], room: '3C' }, C);
    assert.equal(x.status, 400); assert.match(x.error, /11\/27부터/);
    assert.equal((await call('POST', { teacher: t2, from: D, slots: ['수4'] }, C)).status, 200, '실 없이 신청');
    const id = (await call('GET')).reqs.find(q => q.teacher === t2).id;
    assert.equal((await call('PATCH', { id, room: '3C' }, C)).status, 400, '신청한 기기도 아직 안 열린 실은 못 고름');
    assert.equal((await call('PATCH', { id, room: '2D' }, C)).status, 200, '열려 있는 실은 고름');
    assert.equal((await call('PATCH', { id, room: '3C' }, PW)).status, 200, '관리자는 미리 배정 가능');
    assert.equal((await call('DELETE', null, PW, '?id=' + id)).status, 200);
    assert.equal((await call('POST', { teacher: t2, from: '2026-11-27', slots: ['수4'], room: '3C' }, C)).status, 200, '시작일이 실이 열리는 날 이후면 고를 수 있음');
    assert.equal((await call('DELETE', null, PW, '?id=' + (await call('GET')).reqs.find(q => q.teacher === t2).id)).status, 200);
    assert.equal((await call('PUT', { avail: { '2D': D, '3B': D, '3C': D } }, PW)).status, 200, '점검용 값으로 되돌림'); }

  // 실 고르기·배정: 신청한 기기 또는 관리자만, 이용가능 실만, 전공 수업·다른 배정이 없는 시간만
  assert.equal((await call('PATCH', { id: id4, room: '2D' }, B)).status, 403, '다른 기기는 남의 신청에 실을 고를 수 없음');
  assert.equal((await call('PATCH', { id: id4, room: '2D' }, {})).status, 403, '기기 표시가 없으면 고를 수 없음');
  assert.equal((await call('PATCH', { id: id4, room: '2A' }, A)).status, 400, '신청한 기기도 이용가능 표시가 없는 실은 못 고름');
  assert.equal((await call('PATCH', { id: id4, room: '3C' }, A)).status, 200, '신청한 기기는 빈 실을 직접 고를 수 있음');
  assert.equal((await call('PATCH', { id: idB, room: '3C' }, B)).status, 409, '다른 선생님이 먼저 고른 실은 못 고름');
  assert.equal((await call('PATCH', { id: id4, room: '' }, A)).status, 200, '신청한 기기는 실 선택을 취소할 수 있음');
  assert.equal((await call('PATCH', { id: id4, room: '2A' }, PW)).status, 400, '이용가능 표시가 없는 실');
  assert.equal((await call('PATCH', { id: id4, room: '9Z' }, PW)).status, 400);
  r = await call('PATCH', { id: id3, room: '2D' }, PW);
  assert.equal(r.status, 409, '수3 2D 는 전공 수업(3전2 선택)');
  assert.match(r.error, /3전2 선택/);
  assert.equal((await call('PATCH', { id: id4, room: '2D' }, PW)).status, 200);
  assert.equal((await call('PATCH', { id: idB, room: '2D' }, PW)).status, 409, '같은 요일교시 같은 실에 두 번 배정 불가');
  assert.equal((await call('PATCH', { id: idB, room: '3B' }, PW)).status, 200);
  assert.equal((await call('PATCH', { id: id4, room: '1P' }, PW)).status, 400, '없는 실(음악실)에는 배정 불가');
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
