import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { AuthContext } from "../domain/types.js";

export const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const randomCode = (): string => String(Math.floor(100000 + Math.random() * 900000));

export function signAccess(userId: string): { token: string; expiresAt: string } {
  const token = jwt.sign({ type: "user" }, config.JWT_ACCESS_SECRET, { subject: userId, expiresIn: "24h" });
  return { token, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
}

export function signGuest(guestId: string): { token: string; expiresAt: string } {
  const token = jwt.sign({ type: "guest" }, config.JWT_ACCESS_SECRET, { subject: guestId, expiresIn: "7d" });
  return { token, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() };
}

export function verifyBearer(value?: string): AuthContext | null {
  if (!value?.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(value.slice(7), config.JWT_ACCESS_SECRET);
    if (typeof payload === "string" || !payload.sub) return null;
    if (payload.type === "user") return { userId: payload.sub };
    if (payload.type === "guest") return { guestSessionId: payload.sub };
    return null;
  } catch {
    return null;
  }
}

export function verifyToken(token: string): AuthContext | null {
  return verifyBearer(`Bearer ${token}`);
}

export function safetyIdentifier(subject: string): string {
  return createHmac("sha256", config.JWT_ACCESS_SECRET).update(subject).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
