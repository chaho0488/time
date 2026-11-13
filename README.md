# 교체 탐색기 (time)

수업 교체·대강 관리 앱(`public/index.html`)을 Cloudflare Worker로 서비스하고, 기록은 KV에 저장한다.
휴대폰·노트북·데스크톱이 같은 주소(https://time.uehs.workers.dev)로 열어 같은 기록을 쓴다.

- `public/index.html` — 앱. 컴퓨터의 `G:\내 드라이브\결보강 프로그램\timetable_2학기.html`과 같은 파일에 클라우드 동기화·휴대폰 화면(CSS)을 더한 것.
- `src/worker.js` — `/api/data` GET/PUT (KV, 비밀번호 `APP_PW`). 그 밖은 정적 파일.
- `wrangler.toml` — Worker 이름(time)·KV 바인딩(DATA).

비밀번호는 Cloudflare 대시보드 → Worker `time` → Settings → Variables and Secrets → `APP_PW`(Secret) 로 넣는다.

## 올리기 전 점검

`node test/check-view.js` — 가짜 서버로 관리자 앱과 조회 사이트(`/view`)를 띄워 같은 교체 기록이 두 화면에 똑같이 반영되는지 확인한다(인터넷·클라우드 불필요). `npm i -D playwright` 가 한 번 필요하고, 크롬 위치를 따로 잡으려면 `CHROME=경로` 를 앞에 붙인다.

`node test/check-chain.js` — 연쇄 교체(교사 3명 이상이 맞물리는 교체)를 찾고, 추가·저장한 뒤 한 학급을 두 교사가 같은 교시에 맡는 칸이 없는지 확인한다. 실제 시간표의 김태욱 목3 → 한명민 목2↔목3 → 이문수 목2(3명)와, 가상 교사를 붙인 4명 연쇄, 휴대폰 화면을 본다.
