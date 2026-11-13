# 교체 탐색기 (time)

수업 교체·대강 관리 앱(`public/index.html`)을 Cloudflare Worker로 서비스하고, 기록은 KV에 저장한다.
휴대폰·노트북·데스크톱이 같은 주소(https://time.uehs.workers.dev)로 열어 같은 기록을 쓴다.

- `public/index.html` — 앱. 컴퓨터의 `G:\내 드라이브\결보강 프로그램\timetable_2학기.html`과 같은 파일에 클라우드 동기화·휴대폰 화면(CSS)을 더한 것.
- `src/worker.js` — `/api/data` GET/PUT (KV, 비밀번호 `APP_PW`). 그 밖은 정적 파일.
- `public/dg.html` — 대강 신청 화면(https://time.uehs.workers.dev/dg). 선착순 신청은 D1 `time-dg`의 `dg` 표에 저장(같은 칸·같은 교시 중복은 DB가 막음). 칸 목록은 `src/worker.js`의 `DG`; 다음 신청 때는 `DG`를 바꾸고 `DELETE FROM dg`로 표를 비운다. 취소·수정은 신청한 기기(브라우저가 만든 임의 값 `X-Dev`, 표의 `dev` 열 — 응답으로는 내보내지 않음) 또는 화면 아래 관리자 비밀번호(APP_PW).
- `wrangler.toml` — Worker 이름(time)·KV 바인딩(DATA)·D1 바인딩(DG).

비밀번호는 Cloudflare 대시보드 → Worker `time` → Settings → Variables and Secrets → `APP_PW`(Secret) 로 넣는다.

## 올리기 전 점검

`node test/check-dg.mjs` — 대강 신청 API(선착순·같은 교시 중복·수업 없는 칸·취소 비밀번호·동시 신청)를 node:sqlite로 확인한다.

`node test/check-dg-phone.mjs` — 대강 신청 화면이 날짜별 표로 나뉘어 폰 폭(360·390px)에서도 옆으로 넘기지 않고 다 보이는지 확인한다(playwright 필요).

`node test/check-view.js` — 가짜 서버로 관리자 앱과 조회 사이트(`/view`)를 띄워 같은 교체 기록이 두 화면에 똑같이 반영되는지 확인한다(인터넷·클라우드 불필요). `npm i -D playwright` 가 한 번 필요하고, 크롬 위치를 따로 잡으려면 `CHROME=경로` 를 앞에 붙인다.

`node test/check-chain.js` — 연쇄 교체(교사 3명 이상이 맞물리는 교체)를 찾고, 추가·저장한 뒤 한 학급을 두 교사가 같은 교시에 맡는 칸이 없는지 확인한다. 실제 시간표의 김태욱 목3 → 한명민 목2↔목3 → 이문수 목2(3명)와, 가상 교사를 붙인 4명 연쇄, 휴대폰 화면을 본다.

`node test/check-gate.js` — 관리자 앱 잠금 화면: 비밀번호를 서버에서 확인하기 전에는 화면 전체가 가려지고('나중에' 없음), 틀린·오프라인 첫 입력은 열리지 않으며, 확인된 비밀번호가 있는 기기는 오프라인에서도 열리고, 조회용(/view)은 잠기지 않는지 확인한다.
