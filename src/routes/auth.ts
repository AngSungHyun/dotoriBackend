import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import type { Store, StoredRecord } from "../domain/types.js";
import { asyncRoute, ApiError, parse } from "../lib/errors.js";
import { clientIp, optionalAuth, requireAuthFor } from "../lib/http.js";
import { randomCode, randomToken, sha256, signAccess, signGuest, verifyToken } from "../lib/security.js";
import type { FileService } from "../services/file-service.js";

type UserData = { loginId: string; email: string; passwordHash: string; name: string; notificationEnabled: boolean; status: string; freeStoryUsed: boolean; deletedAt?: string };
type VerificationData = { email: string; purpose: string; codeHash?: string; tokenHash?: string; attempts: number; expiresAt: string; confirmedAt?: string; usedAt?: string; payload?: Record<string, unknown> };
type RefreshData = { tokenHash: string; familyId: string; expiresAt: string; revokedAt?: string; replacedById?: string };

const idSchema = z.string().regex(/^[a-z0-9]{4,20}$/, "영문 소문자와 숫자 4~20자로 입력해 주세요.");
const passwordSchema = z.string().min(8).max(72);
const emailSchema = z.string().email().transform((value) => value.toLowerCase());
const authLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." } }) });

function userView(record: StoredRecord<UserData>) {
  return { id: record.id, loginId: record.data.loginId, email: record.data.email, name: record.data.name, notificationEnabled: record.data.notificationEnabled, createdAt: record.createdAt.toISOString() };
}

function cookieOptions() {
  return { httpOnly: true, secure: true, sameSite: "none" as const, path: "/api/v1/auth", maxAge: 30 * 24 * 60 * 60 * 1000 };
}

async function issueSession(store: Store, user: StoredRecord<UserData>, familyId: string = randomUUID()) {
  const rawRefresh = randomToken(48);
  const refresh = await store.create<RefreshData>("refreshSession", {
    ownerId: user.id, status: "ACTIVE", lookup1: sha256(rawRefresh), lookup2: familyId,
    data: { tokenHash: sha256(rawRefresh), familyId, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() },
  });
  return { access: signAccess(user.id), rawRefresh, refresh };
}

