import { z } from "zod";

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "must be E.164, e.g. +14155550100");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_NUMBER: e164,
  CELL_NUMBER: e164,
  PUBLIC_BASE_URL: z
    .url()
    .transform((u) => u.replace(/\/+$/, "")),
  OPENAI_API_KEY: z.string().min(1),
  DASHBOARD_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "at least 32 characters"),
  /**
   * Caller ID presented to the cell when forwarding. "twilio" (default) shows the Twilio number, which is
   * fully attested and rings through carrier spam screening; "caller" shows the real caller's number, which
   * some carriers intercept as a low-attestation call.
   */
  FORWARD_CALLER_ID: z.preprocess((v) => (v === "" || v === undefined ? "twilio" : v), z.enum(["twilio", "caller"])),
  /** Optional public URL of a recorded voicemail greeting (mp3/wav). Unset or empty means use TTS. */
  VOICEMAIL_GREETING_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  NODE_ENV: z.string().optional(),
});

export type Env = z.infer<typeof schema> & { isProd: boolean };

export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return { ...parsed.data, isProd: parsed.data.NODE_ENV === "production" };
}

let cached: Env | undefined;
/** Lazily parsed so importing this module in tests does not require real env. */
export function getEnv(): Env {
  if (!cached) cached = loadEnv(process.env);
  return cached;
}
