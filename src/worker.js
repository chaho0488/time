// 교체 탐색기 저장소 API
//   GET  /api/data  → KV 에 저장된 기록 JSON (없으면 null)            — 비밀번호(X-Pw) 필요
//   PUT  /api/data  → 본문 JSON 을 그대로 저장                          — 비밀번호(X-Pw) 필요
//   GET  /api/view  → 교체·대강 기록만 {swHist, dgHist} (읽기 전용, 비밀번호 없음)
//   GET  /view      → 앱 화면(index.html)을 '보기 전용' 모드로 (기록 탭만 보임; 앱이 주소를 보고 판단)
//   GET  /api/dg    → 대강 신청 표(칸 목록 + 신청 내역)                  — 비밀번호 없음
//   POST /api/dg    → 대강 신청 {slot, label} (선착순, D1 이 같은 칸 두 번 저장을 막음) — 비밀번호 없음
//   DELETE /api/dg?slot= → 신청 취소                                     — 비밀번호(X-Pw) 필요
//   /dg             → public/dg.html (대강 신청 화면, 정적 파일)
// 그 밖의 경로는 public/ 의 정적 파일(앱 화면).
// 비밀번호는 X-Pw 헤더로 받고, Secret APP_PW 와 비교한다. 컴퓨터에서 file:// 로 연 앱도 부르므로 CORS 를 연다.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pw',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

// 대강 신청 표: 열 = 교시, 행 = 결강 교사, 칸 = 그 시간 수업(학반 과목). 수업 없는 칸은 신청 불가.
// 다음 대강 신청 때는 이 DG 만 바꾸고 D1 표(dg)를 비운다.
const DG = {
  title: '11/18(수)·11/19(목) 대강 신청 (선착순)',
  cols: [
    ['수5', '11/18(수) 5교시'], ['수6', '11/18(수) 6교시'], ['수7', '11/18(수) 7교시'],
    ['목1', '11/19(목) 1교시'], ['목2', '11/19(목) 2교시'], ['목3', '11/19(목) 3교시'],
    ['목4', '11/19(목) 4교시'], ['목5', '11/19(목) 5교시'], ['목6', '11/19(목) 6교시'],
  ],
  rows: [
    ['김동후', { 수5: '1신2 자동', 수6: '1신2 자동', 수7: '1신2 자동', 목1: '1전3 기기', 목2: '1전1 기기', 목4: '1신1 자동', 목5: '1신1 자동', 목6: '1신1 자동' }],
    // 최소구현: 확정 시간표에는 이희섭 선생님의 이 시간 수업이 없어 빈 행 — 수업 칸이 확인되면 채운다
    ['이희섭', {}],
    // 수6(2전2)은 교체로 수7로 옮겨짐
    ['김성민', { 수5: '2신2 영어', 수7: '2전2 영어', 목2: '2전3 영어', 목4: '2전2 영어', 목6: '2신2 영어' }],
  ],
};
const DG_SLOTS = new Map();   // '수5|김동후' → 교시 id
for (const [t, c] of DG.rows) for (const col of Object.keys(c)) DG_SLOTS.set(`${col}|${t}`, col);

async function dgApi(req, env, url) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.DG) return json({ error: 'D1(DG)이 연결되지 않았습니다' }, 503);

  if (req.method === 'GET') {
    const { results } = await env.DG.prepare('SELECT slot, label, at FROM dg').all();
    return new Response(JSON.stringify({ ...DG, signups: results }),
      { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: '잘못된 요청입니다' }, 400); }
    const slot = String(body.slot || '');
    const period = DG_SLOTS.get(slot);
    if (!period) return json({ error: '신청할 수 없는 칸입니다' }, 400);
    // '이름-과목' 한 줄: 하이픈 앞뒤 공백은 정리하고, 이름·과목 모두 있어야 함
    const m = String(body.label || '').trim().match(/^([^-]{1,10}?)\s*-\s*([^-]{1,15})$/);
    if (!m || !m[1].trim() || !m[2].trim()) return json({ error: '"이름-과목" 형식으로 적어 주세요 (예: 홍길동-수학)' }, 400);
    const who = m[1].trim().replace(/\s+/g, '');
    const label = `${who}-${m[2].trim()}`;
    const at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 19).replace('T', ' ');   // 한국 시각 MM-DD hh:mm:ss
    try {
      await env.DG.prepare('INSERT INTO dg (slot, period, who, label, at) VALUES (?, ?, ?, ?, ?)')
        .bind(slot, period, who, label, at).run();
    } catch (e) {
      // 칸이 이미 찼거나(slot), 같은 교시에 이미 신청함(period, who) — 어느 쪽인지 다시 읽어 알려 준다
      const taken = await env.DG.prepare('SELECT label FROM dg WHERE slot = ?').bind(slot).first();
      if (taken) return json({ error: `이미 ${taken.label} 선생님이 신청한 칸입니다` }, 409);
      const same = await env.DG.prepare('SELECT slot FROM dg WHERE period = ? AND who = ?').bind(period, who).first();
      if (same) return json({ error: `${who} 선생님은 이 교시에 이미 다른 칸(${same.slot.split('|')[1]})을 신청했습니다` }, 409);
      return json({ error: '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요' }, 500);
    }
    return json({ ok: true, label, at });
  }

  if (req.method === 'DELETE') {
    if (!env.APP_PW) return json({ error: 'APP_PW 비밀번호가 설정되지 않았습니다' }, 503);
    if (req.headers.get('X-Pw') !== env.APP_PW) return json({ error: '비밀번호가 맞지 않습니다' }, 401);
    await env.DG.prepare('DELETE FROM dg WHERE slot = ?').bind(url.searchParams.get('slot') || '').run();
    return json({ ok: true });
  }
  return json({ error: 'method' }, 405);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/api/dg') return dgApi(req, env, url);

    // 보기 전용 화면: 같은 index.html 을 내려준다 (주소는 /view 로 유지되어야 앱이 보기 전용으로 켜진다)
    if (/^\/view\/?$/.test(url.pathname)) {
      if (req.method !== 'GET') return json({ error: 'method' }, 405);
      url.pathname = '/';   // ('/index.html' 로 부르면 정적 자산이 '/' 로 리다이렉트해 보기 전용 주소가 풀림)
      return env.ASSETS.fetch(new Request(url.toString(), req));
    }

    // 읽기 전용 기록: 기기 이름·지운 기록 같은 내부 정보는 빼고 교체·대강 기록만 내보낸다
    if (url.pathname === '/api/view') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (req.method !== 'GET') return json({ error: 'method' }, 405);
      let data = null;
      try { data = JSON.parse((await env.DATA.get('data')) || 'null'); } catch { data = null; }
      return new Response(JSON.stringify({ swHist: (data && data.swHist) || [], dgHist: (data && data.dgHist) || [] }),
        { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    if (url.pathname !== '/api/data') return env.ASSETS.fetch(req);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!env.APP_PW) return json({ error: 'APP_PW 비밀번호가 설정되지 않았습니다' }, 503);   // 비밀번호 없이 열어 두지 않음
    if (req.headers.get('X-Pw') !== env.APP_PW) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'GET') {
      const v = await env.DATA.get('data');
      return new Response(v || 'null', { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > 20_000_000) return json({ error: 'too large' }, 413);   // KV 값 한도(25MB) 안에서 막기
      try { JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
      await env.DATA.put('data', text);
      return json({ ok: true });
    }
    return json({ error: 'method' }, 405);
  },
};
