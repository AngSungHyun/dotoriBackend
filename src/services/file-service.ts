import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.js";
import type { Store, StoredRecord } from "../domain/types.js";
import { ApiError } from "../lib/errors.js";
import { safeEqual } from "../lib/security.js";

type FileData = { kind: string; localPath: string; mimeType: string; size: number; expiresAt?: string; deletedAt?: string };

export class FileService {
  private readonly root = path.resolve(config.STORAGE_PATH);
  constructor(private readonly store: Store) {}

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async save(buffer: Buffer, mimeType: string, kind: string, ownerId?: string, guestId?: string): Promise<StoredRecord<FileData>> {
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : mimeType === "application/json" ? "json" : "png";
    const fileName = `${randomUUID()}.${extension}`;
    const localPath = path.join(this.root, fileName);
    await writeFile(localPath, buffer);
    return this.store.create("storedFile", { ownerId, guestId, status: "ACTIVE", data: { kind, localPath, mimeType, size: buffer.length } });
  }

  async watermark(source: Buffer, ownerId?: string, guestId?: string): Promise<StoredRecord<FileData>> {
    const svg = Buffer.from('<svg width="1024" height="1024"><style>.w{fill:white;fill-opacity:.45;font:bold 72px sans-serif}</style><text x="50%" y="50%" text-anchor="middle" class="w" transform="rotate(-24 512 512)">DOTORI PREVIEW</text></svg>');
    const result = await sharp(source).resize({ width: 1024, height: 1024, fit: "inside" }).composite([{ input: svg, gravity: "center" }]).webp({ quality: 68 }).toBuffer();
    return this.save(result, "image/webp", "STORY_PREVIEW", ownerId, guestId);
  }

  sign(fileId: string, ttlSeconds = config.FILE_URL_TTL_SECONDS): string {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = createHmac("sha256", config.FILE_URL_SECRET).update(`${fileId}:${expires}`).digest("hex");
    return `${config.PUBLIC_BASE_URL}/api/v1/files/${fileId}?expires=${expires}&signature=${signature}`;
  }

  async readSigned(fileId: string, expiresValue: unknown, signatureValue: unknown): Promise<{ buffer: Buffer; mimeType: string }> {
    const expires = Number(expiresValue);
    const signature = String(signatureValue ?? "");
    if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) throw new ApiError(403, "FORBIDDEN", "파일 URL이 만료되었습니다.");
    const expected = createHmac("sha256", config.FILE_URL_SECRET).update(`${fileId}:${expires}`).digest("hex");
    if (!safeEqual(expected, signature)) throw new ApiError(403, "FORBIDDEN", "파일 URL 서명이 올바르지 않습니다.");
    const record = await this.store.get<FileData>("storedFile", fileId);
    if (!record || record.data.deletedAt) throw new ApiError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
    const resolved = path.resolve(record.data.localPath);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new ApiError(403, "FORBIDDEN", "허용되지 않은 파일 경로입니다.");
    return { buffer: await readFile(resolved), mimeType: record.data.mimeType };
  }

  async readInternal(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const record = await this.store.get<FileData>("storedFile", fileId);
    if (!record || record.data.deletedAt) throw new ApiError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
    const resolved = path.resolve(record.data.localPath);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new ApiError(403, "FORBIDDEN", "허용되지 않은 파일 경로입니다.");
    return { buffer: await readFile(resolved), mimeType: record.data.mimeType };
  }

  async deleteFile(fileId: string): Promise<void> {
    const record = await this.store.get<FileData>("storedFile", fileId);
    if (!record || record.data.deletedAt) return;
    const resolved = path.resolve(record.data.localPath);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new ApiError(403, "FORBIDDEN", "허용되지 않은 파일 경로입니다.");
    try { await unlink(resolved); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    await this.store.update("storedFile", fileId, { status: "DELETED", data: { ...record.data, deletedAt: new Date().toISOString() } });
  }
}
