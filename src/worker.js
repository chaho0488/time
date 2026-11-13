// 교체 탐색기 저장소 API
//   GET  /api/data  → KV 에 저장된 기록 JSON (없으면 null)            — 비밀번호(X-Pw) 필요
//   PUT  /api/data  → 본문 JSON 을 그대로 저장                          — 비밀번호(X-Pw) 필요
//   GET  /api/view  → 교체·대강 기록만 {swHist, dgHist} (읽기 전용, 비밀번호 없음)
//   GET  /view      → 앱 화면(index.html)을 '보기 전용' 모드로 (기록 탭만 보임; 앱이 주소를 보고 판단)
//   GET  /api/dg    → 대강 신청 표(칸 목록 + 신청 내역)                  — 비밀번호 없음
//   POST /api/dg    → 대강 신청 {slot, label} (선착순, D1 이 같은 칸 두 번 저장을 막음) — 비밀번호 없음
//   PATCH /api/dg   → 이름-과목 수정 {slot, label}                        — 신청한 기기(X-Dev) 또는 비밀번호(X-Pw)
//   DELETE /api/dg?slot= → 신청 취소                                     — 신청한 기기(X-Dev) 또는 비밀번호(X-Pw)
//   /dg             → public/dg.html (대강 신청 화면, 정적 파일)
// 그 밖의 경로는 public/ 의 정적 파일(앱 화면).
// 비밀번호는 X-Pw 헤더로 받고, Secret APP_PW 와 비교한다. 컴퓨터에서 file:// 로 연 앱도 부르므로 CORS 를 연다.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pw, X-Dev',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

// 대강 신청 표: 열 = 교시, 행 = 학급, 칸 = 그 시간 과목. 수업 없는 칸은 신청 불가.
// 결강 교사 이름은 공개 화면·API에 내보내지 않는다. 다음 대강 신청 때는 이 DG 만 바꾸고 D1 표(dg)를 비운다.
const DG = {
  title: '11/18(수)·11/19(목) 대강 신청 (선착순)',
  cols: [
    ['수5', '11/18(수) 5교시'], ['수6', '11/18(수) 6교시'], ['수7', '11/18(수) 7교시'],
    ['목1', '11/19(목) 1교시'], ['목2', '11/19(목) 2교시'], ['목3', '11/19(목) 3교시'],
    ['목4', '11/19(목) 4교시'], ['목5', '11/19(목) 5교시'], ['목6', '11/19(목) 6교시'],
  ],
  rows: [
    ['1전1', { 목2: '기기' }],
    ['1전3', { 목1: '기기' }],
    ['1신1', { 목4: '자동', 목5: '자동', 목6: '자동' }],
    ['1신2', { 수5: '자동', 수6: '자동', 수7: '자동' }],
    ['2전2', { 수7: '영어', 목4: '영어' }],   // 수7 영어는 수6에서 교체로 옮겨진 수업
    ['2전3', { 목2: '영어' }],
    ['2신2', { 수5: '영어', 목6: '영어' }],
  ],
};
const DG_SLOTS = new Map();   // '수5|1신2' → 교시 id
for (const [t, c] of DG.rows) for (const col of Object.keys(c)) DG_SLOTS.set(`${col}|${t}`, col);

// '이름-과목' 한 줄 → {who, label}: 하이픈 앞뒤 공백은 정리하고, 이름·과목 모두 있어야 함
function dgLabel(raw) {
  const m = String(raw || '').trim().match(/^([^-]{1,10}?)\s*-\s*([^-]{1,15})$/);
  if (!m || !m[1].trim() || !m[2].trim()) return null;
  const who = m[1].trim().replace(/\s+/g, '');
  return { who, label: `${who}-${m[2].trim()}` };
}
const DG_BAD_LABEL = '"이름-과목" 형식으로 적어 주세요 (예: 홍길동-수학)';
// 기기 표시(신청한 브라우저가 만든 임의 값). 응답으로는 절대 내보내지 않는다.
const dgDev = req => { const d = req.headers.get('X-Dev') || ''; return /^[\w-]{16,64}$/.test(d) ? d : null; };

// 같은 칸(slot) 또는 같은 교시·같은 사람(period, who)이 이미 있어 저장이 막혔을 때, 어느 쪽인지 알려 준다
async function dgConflict(env, slot, period, who) {
  const taken = await env.DG.prepare('SELECT label FROM dg WHERE slot = ?').bind(slot).first();
  if (taken) return json({ error: `이미 ${taken.label} 선생님이 신청한 칸입니다` }, 409);
  const same = await env.DG.prepare('SELECT slot FROM dg WHERE period = ? AND who = ?').bind(period, who).first();
  if (same) return json({ error: `${who} 선생님은 이 교시에 이미 다른 학급(${same.slot.split('|')[1]})을 신청했습니다` }, 409);
  return json({ error: '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요' }, 500);
}

async function dgApi(req, env, url) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.DG) return json({ error: 'D1(DG)이 연결되지 않았습니다' }, 503);
  const dev = dgDev(req);

  if (req.method === 'GET') {
    // mine: 이 기기에서 한 신청인지 (취소·수정 단추를 보일지)
    const { results } = await env.DG.prepare('SELECT slot, label, at, (dev IS NOT NULL AND dev = ?) AS mine FROM dg').bind(dev || '').all();
    return new Response(JSON.stringify({ ...DG, signups: results.map(r => ({ ...r, mine: !!r.mine })) }),
      { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  let body = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = await req.json(); } catch { return json({ error: '잘못된 요청입니다' }, 400); }
  }
  const slot = String((req.method === 'DELETE' ? url.searchParams.get('slot') : body.slot) || '');
  const period = DG_SLOTS.get(slot);
  if (!period) return json({ error: '신청할 수 없는 칸입니다' }, 400);

  if (req.method === 'POST') {
    const l = dgLabel(body.label);
    if (!l) return json({ error: DG_BAD_LABEL }, 400);
    const at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 19).replace('T', ' ');   // 한국 시각 MM-DD hh:mm:ss
    try {
      await env.DG.prepare('INSERT INTO dg (slot, period, who, label, at, dev) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(slot, period, l.who, l.label, at, dev).run();
    } catch { return dgConflict(env, slot, period, l.who); }
    return json({ ok: true, label: l.label, at });
  }

  if (req.method !== 'PATCH' && req.method !== 'DELETE') return json({ error: 'method' }, 405);

  // 취소·수정: 신청한 기기이거나 관리자 비밀번호
  const row = await env.DG.prepare('SELECT dev FROM dg WHERE slot = ?').bind(slot).first();
  if (!row) return json({ error: '이미 취소된 칸입니다' }, 404);
  const admin = !!env.APP_PW && req.headers.get('X-Pw') === env.APP_PW;
  if (!admin && !(dev && row.dev === dev)) return json({ error: '신청한 기기에서만 취소·수정할 수 있습니다. 담당 선생님께 말씀해 주세요' }, 403);

  if (req.method === 'DELETE') {
    await env.DG.prepare('DELETE FROM dg WHERE slot = ?').bind(slot).run();
    return json({ ok: true });
  }
  // 수정: 이름-과목만 바꾸고 신청 시각(선착순 기준)은 그대로
  const l = dgLabel(body.label);
  if (!l) return json({ error: DG_BAD_LABEL }, 400);
  try {
    await env.DG.prepare('UPDATE dg SET who = ?, label = ? WHERE slot = ?').bind(l.who, l.label, slot).run();
  } catch { return dgConflict(env, '', period, l.who); }   // 칸은 내 것이므로 같은 교시 겹침만 확인
  return json({ ok: true, label: l.label });
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
