# KREAM Event Monitor

크림(KREAM) 신규 이벤트 + 수수료/카드할인 결합 차익 계산 + 텔레그램 알림 자동화 도구.

## 기능

1. **이벤트 모니터링**: kream.co.kr 메인의 `/exhibitions/*` 신규 이벤트 자동 감지 → 텔레그램 알림
2. **수수료 계산기**: feepromo 같은 수수료 100% 할인 이벤트 + 카드 결제 할인을 조합한 손익 계산 페이지 (HTML)
3. **결제 혜택 자동 수집**: 진행 중인 카드/페이 할인 8종 자동 노출 (드롭다운으로 자동 적용)
4. **로그인 자동화**: 시스템 Chrome 세션을 재사용해서 사이즈별 시세·빠른배송 가격 등 로그인 필요 정보 접근

## 1회 세팅

### 1) 텔레그램 봇 발급

1. 텔레그램에서 `@BotFather` 검색 → 채팅 → `/newbot` 입력
2. 봇 이름 + username 입력 → **HTTP API 토큰** 받음 (예: `123456:ABC-DEF1234...`)
3. 본인의 봇을 검색해서 채팅 시작 → 아무 메시지 한 번 보내기 (`hi` 등)
4. 브라우저에서 열기: `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. 응답 JSON에서 `"chat":{"id":XXXXXXXX}` 의 숫자가 **chat_id**

### 2) 의존성 설치 + .env

```bash
npm install
npx playwright install chromium

cp .env.example .env
# .env 에 TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 입력

npm run test-notify  # 텔레그램으로 테스트 메시지 1건 전송
```

### 3) 크림 로그인 (사이즈별 시세·빠른배송 가격 추출용)

```powershell
$env:USE_SYSTEM_CHROME='1'; npm run login
```

- PC에 설치된 Chrome이 자동으로 띄워짐 (평소 Chrome **모두 종료** 필요 — 한 번만)
- 크림에 평소처럼 로그인 (이메일/네이버/애플)
- 끝나면 터미널에 ENTER → 쿠키가 `data/chrome-profile/` 에 저장됨
- 다음 실행부터 헤드리스로도 자동 로그인 상태

## 실행

### 신규 이벤트 모니터링 (텔레그램 알림)

```bash
npm start          # 새 이벤트가 있으면 텔레그램으로 알림
DRY_RUN=1 npm start  # 알림 없이 baseline만 갱신
```

### 손익 계산 페이지 생성

```bash
$env:USE_SYSTEM_CHROME='1'; npm run rank
# data/feepromo-ranked.html 생성 → 브라우저에서 열기
```

### 다른 이벤트 페이지

```bash
$env:USE_SYSTEM_CHROME='1'; npm run rank -- birthday
$env:USE_SYSTEM_CHROME='1'; npm run rank -- kreamcard
```

## 자동 실행 (Windows 작업 스케줄러)

PC 켜져 있는 동안 30분마다 자동 실행:

1. 작업 스케줄러 열기 (`taskschd.msc`)
2. 작업 만들기 → 트리거: 매 30분
3. 동작: `cmd.exe /c cd /d C:\Users\User\Desktop\kream-event-monitor && npm start`

## 파일 구조

```
kream-event-monitor/
├── .github/workflows/monitor.yml  # GitHub Actions cron (텔레그램 알림용, 로그인 불필요한 정보만)
├── data/
│   ├── seen-events.json           # 모니터링 상태 (자동 갱신)
│   ├── chrome-profile/            # 시스템 Chrome 로그인 쿠키 (gitignore)
│   ├── feepromo-ranked.html       # 손익 계산 페이지 (자동 생성)
│   └── benefits-cache.json        # 결제 혜택 캐시
├── src/
│   ├── main.js                    # 이벤트 모니터링 + 텔레그램 알림
│   ├── scrape.js                  # 메인 페이지 이벤트 추출
│   ├── rank-exhibition.js         # 이벤트 페이지 손익 계산기
│   ├── scrape-benefits.js         # 결제 혜택 8종 추출
│   ├── browser.js                 # Chrome/Chromium/Edge 공통 헬퍼
│   ├── login-and-save.js          # 로그인 쿠키 저장
│   ├── telegram.js                # 텔레그램 API 클라이언트
│   └── test-notify.js             # 알림 단독 테스트
├── .env.example
└── package.json
```

## 트러블슈팅

| 증상 | 해결 |
|---|---|
| `텔레그램 전송 실패 (401)` | TELEGRAM_BOT_TOKEN 오타 확인 |
| `텔레그램 전송 실패 (400 chat_id)` | 봇과 채팅 한 번이라도 시작했는지 확인 → getUpdates로 chat_id 재발급 |
| `Chrome 시작 실패 (exit 21)` | 평소 Chrome 모두 종료 후 재실행 |
| 로그인 페이지 회색 버튼 | 평소 Chrome 종료 안 했을 가능성. 작업관리자에서 chrome.exe 모두 종료 |
| 빠른배송 가격 비어있음 | 로그인 세션이 만료됐을 수 있음 → `npm run login` 재실행 |
