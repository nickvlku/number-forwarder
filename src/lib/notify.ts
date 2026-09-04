import { getEnv } from "@/lib/env";
import { formatDuration } from "@/lib/format";
import { sendSms } from "@/lib/twilio/rest";

const MAX_SMS = 320;
const MAX_NAME = 60;
const PREFIX = "[THE VLKU]";

function capName(s: string): string {
  return s.length > MAX_NAME ? s.slice(0, MAX_NAME - 1).trimEnd() + "…" : s;
}

export function composeVoicemailSms(o: {
  displayName: string;
  durationSeconds: number;
  transcript: string | null;
  callSid: string;
  baseUrl: string;
}): string {
  const name = capName(o.displayName);
  const head = `${PREFIX} Voicemail from ${name} (${formatDuration(o.durationSeconds)})`;
  const link = `${o.baseUrl}/calls/${o.callSid}`;
  if (!o.transcript) return `${head}\nTranscription unavailable, listen in the dashboard.\n${link}`;
  const budget = Math.max(0, MAX_SMS - head.length - link.length - 4 /* newlines + quotes */);
  let body = o.transcript.replace(/\s+/g, " ").trim();
  if (body.length > budget) body = body.slice(0, Math.max(0, budget - 3)).trimEnd() + "...";
  return `${head}\n"${body}"\n${link}`;
}

export function composeTextRelay(o: { displayName: string; body: string; mediaCount: number }): string {
  const parts: string[] = [];
  if (o.body.trim()) parts.push(o.body.trim());
  if (o.mediaCount > 0) parts.push(`(${o.mediaCount} attachment${o.mediaCount === 1 ? "" : "s"}, see dashboard)`);
  return `${PREFIX} ${capName(o.displayName)}: ${parts.join(" ")}`;
}

const RETRY_DELAY_MS = 30_000;

/** Sends to the cell. One retry after 30 s. Never throws; returns whether a send succeeded. */
export async function sendWithRetry(body: string): Promise<boolean> {
  const env = getEnv();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sendSms({ to: env.CELL_NUMBER, body });
      return true;
    } catch (err) {
      console.error("sms send failed", { attempt, err });
      if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  return false;
}
