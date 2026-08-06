import { config } from "./config.js";

type Json = Record<string, unknown>;

const uuid = "550e8400-e29b-41d4-a716-446655440000";
const bearerSecurity = [{ bearerAuth: [] }];
const refreshSecurity = [{ refreshCookie: [] }];

const jsonContent = (example: unknown) => ({
  "application/json": { example },
});

const response = (description: string, example?: unknown) => ({
  description,
  ...(example === undefined ? {} : { content: jsonContent(example) }),
});

const body = (example: unknown, required = true) => ({
  required,
  content: jsonContent(example),
});

const pathParameter = (name: string, description: string, example: string = uuid) => ({
  in: "path",
  name,
  required: true,
  description,
  schema: { type: "string" },
  example,
});

const paginationParameters = [
  { in: "query", name: "page", description: "페이지 번호", schema: { type: "integer", minimum: 1, default: 1 }, example: 1 },
  { in: "query", name: "pageSize", description: "페이지당 항목 수(최대 100)", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 }, example: 20 },
];

const errorResponses = {
  400: { $ref: "#/components/responses/BadRequest" },
  401: { $ref: "#/components/responses/Unauthorized" },
  403: { $ref: "#/components/responses/Forbidden" },
  404: { $ref: "#/components/responses/NotFound" },
  409: { $ref: "#/components/responses/Conflict" },
  429: { $ref: "#/components/responses/RateLimited" },
  500: { $ref: "#/components/responses/InternalError" },
};

function operation(
  tag: string,
  summary: string,
  description: string,
  successStatus: number,
  successExample?: unknown,
  options: Json = {},
) {
  return {
    tags: [tag],
    summary,
    description,
    ...options,
    responses: {
      [successStatus]: response(successStatus === 204 ? "처리 완료(응답 본문 없음)" : "처리 성공", successExample),
      ...errorResponses,
    },
  };
}

