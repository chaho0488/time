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
//   /dg             → public/dg.html (대강 신청 화면, 정적 파일)
//   /api/winter, /winter → 한파 수업 장소 이동 신청·실습실 배정 (아래 '한파' 부분 참고)
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
  const admin = !!env.APP_PW && req.headers.get('X-Pw') === env.APP_PW;
  if (DG.closed && !admin) return json({ error: '신청이 마감되어 더 이상 바꿀 수 없습니다. 담당 선생님께 말씀해 주세요' }, 403);

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
//   GET    /api/winter       → 실습실 목록·전공 수업 시간표·이용가능 실·신청 내역          — 비밀번호 없음
//   POST   /api/winter       → 신청 {teacher, cls, subject, date, periods:[교시…]}          — 비밀번호 없음
//   DELETE /api/winter?id=   → 신청 취소                                                    — 신청한 기기(X-Dev) 또는 비밀번호(X-Pw)
//   PATCH  /api/winter       → 실습실 배정 {id, room} (room 이 '' 이면 배정 취소)           — 비밀번호(X-Pw)
//   PUT    /api/winter       → 이용가능 실 목록 {avail:[실 코드…]}                          — 비밀번호(X-Pw)
//   /winter                  → public/winter.html
// 신청은 D1(DG)의 winter 표(처음 부를 때 자동 생성), 이용가능 실 목록은 KV(DATA)의 winterAvail.
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
// 실습실별 전공 수업(실 → 요일교시 → '학급 과목 교사'). public/index.html 의 TIMETABLE 에서 실습실이 적힌 칸만 뽑은 것.
// 최소구현: 교체·대강으로 옮겨진 전공 수업은 반영하지 않는다(기본 시간표 기준). 시간표가 바뀌면 이 표도 다시 뽑아야 한다.
const W_BASE = {
  '1A': {"월2":"3전3 공정 김동현","월3":"3전3 공정 김동현","월5":"3전1 공정 김동현","월6":"3전1 공정 김동현","화1":"3신3 공정 김동현","화2":"3신3 공정 김동현","수4":"3신1 공정 김동현","수5":"3신1 공정 김동현","수6":"3신2 공정 김동현","수7":"3신2 공정 김동현","목3":"3전2 공정 김동현","목4":"3전2 공정 김동현"},
  '1B': {"월1":"3전1 배관 박은선","월2":"3전1 배관 박은선","월3":"3전1 배관 박은선","월4":"3신2 배관 정재정","월5":"3신2 배관 정재정","월6":"3신2 배관 정재정","화3":"3신2 선택 이희섭","화4":"3신2 선택 이희섭","화5":"3신2 선택 이희섭","화6":"3신2 선택 이희섭","수1":"3신2 선택 이희섭","수2":"3신2 선택 이희섭","수3":"3신2 선택 이희섭","수5":"3전2 배관 박은선","수6":"3전2 배관 박은선","수7":"3전2 배관 박은선","목1":"3전3·3신1 배관 박은선·정재정","목2":"3전3·3신1 배관 박은선·정재정","목3":"3전3·3신1 배관 박은선·정재정","목4":"3신3 배관 정재정","목5":"3신3 배관 정재정","목6":"3신3 배관 정재정","금1":"3신2 선택 이희섭","금2":"3신2 선택 이희섭","금3":"3신2 선택 이희섭","금4":"3신2 선택 이희섭","금5":"3신2 선택 이희섭"},
  '1C': {"화3":"3신3 선택 임성현","화4":"3신3 선택 임성현","화5":"3신3 선택 임성현","화6":"3신3 선택 임성현","수1":"3신3 선택 임성현","수2":"3신3 선택 임성현","수3":"3신3 선택 임성현","금1":"3신3 선택 임성현","금2":"3신3 선택 임성현","금3":"3신3 선택 임성현","금4":"3신3 선택 임성현","금5":"3신3 선택 임성현"},
  '1D': {"화1":"2신1 분반 심창민","화2":"2신1 분반 심창민","화3":"2신1 분반 심창민","화4":"2신1 분반 심창민","수1":"2전1 분반 심창민","수2":"2전1 분반 심창민","수3":"2전1 분반 심창민","수4":"2전1 분반 심창민"},
  '2A': {"월2":"2전3 유압 김신영","월3":"2전3 유압 김신영","월4":"2신1 유압 김신영","월5":"2신1 유압 김신영","수3":"2신3 유압 김신영","수4":"2신3 유압 김신영","수6":"2신2 유압 김신영","수7":"2신2 유압 김신영","목5":"2전1 유압 김신영","목6":"2전1 유압 김신영","금3":"2전2 유압 김신영","금4":"2전2 유압 김신영"},
  '2B': {"월2":"3신3 동력 이소라","월3":"3신3 동력 이소라","월5":"3전2 동력 이소라","월6":"3전2 동력 이소라","화1":"3전1 동력 이소라","화2":"3전1 동력 이소라","수6":"3신1 동력 이소라","수7":"3신1 동력 이소라","목1":"3신2 동력 이소라","목2":"3신2 동력 이소라","목5":"3전3 동력 이소라","목6":"3전3 동력 이소라"},
  '2D': {"화3":"3전2 선택 이선영","화4":"3전2 선택 이선영","화5":"3전2 선택 이선영","화6":"3전2 선택 이선영","수1":"3전2 선택 이선영","수2":"3전2 선택 이선영","수3":"3전2 선택 이선영","금1":"3전2 선택 이선영","금2":"3전2 선택 이선영","금3":"3전2 선택 이선영","금4":"3전2 선택 이선영","금5":"3전2 선택 이선영"},
  '2E': {"월1":"3전2 로봇 김명란","월2":"3전2 로봇 김명란","월3":"3전2 로봇 김명란","월4":"3전2 로봇 김명란","수4":"3전3 로봇 김명란","수5":"3전3 로봇 김명란","수6":"3전3 로봇 김명란","수7":"3전3 로봇 김명란","목1":"3전1 로봇 김명란","목2":"3전1 로봇 김명란","목3":"3전1 로봇 김명란","목4":"3전1 로봇 김명란"},
  '2F': {"화1":"2신2 분반 정진혁","화2":"2신2 분반 정진혁","화3":"2신2 분반 정진혁","화4":"2신2 분반 정진혁","수1":"2전2 분반 정진혁","수2":"2전2 분반 정진혁","수3":"2전2 분반 정진혁","수4":"2전2 분반 정진혁"},
  '2G': {"월1":"2신2 도면 이혜인","월2":"2신2 도면 이혜인","월3":"2신2 도면 이혜인","월4":"2신3 도면 이혜인","월5":"2신3 도면 이혜인","월6":"2신3 도면 이혜인","수5":"2신1 도면 이혜인","수6":"2신1 도면 이혜인","수7":"2신1 도면 이혜인","목1":"2전2 도면 이혜인","목2":"2전2 도면 이혜인","목3":"2전2 도면 이혜인","목4":"2전3 도면 이혜인","목5":"2전3 도면 이혜인","목6":"2전3 도면 이혜인","금2":"2전1 도면 이혜인","금3":"2전1 도면 이혜인","금4":"2전1 도면 이혜인"},
  '2X': {"월1":"2전1 HMI 이강준","월2":"2전1 HMI 이강준","월4":"2전3 HMI 이강준","월5":"2전3 HMI 이강준","화5":"2전2 HMI 이강준","화6":"2전2 HMI 이강준","목2":"2신3 HMI 한명민","목3":"2신1 HMI 한명민","목4":"2신2 HMI 한명민","금2":"2신1 HMI 한명민","금3":"2신3 HMI 한명민","금4":"2신2 HMI 한명민"},
  '2Y': {"화1":"2신3 분반 한명민","화2":"2신3 분반 한명민","화3":"2신3 분반 한명민","화4":"2신3 분반 한명민","수1":"2전3 분반 이강준","수2":"2전3 분반 이강준","수3":"2전3 분반 이강준","수4":"2전3 분반 이강준"},
  '3A': {"월1":"3신2 태양 윤경희","월2":"3신2 태양 윤경희","월4":"3전3 조명 윤경희","월5":"3전3 조명 윤경희","화1":"3전2 조명 윤경희","화2":"3전2 조명 윤경희","수5":"3전1 조명 윤경희","수6":"3전1 조명 윤경희","목2":"3신3 태양 윤경희","목3":"3신3 태양 윤경희","목5":"3신1 태양 윤경희","목6":"3신1 태양 윤경희"},
  '3B': {"화3":"3전3 선택 정유림","화4":"3전3 선택 정유림","화5":"3전3 선택 정유림","화6":"3전3 선택 정유림","수1":"3전3 선택 정유림","수2":"3전3 선택 정유림","수3":"3전3 선택 정유림","금1":"3전3 선택 정유림","금2":"3전3 선택 정유림","금3":"3전3 선택 정유림","금4":"3전3 선택 정유림","금5":"3전3 선택 정유림"},
  '3C': {"화3":"3신1 선택 박경화","화4":"3신1 선택 박경화","화5":"3신1 선택 박경화","화6":"3신1 선택 박경화","수1":"3신1 선택 박경화","수2":"3신1 선택 박경화","수3":"3신1 선택 박경화","금1":"3신1 선택 박경화","금2":"3신1 선택 박경화","금3":"3신1 선택 박경화","금4":"3신1 선택 박경화","금5":"3신1 선택 박경화"},
  '3D': {"월1":"3신1 전지 김유진","월2":"3신1 전지 김유진","월4":"3신3 전지 김유진","월5":"3신3 전지 김유진","화1":"3전3 전지 김유진","화2":"3전3 전지 김유진","수4":"3신2 전지 김유진","수5":"3신2 전지 김유진","목1":"3전2 전지 김유진","목2":"3전2 전지 김유진","목5":"3전1 전지 김유진","목6":"3전1 전지 김유진"},
  '3E': {"월2":"2전2 장치 신종은","월3":"2전2 장치 신종은","월5":"2신2 장치 신종은","월6":"2신2 장치 신종은","화5":"2전3 장치 신종은","화6":"2전3 장치 신종은","수6":"2신3 장치 신종은","수7":"2신3 장치 신종은","목1":"2전1 장치 신종은","목2":"2전1 장치 신종은","목5":"2신1 장치 신종은","목6":"2신1 장치 신종은"},
  '3F': {"월1":"2신3 반도 김진영","월2":"2신1 반도 김진영","월4":"2신2 반도 김진영","월5":"1전1 AI 박용훈","월6":"1전1 AI 박용훈","화1":"1신2 AI 박용훈","화2":"1신2 AI 박용훈","화5":"1신1 AI 박용훈","화6":"1신1 AI 박용훈","수3":"1전3 AI 박용훈","수4":"1전3 AI 박용훈","수6":"1신3 AI 박용훈","수7":"1신3 AI 박용훈","목3":"1전2 AI 박용훈","목4":"1전2 AI 박용훈","금1":"2전3 반도 김진영","금2":"2전2 반도 김진영","금5":"2전1 반도 김진영"},
  '4A': {"화3":"3전1 선택 김정선","화4":"3전1 선택 김정선","화5":"3전1 선택 김정선","화6":"3전1 선택 김정선","수1":"3전1 선택 김정선","수2":"3전1 선택 김정선","수3":"3전1 선택 김정선","금1":"3전1 선택 김정선","금2":"3전1 선택 김정선","금3":"3전1 선택 김정선","금4":"3전1 선택 김정선","금5":"3전1 선택 김정선"},
  '4B': {"수1":"1전1 자동 정재정","수2":"1전1 자동 정재정","수3":"1전1 자동 정재정","수5":"1전2 자동 정재정","수6":"1전2 자동 정재정","수7":"1전2 자동 정재정","금3":"1전3 자동 정재정","금4":"1전3 자동 정재정","금5":"1전3 자동 정재정"},
  '4C': {"월4":"1신3 자동 김동후","월5":"1신3 자동 김동후","월6":"1신3 자동 김동후","수5":"1신2 자동 김동후","수6":"1신2 자동 김동후","수7":"1신2 자동 김동후","목4":"1신1 자동 김동후","목5":"1신1 자동 김동후","목6":"1신1 자동 김동후"},
  '4D': {"월3":"3신1 화학 장승하","월4":"3신1 화학 장승하","월5":"3신1 화학 장승하","월6":"3신1 화학 장승하","수4":"3신3 화학 장승하","수5":"3신3 화학 장승하","수6":"3신3 화학 장승하","수7":"3신3 화학 장승하","목3":"3신2 화학 장승하","목4":"3신2 화학 장승하","목5":"3신2 화학 장승하","목6":"3신2 화학 장승하"},
};
// 교시가 옮겨진 날: {그날 교시: 원래 교시}. public/index.html 의 DATE_DAY_OVERRIDES(periodMap)와 같게 둔다.
const W_SHIFT = { '2026-11-26': { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 } };
const W_AVAIL_DEFAULT = ['2D', '3B', '3C'];   // 11/25부터 이용가능한 실(관리자가 화면에서 바꿀 수 있음)
const W_CLASSES = ['1전1', '1전2', '1전3', '1신1', '1신2', '1신3', '2전1', '2전2', '2전3', '2신1', '2신2', '2신3', '3전1', '3전2', '3전3', '3신1', '3신2', '3신3'];
const W_NP = { 월: 6, 화: 7, 수: 7, 목: 7, 금: 5 };   // 요일별 교시 수

const wToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // 한국 날짜
// 'YYYY-MM-DD' → 요일 글자(월~금). 없는 날짜·주말이면 null
function wDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(date + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== date) return null;
  return '일월화수목금토'[d.getUTCDay()].replace(/[일토]/, '') || null;
}
// 그 날짜·교시에 그 실에서 하는 전공 수업(없으면 null). 교시가 옮겨진 날은 원래 교시로 바꿔 찾는다
function wBase(room, date, period) {
  const sh = W_SHIFT[date], p = sh ? sh[period] : period;
  return (p && W_BASE[room] && W_BASE[room][wDay(date) + p]) || null;
}
async function wAvail(env) {
  try { const a = JSON.parse((await env.DATA.get('winterAvail')) || 'null'); if (Array.isArray(a)) return a.filter(c => W_CODES.has(c)); } catch {}
  return W_AVAIL_DEFAULT;
}
// winter 표: 같은 날짜·교시에 같은 학급·같은 교사·같은 실은 한 번만
let wReady = null;
const wInit = env => wReady || (wReady = (async () => {
  await env.DG.prepare('CREATE TABLE IF NOT EXISTS winter (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, period INTEGER NOT NULL, teacher TEXT NOT NULL, cls TEXT NOT NULL, subject TEXT NOT NULL, room TEXT, at TEXT NOT NULL, dev TEXT, UNIQUE(date, period, cls), UNIQUE(date, period, teacher))').run();
  await env.DG.prepare('CREATE UNIQUE INDEX IF NOT EXISTS winter_room ON winter(date, period, room) WHERE room IS NOT NULL').run();
})().catch(e => { wReady = null; throw e; }));

