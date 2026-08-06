import jwt from "jsonwebtoken";
import request from "supertest";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { signAccess } from "./lib/security.js";
import { FileService } from "./services/file-service.js";
import { GenerationQueue } from "./services/generation-queue.js";
import type { AiService, GeneratedStory } from "./services/openai.js";
import { MemoryStore } from "./store/store.js";

class FakeAiService implements AiService {
  public storyCalls = 0;
  public imageCalls = 0;
  async checkTextSafety(): Promise<void> {}
  async checkImageSafety(): Promise<void> {}
  async generateStory(): Promise<GeneratedStory> {
    this.storyCalls += 1;
    return {
      title: "토리와 용기의 씨앗",
      coverPrompt: "A child and Tori holding a glowing acorn",
      pages: Array.from({ length: config.STORY_PAGE_COUNT }, (_, index) => ({ pageNumber: index + 1, text: `${index + 1}번째 장면에서 아이는 용기를 냈어요.`, imagePrompt: `Scene ${index + 1}, child and Tori` })),
      parentQuestions: ["오늘 어떤 마음이 들었나요?", "토리에게 무엇을 말하고 싶나요?", "다음에는 어떤 용기를 내고 싶나요?"],
    };
  }
  async generateImage(): Promise<Buffer> { this.imageCalls += 1; return sharp({ create: { width: 64, height: 64, channels: 3, background: "#c98b4a" } }).png().toBuffer(); }
  async generateAvatar(): Promise<Buffer> { return this.generateImage(); }
}

async function testContext() {
  const store = new MemoryStore(); const ai = new FakeAiService(); const files = new FileService(store); await files.initialize(); const queue = new GenerationQueue(store, ai, files); await queue.recoverInterruptedJobs();
  return { store, ai, files, queue, app: createApp({ store, ai, files, queue }) };
}

async function cleanupFiles(store: MemoryStore, files: FileService) { for (const file of await store.find("storedFile")) await files.deleteFile(file.id); }

async function signup(app: ReturnType<typeof createApp>, suffix: string, guestSessionToken?: string) {
  const email = `parent-${suffix}@example.com`; const loginId = `parent${suffix}`.replace(/[^a-z0-9]/g, "").slice(0, 20);
  const verification = await request(app).post("/api/v1/auth/verify-email/request").send({ email, purpose: "SIGNUP" }).expect(202);
  const confirmed = await request(app).post("/api/v1/auth/verify-email/confirm").send({ email, purpose: "SIGNUP", code: verification.body.data.debugCode }).expect(200);
  return request(app).post("/api/v1/auth/signup").send({ loginId, email, password: "safe-password-123", name: "보호자", emailVerificationToken: confirmed.body.data.emailVerificationToken, guestSessionToken, consents: [{ type: "TERMS", version: "1.0", agreed: true }, { type: "PRIVACY", version: "1.0", agreed: true }, { type: "CHILD_DATA", version: "1.0", agreed: true }] }).expect(201);
}

describe("authentication, children, and personality", () => {
  it("issues a 24-hour token, rotates refresh tokens, and enforces ownership/consent", async () => {
    const { app, store, files } = await testContext();
    expect((await request(app).get("/api/v1/me")).body.error.code).toBe("AUTHENTICATION_REQUIRED");
    const guest = await request(app).post("/api/v1/guest/session").send({ deviceId: "test-browser" }).expect(201);
    const guestToken = guest.body.data.guestSessionToken as string;
    const guestDraft = await request(app).post("/api/v1/stories/drafts").set("Authorization", `Bearer ${guestToken}`).send({ storyType: "VALUE" }).expect(201);
    const response = await signup(app, "alpha", guestToken); const token = response.body.data.accessToken as string;
    const decoded = jwt.decode(token) as { exp: number; iat: number }; expect(decoded.exp - decoded.iat).toBe(86400);
    const refreshCookie = response.headers["set-cookie"] as unknown as string[]; expect(refreshCookie[0]).toContain("HttpOnly"); expect(refreshCookie[0]).toContain("Secure"); expect(refreshCookie[0]).toContain("SameSite=None");
    const rotated = await request(app).post("/api/v1/auth/token/refresh").set("Cookie", refreshCookie).expect(200);
    const rotatedCookie = rotated.headers["set-cookie"] as unknown as string[];
    await request(app).post("/api/v1/auth/token/refresh").set("Cookie", refreshCookie).expect(401);
    await request(app).post("/api/v1/auth/token/refresh").set("Cookie", rotatedCookie).expect(401);
    await request(app).post("/api/v1/stories/drafts").set("Authorization", `Bearer ${guestToken}`).send({ storyType: "VALUE" }).expect(401);
    await request(app).patch(`/api/v1/stories/drafts/${guestDraft.body.data.draftId}`).set("Authorization", `Bearer ${token}`).send({ childInfo: { name: "시우", age: 5 } }).expect(200);
    const child = await request(app).post("/api/v1/children").set("Authorization", `Bearer ${token}`).send({ name: "시우", birthDate: "2021-05-04", interests: ["공룡"] }).expect(201);
    await request(app).post("/api/v1/personality/assessments").set("Authorization", `Bearer ${token}`).send({ childId: child.body.data.id, guardianConsent: false }).expect(403);
    const assessment = await request(app).post("/api/v1/personality/assessments").set("Authorization", `Bearer ${token}`).send({ childId: child.body.data.id, guardianConsent: true }).expect(201);
    const answers = ["E1", "E2", "N1", "N2", "C1", "C2", "Q1", "Q2", "S1", "S2"].map((questionId) => ({ questionId, value: 4 }));
    await request(app).patch(`/api/v1/personality/assessments/${assessment.body.data.assessmentId}`).set("Authorization", `Bearer ${token}`).send({ answers }).expect(200);
    const submitted = await request(app).post(`/api/v1/personality/assessments/${assessment.body.data.assessmentId}/submit`).set("Authorization", `Bearer ${token}`).expect(200);
    expect(submitted.body.data.rawType).toBeUndefined(); expect(submitted.body.data.labels).toHaveLength(5);
    const outsider = await store.create("user", { status: "ACTIVE", data: { loginId: "outsider", email: "out@example.com" } });
    await request(app).get(`/api/v1/children/${child.body.data.id}`).set("Authorization", `Bearer ${signAccess(outsider.id).token}`).expect(403);
    await cleanupFiles(store, files);
  });
});

