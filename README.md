# 교체 탐색기 (time)

수업 교체·대강 관리 앱(`public/index.html`)을 Cloudflare Worker로 서비스하고, 기록은 KV에 저장한다.
휴대폰·노트북·데스크톱이 같은 주소(https://time.uehs.workers.dev)로 열어 같은 기록을 쓴다.

- `public/index.html` — 앱. 컴퓨터의 `G:\내 드라이브\결보강 프로그램\timetable_2학기.html`과 같은 파일에 클라우드 동기화·휴대폰 화면(CSS)을 더한 것.
- `src/worker.js` — `/api/data` GET/PUT (KV, 비밀번호 `APP_PW`). 그 밖은 정적 파일.
- `wrangler.toml` — Worker 이름(time)·KV 바인딩(DATA).

비밀번호는 Cloudflare 대시보드 → Worker `time` → Settings → Variables and Secrets → `APP_PW`(Secret) 로 넣는다.