async function winterApi(req, env, url) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.DG) return json({ error: 'D1(DG)이 연결되지 않았습니다' }, 503);
  await wInit(env);
  const dev = dgDev(req);
  const admin = !!env.APP_PW && req.headers.get('X-Pw') === env.APP_PW;

  if (req.method === 'GET') {
    const { results } = await env.DG.prepare('SELECT id, date, period, teacher, cls, subject, room, at, (dev IS NOT NULL AND dev = ?) AS mine FROM winter ORDER BY date, period, id').bind(dev || '').all();
    return new Response(JSON.stringify({ rooms: W_ROOMS, classes: W_CLASSES, np: W_NP, base: W_BASE, shift: W_SHIFT, avail: await wAvail(env), today: wToday(), reqs: results.map(r => ({ ...r, mine: !!r.mine })) }),
      { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  if (req.method === 'DELETE') {
    const id = Number(url.searchParams.get('id'));
    const row = Number.isInteger(id) ? await env.DG.prepare('SELECT dev FROM winter WHERE id = ?').bind(id).first() : null;
    if (!row) return json({ error: '이미 취소된 신청입니다' }, 404);
    if (!admin && !(dev && row.dev === dev)) return json({ error: '신청한 기기에서만 취소할 수 있습니다. 담당 선생님께 말씀해 주세요' }, 403);
    await env.DG.prepare('DELETE FROM winter WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: '잘못된 요청입니다' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: '잘못된 요청입니다' }, 400);

  if (req.method === 'POST') {
    const teacher = String(body.teacher || '').replace(/\s+/g, '');
    const cls = String(body.cls || ''), subject = String(body.subject || '').trim(), date = String(body.date || '');
    const day = wDay(date);
    if (!/^[가-힣A-Za-z]{2,10}$/.test(teacher)) return json({ error: '교사명을 적어 주세요 (예: 홍길동)' }, 400);
    if (!W_CLASSES.includes(cls)) return json({ error: '학급을 골라 주세요' }, 400);
    if (!subject || subject.length > 15) return json({ error: '과목을 적어 주세요 (15자 이내)' }, 400);
    if (!day) return json({ error: '수업이 있는 날짜(월~금)를 골라 주세요' }, 400);
    const today = wToday();
    if (date < today) return json({ error: '지난 날짜는 신청할 수 없습니다' }, 400);
    if (date > new Date(Date.parse(today) + 60 * 864e5).toISOString().slice(0, 10)) return json({ error: '60일 안의 날짜만 신청할 수 있습니다' }, 400);
    const periods = [...new Set(Array.isArray(body.periods) ? body.periods.map(Number) : [])].sort();
    if (!periods.length || periods.some(p => !Number.isInteger(p) || p < 1 || p > W_NP[day])) return json({ error: `교시를 골라 주세요 (${day}요일은 1~${W_NP[day]}교시)` }, 400);
    // 겹치는 신청은 먼저 찾아 어느 교시인지 알려 준다 (동시에 들어온 신청은 아래 UNIQUE 가 막음)
    for (const p of periods) {
      const dup = await env.DG.prepare('SELECT teacher, cls FROM winter WHERE date = ? AND period = ? AND (cls = ? OR teacher = ?)').bind(date, p, cls, teacher).first();
      if (dup) return json({ error: `${p}교시는 이미 신청되어 있습니다 (${dup.cls} ${dup.teacher} 선생님)` }, 409);
    }
    const at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');   // 한국 시각 MM-DD hh:mm
    try {   // batch = 한 묶음(전부 저장되거나 전부 안 됨)
      await env.DG.batch(periods.map(p => env.DG.prepare('INSERT INTO winter (date, period, teacher, cls, subject, at, dev) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(date, p, teacher, cls, subject, at, dev)));
    } catch { return json({ error: '방금 같은 시간에 다른 신청이 들어왔습니다. 화면을 확인하고 다시 신청해 주세요' }, 409); }
    return json({ ok: true, count: periods.length });
  }

  if (req.method !== 'PATCH' && req.method !== 'PUT') return json({ error: 'method' }, 405);
  if (!admin) return json({ error: '관리자 비밀번호가 필요합니다' }, 401);

  if (req.method === 'PUT') {   // 이용가능 실 목록
    if (!Array.isArray(body.avail) || body.avail.some(c => !W_CODES.has(c))) return json({ error: '실 코드가 올바르지 않습니다' }, 400);
    const avail = W_ROOMS.map(r => r[0]).filter(c => body.avail.includes(c));
    await env.DATA.put('winterAvail', JSON.stringify(avail));
    return json({ ok: true, avail });
  }

  // 배정: 이용가능으로 표시된 실 중, 그 시간에 전공 수업도 다른 배정도 없는 실만
  const id = Number(body.id), room = String(body.room || '');
  const row = Number.isInteger(id) ? await env.DG.prepare('SELECT date, period FROM winter WHERE id = ?').bind(id).first() : null;
  if (!row) return json({ error: '취소된 신청입니다' }, 404);
  if (room) {
    if (!W_CODES.has(room)) return json({ error: '없는 실습실입니다' }, 400);
    if (!(await wAvail(env)).includes(room)) return json({ error: `${room}은(는) 이용가능으로 표시되지 않은 실입니다` }, 400);
    const busy = wBase(room, row.date, row.period);
    if (busy) return json({ error: `${room}은(는) 그 시간에 전공 수업이 있습니다 (${busy})` }, 409);
  }
  try {
    await env.DG.prepare('UPDATE winter SET room = ? WHERE id = ?').bind(room || null, id).run();
  } catch { return json({ error: `${room}은(는) 그 시간에 이미 다른 수업이 배정되어 있습니다` }, 409); }
  return json({ ok: true });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/api/dg') return dgApi(req, env, url);
    if (url.pathname === '/api/winter') return winterApi(req, env, url);

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