describe("browser deployment integration", () => {
  it("serves Swagger UI and a documented operation for every API route", async () => {
    const { app, store, files } = await testContext();
    const document = await request(app).get("/api-docs.json").expect(200);
    const methods = new Set(["get", "post", "put", "patch", "delete"]);
    const operations = Object.values(document.body.paths as Record<string, Record<string, unknown>>)
      .flatMap((path) => Object.entries(path).filter(([method]) => methods.has(method)).map(([, operation]) => operation as { summary?: string; description?: string; responses?: unknown }));
    expect(operations).toHaveLength(62);
    expect(operations.every((operation) => operation.summary && operation.description && operation.responses)).toBe(true);
    await request(app).get("/api-docs/").expect(200).expect(/도토리 API 문서/);
    await cleanupFiles(store, files);
  });

  it("allows credentialed requests from the Vercel frontend", async () => {
    const { app, store, files } = await testContext();
    const response = await request(app)
      .options("/api/v1/catalog/worlds")
      .set("Origin", "https://custom-ai-storybook-app.vercel.app")
      .set("Access-Control-Request-Method", "GET")
      .expect(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://custom-ai-storybook-app.vercel.app");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    await cleanupFiles(store, files);
  });
});

describe("story generation pipeline", () => {
  it("generates text and images asynchronously, stores previews, checks out, and locks approval", async () => {
    const { app, store, files, ai } = await testContext();
    const user = await store.create("user", { status: "ACTIVE", data: { loginId: "storyuser", email: "story@example.com", freeStoryUsed: false } }); const token = signAccess(user.id).token;
    const draft = await request(app).post("/api/v1/stories/drafts").set("Authorization", `Bearer ${token}`).send({ storyType: "SITUATION" }).expect(201);
    const draftId = draft.body.data.draftId as string;
    const updated = await request(app).patch(`/api/v1/stories/drafts/${draftId}`).set("Authorization", `Bearer ${token}`).send({ childInfo: { name: "시우", age: 5, interests: ["공룡"] }, worldId: "dinosaur-island", illustrationStyleId: "WATERCOLOR", context: { lifeEvents: ["첫 등원"], emotions: ["걱정"], desiredFeeling: "용기를 얻기" }, tone: { lessonId: "COURAGE", toneId: "WARM" }, cast: { guardianConsent: true } }).expect(200);
    expect(updated.body.data.currentStep).toBe(5);
    const avatar = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#eeeeee" } }).png().toBuffer();
    await request(app).post(`/api/v1/stories/drafts/${draftId}/parent-avatar`).set("Authorization", `Bearer ${token}`).field("characterRole", "CHILD").attach("image", avatar, { filename: "child.png", contentType: "image/png" }).expect(201);
    const generation = await request(app).post(`/api/v1/stories/drafts/${draftId}/generate`).set("Authorization", `Bearer ${token}`).expect(202);
    let job; for (let attempt = 0; attempt < 500; attempt += 1) { job = await store.get<{ stage: string; progress: number }>("generationJob", generation.body.data.jobId); if (job?.status === "SUCCEEDED") break; await new Promise((resolve) => setTimeout(resolve, 20)); }
    expect(job?.status).toBe("SUCCEEDED"); expect(ai.storyCalls).toBe(1); expect(ai.imageCalls).toBe(config.STORY_PAGE_COUNT + 2);
    const preview = await request(app).get(`/api/v1/stories/drafts/${draftId}/preview`).set("Authorization", `Bearer ${token}`).expect(200); expect(preview.body.data.pages).toHaveLength(config.STORY_PAGE_COUNT); expect(preview.body.data.parentQuestions).toHaveLength(3);
    const coverUrl = new URL(preview.body.data.coverUrl); await request(app).get(`${coverUrl.pathname}${coverUrl.search}`).expect(200).expect("Content-Type", /image\/webp/);
    const checkout = await request(app).post(`/api/v1/stories/drafts/${draftId}/checkout`).set("Authorization", `Bearer ${token}`).send({ planId: "DIGITAL_MONTHLY" }).expect(201); expect(checkout.body.data.order.paymentStatus).toBe("PAID"); expect(checkout.body.data.order.amount).toBe(0);
    await request(app).post(`/api/v1/stories/drafts/${draftId}/final-approval`).set("Authorization", `Bearer ${token}`).send({ approved: true, refundWaiverAccepted: true }).expect(200);
    await request(app).post(`/api/v1/stories/drafts/${draftId}/regenerate`).set("Authorization", `Bearer ${token}`).send({ scope: "FULL", instruction: "조금 더 다정하게" }).expect(409);
    const library = await request(app).get("/api/v1/me/stories").set("Authorization", `Bearer ${token}`).expect(200); expect(library.body.data).toHaveLength(1);
    await cleanupFiles(store, files);
  });

  it("marks queued jobs as failed after a simulated restart", async () => {
    const { store, files, ai } = await testContext();
    const draft = await store.create("storyDraft", { ownerId: "owner", status: "DRAFT", data: { storyType: "VALUE" } });
    const job = await store.create("generationJob", { ownerId: "owner", relationId: draft.id, status: "QUEUED", data: { draftId: draft.id, stage: "TEXT", progress: 0 } });
    const restartedQueue = new GenerationQueue(store, ai, files); await restartedQueue.recoverInterruptedJobs();
    const failed = await store.get<{ errorCode: string }>("generationJob", job.id); expect(failed?.status).toBe("FAILED"); expect(failed?.data.errorCode).toBe("SERVER_RESTARTED");
  });
});

describe("commerce and support", () => {
  it("completes orders immediately, creates gifts, subscriptions and local exports", async () => {
    const { app, store, files } = await testContext(); const user = await store.create("user", { status: "ACTIVE", data: { loginId: "buyer", email: "buyer@example.com" } }); const token = signAccess(user.id).token;
    await request(app).post("/api/v1/me/subscription").set("Authorization", `Bearer ${token}`).send({ planId: "DIGITAL_MONTHLY" }).expect(201);
    await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId: "HARDCOVER", quantity: 1 }).expect(201);
    const cart = await request(app).get("/api/v1/cart").set("Authorization", `Bearer ${token}`).expect(200); expect(cart.body.data.total).toBe(29000);
    const order = await request(app).post("/api/v1/orders").set("Authorization", `Bearer ${token}`).send({ shipping: { recipient: "보호자" } }).expect(201); expect(order.body.data.orderStatus).toBe("COMPLETED"); expect(order.body.data.trackingNumber).toBeNull();
    const gift = await request(app).post("/api/v1/gifts").set("Authorization", `Bearer ${token}`).send({ orderId: order.body.data.orderId, message: "축하해요" }).expect(201);
    const giftView = await request(app).get(`/api/v1/gifts/${gift.body.data.giftCode}`).expect(200); expect(giftView.body.data.message).toBe("축하해요");
    await request(app).post("/api/v1/b2b/inquiries").send({ organizationName: "도토리 유치원", contactName: "선생님", email: "teacher@example.com", phone: "010-0000-0000", organizationType: "KINDERGARTEN", estimatedVolume: 20, message: "문의합니다", privacyConsent: true }).expect(202);
    const exported = await request(app).post("/api/v1/me/data-export").set("Authorization", `Bearer ${token}`).expect(202); expect(exported.body.data.status).toBe("QUEUED");
    let ready; for (let attempt = 0; attempt < 50; attempt += 1) { ready = await request(app).post("/api/v1/me/data-export").set("Authorization", `Bearer ${token}`).expect(202); if (ready.body.data.status === "READY") break; await new Promise((resolve) => setTimeout(resolve, 20)); } expect(ready?.body.data.status).toBe("READY"); expect(ready?.body.data.downloadUrl).toContain("signature=");
    const exportUrl = new URL(ready!.body.data.downloadUrl); const download = await request(app).get(`${exportUrl.pathname}${exportUrl.search}`).expect(200); expect(JSON.stringify(download.body)).not.toContain("passwordHash");
    await cleanupFiles(store, files);
  });
});
