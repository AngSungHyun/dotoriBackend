# 도토리 API

`API_IMPLEMENTATION_PLAN.md`를 기준으로 구현한 TypeScript + ExpressJS 백엔드다. 회원·게스트, 자녀와 성향 분석, AI 동화 텍스트·이미지 생성, 서재, 임시 결제·주문, 선물, 신고와 B2B 문의를 제공한다.

## 요구 사항

- Node.js 20 이상 (운영 권장: Node.js 22)
- MySQL 8
- OpenAI API 키와 사용 가능한 API 크레딧
- GPT Image 모델 사용을 위한 조직 인증이 계정에 따라 필요할 수 있음

OpenAI 연동은 Responses API와 Images API를 사용한다. 기본값은 비용과 품질의 균형을 위한 `gpt-5.6-terra`, 이미지 생성은 `gpt-image-2`다. 모델은 환경변수로 교체할 수 있다.

## 설치와 실행

```bash
npm install
cp .env.example .env
```

`.env`에서 최소한 다음 값을 실제 환경에 맞게 설정한다.

```dotenv
DATABASE_URL=mysql://USER:PASSWORD@127.0.0.1:3306/dotori
JWT_ACCESS_SECRET=32자-이상의-무작위-문자열
JWT_REFRESH_SECRET=32자-이상의-무작위-문자열
FILE_URL_SECRET=32자-이상의-무작위-문자열
CHATGPT_API_KEY=OpenAI-API-Key
```

DB를 만든 후 마이그레이션과 서버를 실행한다.

```bash
npm run migrate
npm run dev
```

배포 빌드는 다음과 같다.

```bash
npm run build
npm start
```

서버 시작 시 DB에 남아 있는 `QUEUED`/`RUNNING` 생성 작업은 `FAILED/SERVER_RESTARTED`로 정리된다. 생성 큐는 프로세스 메모리에만 있으므로 다중 인스턴스나 재시작 복구가 필요하면 별도 작업 큐로 교체해야 한다.

## 검증

```bash
npm run check
```

이 명령은 TypeScript 빌드와 테스트 전용 메모리 저장소를 이용한 통합 테스트를 실행한다. 테스트는 다음 흐름을 실제 HTTP 요청으로 확인한다.

- 24시간 Access Token, Refresh Token 회전, 공통 오류 응답
- 자녀 소유권, 보호자 동의, 코드 기반 성향 채점과 `rawType` 비노출
- 인메모리 생성 작업, 6페이지 텍스트·표지·삽화·워터마크 로컬 저장
- 즉시 결제 완료, 서재 저장, 최종 승인 후 수정 차단
- 구독자 양장본 가격, 장바구니·주문·기프트 코드
- B2B 접수와 24시간 데이터 내보내기 URL

## 빠른 호출 예시

개발 환경에서는 이메일을 실제 발송하지 않고 인증 기록을 DB에 남기며 `debugCode`를 응답한다. 운영 환경에서는 이 필드가 제거된다.

```bash
curl -sS -X POST http://localhost:25565/api/v1/auth/verify-email/request \
  -H 'Content-Type: application/json' \
  -d '{"email":"parent@example.com","purpose":"SIGNUP"}'
```

회원가입 후 받은 Access Token으로 자녀를 등록한다.

```bash
curl -sS -X POST http://localhost:25565/api/v1/children \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -d '{"name":"시우","birthDate":"2021-05-04","interests":["공룡","기차"]}'
```

게스트도 미리보기까지 생성할 수 있다.

```bash
curl -sS -X POST http://localhost:25565/api/v1/guest/session \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"browser-installation-id"}'

curl -sS -X POST http://localhost:25565/api/v1/stories/drafts \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer GUEST_SESSION_TOKEN' \
  -d '{"storyType":"SITUATION"}'
```

생성에 필요한 1~5단계 값을 누적 저장한 후 작업을 시작하고 상태를 조회한다.

```bash
curl -sS -X PATCH http://localhost:25565/api/v1/stories/drafts/DRAFT_ID \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ACCESS_OR_GUEST_TOKEN' \
  -d '{
    "childInfo":{"name":"시우","age":5,"interests":["공룡"]},
    "worldId":"dinosaur-island",
    "illustrationStyleId":"WATERCOLOR",
    "context":{"lifeEvents":["첫 등원"],"emotions":["걱정"],"desiredFeeling":"용기를 얻기"},
    "tone":{"lessonId":"COURAGE","toneId":"WARM"},
    "cast":{"guardianConsent":true}
  }'

curl -sS -X POST http://localhost:25565/api/v1/stories/drafts/DRAFT_ID/generate \
  -H 'Authorization: Bearer ACCESS_OR_GUEST_TOKEN'

curl -sS http://localhost:25565/api/v1/stories/generations/JOB_ID \
  -H 'Authorization: Bearer ACCESS_OR_GUEST_TOKEN'
```

## 구현 구조

- `src/routes/`: 명세에 있는 HTTP API
- `src/services/openai.ts`: OpenAI 텍스트, 이미지, 안전 검사
- `src/services/generation-queue.ts`: 프로세스 내부 생성 큐와 파이프라인
- `src/services/file-service.ts`: 로컬 파일, 워터마크, HMAC 만료 URL
- `src/database/`: MikroORM 엔티티 메타데이터와 초기 마이그레이션
- `src/store/`: 운영 MySQL 저장소와 테스트용 메모리 저장소

상세 요청·응답 및 정책은 `API_IMPLEMENTATION_PLAN.md`를 참조한다. OpenAI API 사용법은 [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [Image generation](https://developers.openai.com/api/docs/guides/image-generation)을 기준으로 했다.
