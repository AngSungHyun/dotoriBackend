import "dotenv/config";
import { z } from "zod";

const developmentSecret = "dotori-development-secret-change-before-production";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(25565),
  APP_ORIGIN: z.string().default("http://localhost:3000"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:25565"),
  DATABASE_URL: z.string().default("mysql://dotori:dotori@127.0.0.1:3306/dotori"),
  DB_AUTO_SYNC: z.string().default("false").transform((value) => value === "true"),
  JWT_ACCESS_SECRET: z.string().min(32).default(developmentSecret),
  JWT_REFRESH_SECRET: z.string().min(32).default(`${developmentSecret}-refresh`),
  FILE_URL_SECRET: z.string().min(32).default(`${developmentSecret}-files`),
  CHATGPT_API_KEY: z.string().optional(),
  OPENAI_TEXT_MODEL: z.string().default("gpt-5.6-terra"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2"),
  OPENAI_IMAGE_QUALITY: z.enum(["low", "medium", "high"]).default("medium"),
  OPENAI_MODERATION_MODEL: z.string().default("omni-moderation-latest"),
  STORY_PAGE_COUNT: z.coerce.number().int().min(4).max(12).default(6),
  GENERATION_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  REFRESH_COOKIE_NAME: z.string().default("dotori_refresh"),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(25).default(10),
  STORAGE_PATH: z.string().default("storage"),
  FILE_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
});

export const config = schema.parse(process.env);

export const corsOrigins = Array.from(new Set([
  ...config.APP_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
  "https://custom-ai-storybook-app.vercel.app",
]));

if (config.NODE_ENV === "production" && config.JWT_ACCESS_SECRET === developmentSecret) {
  throw new Error("운영 환경에서는 JWT_ACCESS_SECRET을 반드시 설정해야 합니다.");
}
