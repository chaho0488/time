/* 교체 탐색기 오프라인용 서비스 워커
   - 앱 화면(index.html)·아이콘·외부 라이브러리(xlsx, 글꼴)를 캐시에 두어 인터넷이 없어도 앱이 열린다.
   - 앱 화면은 "네트워크 먼저, 안 되면 캐시": 온라인이면 항상 최신 배포본을 쓰고, 오프라인이면 마지막으로 받아 둔 것을 쓴다.
   - 외부 라이브러리는 "캐시 먼저": 버전이 주소에 박혀 있어 바뀌지 않는다.
   - /api/ 는 절대 캐시하지 않는다(기록 저장소는 항상 서버와 직접 주고받음). */
const VERSION = 'v1';                       // 캐시 구조를 바꿀 때만 올린다 (앱 수정은 네트워크 먼저라 올릴 필요 없음)
const CACHE = 'timetable-' + VERSION;
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const LIBS = ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP_SHELL);
    // 외부 라이브러리는 실패해도 설치는 계속 (처음 열 때 인터넷이 잠깐 끊겨도 앱은 깔리게)
    await Promise.all(LIBS.map(u => c.add(new Request(u, { mode: 'no-cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 예전 버전 캐시 정리
    for (const k of await caches.keys()) if (k.startsWith('timetable-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // PUT(기록 저장) 등은 그대로 통과
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;           // 기록 저장소는 캐시 금지

  const sameOrigin = url.origin === self.location.origin;
  const isNav = req.mode === 'navigate';

  if (sameOrigin || isNav) {
    // 앱 화면·아이콘: 네트워크 먼저, 안 되면 캐시
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
        return res;
      } catch (_) {
        const c = await caches.open(CACHE);
        return (await c.match(req)) || (isNav ? await c.match('./index.html') : Response.error());
      }
    })());
    return;
  }

  // 외부 라이브러리·글꼴: 캐시 먼저, 없으면 받아서 저장
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
      return res;
    } catch (_) { return Response.error(); }
  })());
});
