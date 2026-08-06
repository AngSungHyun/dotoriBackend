import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import sharp from "sharp";
import { z } from "zod";
import { config } from "../config.js";
import { billingPlans, illustrationStyles, products, worlds } from "../domain/catalog.js";
import type { Store, StoredRecord } from "../domain/types.js";
import { asyncRoute, ApiError, parse } from "../lib/errors.js";
import { assertOwner, paginate, paginationSchema, requireAuthFor, routeParam } from "../lib/http.js";
import type { AiService } from "../services/openai.js";
import type { FileService } from "../services/file-service.js";
import { GenerationQueue, type StoryDraftData } from "../services/generation-queue.js";

type ChildData = { name: string; birthDate: string; interests: string[] };
type JobData = { draftId: string; type: string; stage: string; progress: number; errorCode?: string | null; completedAt?: string | null };
type StoryData = { draftId: string; childId?: string; childName: string; title: string; storyType: string; coverFileId: string; coverPreviewFileId: string; pages: Array<{ pageNumber: number; text: string; fileId: string }>; parentQuestions: string[]; orderId: string; finalApprovedAt?: string; deletedAt?: string; fileDestructionScheduledAt?: string };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.UPLOAD_MAX_MB * 1024 * 1024, files: 1 } });
const generationLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "생성 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." } }) });
const storyPatchSchema = z.object({
  storyType: z.enum(["VALUE", "SITUATION", "GROWTH"]).optional(), childId: z.string().uuid().optional(),
  childInfo: z.object({ name: z.string().min(1).max(50).optional(), age: z.number().int().min(3).max(7).optional(), interests: z.array(z.string()).max(20).optional() }).optional(),
  worldId: z.string().optional(), illustrationStyleId: z.enum(["WATERCOLOR", "COLORED_PENCIL", "CLAY_3D"]).optional(),
  context: z.object({ lifeEvents: z.array(z.string()).max(10).optional(), emotions: z.array(z.string()).max(10).optional(), recentScene: z.string().max(1000).optional(), desiredFeeling: z.string().max(500).optional(), negativeConstraints: z.array(z.string().max(200)).max(20).optional() }).optional(),
  tone: z.object({ lessonId: z.string().optional(), toneId: z.string().optional() }).optional(),
  cast: z.object({ castAssignments: z.array(z.object({ role: z.string(), name: z.string().min(1).max(50) })).max(10).optional(), guardianConsent: z.boolean().optional() }).optional(),
}).strict();

