// 교체 탐색기 저장소 API
//   GET  /api/data  → KV 에 저장된 기록 JSON (없으면 null)            — 비밀번호(X-Pw) 필요
//   PUT  /api/data  → 본문 JSON 을 그대로 저장                          — 비밀번호(X-Pw) 필요
//   GET  /api/view  → 교체·대강 기록만 {swHist, dgHist} (읽기 전용, 비밀번호 없음)
//   GET  /view      → 앱 화면(index.html)을 '보기 전용' 모드로 (기록 탭만 보임; 앱이 주소를 보고 판단)
// 그 밖의 경로는 public/ 의 정적 파일(앱 화면).
// 비밀번호는 X-Pw 헤더로 받고, Secret APP_PW 와 비교한다. 컴퓨터에서 file:// 로 연 앱도 부르므로 CORS 를 연다.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pw',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

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
