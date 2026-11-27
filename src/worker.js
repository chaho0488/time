// 교체 탐색기 저장소 API
//   GET  /api/data  → KV 에 저장된 기록 JSON (없으면 null)            — 비밀번호(X-Pw) 필요
//   PUT  /api/data  → 본문 JSON 을 그대로 저장                          — 비밀번호(X-Pw) 필요
//   GET  /api/view  → 교체·대강 기록만 {swHist, dgHist} (읽기 전용, 비밀번호 없음)
//   GET  /view      → 앱 화면(index.html)을 '보기 전용' 모드로 (기록 탭만 보임; 앱이 주소를 보고 판단)
//   GET  /api/dg    → 대강 신청 표(칸 목록 + 신청 내역)                  — 비밀번호 없음
//   POST /api/dg    → 대강 신청 {slot, label} (선착순, D1 이 같은 칸 두 번 저장을 막음) — 비밀번호 없음
//   DG.closed 가 true(마감)이면 신청·수정·취소 모두 관리자 비밀번호(X-Pw)가 있어야 한다 — 신청한 기기도 불가
//   PATCH /api/dg   → 이름-과목 수정 {slot, label}                        — 신청한 기기(X-Dev) 또는 비밀번호(X-Pw)
//   DELETE /api/dg?slot= → 신청 취소                                     — 신청한 기기(X-Dev) 또는 비밀번호(X-Pw)
//   PUT  /api/dg    → 표 만들기 {date, teachers[], add}(그날 그 교사들의 수업을 칸으로; add 가 아니면 지난 신청을 지움) / 마감 {closed} — 비밀번호(X-Pw)
//   DELETE /api/dg?all=1 → 지난 내용 초기화(표·신청 모두 비움)            — 비밀번호(X-Pw)
//   /dg             → public/dg.html (대강 신청 화면, 정적 파일)
//   /api/winter, /winter → 한파 수업 장소 이동 신청·실습실 배정 (아래 '한파' 부분 참고)
//   /api/lunch, /lunch   → 솥밥 메뉴 주문 (아래 '솥밥' 부분 참고)
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
  closed: false,   // 신청 받는 중. 마감하려면 true (관리자만 신청·수정·취소)
  title: '11/24(화) 대강 신청 (선착순)',
  cols: [
    ['화1', '11/24(화) 1교시'], ['화3', '11/24(화) 3교시'], ['화5', '11/24(화) 5교시'], ['화6', '11/24(화) 6교시'],
  ],
  rows: [
    ['2전1', { 화3: '역사' }],
    ['2전2', { 화1: '역사' }],
    ['2신2', { 화6: '역사' }],
    ['2신3', { 화5: '역사' }],
  ],
};
// 관리자가 화면에서 표를 만들면(날짜·결강 교사 → 그날 수업 칸) KV(DATA)의 dgConf 에 저장되고, 그때부터는 위 DG 대신 그것을 쓴다
const DG_KEY = 'dgConf';
async function dgConf(env) {
  try { const c = env.DATA && JSON.parse((await env.DATA.get(DG_KEY)) || 'null'); if (c && Array.isArray(c.cols) && Array.isArray(c.rows)) return c; } catch {}
  return DG;
}
const dgSlots = conf => { const m = new Map(); for (const [t, c] of conf.rows) for (const col of Object.keys(c)) m.set(`${col}|${t}`, col); return m; };   // '수5|1신2' → 교시 id
const dgTitle = cols => { const ds = [...new Set(cols.map(c => c[1].split(' ')[0]))]; return ds.length ? `${ds.join('·')} 대강 신청 (선착순)` : '대강 신청'; };
// 표 만들기: 그 날짜에 결강 교사들이 하는 수업을 모두 칸으로 만든다(교시가 옮겨진 날은 옮겨진 교시로). 교사 이름은 관리자에게만 보인다
function dgBuild(date, teachers, base) {
  const day = '일월화수목금토'[new Date(date + 'T00:00:00Z').getUTCDay()], md = `${Number(date.slice(5, 7))}/${Number(date.slice(8))}(${day})`, id = date.slice(5, 7) + date.slice(8);
  const cols = new Map((base ? base.cols : []).map(c => [c[0], c[1]])), rows = new Map((base ? base.rows : []).map(([t, c]) => [t, { ...c }]));
  let n = 0;
  for (const t of teachers) for (let p = 1; p <= 7; p++) {
    const sh = W_SHIFT[date], bk = sh ? (sh[p] ? day + sh[p] : '') : day + p, v = bk && W_TT[t][bk];
    if (!v) continue;
    const [cls, subject] = v.split('|'), col = `${id}${day}${p}`;
    cols.set(col, `${md} ${p}교시`);
    if (!rows.has(cls)) rows.set(cls, {});
    if (!rows.get(cls)[col]) { rows.get(cls)[col] = subject; n++; }
  }
  const key = c => c[0] + (c[1] === '전' ? 0 : 1) + c.slice(2);   // 학년 → 전기반 → 신재생반
  const cl = [...cols].sort((a, b) => a[0].localeCompare(b[0])), absent = [...(base && base.absent || []), ...teachers.map(t => `${md} ${t}`)];
  return { n, conf: { closed: false, title: dgTitle(cl), cols: cl, rows: [...rows].sort((a, b) => key(a[0]).localeCompare(key(b[0]))), absent: [...new Set(absent)] } };
}

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
  const admin = !!env.APP_PW && req.headers.get('X-Pw') === env.APP_PW;
  const conf = await dgConf(env);

  // 관리자: 표 만들기·추가 {date, teachers[], add}, 마감·다시 열기 {closed}
  if (req.method === 'PUT') {
    if (!admin) return json({ error: '관리자 비밀번호가 필요합니다' }, 401);
    if (!env.DATA) return json({ error: '저장소(KV)가 연결되지 않았습니다' }, 503);
    let b; try { b = await req.json(); } catch { return json({ error: '잘못된 요청입니다' }, 400); }
    if (b && typeof b.closed === 'boolean') { await env.DATA.put(DG_KEY, JSON.stringify({ ...conf, closed: b.closed })); return json({ ok: true, closed: b.closed }); }
    const date = String((b && b.date) || ''), teachers = [...new Set(Array.isArray(b && b.teachers) ? b.teachers.map(String) : [])];
    if (!wIsDate(date)) return json({ error: '날짜를 골라 주세요' }, 400);
    if ([0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay())) return json({ error: '주말은 고를 수 없습니다' }, 400);
    if (!teachers.length || teachers.length > 20) return json({ error: '결강 교사를 한 명 이상(20명까지) 골라 주세요' }, 400);
    const bad = teachers.find(t => !Object.hasOwn(W_TT, t));
    if (bad) return json({ error: `${bad}: 목록에 없는 교사입니다` }, 400);
    const { n, conf: next } = dgBuild(date, teachers, b.add ? conf : null);
    if (!n) return json({ error: '그 날짜에 새로 넣을 수업이 없습니다(수업이 없는 날이거나 이미 표에 있는 칸)' }, 400);
    if (!b.add) await env.DG.prepare('DELETE FROM dg').run();   // 새 표: 지난 신청은 지운다
    await env.DATA.put(DG_KEY, JSON.stringify(next));
    return json({ ok: true, added: n, title: next.title });
  }
  // 관리자: 지난 내용 초기화(표와 신청 모두 비움)
  if (req.method === 'DELETE' && url.searchParams.get('all')) {
    if (!admin) return json({ error: '관리자 비밀번호가 필요합니다' }, 401);
    if (!env.DATA) return json({ error: '저장소(KV)가 연결되지 않았습니다' }, 503);
    await env.DG.prepare('DELETE FROM dg').run();
    await env.DATA.put(DG_KEY, JSON.stringify({ closed: false, title: '대강 신청', cols: [], rows: [], absent: [] }));
    return json({ ok: true });
  }

  if (req.method === 'GET') {
    // mine: 이 기기에서 한 신청인지 (취소·수정 단추를 보일지)
    const { results } = await env.DG.prepare('SELECT slot, label, at, (dev IS NOT NULL AND dev = ?) AS mine FROM dg').bind(dev || '').all();
    const { absent, ...pub } = conf;   // 결강 교사 이름과 교사 목록은 관리자에게만
    return new Response(JSON.stringify({ ...pub, admin, ...(admin ? { absent: absent || [], teachers: Object.keys(W_TT) } : {}), signups: results.map(r => ({ ...r, mine: !!r.mine })) }),
      { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  let body = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = await req.json(); } catch { return json({ error: '잘못된 요청입니다' }, 400); }
  }
  const slot = String((req.method === 'DELETE' ? url.searchParams.get('slot') : body.slot) || '');
  const period = dgSlots(conf).get(slot);
  if (!period) return json({ error: '신청할 수 없는 칸입니다' }, 400);
  if (conf.closed && !admin) return json({ error: '신청이 마감되어 더 이상 바꿀 수 없습니다. 담당 선생님께 말씀해 주세요' }, 403);

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

// ───────── 한파 수업 장소 이동 신청(/winter) ─────────
//   GET    /api/winter       → 실습실 목록·교사별 시간표·전공 수업·이용가능 실·신청 내역      — 비밀번호 없음 (X-Pw 가 맞으면 admin:true — 관리자 로그인 확인용)
//   POST   /api/winter       → 신청 {teacher, from(이동 시작일), slots:[요일교시…]}          — 비밀번호 없음
//                               (원래 실습실 수업은 옮길 실 room 을 함께 보내야 하고, 그 주에는 원래 실이 빈다)
//   DELETE /api/winter?id=   → 신청 취소                                                    — 신청한 기기(X-Dev) 또는 비밀번호(X-Pw)
//   PATCH  /api/winter       → 실습실 배정 {id, room} (room 이 '' 이면 배정 취소)           — 비밀번호(X-Pw)
//   PUT    /api/winter       → 이용가능 실 목록 {avail:{실 코드: 이용 시작일}}                — 비밀번호(X-Pw)
//   /winter                  → public/winter.html
// 신청은 '매주 그 요일·교시 수업을 시작일부터 옮긴다'는 뜻이라 한 줄 = 교사의 수업 한 칸(요일교시).
// 신청은 D1(DG)의 winter3 표(처음 부를 때 자동 생성, 한 줄 = 어느 주(wk)의 요일교시), 이용가능 실 목록은 KV(DATA)의 winterAvail2(없으면 W_AVAIL_DEFAULT).
const W_ROOMS = [
  ['1A', '공유압실습실_01'], ['1B', '내선공사실습실_01'], ['1C', '내선공사실습실_02'],
  ['1D', '설비보전실습실'], ['2A', '공유압실습실_02'], ['2B', '동력설비공사실습실'],
  ['2C', '반도체장비전장조립실습실'], ['2D', '송변전배전설비운영실습실'], ['2E', '자동제어시스템운영실습실'],
  ['2F', '전기기기실습실'], ['2G', '전기CAD실습실_01'], ['2X', '생산자동화실습실_01'],
  ['2Y', '생산자동화실습실_02'], ['3A', '신재생에너지실무실습실'], ['3B', '자동제어기기제작실습실'],
  ['3C', '자동화설비실습실'], ['3D', '전기저장장치개발실습실'], ['3E', '전기전자회로실습실'],
  ['3F', '전기CAD실습실_02'], ['4A', '기계제어설계실습실'], ['4B', '전기설비운영실습실_01'],
  ['4C', '전기설비운영실습실_02'], ['4D', '환경공정실습실'],
];
const W_CODES = new Set(W_ROOMS.map(r => r[0]));
// 교사별 시간표(교사 → 요일교시 → '학급|과목|실습실'). public/index.html 의 TIMETABLE 을 그대로 줄여 적은 것.
// 최소구현: 교체·대강으로 옮겨진 수업은 반영하지 않는다(기본 시간표 기준). 시간표가 바뀌면 이 표도 다시 뽑아야 한다.
const W_TT = {
  '장승하': {"월1":"3신3|진로|","월3":"3신1|화학|4D","월4":"3신1|화학|4D","월5":"3신1|화학|4D","월6":"3신1|화학|4D","화7":"3신3|HR|","수4":"3신3|화학|4D","수5":"3신3|화학|4D","수6":"3신3|화학|4D","수7":"3신3|화학|4D","목3":"3신2|화학|4D","목4":"3신2|화학|4D","목5":"3신2|화학|4D","목6":"3신2|화학|4D"},
  '김동현': {"월2":"3전3|공정|1A","월3":"3전3|공정|1A","월5":"3전1|공정|1A","월6":"3전1|공정|1A","화1":"3신3|공정|1A","화2":"3신3|공정|1A","화7":"3신1|HR|","수4":"3신1|공정|1A","수5":"3신1|공정|1A","수6":"3신2|공정|1A","수7":"3신2|공정|1A","목3":"3전2|공정|1A","목4":"3전2|공정|1A"},
  '심창민': {"화1":"2신1|분반|1D","화2":"2신1|분반|1D","화3":"2신1|분반|1D","화4":"2신1|분반|1D","화7":"3신2|HR|","수1":"2전1|분반|1D","수2":"2전1|분반|1D","수3":"2전1|분반|1D","수4":"2전1|분반|1D"},
  '이혜인': {"월1":"2신2|도면|2G","월2":"2신2|도면|2G","월3":"2신2|도면|2G","월4":"2신3|도면|2G","월5":"2신3|도면|2G","월6":"2신3|도면|2G","화7":"2전1|HR|","수5":"2신1|도면|2G","수6":"2신1|도면|2G","수7":"2신1|도면|2G","목1":"2전2|도면|2G","목2":"2전2|도면|2G","목3":"2전2|도면|2G","목4":"2전3|도면|2G","목5":"2전3|도면|2G","목6":"2전3|도면|2G","금2":"2전1|도면|2G","금3":"2전1|도면|2G","금4":"2전1|도면|2G"},
  '김동후': {"월1":"1전2|기기|","월2":"1전1|기기|","월4":"1신3|자동|4C","월5":"1신3|자동|4C","월6":"1신3|자동|4C","수1":"1전3|기기|","수2":"1전2|기기|","수5":"1신2|자동|4C","수6":"1신2|자동|4C","수7":"1신2|자동|4C","목1":"1전3|기기|","목2":"1전1|기기|","목4":"1신1|자동|4C","목5":"1신1|자동|4C","목6":"1신1|자동|4C","금1":"1전3|기기|","금2":"1전1|기기|","금5":"1전2|기기|"},
  '김명란': {"월1":"3전2|로봇|2E","월2":"3전2|로봇|2E","월3":"3전2|로봇|2E","월4":"3전2|로봇|2E","수4":"3전3|로봇|2E","수5":"3전3|로봇|2E","수6":"3전3|로봇|2E","수7":"3전3|로봇|2E","목1":"3전1|로봇|2E","목2":"3전1|로봇|2E","목3":"3전1|로봇|2E","목4":"3전1|로봇|2E","목7":"3전1|CA|"},
  '김신영': {"월2":"2전3|유압|2A","월3":"2전3|유압|2A","월4":"2신1|유압|2A","월5":"2신1|유압|2A","화7":"3전2|HR|","수3":"2신3|유압|2A","수4":"2신3|유압|2A","수6":"2신2|유압|2A","수7":"2신2|유압|2A","목5":"2전1|유압|2A","목6":"2전1|유압|2A","금3":"2전2|유압|2A","금4":"2전2|유압|2A"},
  '김유진': {"월1":"3신1|전지|3D","월2":"3신1|전지|3D","월4":"3신3|전지|3D","월5":"3신3|전지|3D","화1":"3전3|전지|3D","화2":"3전3|전지|3D","화7":"1전2|HR|","수4":"3신2|전지|3D","수5":"3신2|전지|3D","목1":"3전2|전지|3D","목2":"3전2|전지|3D","목5":"3전1|전지|3D","목6":"3전1|전지|3D"},
  '김정선': {"화3":"3전1|선택|4A","화4":"3전1|선택|4A","화5":"3전1|선택|4A","화6":"3전1|선택|4A","수1":"3전1|선택|4A","수2":"3전1|선택|4A","수3":"3전1|선택|4A","목7":"3전3|CA|","금1":"3전1|선택|4A","금2":"3전1|선택|4A","금3":"3전1|선택|4A","금4":"3전1|선택|4A","금5":"3전1|선택|4A"},
  '김진영': {"월1":"2신3|반도|3F","월2":"2신1|반도|3F","월4":"2신2|반도|3F","화1":"2전1|반도|","화4":"2전3|반도|","화6":"2신1|반도|","목3":"2신2|반도|","목5":"2신3|반도|","목6":"2전2|반도|","목7":"1전2|CA|","금1":"2전3|반도|3F","금2":"2전2|반도|3F","금5":"2전1|반도|3F"},
  '박경화': {"화3":"3신1|선택|3C","화4":"3신1|선택|3C","화5":"3신1|선택|3C","화6":"3신1|선택|3C","수1":"3신1|선택|3C","수2":"3신1|선택|3C","수3":"3신1|선택|3C","목7":"1신3|CA|","금1":"3신1|선택|3C","금2":"3신1|선택|3C","금3":"3신1|선택|3C","금4":"3신1|선택|3C","금5":"3신1|선택|3C"},
  '박선아': {"월2":"1신3|기기|","월3":"1신2|기기|","월5":"1신1|기기|","화1":"1신1|기기|","화3":"1신2|기기|","화5":"1신3|설비|","화6":"1신3|설비|","목1":"1신3|기기|","목3":"1신2|설비|","목4":"1신2|설비|","목7":"2전1|CA|","금2":"1신3|기기|","금3":"1신1|기기|","금5":"1신2|기기|"},
  '박용훈': {"월5":"1전1|AI|3F","월6":"1전1|AI|3F","화1":"1신2|AI|3F","화2":"1신2|AI|3F","화5":"1신1|AI|3F","화6":"1신1|AI|3F","수3":"1전3|AI|3F","수4":"1전3|AI|3F","수6":"1신3|AI|3F","수7":"1신3|AI|3F","목3":"1전2|AI|3F","목4":"1전2|AI|3F","목7":"2신2|CA|"},
  '박은선': {"월1":"3전1|배관|1B","월2":"3전1|배관|1B","월3":"3전1|배관|1B","수5":"3전2|배관|1B","수6":"3전2|배관|1B","수7":"3전2|배관|1B","목1":"3전3|배관|1B","목2":"3전3|배관|1B","목3":"3전3|배관|1B","목5":"1전1|설비|","목6":"1전1|설비|","목7":"2전2|CA|","금3":"1전2|설비|","금4":"1전2|설비|"},
  '신종은': {"월2":"2전2|장치|3E","월3":"2전2|장치|3E","월5":"2신2|장치|3E","월6":"2신2|장치|3E","화5":"2전3|장치|3E","화6":"2전3|장치|3E","화7":"1신3|HR|","수6":"2신3|장치|3E","수7":"2신3|장치|3E","목1":"2전1|장치|3E","목2":"2전1|장치|3E","목5":"2신1|장치|3E","목6":"2신1|장치|3E"},
  '윤경희': {"월1":"3신2|태양|3A","월2":"3신2|태양|3A","월4":"3전3|조명|3A","월5":"3전3|조명|3A","화1":"3전2|조명|3A","화2":"3전2|조명|3A","수4":"3전1|진로|","수5":"3전1|조명|3A","수6":"3전1|조명|3A","목2":"3신3|태양|3A","목3":"3신3|태양|3A","목5":"3신1|태양|3A","목6":"3신1|태양|3A"},
  '이강준': {"월1":"2전1|HMI|2X","월2":"2전1|HMI|2X","월4":"2전3|HMI|2X","월5":"2전3|HMI|2X","화5":"2전2|HMI|2X","화6":"2전2|HMI|2X","화7":"3전1|HR|","수1":"2전3|분반|2Y","수2":"2전3|분반|2Y","수3":"2전3|분반|2Y","수4":"2전3|분반|2Y"},
  '이선영': {"화3":"3전2|선택|2D","화4":"3전2|선택|2D","화5":"3전2|선택|2D","화6":"3전2|선택|2D","수1":"3전2|선택|2D","수2":"3전2|선택|2D","수3":"3전2|선택|2D","목7":"2신3|CA|","금1":"3전2|선택|2D","금2":"3전2|선택|2D","금3":"3전2|선택|2D","금4":"3전2|선택|2D","금5":"3전2|선택|2D"},
  '이소라': {"월2":"3신3|동력|2B","월3":"3신3|동력|2B","월5":"3전2|동력|2B","월6":"3전2|동력|2B","화1":"3전1|동력|2B","화2":"3전1|동력|2B","수6":"3신1|동력|2B","수7":"3신1|동력|2B","목1":"3신2|동력|2B","목2":"3신2|동력|2B","목5":"3전3|동력|2B","목6":"3전3|동력|2B","목7":"1전3|CA|"},
  '이희섭': {"화3":"3신2|선택|1B","화4":"3신2|선택|1B","화5":"3신2|선택|1B","화6":"3신2|선택|1B","화7":"2신3|HR|","수1":"3신2|선택|1B","수2":"3신2|선택|1B","수3":"3신2|선택|1B","금1":"3신2|선택|1B","금2":"3신2|선택|1B","금3":"3신2|선택|1B","금4":"3신2|선택|1B","금5":"3신2|선택|1B"},
  '임성현': {"화3":"3신3|선택|1C","화4":"3신3|선택|1C","화5":"3신3|선택|1C","화6":"3신3|선택|1C","화7":"1신2|HR|","수1":"3신3|선택|1C","수2":"3신3|선택|1C","수3":"3신3|선택|1C","금1":"3신3|선택|1C","금2":"3신3|선택|1C","금3":"3신3|선택|1C","금4":"3신3|선택|1C","금5":"3신3|선택|1C"},
  '정유림': {"화3":"3전3|선택|3B","화4":"3전3|선택|3B","화5":"3전3|선택|3B","화6":"3전3|선택|3B","화7":"2전2|HR|","수1":"3전3|선택|3B","수2":"3전3|선택|3B","수3":"3전3|선택|3B","금1":"3전3|선택|3B","금2":"3전3|선택|3B","금3":"3전3|선택|3B","금4":"3전3|선택|3B","금5":"3전3|선택|3B"},
  '정재정': {"월4":"3신2|배관|1B","월5":"3신2|배관|1B","월6":"3신2|배관|1B","화7":"1전3|HR|","수1":"1전1|자동|4B","수2":"1전1|자동|4B","수3":"1전1|자동|4B","수5":"1전2|자동|4B","수6":"1전2|자동|4B","수7":"1전2|자동|4B","목1":"3신1|배관|1B","목2":"3신1|배관|1B","목3":"3신1|배관|1B","목4":"3신3|배관|1B","목5":"3신3|배관|1B","목6":"3신3|배관|1B","금3":"1전3|자동|4B","금4":"1전3|자동|4B","금5":"1전3|자동|4B"},
  '정진혁': {"월4":"1전3|설비|","월5":"1전3|설비|","화1":"2신2|분반|2F","화2":"2신2|분반|2F","화3":"2신2|분반|2F","화4":"2신2|분반|2F","수1":"2전2|분반|2F","수2":"2전2|분반|2F","수3":"2전2|분반|2F","수4":"2전2|분반|2F","목7":"3신2|CA|","금1":"1신1|설비|","금2":"1신1|설비|"},
  '한명민': {"화1":"2신3|분반|2Y","화2":"2신3|분반|2Y","화3":"2신3|분반|2Y","화4":"2신3|분반|2Y","목2":"2신3|HMI|2X","목3":"2신1|HMI|2X","목4":"2신2|HMI|2X","목7":"3전2|CA|","금2":"2신1|HMI|2X","금3":"2신3|HMI|2X","금4":"2신2|HMI|2X"},
  '김학선': {"월1":"1신3|국A|","월4":"1신1|국A|","화3":"1신3|국A|","화4":"1신1|국A|","수3":"1전2|국A|","수5":"1전3|국A|","목4":"2전1|진로|","목6":"1신2|국A|","목7":"2신1|CA|","금1":"1전1|국A|","금3":"1신2|국A|"},
  '박세은': {"월2":"1전3|국B|","월4":"1전1|국B|","화1":"1전3|국B|","화2":"1전2|국B|","화4":"1전1|국B|","수1":"1신1|국B|","수2":"1신2|국B|","수5":"1신3|국B|","목5":"1전2|국B|","목7":"1신1|CA|","금5":"2전2|진로|"},
  '정호임': {"월3":"2전1|화법|","월6":"2전2|화법|","화1":"2전3|화법|","화3":"2전2|화법|","화5":"2전1|화법|","화7":"2신1|HR|","수1":"2신3|화법|","수4":"2신1|화법|","수6":"2전3|화법|","목2":"2신2|화법|","목4":"2신3|화법|","금2":"2신2|화법|","금5":"2신1|화법|"},
  '김성민': {"월4":"2전1|영어|","월6":"2전3|영어|","화2":"2전1|영어|","화5":"2신1|영어|","화6":"2신3|영어|","수5":"2신2|영어|","수6":"2전2|영어|","목2":"2전3|영어|","목4":"2전2|영어|","목6":"2신2|영어|","금1":"2신3|영어|","금3":"2전3|진로|","금4":"2신1|영어|"},
  '노현주': {"월1":"1신2|영A|","월3":"1전1|영A|","화1":"1전2|영A|","화7":"1신1|HR|","수3":"1신1|영A|","수4":"1신3|영A|","목2":"1신2|영A|","목3":"1전3|영A|","목4":"1신3|영A|","금5":"1신1|영A|"},
  '박주란': {"월3":"1신1|영B|","월6":"1전2|영B|","화3":"1전1|영B|","화4":"1신3|영B|","수1":"1전2|영B|","수2":"1전3|영B|","목1":"1전1|영B|","목6":"1전3|영B|","목7":"3신3|CA|","금1":"2신1|진로|","금2":"1신2|영B|"},
  '박연옥': {"월1":"2신1|확통|","월2":"2신3|확통|","월4":"2전2|확통|","화2":"2전3|확통|","화4":"2전2|확통|","수1":"2신2|확통|","수5":"2전1|확통|","목1":"2전3|확통|","목3":"2전1|확통|","목4":"2신1|확통|","목7":"2전3|CA|","금3":"2신2|확통|","금5":"2신3|확통|"},
  '양성필': {"월4":"1신2|수학|","월6":"1신1|수학|","화1":"1신3|수학|","화4":"1신2|수학|","수2":"1신1|수학|","수4":"1신2|수학|","목1":"2신3|진로|","목2":"1신3|수학|","목7":"1신2|CA|","금1":"1신3|수학|","금4":"1신1|수학|"},
  '이용직': {"월1":"3전3|진로|","월3":"1전3|수학|","화2":"1전3|수학|","화4":"1전2|수학|","화7":"3전3|HR|","수4":"1전2|수학|","수6":"1전1|수학|","목4":"1전1|수학|","금1":"1전2|수학|","금2":"1전3|수학|","금5":"1전1|수학|"},
  '정선화': {"월1":"2전2|사회|","월3":"2신1|사회|","월6":"2전1|사회|","화2":"2전2|사회|","화3":"2전3|사회|","화5":"2신2|사회|","화6":"2전1|사회|","수1":"2신1|사회|","수2":"2신2|사회|","수5":"2신3|사회|","수7":"2전1|사회|","목1":"2신1|사회|","목3":"2전3|사회|","목5":"2신2|사회|","목6":"2신3|사회|","금1":"2전2|사회|","금2":"2신3|사회|","금4":"2전3|사회|"},
  '이문수': {"월1":"2전3|역사|","월3":"2신3|역사|","월5":"2전1|역사|","월6":"2신1|역사|","화1":"2전2|역사|","화3":"2전1|역사|","화5":"2신3|역사|","화6":"2신2|역사|","수2":"2신1|역사|","수3":"2신2|역사|","수5":"2전2|역사|","수7":"2전3|역사|","목1":"2신2|역사|","목2":"2신1|역사|","목5":"2전2|역사|","목7":"3신1|CA|","금1":"2전1|역사|","금2":"2전3|역사|","금4":"2신3|역사|"},
  '성준혁': {"월1":"1신1|과학|","월3":"1신3|과학|","월5":"1전2|과학|","월6":"1전3|과학|","화2":"1신3|과학|","화3":"1전2|과학|","화5":"1전1|과학|","화6":"1신2|과학|","수3":"1신3|과학|","수4":"1신1|과학|","수6":"1전3|과학|","수7":"1전1|과학|","목2":"1전3|과학|","목3":"1신1|과학|","목5":"1신2|과학|","목6":"1전2|과학|","금3":"1전1|과학|","금4":"1신2|과학|"},
  '황주미': {"월1":"1전1|중어|","월4":"1전2|중어|","화3":"1신1|중어|","화4":"1전3|중어|","화6":"1전2|중어|","수1":"1신2|중어|","수2":"1신3|중어|","수5":"1전1|중어|","목1":"1신1|중어|","목3":"1신3|중어|","목4":"1전3|중어|","목7":"1전1|CA|","금1":"1신2|중어|","금5":"2신2|진로|"},
  '신지은': {"월2":"1신1|음악|","월3":"1전2|음악|","월5":"1신2|음악|","월6":"1신2|음악|","화1":"1전1|음악|","화2":"1전1|음악|","화5":"1전3|음악|","화6":"1전3|음악|","화7":"2신2|HR|","수3":"1신2|음악|","수4":"1전1|음악|","수6":"1신1|음악|","수7":"1신1|음악|","목1":"1전2|음악|","목2":"1전2|음악|","목5":"1전3|음악|","목6":"1신3|음악|","금3":"1신3|음악|","금4":"1신3|음악|"},
  '김정연': {"월1":"1전3|체육|","월2":"1전2|체육|","월4":"3전1|체육|","월6":"3전3|체육|","화2":"1신1|체육|","화3":"1전3|체육|","화5":"1신2|체육|","화6":"1전1|체육|","화7":"1전1|HR|","수1":"1신3|체육|","수4":"3전2|체육|","수7":"3전1|체육|","목1":"1신2|체육|","목2":"1신1|체육|","목4":"3전3|체육|","목5":"1신3|체육|","목6":"3전2|체육|","금2":"1전2|체육|","금4":"1전1|체육|"},
  '김태욱': {"월3":"3신2|체육|","월5":"2전2|체육|","월6":"3신3|체육|","화1":"3신1|체육|","화2":"3신2|체육|","화4":"2전1|체육|","화7":"2전3|HR|","수2":"2신3|체육|","수3":"2신1|체육|","목1":"3신3|체육|","목3":"2신3|체육|","목4":"3신1|체육|","금1":"2신2|체육|","금3":"2신1|체육|","금5":"2전3|체육|"},
  '이숙미': {"수4":"2신2|체육|","수5":"2전3|체육|","수6":"2전1|체육|","수7":"2전2|체육|"},
  '정영옥': {"월2":"1신2|진로|","화1":"3신2|진로|","화2":"3신1|진로|","화5":"1전2|진로|","수5":"1신1|진로|","수7":"1전3|진로|","목3":"1전1|진로|","목5":"3전2|진로|","금5":"1신3|진로|"},
};
// 음악 수업은 11/24부터 따로 마련한 음악실(1층 프로젝트실)에서 한다 — 그래서 음악 칸은 이동 신청 대상이 아니다.
// 음악실은 실습실 시간표에는 넣지 않는다(실 목록 W_ROOMS 에 없음). 교사 시간표에서 음악 칸을 '음악실'로만 표시한다.
for (const sc of Object.values(W_TT)) for (const k of Object.keys(sc)) {
  const [c, s, room] = sc[k].split('|');
  if (s === '음악' && !room) sc[k] = `${c}|${s}|음악실`;
}
// 실습실별 전공 수업(실 → 요일교시 → '학급 과목 교사'): 위 표에서 실습실이 적힌 칸. 두 반이 같이 쓰는 칸은 '·'로 잇는다
const W_BASE = {};
for (const [t, sc] of Object.entries(W_TT)) for (const [k, v] of Object.entries(sc)) {
  const [c, s, room] = v.split('|');
  if (!W_CODES.has(room)) continue;   // 실습실 목록에 있는 실만(음악실 제외)
  const b = W_BASE[room] || (W_BASE[room] = {});
  if (b[k]) { const [c0, s0, t0] = b[k].split(' '); b[k] = `${c0}·${c} ${s0} ${t0}·${t}`; } else b[k] = `${c} ${s} ${t}`;
}
// 교시가 옮겨진 날: {그날 교시: 원래 교시}. 화면이 그날 시간표를 그릴 때 쓴다. public/index.html 의 DATE_DAY_OVERRIDES(periodMap)와 같게 둔다.
// 실습실을 쓸 수 없는 시간(모든 실, 관리자 포함): 화·목 7교시는 창체 수업으로 실습실을 쓴다
const W_BLOCK = { 화7: '창체', 목7: '창체' };
const W_SHIFT = { '2026-11-26': { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 } };
// 이용가능한 실 → 이용 시작일. 그 날짜부터만 이용가능으로 보인다(관리자가 화면에서 바꿀 수 있음)
const W_START = '2026-11-25';   // 실습실 이동이 시작되는 날: 이보다 앞선 날짜는 신청도 화면 조회도 안 됨
// 기본값: 2026-11-24 실습실 현황표의 '가능 시작일'(X 인 1C·1D·2E·2X·2Y·4A 는 없음 = 수업 불가)
const W_AVAIL_DEFAULT = {
  '1A': '2026-11-27', '1B': '2026-11-30',
  '2A': '2026-11-25', '2B': '2026-11-25', '2C': '2026-11-30', '2D': '2026-11-26', '2F': '2026-11-25', '2G': '2026-11-28',
  '3A': '2026-11-25', '3B': '2026-11-26', '3C': '2026-11-26', '3D': '2026-11-25', '3E': '2026-11-30', '3F': '2026-11-25',
  '4B': '2026-11-25', '4C': '2026-11-25', '4D': '2026-12-02',
};
// 교실로 쓸 수 없는 실습실(현황표의 X). 화면에서 더 어둡게 표시하고, 관리자가 이용가능으로 풀려 하면 한 번 더 묻는다
const W_NEVER = ['1C', '1D', '2E', '2X', '2Y', '4A'];
// PC 를 쓸 수 있는 실습실(실습실 현황 엑셀의 'PC 가능' 칸). 화면에 PC 표시를 붙인다
const W_PC = ['2E', '2G', '2X', '2Y', '3B', '3C', '3F'];
const W_AVAIL_KEY = 'winterAvail2';   // 기본값을 현황표대로 새로 잡으면서 이름을 바꿈(예전 winterAvail 은 더 읽지 않음)

const wToday = env => (env && env.W_TODAY) || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // 한국 날짜
const wIsDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
async function wAvail(env) {
  try { const a = JSON.parse((await env.DATA.get(W_AVAIL_KEY)) || 'null'); if (a && typeof a === 'object' && !Array.isArray(a)) return a; } catch {}
  return W_AVAIL_DEFAULT;
}
// 주 단위 신청: 이번 주(오늘이 속한 주)부터 앞으로 어느 주든 신청할 수 있고(주 제한 없음), 신청은 그 주에만 유효하다. 주말에는 다가오는 주가 '이번 주'
const wAdd = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function wWeek(iso) { const g = new Date(iso + 'T00:00:00Z').getUTCDay(), mon = wAdd(iso, g === 0 ? 1 : g === 6 ? 2 : 1 - g); return { mon, fri: wAdd(mon, 4) }; }
const wSlotDate = (mon, slot) => wAdd(mon, '월화수목금'.indexOf(slot[0]));   // 그 주에서 이 요일교시의 날짜
const wNext = wk => ({ mon: wAdd(wk.mon, 7), fri: wAdd(wk.fri, 7) });   // 다음 주
// 유효하지 않은 신청(지난 주 것 · 시작일보다 앞 요일이라 그 주에 한 번도 해당하지 않는 것)은 보관 표(winter2_old)로 옮긴다 → winter3 에는 이번 주와 그 뒤 주의 유효한 신청만 남는다
async function wSweep(env, wk) {
  const { results } = await env.DG.prepare('SELECT id, wk, slot, from_date FROM winter3').all();
  const dead = results.filter(r => r.wk < wk.mon || wSlotDate(r.wk, r.slot) < r.from_date).map(r => r.id);
  if (!dead.length) return;
  const q = dead.map(() => '?').join(',');
  await env.DG.batch([
    env.DG.prepare(`INSERT INTO winter2_old (id, slot, from_date, teacher, cls, subject, room, at, dev) SELECT id, slot, from_date, teacher, cls, subject, room, at, dev FROM winter3 WHERE id IN (${q})`).bind(...dead),
    env.DG.prepare(`DELETE FROM winter3 WHERE id IN (${q})`).bind(...dead),
  ]);
}
// winter3 표: 같은 주·같은 요일교시에 같은 학급·같은 교사·같은 실은 한 번만 (wk = 그 주 월요일. 주마다 따로 신청된다)
let wReady = null;
const wInit = env => wReady || (wReady = (async () => {
  await env.DG.prepare('CREATE TABLE IF NOT EXISTS winter3 (id INTEGER PRIMARY KEY AUTOINCREMENT, wk TEXT NOT NULL, slot TEXT NOT NULL, from_date TEXT NOT NULL, teacher TEXT NOT NULL, cls TEXT NOT NULL, subject TEXT NOT NULL, room TEXT, at TEXT NOT NULL, dev TEXT, UNIQUE(wk, slot, cls), UNIQUE(wk, slot, teacher))').run();
  await env.DG.prepare('CREATE UNIQUE INDEX IF NOT EXISTS winter3_room ON winter3(wk, slot, room) WHERE room IS NOT NULL').run();
  await env.DG.prepare('CREATE TABLE IF NOT EXISTS winter2_old (id INTEGER, slot TEXT, from_date TEXT, teacher TEXT, cls TEXT, subject TEXT, room TEXT, at TEXT, dev TEXT)').run();   // 지난 신청 보관
  // 예전 표(winter2: 이번 주만 받던 때)의 신청을 한 번만 옮겨 온다 — 옮기면서 이름을 바꿔 두므로 다시 옮기지 않는다(동시에 두 번 불려도 한쪽만 성공)
  if (await env.DG.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'winter2'").first()) {
    try {
      const { results } = await env.DG.prepare('SELECT id, slot, from_date, teacher, cls, subject, room, at, dev FROM winter2').all();
      await env.DG.batch([...results.map(r => env.DG.prepare('INSERT OR IGNORE INTO winter3 (id, wk, slot, from_date, teacher, cls, subject, room, at, dev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(r.id, wWeek(r.from_date).mon, r.slot, r.from_date, r.teacher, r.cls, r.subject, r.room, r.at, r.dev)), env.DG.prepare('ALTER TABLE winter2 RENAME TO winter2_moved')]);
    } catch {}
  }
})().catch(e => { wReady = null; throw e; }));

// 교체·대강 반영: 교체 탐색기가 KV 'data' 에 저장한 기록(swHist·dgHist)을 '그 날짜에만' 달라지는 실습실 사용으로 바꾼다.
//   room[날짜][실][요일교시] = null(그날은 빔) | '학급 과목 교사'(그날만 들어온 수업 / 대강 교사)
//   out[날짜]['교사|요일교시'] = ''(교체로 그 시간 수업이 없음) | '대강 교사 이름'
// 요일교시는 그 날짜의 실제 교시. 실습실 수업은 교체되면 실습실도 함께 옮겨 가는 것으로 본다.
// 최소구현: 같은 수업을 두 번 이상 연달아 옮긴 기록(교체의 교체)은 한 단계만 반영한다 — 필요해지면 교체 탐색기의 실효 시간표 계산을 옮겨 올 것
async function wMoves(env) {
  let d = null;
  try { d = JSON.parse((await env.DATA.get('data')) || 'null'); } catch {}
  const room = {}, out = {}, ins = [];
  const put = (o, a, b, c, v) => { ((o[a] ||= {})[b] ||= {})[c] = v; };
  const wd = iso => '일월화수목금토'[new Date(iso + 'T00:00:00Z').getUTCDay()];
  const keyOf = (k, iso, p) => { k = String(k || ''); if (/^[월화수목금][1-7]$/.test(k)) return k; const n = parseInt(p, 10); return n >= 1 && n <= 7 ? wd(iso) + n : ''; };
  const lesson = (t, iso, k) => {   // 그 날짜 그 교시의 원래 수업 [학급, 과목, 실] (교시가 옮겨진 날은 원래 시간표 칸으로 바꿔 찾는다)
    const sh = W_SHIFT[iso], bk = sh ? (sh[k[1]] ? k[0] + sh[k[1]] : '') : k, v = Object.hasOwn(W_TT, t) && W_TT[t][bk];
    return v ? v.split('|') : null;
  };
  const okDate = iso => typeof iso === 'string' && wIsDate(iso) && iso >= W_START;
  const move = (t, d1, k1, d2, k2) => {   // t 의 (d1,k1) 수업이 (d2,k2) 로 옮겨 감
    if (!okDate(d1) || !k1) return;
    const L = lesson(t, d1, k1);
    if (!L) return;
    (out[d1] ||= {})[t + '|' + k1] = '';
    if (!W_CODES.has(L[2])) return;
    put(room, d1, L[2], k1, null);
    if (okDate(d2) && k2) ins.push([d2, L[2], k2, `${L[0]} ${L[1]} ${t}`]);
  };
  const sub = (t, iso, k, tSub, subj) => {   // 대강: 수업·실은 그대로, 교사만 바뀜
    tSub = String(tSub || '');
    if (!okDate(iso) || !k || !tSub || tSub === '—') return;
    const L = lesson(t, iso, k);
    if (!L) return;
    (out[iso] ||= {})[t + '|' + k] = tSub;
    if (W_CODES.has(L[2])) ins.push([iso, L[2], k, `${L[0]} ${subj || L[1]} ${tSub}(대강)`]);
  };
  for (const r of (d && Array.isArray(d.swHist) ? d.swHist : [])) {
    if (!r || typeof r !== 'object') continue;
    const dA = r.dateISO_sw, dB = r.dateBISO || dA, kA = okDate(dA) ? keyOf(r.kA, dA, r.pA) : '', kB = okDate(dB) ? keyOf(r.kB, dB, r.pB) : '';
    if (r.isDG) { sub(String(r.tA), dA, kA, r.tB, r.sB); continue; }
    move(String(r.tA), dA, kA, dB, kB); move(String(r.tB), dB, kB, dA, kA);
  }
  for (const r of (d && Array.isArray(d.dgHist) ? d.dgHist : []))
    if (r && typeof r === 'object' && okDate(r.dateISO)) sub(String(r.tA), r.dateISO, keyOf(r.kA, r.dateISO, r.pA), r.tSub, r.subjectSub);
  for (const [iso, R, k, v] of ins) put(room, iso, R, k, v);   // 들어온 수업은 '빔' 표시보다 나중에(같은 칸이면 들어온 수업이 이김)
  return { room, out };
}

// 고른 실을 쓸 수 있는지: 있는 실 · 이용가능 표시 · 그 요일교시에 전공 수업 없음 (다른 신청과 겹치는지는 DB 의 UNIQUE 가 막는다)
// 선생님은 이동 시작일에 이미 쓸 수 있는 실만 고른다(아직 안 열린 실을 미리 잡아 두지 못함). 관리자는 미리 배정할 수 있다
async function wRoomBad(env, room, slot, from, admin, wk) {
  if (!W_CODES.has(room)) return json({ error: '없는 실습실입니다' }, 400);
  if (W_BLOCK[slot]) return json({ error: `${slot[0]}요일 ${slot[1]}교시는 ${W_BLOCK[slot]} 수업으로 실습실을 쓸 수 없습니다` }, 409);
  const open = (await wAvail(env))[room];
  if (typeof open !== 'string') return json({ error: `${room}은(는) 이용가능으로 표시되지 않은 실입니다` }, 400);
  if (!admin && open > from) return json({ error: `${room}은(는) ${Number(open.slice(5, 7))}/${Number(open.slice(8))}부터 쓸 수 있어 아직 신청할 수 없습니다` }, 400);
  const busy = W_BASE[room] && W_BASE[room][slot];
  if (busy && !(await wVacated(env, room, slot, wk))) return json({ error: `${room}은(는) 그 시간에 전공 수업이 있습니다 (${busy})` }, 409);
  return null;
}
// 원래 실습실 수업을 그 주에 다른 실로 옮겼으면 원래 실은 그 시간에 빈다 (두 반이 같이 쓰는 칸은 모두 옮겼을 때만)
async function wVacated(env, room, slot, wk) {
  const ts = W_BASE[room][slot].split(' ')[2].split('·');
  const { results } = await env.DG.prepare(`SELECT teacher FROM winter3 WHERE wk = ? AND slot = ? AND room IS NOT NULL AND room != ? AND teacher IN (${ts.map(() => '?').join(',')})`).bind(wk, slot, room, ...ts).all();
  return results.length === ts.length;
}
// 원래 실습실 수업을 옮긴 신청을 취소하거나 실을 비우면 원래 실로 돌아가야 하는데, 그사이 다른 수업이 그 실에 들어왔으면 막는다
async function wBackBad(env, row) {
  const orig = (Object.hasOwn(W_TT, row.teacher) && W_TT[row.teacher][row.slot] || '').split('|')[2];
  if (!W_CODES.has(orig)) return null;
  const other = await env.DG.prepare('SELECT teacher, cls FROM winter3 WHERE wk = ? AND slot = ? AND room = ?').bind(row.wk, row.slot, orig).first();
  return other ? json({ error: `원래 실습실(${orig})에 그사이 ${other.cls} ${other.teacher} 선생님 수업이 들어와 되돌릴 수 없습니다. 다른 실로 바꾸거나 담당 선생님께 말씀해 주세요` }, 409) : null;
}

async function winterApi(req, env, url) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.DG) return json({ error: 'D1(DG)이 연결되지 않았습니다' }, 503);
  await wInit(env);
  const dev = dgDev(req);
  const admin = !!env.APP_PW && req.headers.get('X-Pw') === env.APP_PW;
  const wk = wWeek(wToday(env)), nx = wNext(wk);
  await wSweep(env, wk);

  if (req.method === 'GET') {
    const { results } = await env.DG.prepare('SELECT id, wk, slot, from_date AS "from", teacher, cls, subject, room, at, (dev IS NOT NULL AND dev = ?) AS mine FROM winter3 ORDER BY wk, id').bind(dev || '').all();
    return new Response(JSON.stringify({ rooms: W_ROOMS, tt: W_TT, base: W_BASE, shift: W_SHIFT, block: W_BLOCK, never: W_NEVER, pc: W_PC, start: W_START, avail: await wAvail(env), moves: await wMoves(env), today: wToday(env), week: wk, next: nx, admin, reqs: results.map(r => ({ ...r, date: wSlotDate(r.wk, r.slot), mine: !!r.mine })) }),
      { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  if (req.method === 'DELETE') {
    const id = Number(url.searchParams.get('id'));
    const row = Number.isInteger(id) ? await env.DG.prepare('SELECT dev, wk, slot, teacher FROM winter3 WHERE id = ?').bind(id).first() : null;
    if (!row) return json({ error: '이미 취소된 신청입니다' }, 404);
    if (!admin && !(dev && row.dev === dev)) return json({ error: '신청한 기기에서만 취소할 수 있습니다. 담당 선생님께 말씀해 주세요' }, 403);
    { const bad = await wBackBad(env, row); if (bad) return bad; }
    await env.DG.prepare('DELETE FROM winter3 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: '잘못된 요청입니다' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: '잘못된 요청입니다' }, 400);

  if (req.method === 'POST') {
    const teacher = String(body.teacher || ''), from = String(body.from || '');
    const sc = Object.hasOwn(W_TT, teacher) ? W_TT[teacher] : null;
    if (!sc) return json({ error: '교사명을 목록에서 골라 주세요' }, 400);
    const today = wToday(env);
    if (!wIsDate(from)) return json({ error: '언제부터 이동할지 날짜를 골라 주세요' }, 400);
    if (from < today) return json({ error: '지난 날짜는 고를 수 없습니다' }, 400);
    if (from < W_START) return json({ error: `${Number(W_START.slice(5, 7))}/${Number(W_START.slice(8))}부터 신청할 수 있습니다` }, 400);
    const mdK = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
    if (from < wk.mon) return json({ error: '지난 주 수업은 신청할 수 없습니다' }, 400);
    if ([0, 6].includes(new Date(from + 'T00:00:00Z').getUTCDay())) return json({ error: '시작일은 평일로 골라 주세요' }, 400);
    const fw = wWeek(from).mon;   // 이 신청이 들어갈 주(시작일이 속한 주)
    const slots = [...new Set(Array.isArray(body.slots) ? body.slots.map(String) : [])];
    if (!slots.length) return json({ error: '시간표에서 옮기고 싶은 수업을 골라 주세요' }, 400);
    // room = 신청하면서 바로 고른 실(수업 한 칸을 눌러 실을 고르는 화면). 한 칸 신청일 때만 받는다
    const room = String(body.room || '');
    if (room) {
      if (slots.length !== 1) return json({ error: '실습실은 수업 한 칸씩 골라 주세요' }, 400);
      const bad = await wRoomBad(env, room, slots[0], from, admin, fw); if (bad) return bad;
      if (await env.DG.prepare('SELECT 1 FROM winter3 WHERE wk = ? AND slot = ? AND room = ?').bind(fw, slots[0], room).first()) return json({ error: `${room}은(는) 그 시간에 방금 다른 수업이 들어왔습니다. 다른 실을 골라 주세요` }, 409);
    }
    const rows = [];
    for (const k of slots) {
      if (!Object.hasOwn(sc, k)) return json({ error: `${teacher} 선생님 시간표에 없는 시간입니다 (${k})` }, 400);
      const [cls, subject, orig] = sc[k].split('|');   // orig = 원래 수업하는 실(교실 수업은 '')
      if (wSlotDate(fw, k) < from) return json({ error: `${k[0]}요일 ${k[1]}교시는 이동 시작일(${mdK(from)})보다 앞이라 그 주에는 신청할 수 없습니다${fw === wk.mon ? '. 다음 주 수업으로 신청해 주세요' : ''}` }, 400);
      if (W_BLOCK[k]) return json({ error: `${k[0]}요일 ${k[1]}교시는 ${W_BLOCK[k]} 수업으로 실습실을 쓸 수 없습니다` }, 400);
      // 원래 실습실에서 하는 수업도 다른 실습실로 옮길 수 있다(옮길 실을 함께 골라야 함). 음악실 수업은 대상이 아님
      if (orig && !W_CODES.has(orig)) return json({ error: `${k} ${cls} ${subject} 수업은 ${orig}에서 하는 수업이라 옮길 수 없습니다` }, 400);
      if (orig && !room) return json({ error: `${k} ${cls} ${subject} 수업은 원래 실습실(${orig})에서 하는 수업입니다. 옮겨 갈 실습실을 골라 주세요` }, 400);
      if (orig && room === orig) return json({ error: `${room}은(는) 원래 이 수업을 하는 실습실입니다. 다른 실을 골라 주세요` }, 400);
      // 겹치는 신청은 먼저 찾아 어느 칸인지 알려 준다 (동시에 들어온 신청은 아래 UNIQUE 가 막음)
      const dup = await env.DG.prepare('SELECT 1 FROM winter3 WHERE wk = ? AND slot = ? AND (cls = ? OR teacher = ?)').bind(fw, k, cls, teacher).first();
      if (dup) return json({ error: `${k[0]}요일 ${k[1]}교시 ${cls} 수업은 이미 신청되어 있습니다` }, 409);
      rows.push([fw, k, from, teacher, cls, subject]);
    }
    const at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');   // 한국 시각 MM-DD hh:mm
    try {   // batch = 한 묶음(전부 저장되거나 전부 안 됨)
      await env.DG.batch(rows.map(r => env.DG.prepare('INSERT INTO winter3 (wk, slot, from_date, teacher, cls, subject, at, dev, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(...r, at, dev, room || null)));
    } catch { return json({ error: '방금 같은 수업에 다른 신청이 들어왔습니다. 화면을 확인하고 다시 신청해 주세요' }, 409); }
    return json({ ok: true, count: rows.length });
  }

  if (req.method !== 'PATCH' && req.method !== 'PUT') return json({ error: 'method' }, 405);
  if (req.method === 'PUT') {
    if (!admin) return json({ error: '관리자 비밀번호가 필요합니다' }, 401);   // 이용가능 실 목록
    const a = body.avail;
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(c => !W_CODES.has(c)) || Object.values(a).some(d => typeof d !== 'string' || !wIsDate(d)))
      return json({ error: '실 코드 또는 이용 시작일이 올바르지 않습니다' }, 400);
    const avail = Object.fromEntries(W_ROOMS.map(r => r[0]).filter(c => c in a).map(c => [c, a[c]]));
    await env.DATA.put(W_AVAIL_KEY, JSON.stringify(avail));
    return json({ ok: true, avail });
  }

  // 배정: 이용가능으로 표시된 실 중, 그 요일교시에 전공 수업도 다른 배정도 없는 실만.
  // 실의 이용 시작일이 신청 시작일보다 늦으면 화면이 실의 시작일부터 배정된 것으로 보여 준다
  const id = Number(body.id), room = String(body.room || '');
  const row = Number.isInteger(id) ? await env.DG.prepare('SELECT wk, slot, teacher, dev, from_date FROM winter3 WHERE id = ?').bind(id).first() : null;
  if (!row) return json({ error: '취소된 신청입니다' }, 404);
  // 실은 신청한 선생님이 직접 고른다: 신청한 기기(또는 관리자)만 바꿀 수 있다 — 취소와 같은 규칙
  if (!admin && !(dev && row.dev === dev)) return json({ error: '신청한 기기에서만 실을 고를 수 있습니다' }, 403);
  const orig = (Object.hasOwn(W_TT, row.teacher) && W_TT[row.teacher][row.slot] || '').split('|')[2];
  if (room && room === orig) return json({ error: `${room}은(는) 원래 이 수업을 하는 실습실입니다. 원래 실로 돌아가려면 신청을 취소해 주세요` }, 400);
  if (!room && W_CODES.has(orig)) return json({ error: '원래 실습실에서 하는 수업은 실 선택만 지울 수 없습니다. 신청을 취소해 주세요' }, 400);
  if (room) { const bad = await wRoomBad(env, room, row.slot, row.from_date, admin, row.wk); if (bad) return bad; }
  try {
    await env.DG.prepare('UPDATE winter3 SET room = ? WHERE id = ?').bind(room || null, id).run();
  } catch { return json({ error: `${room}은(는) 그 시간에 이미 다른 수업이 배정되어 있습니다` }, 409); }
  return json({ ok: true });
}

// ───────── 솥밥 메뉴 주문(/lunch) ─────────
//   GET  /api/lunch       → 메뉴 목록만 (주문 화면용)
//   GET  /api/lunch?all=1 → 메뉴 목록 + 주문 내역 [{name, menu, at}] (결과 화면용, 비밀번호 없음 — 결과 주소를 아는 사람만 봄)
//   POST /api/lunch       → 주문 {name, menu}. 같은 이름으로 다시 내면 메뉴를 바꾼다
//   /lunch                → public/lunch.html (주문만), /lunch/admin → 같은 화면의 결과 보기
// 주문은 D1(DG)의 lunch 표(처음 부를 때 자동 생성). 다음에 다시 쓸 때는 LUNCH 를 바꾸고 DELETE FROM lunch 로 비운다.
const LUNCH = ['전복솥밥', '곤드레솥밥', '식사 불참'];   // 갈비솥밥은 11/27 메뉴에서 뺌
async function lunchApi(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.DG) return json({ error: 'D1(DG)이 연결되지 않았습니다' }, 503);
  await env.DG.prepare('CREATE TABLE IF NOT EXISTS lunch (name TEXT PRIMARY KEY, menu TEXT NOT NULL, at TEXT NOT NULL)').run();
  if (req.method === 'GET') {
    if (new URL(req.url).searchParams.get('all') !== '1') return json({ menus: LUNCH });   // 주문 화면에는 메뉴만 (누가 무엇을 골랐는지는 내보내지 않음)
    const { results } = await env.DG.prepare('SELECT name, menu, at FROM lunch ORDER BY at').all();
    return new Response(JSON.stringify({ menus: LUNCH, list: results }),
      { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: '잘못된 요청입니다' }, 400); }
    const name = String((b && b.name) || '').replace(/\s+/g, '');   // 띄어쓰기 차이로 같은 사람이 두 번 세지지 않게
    const menu = String((b && b.menu) || '');
    if (!name || name.length > 20) return json({ error: '이름을 확인해 주세요' }, 400);
    if (!LUNCH.includes(menu)) return json({ error: '메뉴를 골라 주세요' }, 400);
    await env.DG.prepare('INSERT INTO lunch (name, menu, at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET menu = excluded.menu, at = excluded.at')
      .bind(name, menu, new Date().toISOString()).run();
    return json({ ok: true, name, menu });
  }
  return json({ error: 'method' }, 405);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/api/dg') return dgApi(req, env, url);
    if (url.pathname === '/api/winter') return winterApi(req, env, url);
    if (url.pathname === '/api/lunch') return lunchApi(req, env);
    // 솥밥 주문 결과 보기: 같은 lunch.html 을 내려준다 (화면이 주소를 보고 결과 보기로 켜짐)
    if (/^\/lunch\/admin\/?$/.test(url.pathname)) {
      url.pathname = '/lunch';
      return env.ASSETS.fetch(new Request(url.toString(), req));
    }

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
