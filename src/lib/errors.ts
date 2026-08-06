import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError, type ZodType } from "zod";
import multer from "multer";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(400, "VALIDATION_FAILED", "입력값을 확인해 주세요.", error.issues.map((issue) => ({
        field: issue.path.join("."), message: issue.message,
      })));
    }
    throw error;
  }
}

export const notFound: RequestHandler = (_req, _res, next) => next(new ApiError(404, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다."));

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    res.status(tooLarge ? 413 : 400).json({ error: { code: tooLarge ? "FILE_TOO_LARGE" : "VALIDATION_FAILED", message: tooLarge ? "업로드 파일이 너무 큽니다." : "파일 업로드 요청이 올바르지 않습니다." } });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "JSON 형식이 올바르지 않습니다." } });
    return;
  }
  if (typeof error === "object" && error !== null && ("type" in error && error.type === "entity.too.large" || "status" in error && error.status === 413)) {
    res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: "요청 본문이 너무 큽니다." } });
    return;
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
    res.status(409).json({ error: { code: "CONFLICT", message: "이미 존재하는 값입니다." } });
    return;
  }
  console.error(error instanceof Error ? error.message : "Unknown server error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "서버 내부 오류가 발생했습니다." } });
};

export function asyncRoute(handler: (...args: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { void handler(req, res, next).catch(next); };
}
