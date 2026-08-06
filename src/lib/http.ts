import type { RequestHandler } from "express";
import { z } from "zod";
import type { AuthContext, Store, StoredRecord } from "../domain/types.js";
import { ApiError } from "./errors.js";
import { sha256, verifyBearer } from "./security.js";

export const optionalAuth: RequestHandler = (req, _res, next) => {
  req.auth = verifyBearer(req.header("authorization")) ?? undefined;
  next();
};

export const requireAnyAuth: RequestHandler = (req, _res, next) => {
  const auth = verifyBearer(req.header("authorization"));
  if (!auth) return next(new ApiError(401, "AUTHENTICATION_REQUIRED", "인증이 필요합니다."));
  req.auth = auth;
  next();
};

export const requireUser: RequestHandler = (req, _res, next) => {
  const auth = verifyBearer(req.header("authorization"));
  if (!auth?.userId) return next(new ApiError(401, "AUTHENTICATION_REQUIRED", "회원 인증이 필요합니다."));
  req.auth = auth;
  next();
};

export function requireAuthFor(store: Store, memberOnly = false): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const authorization = req.header("authorization");
      const auth = verifyBearer(authorization);
      if (!auth || (memberOnly && !auth.userId)) throw new ApiError(401, "AUTHENTICATION_REQUIRED", memberOnly ? "회원 인증이 필요합니다." : "인증이 필요합니다.");
      if (auth.userId) {
        const user = await store.get("user", auth.userId);
        if (!user || user.status !== "ACTIVE") throw new ApiError(401, "AUTHENTICATION_REQUIRED", "유효하지 않은 회원 세션입니다.");
      } else if (auth.guestSessionId) {
        const guest = await store.get<{ tokenHash: string; expiresAt: string }>("guestSession", auth.guestSessionId);
        const rawToken = authorization?.slice(7) ?? "";
        if (!guest || guest.status !== "ACTIVE" || guest.lookup1 !== sha256(rawToken) || new Date(guest.data.expiresAt).getTime() < Date.now()) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "유효하지 않은 게스트 세션입니다.");
      }
      req.auth = auth;
      next();
    })().catch(next);
  };
}

export function assertOwner(record: StoredRecord | null, auth: AuthContext | undefined): asserts record is StoredRecord {
  if (!record) throw new ApiError(404, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
  const allowed = record.ownerId ? record.ownerId === auth?.userId : record.guestId ? record.guestId === auth?.guestSessionId : false;
  if (!allowed) {
    throw new ApiError(403, "FORBIDDEN", "이 리소스에 접근할 수 없습니다.");
  }
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  return {
    data: items.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export function publicRecord(record: StoredRecord): Record<string, unknown> {
  return { id: record.id, ...record.data, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}

export function clientIp(value: string | undefined): string {
  return value?.split(",")[0]?.trim() || "unknown";
}

export function routeParam(value: string | string[] | undefined): string {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result) throw new ApiError(400, "VALIDATION_FAILED", "경로 식별자가 필요합니다.");
  return result;
}
