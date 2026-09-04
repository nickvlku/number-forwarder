import type { DB } from "@/db";
import type { Env } from "@/lib/env";
import { getGreetingMeta } from "@/db/repo/greeting";

/** Public URL Twilio fetches for <Play>. The version query defeats Twilio's media cache after a re-record. */
export function recordedGreetingUrl(baseUrl: string, updatedAt: Date): string {
  return `${baseUrl}/api/greeting.wav?v=${updatedAt.getTime()}`;
}

/** Precedence: recording saved in the dashboard, then VOICEMAIL_GREETING_URL, then text-to-speech (undefined). */
export async function resolveGreetingUrl(db: DB, env: Env): Promise<string | undefined> {
  const meta = await getGreetingMeta(db);
  if (meta) return recordedGreetingUrl(env.PUBLIC_BASE_URL, meta.updatedAt);
  return env.VOICEMAIL_GREETING_URL;
}