export function authRouter(store: Store, files: FileService): Router {
  const router = Router();
  const memberAuth = requireAuthFor(store, true);

  // 역할/사용 시점: 회원가입 전에도 동화 초안을 소유할 수 있도록 첫 방문 시 게스트 세션을 발급한다.
  router.post("/guest/session", authLimiter, asyncRoute(async (req, res) => {
    const body = parse(z.object({ deviceId: z.string().max(200).optional() }), req.body);
    const placeholder = randomUUID();
    const signed = signGuest(placeholder);
    const session = await store.create("guestSession", { id: placeholder, status: "ACTIVE", lookup1: sha256(signed.token), data: { deviceId: body.deviceId, tokenHash: sha256(signed.token), expiresAt: signed.expiresAt } });
    res.status(201).json({ data: { guestSessionId: session.id, guestSessionToken: signed.token, expiresAt: signed.expiresAt } });
  }));

  // 역할/사용 시점: 회원가입 폼에서 로그인 아이디를 확정하기 전에 중복 여부를 확인한다.
  router.get("/auth/check-id", authLimiter, asyncRoute(async (req, res) => {
    const { loginId } = parse(z.object({ loginId: idSchema }), req.query);
    const existing = await store.find<UserData>("user", { lookup1: loginId });
    res.json({ data: { loginId, available: existing.length === 0 } });
  }));

  // 역할/사용 시점: 회원가입·이메일 변경 전 소유 확인용 6자리 코드를 생성하고 DB에 해시로 기록한다.
  router.post("/auth/verify-email/request", authLimiter, asyncRoute(async (req, res) => {
    const body = parse(z.object({ email: emailSchema, purpose: z.enum(["SIGNUP", "CHANGE_EMAIL"]).default("SIGNUP") }), req.body);
    const code = randomCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await store.create<VerificationData>("verification", { lookup1: body.email, status: "PENDING", data: { email: body.email, purpose: body.purpose, codeHash: sha256(code), attempts: 0, expiresAt } });
    res.status(202).json({ data: { message: "인증 메일 요청을 접수했습니다.", expiresAt, ...(config.NODE_ENV !== "production" ? { debugCode: code } : {}) } });
  }));

  // 역할/사용 시점: 이메일 코드를 검증해 회원가입에서 한 번만 쓸 수 있는 인증 토큰으로 교환한다.
  router.post("/auth/verify-email/confirm", authLimiter, asyncRoute(async (req, res) => {
    const body = parse(z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/), purpose: z.enum(["SIGNUP", "CHANGE_EMAIL"]).default("SIGNUP") }), req.body);
    const records = await store.find<VerificationData>("verification", { lookup1: body.email, status: "PENDING" });
    const record = records.find((item) => item.data.purpose === body.purpose);
    if (!record || new Date(record.data.expiresAt).getTime() < Date.now() || record.data.attempts >= 5) throw new ApiError(400, "VALIDATION_FAILED", "인증 코드가 올바르지 않거나 만료되었습니다.");
    if (record.data.codeHash !== sha256(body.code)) {
      await store.update("verification", record.id, { data: { ...record.data, attempts: record.data.attempts + 1 } });
      throw new ApiError(400, "VALIDATION_FAILED", "인증 코드가 올바르지 않거나 만료되었습니다.");
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    await store.update("verification", record.id, { status: "CONFIRMED", lookup2: sha256(token), data: { ...record.data, tokenHash: sha256(token), confirmedAt: new Date().toISOString(), expiresAt } });
    res.json({ data: { emailVerificationToken: token, expiresAt } });
  }));

  // 역할/사용 시점: 인증된 이메일과 필수 약관을 확인해 회원을 만들고 게스트 작업 및 로그인 세션을 승계한다.
  router.post("/auth/signup", authLimiter, asyncRoute(async (req, res) => {
    const body = parse(z.object({
      loginId: idSchema, email: emailSchema, password: passwordSchema, name: z.string().trim().min(1).max(50),
      emailVerificationToken: z.string().min(20), guestSessionToken: z.string().optional(),
      consents: z.array(z.object({ type: z.enum(["TERMS", "PRIVACY", "CHILD_DATA", "MARKETING"]), version: z.string().min(1), agreed: z.boolean() })).default([]),
    }), req.body);
    if ((await store.find("user", { lookup1: body.loginId })).length || (await store.find("user", { lookup2: body.email })).length) throw new ApiError(409, "CONFLICT", "이미 사용 중인 아이디 또는 이메일입니다.");
    const verification = (await store.find<VerificationData>("verification", { lookup1: body.email, status: "CONFIRMED" })).find((item) => item.data.tokenHash === sha256(body.emailVerificationToken) && !item.data.usedAt && new Date(item.data.expiresAt).getTime() > Date.now());
    if (!verification) throw new ApiError(400, "VALIDATION_FAILED", "이메일 인증 토큰이 올바르지 않습니다.");
    for (const required of ["TERMS", "PRIVACY"] as const) if (!body.consents.some((item) => item.type === required && item.agreed)) throw new ApiError(400, "VALIDATION_FAILED", "필수 약관 동의가 필요합니다.");
    const user = await store.create<UserData>("user", { lookup1: body.loginId, lookup2: body.email, status: "ACTIVE", data: { loginId: body.loginId, email: body.email, passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }), name: body.name, notificationEnabled: true, status: "ACTIVE", freeStoryUsed: false } });
    await store.update("verification", verification.id, { data: { ...verification.data, usedAt: new Date().toISOString() } });
    await Promise.all(body.consents.map((consent) => store.create("consent", { ownerId: user.id, lookup1: consent.type, status: consent.agreed ? "AGREED" : "DECLINED", data: { ...consent, ip: clientIp(req.ip), agreedAt: consent.agreed ? new Date().toISOString() : null } })));
    if (body.guestSessionToken) {
      const guest = verifyToken(body.guestSessionToken);
      if (guest?.guestSessionId) {
        const guestSession = await store.get("guestSession", guest.guestSessionId);
        if (guestSession && guestSession.status === "ACTIVE") {
          for (const kind of ["storyDraft", "generationJob", "storedFile"] as const) {
            const records = await store.find(kind, { guestId: guest.guestSessionId });
            await Promise.all(records.map((record) => store.update(kind, record.id, { ownerId: user.id, guestId: undefined })));
          }
          await store.update("guestSession", guestSession.id, { status: "CLAIMED", ownerId: user.id, data: { ...guestSession.data, claimedByUserId: user.id } });
        }
      }
    }
    const session = await issueSession(store, user);
    res.cookie(config.REFRESH_COOKIE_NAME, session.rawRefresh, cookieOptions());
    res.status(201).json({ data: { user: userView(user), accessToken: session.access.token, accessTokenExpiresAt: session.access.expiresAt } });
  }));

  // 역할/사용 시점: 로그인 화면에서 자격 증명을 검증하고 Access Token과 Refresh 쿠키를 함께 발급한다.
  router.post("/auth/login", authLimiter, asyncRoute(async (req, res) => {
    const body = parse(z.object({ loginId: idSchema, password: z.string() }), req.body);
    const user = (await store.find<UserData>("user", { lookup1: body.loginId }))[0];
    if (!user || user.status !== "ACTIVE" || !(await argon2.verify(user.data.passwordHash, body.password))) throw new ApiError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.");
    const session = await issueSession(store, user);
    res.cookie(config.REFRESH_COOKIE_NAME, session.rawRefresh, cookieOptions());
    res.json({ data: { user: userView(user), accessToken: session.access.token, accessTokenExpiresAt: session.access.expiresAt } });
  }));

  // 역할/사용 시점: 로그아웃 시 현재 Refresh 세션을 폐기하고 브라우저 쿠키를 지운다.
  router.post("/auth/logout", optionalAuth, asyncRoute(async (req, res) => {
    const raw = req.cookies?.[config.REFRESH_COOKIE_NAME] as string | undefined;
    if (raw) {
      const session = (await store.find<RefreshData>("refreshSession", { lookup1: sha256(raw) }))[0];
      if (session) await store.update("refreshSession", session.id, { status: "REVOKED", data: { ...session.data, revokedAt: new Date().toISOString() } });
    }
    res.clearCookie(config.REFRESH_COOKIE_NAME, cookieOptions());
    res.status(204).end();
  }));

  // 역할/사용 시점: Access Token 만료 시 Refresh Token을 회전하며, 재사용이 감지되면 세션 계열을 폐기한다.
  router.post("/auth/token/refresh", authLimiter, asyncRoute(async (req, res) => {
    const raw = req.cookies?.[config.REFRESH_COOKIE_NAME] as string | undefined;
    if (!raw) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Refresh Token이 필요합니다.");
    const session = (await store.find<RefreshData>("refreshSession", { lookup1: sha256(raw) }))[0];
    if (!session || session.status !== "ACTIVE" || new Date(session.data.expiresAt).getTime() < Date.now()) {
      if (session?.data.familyId) {
        const family = await store.find<RefreshData>("refreshSession", { lookup2: session.data.familyId });
        await Promise.all(family.map((item) => store.update("refreshSession", item.id, { status: "REVOKED", data: { ...item.data, revokedAt: new Date().toISOString() } })));
      }
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Refresh Token이 유효하지 않습니다.");
    }
    const user = await store.get<UserData>("user", session.ownerId!);
    if (!user || user.status !== "ACTIVE") throw new ApiError(401, "AUTHENTICATION_REQUIRED", "계정을 찾을 수 없습니다.");
    const next = await issueSession(store, user, session.data.familyId);
    await store.update("refreshSession", session.id, { status: "REVOKED", data: { ...session.data, revokedAt: new Date().toISOString(), replacedById: next.refresh.id } });
    res.cookie(config.REFRESH_COOKIE_NAME, next.rawRefresh, cookieOptions());
    res.json({ data: { accessToken: next.access.token, accessTokenExpiresAt: next.access.expiresAt } });
  }));

  // 역할/사용 시점: 아이디 찾기를 접수하되 계정 존재 여부가 응답으로 유출되지 않게 중립 메시지를 반환한다.
  router.post("/auth/find-id", authLimiter, asyncRoute(async (req, res) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const user = (await store.find<UserData>("user", { lookup2: email }))[0];
    if (user) await store.create("verification", { ownerId: user.id, status: "RECORDED", lookup1: email, data: { email, purpose: "FIND_ID", attempts: 0, expiresAt: new Date().toISOString(), payload: { maskedLoginId: `${user.data.loginId.slice(0, 2)}***` } } });
    res.status(202).json({ data: { message: "일치하는 계정이 있으면 아이디 안내를 기록했습니다." } });
  }));

  // 역할/사용 시점: 비밀번호 찾기 화면에서 계정이 일치할 때만 일회성 재설정 토큰을 기록한다.
  router.post("/auth/reset-password/request", authLimiter, asyncRoute(async (req, res) => {
    const body = parse(z.object({ loginId: idSchema, email: emailSchema }), req.body);
    const user = (await store.find<UserData>("user", { lookup1: body.loginId })).find((item) => item.data.email === body.email);
    let debugResetToken: string | undefined;
    if (user) {
      debugResetToken = randomToken();
      await store.create<VerificationData>("verification", { ownerId: user.id, lookup1: body.email, lookup2: sha256(debugResetToken), status: "PENDING", data: { email: body.email, purpose: "RESET_PASSWORD", tokenHash: sha256(debugResetToken), attempts: 0, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } });
    }
    res.status(202).json({ data: { message: "일치하는 계정이 있으면 비밀번호 재설정 안내를 기록했습니다.", ...(config.NODE_ENV !== "production" && debugResetToken ? { debugResetToken } : {}) } });
  }));

  // 역할/사용 시점: 재설정 토큰을 소비해 비밀번호를 바꾸고 탈취 위험이 있는 기존 Refresh 세션을 전부 폐기한다.
  router.post("/auth/reset-password/confirm", authLimiter, asyncRoute(async (req, res) => {
    const body = parse(z.object({ resetToken: z.string().min(20), newPassword: passwordSchema }), req.body);
    const record = (await store.find<VerificationData>("verification", { lookup2: sha256(body.resetToken), status: "PENDING" }))[0];
    if (!record || record.data.purpose !== "RESET_PASSWORD" || record.data.usedAt || new Date(record.data.expiresAt).getTime() < Date.now()) throw new ApiError(400, "VALIDATION_FAILED", "재설정 토큰이 올바르지 않거나 만료되었습니다.");
    const user = await store.get<UserData>("user", record.ownerId!);
    if (!user) throw new ApiError(404, "NOT_FOUND", "계정을 찾을 수 없습니다.");
    await store.update("user", user.id, { data: { ...user.data, passwordHash: await argon2.hash(body.newPassword, { type: argon2.argon2id }) } });
    const sessions = await store.find<RefreshData>("refreshSession", { ownerId: user.id });
    await Promise.all(sessions.map((item) => store.update("refreshSession", item.id, { status: "REVOKED", data: { ...item.data, revokedAt: new Date().toISOString() } })));
    await store.update("verification", record.id, { status: "USED", data: { ...record.data, usedAt: new Date().toISOString() } });
    res.status(204).end();
  }));

  // 역할/사용 시점: 마이페이지 진입 시 비밀번호 등 민감 필드를 제외한 회원 기본 정보를 조회한다.
  router.get("/me", memberAuth, asyncRoute(async (req, res) => {
    const user = await store.get<UserData>("user", req.auth!.userId!);
    if (!user) throw new ApiError(404, "NOT_FOUND", "계정을 찾을 수 없습니다.");
    res.json({ data: userView(user) });
  }));

  // 역할/사용 시점: 마이페이지에서 이름과 알림 설정처럼 허용된 회원 필드만 부분 수정한다.
  router.patch("/me", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(50).optional(), notificationEnabled: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0), req.body);
    const user = await store.get<UserData>("user", req.auth!.userId!);
    if (!user) throw new ApiError(404, "NOT_FOUND", "계정을 찾을 수 없습니다.");
    const updated = await store.update<UserData>("user", user.id, { data: { ...user.data, ...body } });
    res.json({ data: userView(updated!) });
  }));

  // 역할/사용 시점: 로그인 회원이 현재 비밀번호를 확인한 뒤 비밀번호를 변경하고 다른 기기 세션을 종료한다.
  router.post("/me/password", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string(), newPassword: passwordSchema }), req.body);
    const user = await store.get<UserData>("user", req.auth!.userId!);
    if (!user || !(await argon2.verify(user.data.passwordHash, body.currentPassword))) throw new ApiError(401, "INVALID_CREDENTIALS", "현재 비밀번호가 올바르지 않습니다.");
    await store.update("user", user.id, { data: { ...user.data, passwordHash: await argon2.hash(body.newPassword, { type: argon2.argon2id }) } });
    const raw = req.cookies?.[config.REFRESH_COOKIE_NAME] as string | undefined;
    const sessions = await store.find<RefreshData>("refreshSession", { ownerId: user.id });
    await Promise.all(sessions.filter((item) => !raw || item.data.tokenHash !== sha256(raw)).map((item) => store.update("refreshSession", item.id, { status: "REVOKED", data: { ...item.data, revokedAt: new Date().toISOString() } })));
    res.status(204).end();
  }));

  // 역할/사용 시점: 회원 탈퇴를 확정할 때 계정을 비활성화하고 보존 필요 데이터만 익명화해 남긴다.
  router.delete("/me", memberAuth, asyncRoute(async (req, res) => {
    const body = parse(z.object({ password: z.string(), reason: z.string().max(500).optional() }), req.body);
    const user = await store.get<UserData>("user", req.auth!.userId!);
    if (!user || !(await argon2.verify(user.data.passwordHash, body.password))) throw new ApiError(401, "INVALID_CREDENTIALS", "비밀번호가 올바르지 않습니다.");
    await store.update("user", user.id, { status: "DELETED", lookup1: `deleted:${user.id}`, lookup2: `deleted:${user.id}`, data: { ...user.data, loginId: `deleted-${user.id}`, email: `deleted-${user.id}@invalid.local`, name: "탈퇴회원", status: "DELETED", deletedAt: new Date().toISOString(), deletionReason: body.reason } });
    const stories = await store.find("story", { ownerId: user.id });
    const purchasedChildIds = new Set(stories.map((item) => item.data.childId).filter((id): id is string => typeof id === "string"));
    for (const child of await store.find<Record<string, unknown>>("child", { ownerId: user.id })) {
      if (purchasedChildIds.has(child.id)) await store.update("child", child.id, { status: "ANONYMIZED", data: { name: "아이", birthDate: "1970-01-01", interests: [], anonymizedAt: new Date().toISOString() } });
      else await store.delete("child", child.id);
    }
    for (const file of await store.find("storedFile", { ownerId: user.id })) await files.deleteFile(file.id);
    for (const kind of ["refreshSession", "consent", "personalityAssessment", "storyDraft", "story", "creditTransaction", "subscription", "cartItem", "report", "dataExport"] as const) {
      for (const record of await store.find(kind, { ownerId: user.id })) await store.delete(kind, record.id);
    }
    res.clearCookie(config.REFRESH_COOKIE_NAME, cookieOptions());
    res.status(204).end();
  }));

  // 역할/사용 시점: 개인정보 처리 투명성을 위해 회원에게 약관·자녀 데이터 동의 이력을 보여 준다.
  router.get("/me/consents", memberAuth, asyncRoute(async (req, res) => {
    const records = await store.find("consent", { ownerId: req.auth!.userId });
    res.json({ data: records.map((item) => ({ id: item.id, ...item.data, createdAt: item.createdAt.toISOString() })) });
  }));

  return router;
}