function deepMerge<T extends Record<string, unknown>>(current: T, patch: Partial<T>): T {
  const result: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const previous = result[key];
    result[key] = value && typeof value === "object" && !Array.isArray(value) && previous && typeof previous === "object" && !Array.isArray(previous)
      ? deepMerge(previous as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return result as T;
}

function draftProgress(data: StoryDraftData): { currentStep: number; missingFields: string[] } {
  const missing: string[] = [];
  if (!data.storyType) missing.push("storyType");
  if (!data.childId && !(data.childInfo?.name && data.childInfo?.age)) missing.push("childId|childInfo");
  if (!data.worldId) missing.push("worldId");
  if (!data.illustrationStyleId) missing.push("illustrationStyleId");
  if (!data.context?.desiredFeeling) missing.push("context.desiredFeeling");
  if (!data.tone?.lessonId || !data.tone?.toneId) missing.push("tone");
  if (data.cast?.guardianConsent !== true) missing.push("cast.guardianConsent");
  let currentStep = 0;
  if (data.childId || (data.childInfo?.name && data.childInfo?.age)) currentStep = 1;
  if (currentStep === 1 && data.worldId && data.illustrationStyleId) currentStep = 2;
  if (currentStep === 2 && data.context?.desiredFeeling) currentStep = 3;
  if (currentStep === 3 && data.tone?.lessonId && data.tone?.toneId) currentStep = 4;
  if (currentStep === 4 && data.cast?.guardianConsent === true) currentStep = 5;
  return { currentStep, missingFields: missing };
}

function ageFromBirthDate(birthDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00Z`); const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

async function resolvedDraft(store: Store, draft: StoredRecord<StoryDraftData>, userId?: string): Promise<StoryDraftData> {
  const data = structuredClone(draft.data);
  if (data.childId) {
    if (!userId) throw new ApiError(400, "VALIDATION_FAILED", "게스트는 childInfo를 사용해야 합니다.");
    const child = await store.get<ChildData>("child", data.childId);
    if (!child || child.ownerId !== userId) throw new ApiError(403, "FORBIDDEN", "자녀 프로필에 접근할 수 없습니다.");
    data.childInfo = { name: child.data.name, age: ageFromBirthDate(child.data.birthDate), interests: child.data.interests };
  }
  const progress = draftProgress(data);
  if (progress.missingFields.length) throw new ApiError(400, "VALIDATION_FAILED", "초안의 필수 단계를 완료해 주세요.", progress.missingFields.map((field) => ({ field, message: "필수값입니다." })));
  if (data.childInfo!.age! < 3 || data.childInfo!.age! > 7) throw new ApiError(400, "VALIDATION_FAILED", "동화 생성 대상 연령은 만 3~7세입니다.");
  const world = worlds.find((item) => item.id === data.worldId);
  if (!world) throw new ApiError(400, "VALIDATION_FAILED", "세계관이 올바르지 않습니다.");
  if (!illustrationStyles.some((item) => item.id === data.illustrationStyleId)) throw new ApiError(400, "VALIDATION_FAILED", "그림체가 올바르지 않습니다.");
  if (!world.compatibleLessonIds.includes(data.tone!.lessonId!) || !world.compatibleToneIds.includes(data.tone!.toneId!)) throw new ApiError(400, "VALIDATION_FAILED", "세계관과 교훈 또는 톤이 호환되지 않습니다.");
  return data;
}

export function storiesRouter(store: Store, files: FileService, ai: AiService, queue: GenerationQueue): Router {
  const router = Router();
  const anyAuth = requireAuthFor(store);
  const memberAuth = requireAuthFor(store, true);

  // 역할/사용 시점: 회원 또는 게스트가 맞춤 동화 제작 흐름에 진입할 때 소유권이 있는 빈 초안을 만든다.
  router.post("/stories/drafts", anyAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ storyType: z.enum(["VALUE", "SITUATION", "GROWTH"]).default("VALUE") }), req.body);
    const record = await store.create<StoryDraftData>("storyDraft", { ownerId: req.auth!.userId, guestId: req.auth!.guestSessionId, status: "DRAFT", data: { storyType: body.storyType, regenerateCount: 0 } });
    res.status(201).json({ data: { draftId: record.id, status: record.status, currentStep: 0 } });
  }));
  // 역할/사용 시점: 자녀·세계관·화풍·상황·교훈·등장인물 선택을 단계별로 병합 저장한다.
  router.patch("/stories/drafts/:draftId", anyAuth, asyncRoute(async (req, res) => {
    const body = parse(storyPatchSchema, req.body); const draft = await store.get<StoryDraftData>("storyDraft", routeParam(req.params.draftId)); assertOwner(draft, req.auth);
    if (draft.data.finalApprovedAt) throw new ApiError(409, "CONFLICT", "최종 승인된 동화는 수정할 수 없습니다.");
    if (body.childId && body.childInfo) throw new ApiError(400, "VALIDATION_FAILED", "childId와 childInfo는 동시에 사용할 수 없습니다.");
    if (req.auth!.guestSessionId && body.childId) throw new ApiError(400, "VALIDATION_FAILED", "게스트는 childInfo만 사용할 수 있습니다.");
    const data = deepMerge(draft.data as Record<string, unknown>, body as Record<string, unknown>) as StoryDraftData;
    if (body.childId) delete data.childInfo; if (body.childInfo) delete data.childId;
    const progress = draftProgress(data); const updated = await store.update<StoryDraftData>("storyDraft", draft.id, { data });
    res.json({ data: { draftId: draft.id, status: updated!.status, ...data, ...progress } });
  }));
  // 역할/사용 시점: 동의받은 가족 사진을 캐릭터로 변환하되 개인정보 보호를 위해 원본 사진은 저장하지 않는다.
  router.post("/stories/drafts/:draftId/parent-avatar", anyAuth, generationLimiter, upload.single("image"), asyncRoute(async (req, res) => {
    const draft = await store.get<StoryDraftData>("storyDraft", routeParam(req.params.draftId)); assertOwner(draft, req.auth);
    if (draft.data.cast?.guardianConsent !== true) throw new ApiError(403, "GUARDIAN_CONSENT_REQUIRED", "보호자 동의가 필요합니다.");
    if (!req.file) throw new ApiError(400, "VALIDATION_FAILED", "image 파일이 필요합니다.");
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) throw new ApiError(400, "VALIDATION_FAILED", "JPEG, PNG, WebP 이미지만 업로드할 수 있습니다.");
    try { await sharp(req.file.buffer).metadata(); } catch { throw new ApiError(400, "VALIDATION_FAILED", "이미지 파일을 해석할 수 없습니다."); }
    const role = parse(z.enum(["GUARDIAN", "CHILD"]).default("GUARDIAN"), req.body.characterRole);
    await ai.checkImageSafety(req.file.buffer, req.file.mimetype);
    const transformed = await ai.generateAvatar(req.file.buffer, req.file.mimetype, `Transform this person into a safe, warm Korean children's storybook ${role.toLowerCase()} character. Preserve recognizable features, no text.`);
    const file = await files.save(transformed, "image/png", "AVATAR", draft.ownerId, draft.guestId);
    const avatarId = randomUUID(); const avatars = [...(draft.data.avatars ?? []), { avatarId, fileId: file.id, characterRole: role }];
    await store.update("storyDraft", draft.id, { data: { ...draft.data, avatars } });
    res.status(201).json({ data: { avatarId, avatarUrl: files.sign(file.id), characterRole: role, originalDeleted: true } });
  }));
  // 역할/사용 시점: 필수 입력이 끝난 초안을 AI 생성 큐에 넣고 프론트가 추적할 작업 ID를 반환한다.
  router.post("/stories/drafts/:draftId/generate", anyAuth, generationLimiter, asyncRoute(async (req, res) => {
    const draft = await store.get<StoryDraftData>("storyDraft", routeParam(req.params.draftId)); assertOwner(draft, req.auth);
    const data = await resolvedDraft(store, draft, req.auth!.userId); const updated = await store.update<StoryDraftData>("storyDraft", draft.id, { data });
    const job = await queue.enqueue(updated!); res.status(202).json({ data: { jobId: job.id, status: job.status, statusUrl: `/api/v1/stories/generations/${job.id}` } });
  }));
  // 역할/사용 시점: 생성 대기 화면에서 텍스트·이미지 단계와 진행률, 실패 코드를 주기적으로 조회한다.
  router.get("/stories/generations/:jobId", anyAuth, asyncRoute(async (req, res) => {
    const job = await store.get<JobData>("generationJob", routeParam(req.params.jobId)); assertOwner(job, req.auth);
    res.json({ data: { jobId: job.id, draftId: job.data.draftId, status: job.status, stage: job.data.stage, progress: job.data.progress, errorCode: job.data.errorCode ?? null, createdAt: job.createdAt.toISOString(), completedAt: job.data.completedAt ?? null } });
  }));
  // 역할/사용 시점: 구매 전 생성 결과의 본문, 워터마크 이미지와 부모 대화 질문을 검토한다.
  router.get("/stories/drafts/:draftId/preview", anyAuth, asyncRoute(async (req, res) => {
    const draft = await store.get<StoryDraftData>("storyDraft", routeParam(req.params.draftId)); assertOwner(draft, req.auth);
    if (!draft.data.generated) throw new ApiError(409, "GENERATION_NOT_READY", "아직 동화 생성이 완료되지 않았습니다.");
    const generated = draft.data.generated;
    res.json({ data: { title: generated.title, coverUrl: files.sign(generated.coverPreviewFileId), pages: generated.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text, imageUrl: files.sign(page.previewFileId) })), parentQuestions: generated.parentQuestions } });
  }));
  // 역할/사용 시점: 최종 승인 전 수정 요청을 크레딧으로 처리하고 전체 또는 일부 결과를 다시 생성한다.
  router.post("/stories/drafts/:draftId/regenerate", anyAuth, generationLimiter, asyncRoute(async (req, res) => {
    const body = parse(z.object({ scope: z.enum(["FULL", "TEXT", "PAGE"]), pageNumber: z.number().int().positive().optional(), instruction: z.string().trim().min(1).max(1000) }).refine((value) => value.scope !== "PAGE" || value.pageNumber !== undefined, { message: "PAGE 재생성에는 pageNumber가 필요합니다.", path: ["pageNumber"] }), req.body);
    const draft = await store.get<StoryDraftData>("storyDraft", routeParam(req.params.draftId)); assertOwner(draft, req.auth);
    if (!draft.data.generated) throw new ApiError(409, "GENERATION_NOT_READY", "먼저 동화를 생성해 주세요.");
    if (draft.data.finalApprovedAt) throw new ApiError(409, "CONFLICT", "최종 승인된 동화는 재생성할 수 없습니다.");
    const count = draft.data.regenerateCount ?? 0; if (count >= 3) throw new ApiError(409, "CONFLICT", "재생성 가능 횟수를 초과했습니다.");
    if (count >= 1 && draft.ownerId) {
      const txs = await store.find<{ amount: number; balanceAfter: number }>("creditTransaction", { ownerId: draft.ownerId }); const balance = txs[0]?.data.balanceAfter ?? 0;
      if (balance < 1) throw new ApiError(409, "INSUFFICIENT_CREDITS", "재생성 크레딧이 부족합니다.");
      await store.create("creditTransaction", { ownerId: draft.ownerId, relationId: draft.id, status: "COMPLETED", data: { amount: -1, balanceAfter: balance - 1, type: "REGENERATE", referenceId: draft.id } });
    }
    const data = { ...draft.data, regenerateCount: count + 1, regenerationRequest: body };
    const updated = await store.update<StoryDraftData>("storyDraft", draft.id, { status: "DRAFT", data }); const job = await queue.enqueue(updated!, body.scope);
    res.status(202).json({ data: { jobId: job.id, status: job.status, remainingRegenerations: 2 - count, creditsCharged: count >= 1 ? 1 : 0 } });
  }));
  // 역할/사용 시점: 미리보기 확인을 마친 회원의 결제·주문과 영구 보관용 동화 생성을 한 번에 확정한다.
  router.post("/stories/drafts/:draftId/checkout", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ planId: z.string().optional(), productId: z.string().optional(), paymentMethodToken: z.string().optional(), shipping: z.record(z.string(), z.unknown()).optional(), gift: z.record(z.string(), z.unknown()).optional() }).refine((value) => value.planId || value.productId, { message: "planId 또는 productId가 필요합니다." }), req.body);
    const draft = await store.get<StoryDraftData>("storyDraft", routeParam(req.params.draftId)); assertOwner(draft, req.auth);
    if (!draft.data.generated) throw new ApiError(409, "GENERATION_NOT_READY", "먼저 동화를 생성해 주세요.");
    const selectedProduct = body.productId ? products.find((item) => item.id === body.productId) : undefined;
    const selectedPlan = body.planId ? billingPlans.find((item) => item.id === body.planId) : undefined;
    if (!selectedProduct && !selectedPlan) throw new ApiError(404, "NOT_FOUND", "요금제 또는 상품을 찾을 수 없습니다.");
    const user = await store.get<Record<string, unknown>>("user", req.auth!.userId!); const isFree = !user?.data.freeStoryUsed && Boolean(selectedPlan?.id === "DIGITAL_MONTHLY");
    const amount = isFree ? 0 : selectedProduct?.price ?? selectedPlan!.price;
    const order = await store.create("order", { ownerId: req.auth!.userId, relationId: draft.id, status: "COMPLETED", data: { items: [{ productId: body.productId ?? body.planId, quantity: 1, amount }], amount, paymentStatus: "PAID", orderStatus: "COMPLETED", shipping: body.shipping, gift: body.gift, carrier: null, trackingNumber: null, trackingUrl: null } });
    const generated = draft.data.generated;
    const story = await store.create<StoryData>("story", { ownerId: req.auth!.userId, relationId: draft.id, status: "ACTIVE", data: { draftId: draft.id, childId: draft.data.childId, childName: draft.data.childInfo?.name ?? "아이", title: generated.title, storyType: draft.data.storyType ?? "VALUE", coverFileId: generated.coverFileId, coverPreviewFileId: generated.coverPreviewFileId, pages: generated.pages.map(({ previewFileId: _, ...page }) => page), parentQuestions: generated.parentQuestions, orderId: order.id } });
    await store.update("storyDraft", draft.id, { status: "PURCHASED", data: { ...draft.data, checkedOut: true } });
    if (isFree && user) await store.update("user", user.id, { data: { ...user.data, freeStoryUsed: true } });
    res.status(201).json({ data: { order: { id: order.id, ...order.data }, paymentStatus: "PAID", storyId: story.id } });
  }));
  // 역할/사용 시점: 구매자가 인쇄 전 내용과 환불 제한을 최종 확인해 이후 재생성을 잠근다.
  router.post("/stories/drafts/:draftId/final-approval", memberAuth, asyncRoute(async (req, res) => {
    parse(z.object({ approved: z.literal(true), refundWaiverAccepted: z.literal(true) }), req.body);
    const draft = await store.get<StoryDraftData>("storyDraft", routeParam(req.params.draftId)); assertOwner(draft, req.auth);
    if (!draft.data.checkedOut) throw new ApiError(409, "CONFLICT", "구매 완료 후 최종 승인할 수 있습니다.");
    const approvedAt = new Date().toISOString(); await store.update("storyDraft", draft.id, { status: "FINAL_APPROVED", data: { ...draft.data, finalApprovedAt: approvedAt } });
    const story = (await store.find<StoryData>("story", { relationId: draft.id }))[0]; if (story) await store.update("story", story.id, { data: { ...story.data, finalApprovedAt: approvedAt } });
    res.json({ data: { approvedAt, printStatus: "COMPLETED" } });
  }));

  // 역할/사용 시점: 마이페이지 보관함에서 구매한 동화를 페이지 단위 요약 목록으로 보여 준다.
  router.get("/me/stories", memberAuth, asyncRoute(async (req, res) => {
    const { page, pageSize } = parse(paginationSchema, req.query); const stories = (await store.find<StoryData>("story", { ownerId: req.auth!.userId })).filter((item) => !item.data.deletedAt);
    res.json(paginate(stories.map((item) => ({ storyId: item.id, title: item.data.title, coverPreviewUrl: files.sign(item.data.coverPreviewFileId), childName: item.data.childName, storyType: item.data.storyType, createdAt: item.createdAt.toISOString(), finalApproved: Boolean(item.data.finalApprovedAt) })), page, pageSize));
  }));
  // 역할/사용 시점: 보관함에서 선택한 구매 동화의 전체 본문과 원본 삽화를 읽는다.
  router.get("/me/stories/:storyId", memberAuth, asyncRoute(async (req, res) => {
    const story = await store.get<StoryData>("story", routeParam(req.params.storyId)); assertOwner(story, req.auth); if (story.data.deletedAt) throw new ApiError(404, "NOT_FOUND", "동화를 찾을 수 없습니다.");
    res.json({ data: { storyId: story.id, ...story.data, coverUrl: files.sign(story.data.coverFileId), pages: story.data.pages.map((page) => ({ ...page, imageUrl: files.sign(page.fileId) })) } });
  }));
  // 역할/사용 시점: 사용자가 보관함 동화를 삭제하면 즉시 숨기고 파일 폐기를 30일 뒤로 예약한다.
  router.delete("/me/stories/:storyId", memberAuth, asyncRoute(async (req, res) => {
    const story = await store.get<StoryData>("story", routeParam(req.params.storyId)); assertOwner(story, req.auth); const now = new Date(); const destroy = new Date(now.getTime() + 30 * 86400_000).toISOString();
    await store.update("story", story.id, { status: "DELETED", data: { ...story.data, deletedAt: now.toISOString(), fileDestructionScheduledAt: destroy } }); res.status(204).end();
  }));
  return router;
}