const userExample = { id: uuid, loginId: "dotori", email: "parent@example.com", name: "도토리 보호자", notificationEnabled: true, createdAt: "2026-08-06T00:00:00.000Z" };
const childExample = { id: uuid, name: "시우", birthDate: "2021-05-04", gender: "MALE", interests: ["공룡", "기차"], pronouns: "시우", notes: "큰 소리에 예민함", createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z" };
const authDescription = "회원 Access Token을 Authorization: Bearer <token> 헤더로 전달합니다.";
const anyAuthDescription = "회원 또는 게스트 토큰을 Authorization: Bearer <token> 헤더로 전달합니다.";

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "도토리 AI 동화책 API",
    version: "0.1.0",
    description: [
      "아이의 정보와 성격을 바탕으로 맞춤 동화를 생성하고 구매하는 서비스 API입니다.",
      "회원 인증 API는 Access Token과 SameSite=None; Secure Refresh 쿠키를 함께 사용합니다.",
      "Swagger의 예시는 심사 및 프론트엔드 연동을 위한 샘플이며 UUID와 토큰은 실제 발급값으로 교체해야 합니다.",
    ].join("\n\n"),
  },
  servers: [
    { url: "/api/v1", description: "현재 접속한 서버" },
    { url: "https://125-176-141-217.sslip.io/api/v1", description: "배포 서버" },
    { url: "http://localhost:25565/api/v1", description: "로컬 개발 서버" },
  ],
  tags: [
    { name: "인증", description: "게스트 세션, 회원가입, 로그인과 토큰 관리" },
    { name: "마이페이지", description: "회원 정보, 약관 동의와 데이터 내보내기" },
    { name: "자녀", description: "자녀 프로필 등록과 관리" },
    { name: "성격 분석", description: "보호자 설문을 통한 자녀 성격 분석" },
    { name: "동화", description: "동화 초안, AI 생성, 미리보기와 구매 확정" },
    { name: "보관함", description: "구매한 동화 조회와 삭제" },
    { name: "결제·주문", description: "구독, 크레딧, 장바구니, 주문과 선물" },
    { name: "카탈로그", description: "동화 제작 선택지와 판매 상품 조회" },
    { name: "지원", description: "콘텐츠 신고와 B2B 문의" },
    { name: "파일", description: "서명된 URL을 이용한 비공개 파일 조회" },
  ],
  paths: {
    "/guest/session": { post: operation("인증", "게스트 세션 발급", "회원가입 전 사용자가 동화 초안을 만들 때 7일짜리 게스트 토큰을 발급합니다.", 201, { data: { guestSessionId: uuid, guestSessionToken: "guest.jwt.token", expiresAt: "2026-08-13T00:00:00.000Z" } }, { requestBody: body({ deviceId: "browser-abc-123" }, false) }) },
    "/auth/check-id": { get: operation("인증", "아이디 중복 확인", "회원가입 화면에서 로그인 아이디를 사용할 수 있는지 확인합니다.", 200, { data: { loginId: "dotori", available: true } }, { parameters: [{ in: "query", name: "loginId", required: true, description: "영문 소문자와 숫자 4~20자", schema: { type: "string", pattern: "^[a-z0-9]{4,20}$" }, example: "dotori" }] }) },
    "/auth/verify-email/request": { post: operation("인증", "이메일 인증 코드 요청", "회원가입 또는 이메일 변경 전에 10분 유효한 6자리 인증 코드를 생성합니다. 운영 환경에서는 코드를 응답에 노출하지 않습니다.", 202, { data: { message: "인증 메일 요청을 접수했습니다.", expiresAt: "2026-08-06T00:10:00.000Z" } }, { requestBody: body({ email: "parent@example.com", purpose: "SIGNUP" }) }) },
    "/auth/verify-email/confirm": { post: operation("인증", "이메일 인증 코드 확인", "사용자가 입력한 인증 코드를 확인하고 회원가입에 한 번 사용할 이메일 인증 토큰을 발급합니다.", 200, { data: { emailVerificationToken: "email-verification-token", expiresAt: "2026-08-06T00:30:00.000Z" } }, { requestBody: body({ email: "parent@example.com", code: "123456", purpose: "SIGNUP" }) }) },
    "/auth/signup": { post: operation("인증", "회원가입", "이메일 인증과 필수 약관 동의를 확인해 회원을 만들고 즉시 로그인 세션을 발급합니다. 게스트 작업이 있으면 새 회원에게 승계합니다.", 201, { data: { user: userExample, accessToken: "access.jwt.token", accessTokenExpiresAt: "2026-08-07T00:00:00.000Z" } }, { requestBody: body({ loginId: "dotori", email: "parent@example.com", password: "safe-password-123", name: "도토리 보호자", emailVerificationToken: "email-verification-token", guestSessionToken: "guest.jwt.token", consents: [{ type: "TERMS", version: "1.0", agreed: true }, { type: "PRIVACY", version: "1.0", agreed: true }, { type: "CHILD_DATA", version: "1.0", agreed: true }] }) }) },
    "/auth/login": { post: operation("인증", "로그인", "아이디와 비밀번호를 검증해 24시간 Access Token과 30일 Refresh 쿠키를 발급합니다.", 200, { data: { user: userExample, accessToken: "access.jwt.token", accessTokenExpiresAt: "2026-08-07T00:00:00.000Z" } }, { requestBody: body({ loginId: "dotori", password: "safe-password-123" }) }) },
    "/auth/logout": { post: operation("인증", "로그아웃", "현재 Refresh Token을 폐기하고 브라우저의 Refresh 쿠키를 삭제할 때 사용합니다.", 204, undefined, { security: [{ bearerAuth: [] }, { refreshCookie: [] }] }) },
    "/auth/token/refresh": { post: operation("인증", "Access Token 재발급", "Access Token 만료 시 Refresh 쿠키를 검증하고 토큰을 회전해 새 Access Token을 발급합니다.", 200, { data: { accessToken: "new.access.jwt.token", accessTokenExpiresAt: "2026-08-07T00:00:00.000Z" } }, { security: refreshSecurity }) },
    "/auth/find-id": { post: operation("인증", "아이디 찾기", "가입 이메일로 아이디 찾기를 요청합니다. 계정 존재 여부를 노출하지 않도록 항상 같은 메시지를 반환합니다.", 202, { data: { message: "일치하는 계정이 있으면 아이디 안내를 기록했습니다." } }, { requestBody: body({ email: "parent@example.com" }) }) },
    "/auth/reset-password/request": { post: operation("인증", "비밀번호 재설정 요청", "아이디와 이메일이 일치하면 30분짜리 재설정 토큰을 기록합니다. 운영에서는 토큰을 응답하지 않습니다.", 202, { data: { message: "일치하는 계정이 있으면 비밀번호 재설정 안내를 기록했습니다." } }, { requestBody: body({ loginId: "dotori", email: "parent@example.com" }) }) },
    "/auth/reset-password/confirm": { post: operation("인증", "비밀번호 재설정 확정", "일회성 재설정 토큰으로 새 비밀번호를 저장하고 기존 Refresh 세션을 모두 폐기합니다.", 204, undefined, { requestBody: body({ resetToken: "one-time-reset-token-value", newPassword: "new-safe-password-123" }) }) },
    "/me": {
      get: operation("마이페이지", "내 정보 조회", "마이페이지 진입 시 로그인한 회원의 공개 가능한 기본 정보를 조회합니다.", 200, { data: userExample }, { security: bearerSecurity }),
      patch: operation("마이페이지", "내 정보 수정", "회원 이름 또는 알림 수신 여부를 변경할 때 사용합니다.", 200, { data: { ...userExample, name: "변경된 보호자" } }, { security: bearerSecurity, requestBody: body({ name: "변경된 보호자", notificationEnabled: false }) }),
      delete: operation("마이페이지", "회원 탈퇴", "비밀번호를 다시 확인한 뒤 계정을 비활성화하고 보존 의무가 없는 개인정보를 삭제·익명화합니다.", 204, undefined, { security: bearerSecurity, requestBody: body({ password: "safe-password-123", reason: "서비스를 더 이상 이용하지 않음" }) }),
    },
    "/me/password": { post: operation("마이페이지", "로그인 비밀번호 변경", "로그인 상태에서 현재 비밀번호를 확인해 새 비밀번호로 변경하고 다른 Refresh 세션을 폐기합니다.", 204, undefined, { security: bearerSecurity, requestBody: body({ currentPassword: "safe-password-123", newPassword: "new-safe-password-123" }) }) },
    "/me/consents": { get: operation("마이페이지", "약관 동의 이력 조회", "회원가입과 자녀 데이터 처리 과정에서 저장된 약관 동의·철회 이력을 확인합니다.", 200, { data: [{ id: uuid, type: "PRIVACY", version: "1.0", agreed: true, agreedAt: "2026-08-06T00:00:00.000Z" }] }, { security: bearerSecurity }) },
    "/me/data-export": { post: operation("마이페이지", "개인 데이터 내보내기", "내 계정·자녀·성격·동화·주문 데이터를 JSON 파일로 비동기 생성합니다. 준비된 뒤 다시 호출하면 다운로드 URL을 반환합니다.", 202, { data: { exportId: uuid, status: "QUEUED" } }, { security: bearerSecurity }) },

    "/children": {
      get: operation("자녀", "자녀 목록 조회", "동화 제작 또는 성격 분석에서 사용할 로그인 회원의 자녀 프로필 목록을 조회합니다.", 200, { data: [childExample] }, { security: bearerSecurity }),
      post: operation("자녀", "자녀 프로필 등록", "맞춤 동화와 성격 분석에 사용할 자녀 기본 정보를 새로 저장합니다.", 201, { data: childExample }, { security: bearerSecurity, requestBody: body({ name: "시우", birthDate: "2021-05-04", gender: "MALE", interests: ["공룡", "기차"], pronouns: "시우", notes: "큰 소리에 예민함" }) }),
    },
    "/children/{childId}": {
      get: operation("자녀", "자녀 상세 조회", "자녀 프로필을 수정하거나 동화를 만들기 전에 상세 정보를 조회합니다.", 200, { data: childExample }, { security: bearerSecurity, parameters: [pathParameter("childId", "자녀 ID")] }),
      patch: operation("자녀", "자녀 프로필 수정", "관심사나 참고 사항 등 기존 자녀 정보를 일부 변경합니다.", 200, { data: { ...childExample, interests: ["우주", "로봇"] } }, { security: bearerSecurity, parameters: [pathParameter("childId", "자녀 ID")], requestBody: body({ interests: ["우주", "로봇"], notes: "새로운 환경을 좋아함" }) }),
      delete: operation("자녀", "자녀 프로필 삭제", "자녀 프로필과 미구매 초안을 정리합니다. 구매 동화에 필요한 정보는 익명화해 보존합니다.", 204, undefined, { security: bearerSecurity, parameters: [pathParameter("childId", "자녀 ID")] }),
    },
    "/personality/assessments": { post: operation("성격 분석", "성격 분석 시작", "보호자 동의를 기록하고 자녀 성격 설문 10문항을 시작할 때 사용합니다.", 201, { data: { assessmentId: uuid, questions: [{ id: "E1", text: "새로운 친구에게 먼저 다가가는 편인가요?", axis: "E" }], currentStep: 0 } }, { security: bearerSecurity, requestBody: body({ childId: uuid, guardianConsent: true, consentVersion: "1.0" }) }) },
    "/personality/assessments/{id}": {
      get: operation("성격 분석", "성격 분석 진행 상태 조회", "중단했던 설문을 이어서 작성하거나 현재 응답률과 결과를 확인합니다.", 200, { data: { assessmentId: uuid, answers: { E1: 4 }, progress: 10, status: "IN_PROGRESS" } }, { security: bearerSecurity, parameters: [pathParameter("id", "성격 분석 ID")] }),
      patch: operation("성격 분석", "성격 분석 답변 저장", "설문 화면에서 한 개 이상의 답변을 임시 저장하고 진행률을 갱신합니다.", 200, { data: { assessmentId: uuid, answers: { E1: 4, E2: 2 }, progress: 20, tiebreakerQuestions: [], updatedAt: "2026-08-06T00:00:00.000Z" } }, { security: bearerSecurity, parameters: [pathParameter("id", "성격 분석 ID")], requestBody: body({ answers: [{ questionId: "E1", value: 4 }, { questionId: "E2", value: 2 }] }) }),
    },
    "/personality/assessments/{id}/submit": { post: operation("성격 분석", "성격 분석 제출", "10개 필수 답변을 점수와 보호자 친화적 성격 문구로 변환해 분석을 완료합니다.", 200, { data: { assessmentId: uuid, scores: { E: 75, N: 50, C: 63, Q: 88, S: 75 }, labels: ["친구에게 먼저 다가가는 아이", "마음을 섬세하게 느끼는 아이", "마음을 차근차근 조절하는 아이", "새로운 것을 탐색하는 아이", "다른 마음을 다정히 살피는 아이"], submittedAt: "2026-08-06T00:00:00.000Z" } }, { security: bearerSecurity, parameters: [pathParameter("id", "성격 분석 ID")] }) },
    "/children/{childId}/personality": {
      put: operation("성격 분석", "성격 결과를 자녀에게 적용", "제출한 분석 결과를 자녀 프로필에 저장합니다. 보호자가 필요하면 축별 점수를 보정할 수 있습니다.", 200, { data: { scores: { E: 75, N: 50, C: 63, Q: 88, S: 75 }, labels: ["친구에게 먼저 다가가는 아이"], overridden: true, assessmentId: uuid } }, { security: bearerSecurity, parameters: [pathParameter("childId", "자녀 ID")], requestBody: body({ assessmentId: uuid, overrides: { E: 75 } }) }),
      get: operation("성격 분석", "저장된 자녀 성격 조회", "동화 개인화 입력이나 자녀 프로필 화면에서 최종 적용된 성격 결과를 조회합니다.", 200, { data: { scores: { E: 75, N: 50, C: 63, Q: 88, S: 75 }, labels: ["친구에게 먼저 다가가는 아이"], overridden: false, assessmentId: uuid } }, { security: bearerSecurity, parameters: [pathParameter("childId", "자녀 ID")] }),
    },

    "/stories/drafts": { post: operation("동화", "동화 초안 생성", `맞춤 동화 제작을 시작할 때 빈 초안을 만듭니다. ${anyAuthDescription}`, 201, { data: { draftId: uuid, storyType: "SITUATION", currentStep: 1, missingFields: ["childId|childInfo", "worldId", "illustrationStyleId", "context", "tone", "cast.guardianConsent"] } }, { security: bearerSecurity, requestBody: body({ storyType: "SITUATION" }) }) },
    "/stories/drafts/{draftId}": { patch: operation("동화", "동화 초안 단계별 저장", "자녀, 세계관, 화풍, 상황, 교훈과 등장인물 선택을 단계별로 합쳐 저장합니다.", 200, { data: { draftId: uuid, currentStep: 5, missingFields: [], storyType: "SITUATION", worldId: "dinosaur-island", illustrationStyleId: "WATERCOLOR" } }, { security: bearerSecurity, parameters: [pathParameter("draftId", "동화 초안 ID")], requestBody: body({ childInfo: { name: "시우", age: 5, interests: ["공룡"] }, worldId: "dinosaur-island", illustrationStyleId: "WATERCOLOR", context: { lifeEvents: ["첫 등원"], emotions: ["걱정"], desiredFeeling: "용기를 얻기" }, tone: { lessonId: "COURAGE", toneId: "WARM" }, cast: { guardianConsent: true } }) }) },
    "/stories/drafts/{draftId}/parent-avatar": { post: operation("동화", "등장인물 아바타 생성", "부모가 동의한 사진을 업로드해 원본은 저장하지 않고 동화용 캐릭터 이미지로 변환합니다. image는 JPG/PNG/WEBP 파일입니다.", 201, { data: { avatarId: uuid, characterRole: "CHILD", imageUrl: `/api/v1/files/${uuid}?expires=1786000000&signature=example` } }, { security: bearerSecurity, parameters: [pathParameter("draftId", "동화 초안 ID")], requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["image", "characterRole"], properties: { image: { type: "string", format: "binary" }, characterRole: { type: "string", example: "CHILD" } } } } } } }) },
    "/stories/drafts/{draftId}/generate": { post: operation("동화", "AI 동화 생성 요청", "필수 입력이 완료된 초안을 인메모리 생성 큐에 넣습니다. 응답받은 jobId로 진행 상태를 조회합니다.", 202, { data: { jobId: uuid, status: "QUEUED", stage: "TEXT", progress: 0 } }, { security: bearerSecurity, parameters: [pathParameter("draftId", "동화 초안 ID")] }) },
    "/stories/generations/{jobId}": { get: operation("동화", "AI 생성 진행 상태 조회", "동화 텍스트·표지·삽화 생성의 단계와 진행률을 폴링할 때 사용합니다.", 200, { data: { jobId: uuid, draftId: uuid, status: "PROCESSING", stage: "IMAGES", progress: 60, errorCode: null, completedAt: null } }, { security: bearerSecurity, parameters: [pathParameter("jobId", "생성 작업 ID")] }) },
    "/stories/drafts/{draftId}/preview": { get: operation("동화", "생성 동화 미리보기", "AI 생성이 끝난 뒤 구매 전에 제목, 본문, 워터마크 이미지와 대화 질문을 확인합니다.", 200, { data: { draftId: uuid, title: "토리와 용기의 씨앗", coverUrl: `/api/v1/files/${uuid}?expires=1786000000&signature=example`, pages: [{ pageNumber: 1, text: "시우는 토리와 함께 첫걸음을 내디뎠어요.", imageUrl: `/api/v1/files/${uuid}?expires=1786000000&signature=example` }], parentQuestions: ["오늘 어떤 마음이 들었나요?", "토리에게 무엇을 말하고 싶나요?", "다음에는 어떤 용기를 내고 싶나요?"] } }, { security: bearerSecurity, parameters: [pathParameter("draftId", "동화 초안 ID")] }) },
    "/stories/drafts/{draftId}/regenerate": { post: operation("동화", "동화 재생성", "구매·최종 승인 전 결과를 전체 또는 일부 다시 만들 때 크레딧을 차감하고 생성 작업을 등록합니다.", 202, { data: { jobId: uuid, status: "QUEUED", creditsRemaining: 0 } }, { security: bearerSecurity, parameters: [pathParameter("draftId", "동화 초안 ID")], requestBody: body({ scope: "FULL", instruction: "조금 더 다정하고 짧게 바꿔 주세요." }) }) },
    "/stories/drafts/{draftId}/checkout": { post: operation("동화", "동화 결제 및 구매", "미리보기를 확인한 회원이 디지털 동화 또는 실물 상품 구매를 확정할 때 사용합니다. 현재 구현은 외부 PG 없이 즉시 결제 완료 처리합니다.", 201, { data: { order: { id: uuid, amount: 0, paymentStatus: "PAID", orderStatus: "COMPLETED" }, paymentStatus: "PAID", storyId: uuid } }, { security: bearerSecurity, parameters: [pathParameter("draftId", "동화 초안 ID")], requestBody: body({ planId: "DIGITAL_MONTHLY", productId: "HARDCOVER", shipping: { recipient: "도토리 보호자", address: "서울시 예시구 도토리로 1" }, giftMessage: "시우에게 사랑을 담아" }) }) },
    "/stories/drafts/{draftId}/final-approval": { post: operation("동화", "인쇄 전 최종 승인", "구매한 동화 내용과 환불 제한 안내를 보호자가 확인한 뒤 인쇄 가능 상태로 잠급니다.", 200, { data: { approvedAt: "2026-08-06T00:00:00.000Z", printStatus: "COMPLETED" } }, { security: bearerSecurity, parameters: [pathParameter("draftId", "동화 초안 ID")], requestBody: body({ approved: true, refundWaiverAccepted: true }) }) },
    "/me/stories": { get: operation("보관함", "내 동화 목록 조회", "구매 완료된 동화를 마이페이지 보관함에서 페이지 단위로 조회합니다.", 200, { data: [{ storyId: uuid, title: "토리와 용기의 씨앗", coverPreviewUrl: `/api/v1/files/${uuid}?expires=1786000000&signature=example`, childName: "시우", storyType: "SITUATION", createdAt: "2026-08-06T00:00:00.000Z", finalApproved: true }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }, { security: bearerSecurity, parameters: paginationParameters }) },
    "/me/stories/{storyId}": {
      get: operation("보관함", "내 동화 상세 조회", "보관함에서 구매한 동화의 전체 본문, 삽화와 부모 대화 질문을 읽을 때 사용합니다.", 200, { data: { storyId: uuid, title: "토리와 용기의 씨앗", coverUrl: `/api/v1/files/${uuid}?expires=1786000000&signature=example`, pages: [{ pageNumber: 1, text: "시우는 토리와 첫걸음을 내디뎠어요.", imageUrl: `/api/v1/files/${uuid}?expires=1786000000&signature=example` }] } }, { security: bearerSecurity, parameters: [pathParameter("storyId", "구매 동화 ID")] }),
      delete: operation("보관함", "내 동화 삭제", "보관함에서 동화를 숨기고 관련 파일을 30일 뒤 삭제하도록 예약합니다.", 204, undefined, { security: bearerSecurity, parameters: [pathParameter("storyId", "구매 동화 ID")] }),
    },

    "/me/credits": { get: operation("결제·주문", "재생성 크레딧 조회", "AI 동화 재생성에 사용할 현재 크레딧과 증감 이력을 조회합니다.", 200, { data: { balance: 1, transactions: [{ id: uuid, amount: 1, balanceAfter: 1, type: "SUBSCRIPTION", createdAt: "2026-08-06T00:00:00.000Z" }] }, meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }, { security: bearerSecurity, parameters: paginationParameters }) },
    "/me/subscription": {
      get: operation("결제·주문", "내 구독 조회", "현재 디지털 월 구독 상태와 다음 결제 기간을 확인합니다.", 200, { data: { id: uuid, planId: "DIGITAL_MONTHLY", status: "ACTIVE", startedAt: "2026-08-06T00:00:00.000Z", currentPeriodEnd: "2026-09-06T00:00:00.000Z", cancelAtPeriodEnd: false } }, { security: bearerSecurity }),
      post: operation("결제·주문", "디지털 구독 시작", "월간 디지털 구독을 즉시 활성화하고 동화 재생성 크레딧 1개를 지급합니다.", 201, { data: { id: uuid, planId: "DIGITAL_MONTHLY", status: "ACTIVE", paymentStatus: "PAID" } }, { security: bearerSecurity, requestBody: body({ planId: "DIGITAL_MONTHLY", paymentMethodToken: "mock-payment-token" }) }),
      delete: operation("결제·주문", "구독 해지 예약", "활성 구독을 즉시 삭제하지 않고 현재 이용 기간 종료 시 해지되도록 예약합니다.", 200, { data: { id: uuid, planId: "DIGITAL_MONTHLY", status: "ACTIVE", cancelAtPeriodEnd: true } }, { security: bearerSecurity }),
    },
    "/cart": { get: operation("결제·주문", "장바구니 조회", "실물 동화책과 선물 상품의 현재 장바구니, 적용 단가와 합계를 조회합니다.", 200, { data: { items: [{ itemId: uuid, productId: "HARDCOVER", quantity: 1, subtotal: 29000 }], total: 29000, currency: "KRW" } }, { security: bearerSecurity }) },
    "/cart/items": { post: operation("결제·주문", "장바구니 상품 추가", "구매할 실물 상품과 연결할 동화, 수량, 선택 옵션을 장바구니에 담습니다.", 201, { data: { itemId: uuid, productId: "HARDCOVER", quantity: 1, storyId: uuid, options: { coverMessage: "시우에게" } } }, { security: bearerSecurity, requestBody: body({ productId: "HARDCOVER", quantity: 1, storyId: uuid, options: { coverMessage: "시우에게" } }) }) },
    "/cart/items/{itemId}": {
      patch: operation("결제·주문", "장바구니 상품 수정", "장바구니에 담은 상품의 수량이나 제작 옵션을 변경합니다.", 200, { data: { itemId: uuid, productId: "HARDCOVER", quantity: 2, options: { coverMessage: "사랑하는 시우에게" } } }, { security: bearerSecurity, parameters: [pathParameter("itemId", "장바구니 항목 ID")], requestBody: body({ quantity: 2, options: { coverMessage: "사랑하는 시우에게" } }) }),
      delete: operation("결제·주문", "장바구니 상품 삭제", "구매하지 않을 상품 한 건을 장바구니에서 제거합니다.", 204, undefined, { security: bearerSecurity, parameters: [pathParameter("itemId", "장바구니 항목 ID")] }),
    },
    "/orders": {
      post: operation("결제·주문", "주문 생성", "요청 items 또는 현재 장바구니 상품으로 주문을 만들고 즉시 결제·주문 완료 처리합니다.", 201, { data: { orderId: uuid, items: [{ productId: "HARDCOVER", quantity: 1, amount: 29000 }], amount: 29000, paymentStatus: "PAID", orderStatus: "COMPLETED", carrier: null, trackingNumber: null } }, { security: bearerSecurity, requestBody: body({ items: [{ productId: "HARDCOVER", quantity: 1, storyId: uuid, options: { coverMessage: "시우에게" } }], shipping: { recipient: "도토리 보호자", phone: "010-1234-5678", address: "서울시 예시구 도토리로 1" }, giftMessage: "사랑을 담아" }) }),
      get: operation("결제·주문", "주문 목록 조회", "로그인 회원의 주문 이력을 최신 페이지 단위로 조회합니다.", 200, { data: [{ orderId: uuid, amount: 29000, paymentStatus: "PAID", orderStatus: "COMPLETED", createdAt: "2026-08-06T00:00:00.000Z" }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }, { security: bearerSecurity, parameters: paginationParameters }),
    },
    "/orders/{orderId}": { get: operation("결제·주문", "주문 상세 조회", "주문 완료 화면과 주문 내역에서 상품, 결제, 배송 정보를 조회합니다.", 200, { data: { orderId: uuid, items: [{ productId: "HARDCOVER", quantity: 1, amount: 29000 }], amount: 29000, paymentStatus: "PAID", orderStatus: "COMPLETED", carrier: null, trackingNumber: null, createdAt: "2026-08-06T00:00:00.000Z" } }, { security: bearerSecurity, parameters: [pathParameter("orderId", "주문 ID")] }) },
    "/gifts": { post: operation("결제·주문", "선물 코드 발급", "완료된 주문을 다른 사람에게 전달할 수 있도록 90일 유효한 선물 코드를 발급합니다.", 201, { data: { giftId: uuid, giftCode: "gift-code-value", status: "ISSUED", expiresAt: "2026-11-04T00:00:00.000Z" } }, { security: bearerSecurity, requestBody: body({ orderId: uuid, message: "시우의 생일을 축하해요!" }) }) },
    "/gifts/{giftCode}": { get: operation("결제·주문", "선물 코드 확인", "선물을 받은 사용자가 로그인 전에도 코드 상태, 메시지와 만료일을 확인합니다.", 200, { data: { giftId: uuid, status: "ISSUED", message: "시우의 생일을 축하해요!", expiresAt: "2026-11-04T00:00:00.000Z" } }, { parameters: [pathParameter("giftCode", "선물 코드", "gift-code-value")] }) },

    "/catalog/worlds": { get: operation("카탈로그", "세계관 목록 조회", "동화 제작 단계에서 아이에게 보여 줄 배경 세계관 선택지를 조회합니다.", 200, { data: [{ id: "dinosaur-island", name: "공룡섬", description: "친절한 공룡들이 사는 모험의 섬", recommendedAges: [4, 7], thumbnailUrl: null }] }) },
    "/catalog/worlds/{id}": { get: operation("카탈로그", "세계관 상세 조회", "선택한 세계관의 설명과 호환되는 교훈·톤을 확인합니다.", 200, { data: { id: "dinosaur-island", name: "공룡섬", description: "친절한 공룡들이 사는 모험의 섬", recommendedAges: [4, 7], compatibleLessonIds: ["COURAGE", "KINDNESS"], compatibleToneIds: ["WARM", "ADVENTUROUS"], thumbnailUrl: null } }, { parameters: [pathParameter("id", "세계관 ID", "dinosaur-island")] }) },
    "/catalog/illustration-styles": { get: operation("카탈로그", "그림체 목록 조회", "동화 삽화 생성 전에 수채화, 색연필, 클레이 3D 중 그림체를 선택합니다.", 200, { data: [{ id: "WATERCOLOR", name: "수채화", description: "부드럽고 투명한 수채화", previewUrl: null }] }) },
    "/catalog/tags": { get: operation("카탈로그", "동화 태그 조회", "관심사, 감정, 상황, 교훈, 분위기와 제외 조건 선택지를 조회합니다. group을 생략하면 전체를 반환합니다.", 200, { data: [{ id: "COURAGE", group: "LESSON", name: "용기", compatibleWorldIds: ["story-forest", "dinosaur-island"] }] }, { parameters: [{ in: "query", name: "group", required: false, description: "조회할 태그 그룹", schema: { type: "string", enum: ["INTEREST", "EMOTION", "SITUATION", "LESSON", "TONE", "NEGATIVE"] }, example: "LESSON" }] }) },
    "/billing/plans": { get: operation("카탈로그", "요금제 목록 조회", "구독 및 동화 결제 화면에서 가격과 제공 내용을 표시합니다.", 200, { data: [{ id: "DIGITAL_MONTHLY", name: "디지털 월 구독", price: 9900, currency: "KRW", interval: "MONTH", storiesPerPeriod: 1 }] }) },
    "/products": { get: operation("카탈로그", "판매 상품 목록 조회", "장바구니 화면에서 구매 가능한 양장본, 선물 패키지와 키링을 조회합니다.", 200, { data: [{ id: "HARDCOVER", name: "맞춤 동화 양장본", price: 39000, subscriberPrice: 29000, options: ["coverMessage"], active: true }] }) },

    "/reports": { post: operation("지원", "동화 콘텐츠 신고", `부적절한 초안 또는 구매 동화를 운영 검토 대상으로 접수합니다. ${anyAuthDescription}`, 201, { data: { reportId: uuid, status: "RECEIVED" } }, { security: bearerSecurity, requestBody: body({ draftId: uuid, category: "UNSAFE_CONTENT", description: "아이에게 무서울 수 있는 장면이 포함되어 있어요." }) }) },
    "/b2b/inquiries": { post: operation("지원", "기관 도입 문의", "유치원, 어린이집 등 기관 담당자가 대량 도입 상담을 신청합니다.", 202, { data: { inquiryId: uuid, message: "문의가 접수되었습니다." } }, { requestBody: body({ organizationName: "도토리 유치원", contactName: "김선생", email: "teacher@example.com", phone: "010-1234-5678", organizationType: "KINDERGARTEN", estimatedVolume: 20, message: "맞춤 동화 프로그램 도입을 문의합니다.", privacyConsent: true }) }) },
    "/files/{fileId}": { get: operation("파일", "서명 파일 다운로드", "API가 발급한 만료 시간과 HMAC 서명이 포함된 URL로 비공개 이미지 또는 데이터 파일을 읽습니다.", 200, undefined, { parameters: [pathParameter("fileId", "저장 파일 ID"), { in: "query", name: "expires", required: true, description: "URL 만료 Unix timestamp", schema: { type: "integer" }, example: 1786000000 }, { in: "query", name: "signature", required: true, description: "서버가 생성한 HMAC 서명", schema: { type: "string" }, example: "signed-value" }], responses: { 200: { description: "파일 바이너리", content: { "image/webp": { schema: { type: "string", format: "binary" } }, "application/json": { schema: { type: "string", format: "binary" } } } }, ...errorResponses } }) },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: authDescription },
      refreshCookie: { type: "apiKey", in: "cookie", name: config.REFRESH_COOKIE_NAME, description: "로그인·회원가입 시 자동 설정되는 HttpOnly Refresh Token 쿠키" },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string", example: "VALIDATION_FAILED" }, message: { type: "string", example: "입력값을 확인해 주세요." }, details: { type: "array", items: { type: "object" } } } } },
      },
    },
    responses: {
      BadRequest: { description: "요청값 검증 실패", content: jsonContent({ error: { code: "VALIDATION_FAILED", message: "입력값을 확인해 주세요.", details: [{ field: "email", message: "Invalid email address" }] } }) },
      Unauthorized: { description: "인증 필요 또는 토큰 만료", content: jsonContent({ error: { code: "AUTHENTICATION_REQUIRED", message: "회원 인증이 필요합니다." } }) },
      Forbidden: { description: "권한 또는 보호자 동의 부족", content: jsonContent({ error: { code: "FORBIDDEN", message: "이 리소스에 접근할 수 없습니다." } }) },
      NotFound: { description: "리소스 없음", content: jsonContent({ error: { code: "NOT_FOUND", message: "요청한 리소스를 찾을 수 없습니다." } }) },
      Conflict: { description: "중복 또는 현재 상태 충돌", content: jsonContent({ error: { code: "CONFLICT", message: "현재 상태에서는 요청을 처리할 수 없습니다." } }) },
      RateLimited: { description: "요청 횟수 제한 초과", content: jsonContent({ error: { code: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." } }) },
      InternalError: { description: "서버 내부 오류", content: jsonContent({ error: { code: "INTERNAL_ERROR", message: "서버 내부 오류가 발생했습니다." } }) },
    },
  },
} as const;
