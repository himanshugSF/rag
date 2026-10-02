import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const schema = z.object({
  // --- required ---
  DATABASE_URL: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),

  // --- server ---
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  CORS_ORIGIN: z.string().default("*"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),

  // --- uploads ---
  UPLOAD_DIR: z.string().default("uploads"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(20),

  // --- models ---
  GEN_MODEL: z.string().default("gemini-3.8-flash"),
  WORKER_MODEL: z.string().default("gemini-3.5-flash-lite"),
  EMBED_MODEL: z.string().default("gemini-embedding-2"),
  // Must match vector(N) in migrations.
  EMBED_DIM: z.coerce.number().int().positive().default(1536),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(`Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

export const config: Config = load();
