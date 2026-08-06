import OpenAI, { toFile } from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { ApiError } from "../lib/errors.js";

const generatedStorySchema = z.object({
  title: z.string().min(1).max(100),
  coverPrompt: z.string().min(1),
  pages: z.array(z.object({ pageNumber: z.number().int().positive(), text: z.string().min(1), imagePrompt: z.string().min(1) })).min(1),
  parentQuestions: z.array(z.string().min(1)).length(3),
});

export type GeneratedStory = z.infer<typeof generatedStorySchema>;

export interface AiService {
  checkTextSafety(text: string): Promise<void>;
  checkImageSafety(buffer: Buffer, mimeType: string): Promise<void>;
  generateStory(input: Record<string, unknown>, safetyIdentifier: string): Promise<GeneratedStory>;
  generateImage(prompt: string): Promise<Buffer>;
  generateAvatar(buffer: Buffer, mimeType: string, prompt: string): Promise<Buffer>;
}

export class OpenAiService implements AiService {
  private readonly client: OpenAI;
  constructor() {
    if (!config.CHATGPT_API_KEY) throw new Error("CHATGPT_API_KEY가 설정되지 않았습니다.");
    this.client = new OpenAI({ apiKey: config.CHATGPT_API_KEY });
  }

  private providerError(error: unknown): never {
    const message = error instanceof Error ? error.message : "OpenAI request failed";
    console.error(`OpenAI provider error: ${message}`);
    throw new ApiError(502, "AI_PROVIDER_ERROR", "AI 생성 서비스 호출에 실패했습니다.");
  }

  async checkTextSafety(text: string): Promise<void> {
    try {
      const response = await this.client.moderations.create({ model: config.OPENAI_MODERATION_MODEL, input: text });
      if (response.results.some((result) => result.flagged)) throw new ApiError(400, "UNSAFE_CONTENT", "안전하지 않은 콘텐츠가 포함되어 있습니다.");
    } catch (error) {
      if (error instanceof ApiError) throw error;
      this.providerError(error);
    }
  }

  async checkImageSafety(buffer: Buffer, mimeType: string): Promise<void> {
    try {
      const input = [{ type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } }];
      const response = await this.client.moderations.create({ model: config.OPENAI_MODERATION_MODEL, input: input as never });
      if (response.results.some((result) => result.flagged)) throw new ApiError(400, "UNSAFE_CONTENT", "안전하지 않은 이미지입니다.");
    } catch (error) {
      if (error instanceof ApiError) throw error;
      this.providerError(error);
    }
  }

  async generateStory(input: Record<string, unknown>, safetyId: string): Promise<GeneratedStory> {
    const pageCount = config.STORY_PAGE_COUNT;
    const prompt = [
      "한국어 유아용 개인 맞춤 동화를 작성하세요.",
      `정확히 ${pageCount}개 장면으로 만들고 모든 장면에 다정한 도토리 요정 토리를 등장시키세요.`,
      "3~4세는 짧고 반복적인 문장, 5~7세는 갈등-선택-해결 구조를 사용하세요.",
      "아이를 꾸짖거나 공포를 조장하지 말고 부모 대화 질문을 정확히 3개 만드세요.",
      `입력: ${JSON.stringify(input)}`,
    ].join("\n");
    try {
      const response = await this.client.responses.create({
        model: config.OPENAI_TEXT_MODEL,
        input: prompt,
        safety_identifier: safetyId,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "dotori_story",
            strict: true,
            schema: {
              type: "object", additionalProperties: false,
              required: ["title", "coverPrompt", "pages", "parentQuestions"],
              properties: {
                title: { type: "string" }, coverPrompt: { type: "string" },
                pages: { type: "array", minItems: pageCount, maxItems: pageCount, items: { type: "object", additionalProperties: false, required: ["pageNumber", "text", "imagePrompt"], properties: { pageNumber: { type: "integer" }, text: { type: "string" }, imagePrompt: { type: "string" } } } },
                parentQuestions: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
              },
            },
          },
        },
      } as never);
      const parsed = generatedStorySchema.parse(JSON.parse(response.output_text));
      if (parsed.pages.length !== pageCount) throw new Error("Unexpected page count");
      return parsed;
    } catch (error) {
      this.providerError(error);
    }
  }

  async generateImage(prompt: string): Promise<Buffer> {
    try {
      const result = await this.client.images.generate({ model: config.OPENAI_IMAGE_MODEL, prompt, size: "1024x1024", quality: config.OPENAI_IMAGE_QUALITY });
      const encoded = result.data?.[0]?.b64_json;
      if (!encoded) throw new Error("Image response did not include b64_json");
      return Buffer.from(encoded, "base64");
    } catch (error) {
      this.providerError(error);
    }
  }

  async generateAvatar(buffer: Buffer, mimeType: string, prompt: string): Promise<Buffer> {
    try {
      const image = await toFile(buffer, `avatar.${mimeType.split("/")[1] ?? "png"}`, { type: mimeType });
      const result = await this.client.images.edit({ model: config.OPENAI_IMAGE_MODEL, image, prompt, size: "1024x1024", quality: config.OPENAI_IMAGE_QUALITY });
      const encoded = result.data?.[0]?.b64_json;
      if (!encoded) throw new Error("Image edit response did not include b64_json");
      return Buffer.from(encoded, "base64");
    } catch (error) {
      this.providerError(error);
    }
  }
}

export class UnavailableAiService implements AiService {
  private fail(): never { throw new ApiError(502, "AI_PROVIDER_ERROR", "CHATGPT_API_KEY가 설정되지 않았습니다."); }
  async checkTextSafety(): Promise<void> { this.fail(); }
  async checkImageSafety(): Promise<void> { this.fail(); }
  async generateStory(): Promise<GeneratedStory> { return this.fail(); }
  async generateImage(): Promise<Buffer> { return this.fail(); }
  async generateAvatar(): Promise<Buffer> { return this.fail(); }
}

