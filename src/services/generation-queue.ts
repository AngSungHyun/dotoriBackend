import { config } from "../config.js";
import type { Store, StoredRecord } from "../domain/types.js";
import { illustrationStyles, worlds } from "../domain/catalog.js";
import { safetyIdentifier } from "../lib/security.js";
import { ApiError } from "../lib/errors.js";
import type { AiService } from "./openai.js";
import type { FileService } from "./file-service.js";

export type StoryDraftData = {
  storyType?: "VALUE" | "SITUATION" | "GROWTH";
  childId?: string;
  childInfo?: { name?: string; age?: number; interests?: string[] };
  worldId?: string;
  illustrationStyleId?: string;
  context?: { lifeEvents?: string[]; emotions?: string[]; recentScene?: string; desiredFeeling?: string; negativeConstraints?: string[] };
  tone?: { lessonId?: string; toneId?: string };
  cast?: { castAssignments?: Array<{ role: string; name: string }>; guardianConsent?: boolean };
  avatars?: Array<{ avatarId: string; fileId: string; characterRole: "GUARDIAN" | "CHILD" }>;
  generated?: { title: string; coverFileId: string; coverPreviewFileId: string; pages: Array<{ pageNumber: number; text: string; fileId: string; previewFileId: string }>; parentQuestions: string[] };
  checkedOut?: boolean;
  finalApprovedAt?: string;
  regenerateCount?: number;
};

type JobData = { draftId: string; type: string; stage: string; progress: number; errorCode?: string | null; completedAt?: string | null };

export class GenerationQueue {
  private readonly pending: string[] = [];
  private running = 0;

  constructor(private readonly store: Store, private readonly ai: AiService, private readonly files: FileService) {}

  async recoverInterruptedJobs(): Promise<void> {
    for (const status of ["QUEUED", "RUNNING"]) {
      const jobs = await this.store.find<JobData>("generationJob", { status });
      await Promise.all(jobs.map((job) => this.store.update("generationJob", job.id, {
        status: "FAILED", data: { ...job.data, stage: "DONE", progress: job.data.progress, errorCode: "SERVER_RESTARTED", completedAt: new Date().toISOString() },
      })));
    }
  }

  async enqueue(draft: StoredRecord<StoryDraftData>, type = "FULL"): Promise<StoredRecord<JobData>> {
    const active = (await this.store.find<JobData>("generationJob", { relationId: draft.id })).find((job) => ["QUEUED", "RUNNING"].includes(job.status ?? ""));
    if (active) throw new ApiError(409, "CONFLICT", "이미 진행 중인 생성 작업이 있습니다.");
    const job = await this.store.create<JobData>("generationJob", {
      ownerId: draft.ownerId, guestId: draft.guestId, relationId: draft.id, status: "QUEUED",
      data: { draftId: draft.id, type, stage: "TEXT", progress: 0, errorCode: null, completedAt: null },
    });
    this.pending.push(job.id);
    queueMicrotask(() => void this.drain());
    return job;
  }

  private async drain(): Promise<void> {
    while (this.running < config.GENERATION_CONCURRENCY && this.pending.length) {
      const jobId = this.pending.shift();
      if (!jobId) return;
      this.running += 1;
      void this.process(jobId).finally(() => { this.running -= 1; void this.drain(); });
    }
  }

  private async process(jobId: string): Promise<void> {
    const job = await this.store.get<JobData>("generationJob", jobId);
    if (!job) return;
    try {
      await this.setJob(job, "RUNNING", "TEXT", 5);
      const draft = await this.store.get<StoryDraftData>("storyDraft", job.data.draftId);
      if (!draft) throw new Error("Draft not found");
      const subject = draft.ownerId ?? draft.guestId ?? draft.id;
      await this.ai.checkTextSafety(JSON.stringify({ childInfo: draft.data.childInfo, context: draft.data.context, tone: draft.data.tone, cast: draft.data.cast }));
      const story = await this.ai.generateStory(draft.data as Record<string, unknown>, safetyIdentifier(subject));
      await this.setJob(job, "RUNNING", "SAFETY", 25);
      await this.ai.checkTextSafety([story.title, ...story.pages.map((page) => page.text), ...story.parentQuestions].join("\n"));
      const outputText = story.pages.map((page) => page.text).join(" ");
      for (const constraint of draft.data.context?.negativeConstraints ?? []) {
        const keyword = constraint.replace(/(하지\s*않기|제외|금지|말기|않도록)/g, "").trim();
        if (keyword.length >= 2 && outputText.includes(keyword)) throw new ApiError(400, "UNSAFE_CONTENT", "생성 결과가 설정한 제외 조건을 위반했습니다.");
      }

      const world = worlds.find((item) => item.id === draft.data.worldId);
      const style = illustrationStyles.find((item) => item.id === draft.data.illustrationStyleId);
      const common = [style?.prompt, ...(world?.promptKeywords ?? []), "safe for ages 3 to 7", "same child character and outfit", "friendly acorn fairy Tori", "no text, no lettering"].filter(Boolean).join(", ");
      const avatar = draft.data.avatars?.at(-1);
      const avatarSource = avatar ? await this.files.readInternal(avatar.fileId) : null;
      const draw = (prompt: string) => avatarSource ? this.ai.generateAvatar(avatarSource.buffer, avatarSource.mimeType, `${common}. Use the reference character consistently. ${prompt}`) : this.ai.generateImage(`${common}. ${prompt}`);

      await this.setJob(job, "RUNNING", "IMAGES", 30);
      const coverBuffer = await draw(story.coverPrompt);
      const coverFile = await this.files.save(coverBuffer, "image/png", "STORY_ORIGINAL", draft.ownerId, draft.guestId);
      const coverPreview = await this.files.watermark(coverBuffer, draft.ownerId, draft.guestId);
      const pages: NonNullable<StoryDraftData["generated"]>["pages"] = [];
      for (let index = 0; index < story.pages.length; index += 1) {
        const page = story.pages[index]!;
        const image = await draw(page.imagePrompt);
        const file = await this.files.save(image, "image/png", "STORY_ORIGINAL", draft.ownerId, draft.guestId);
        const preview = await this.files.watermark(image, draft.ownerId, draft.guestId);
        pages.push({ pageNumber: page.pageNumber, text: page.text, fileId: file.id, previewFileId: preview.id });
        await this.setJob(job, "RUNNING", "IMAGES", 30 + Math.round(((index + 1) / story.pages.length) * 55));
      }
      await this.setJob(job, "RUNNING", "PREVIEW", 92);
      const generated = { title: story.title, coverFileId: coverFile.id, coverPreviewFileId: coverPreview.id, pages, parentQuestions: story.parentQuestions };
      await this.store.update("storyDraft", draft.id, { status: "GENERATED", data: { ...draft.data, generated } });
      await this.setJob(job, "SUCCEEDED", "DONE", 100, null, new Date().toISOString());
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "AI_PROVIDER_ERROR";
      await this.setJob(job, "FAILED", "DONE", job.data.progress, code, new Date().toISOString());
    }
  }

  private async setJob(job: StoredRecord<JobData>, status: string, stage: string, progress: number, errorCode: string | null = null, completedAt: string | null = null): Promise<void> {
    const next = { ...job.data, stage, progress, errorCode, completedAt };
    job.status = status;
    job.data = next;
    await this.store.update("generationJob", job.id, { status, data: next });
  }
}
