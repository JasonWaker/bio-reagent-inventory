import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3110),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD_HASH: z.string().startsWith("$argon2"),
  CORS_ORIGIN: z.string().url(),
  DASHSCOPE_API_KEY: z.string().min(10),
  BAILIAN_BASE_URL: z.string().url().default("https://dashscope.aliyuncs.com"),
  BAILIAN_VISION_MODEL: z.string().default("qwen-vl-ocr-latest"),
  OSS_REGION: z.string().min(1),
  OSS_BUCKET: z.string().min(3),
  OSS_ACCESS_KEY_ID: z.string().min(8),
  OSS_ACCESS_KEY_SECRET: z.string().min(8),
});

export const config = configSchema.parse(process.env);
