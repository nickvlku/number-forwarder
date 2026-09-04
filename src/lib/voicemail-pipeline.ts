import type { DB } from "@/db";
import { getEnv } from "@/lib/env";
import { fetchRecording } from "@/lib/twilio/rest";
import { transcribe } from "@/lib/transcription";
import { composeVoicemailSms, sendWithRetry } from "@/lib/notify";
import { getVoicemail, setTranscriptionStatus, setNotified } from "@/db/repo/voicemails";
import { getCall } from "@/db/repo/calls";
import { displayNameFor } from "@/db/repo/contacts";

const DOWNLOAD_ATTEMPTS = 3;
const BACKOFF_MS = [0, 2_000, 5_000];

async function downloadWithRetry(recordingSid: string): Promise<Blob> {
  let lastErr: unknown;
  for (let i = 0; i < DOWNLOAD_ATTEMPTS; i++) {
    if (BACKOFF_MS[i]) await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
    try {
      const res = await fetchRecording(recordingSid);
      if (res.ok) return await res.blob();
      lastErr = new Error(`recording download ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Runs the full post-recording pipeline. Safe to call after claimVoicemail returned "claimed". */
export async function processVoicemail(db: DB, recordingSid: string): Promise<void> {
  const env = getEnv();
  const vm = await getVoicemail(db, recordingSid);
  if (!vm) return;
  if (vm.transcriptionStatus === "done" || vm.transcriptionStatus === "in_progress") return;
  const call = await getCall(db, vm.callSid);
  if (!call) return;

  try {
    await setTranscriptionStatus(db, recordingSid, "in_progress");
    let transcript: string | null = null;
    try {
      const audio = await downloadWithRetry(recordingSid);
      transcript = await transcribe(audio, `${recordingSid}.mp3`);
      await setTranscriptionStatus(db, recordingSid, "done", { transcript });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("voicemail pipeline failed", { recordingSid, message });
      await setTranscriptionStatus(db, recordingSid, "failed", { error: message.slice(0, 500) });
    }

    if (!vm.notifiedAt) {
      const body = composeVoicemailSms({
        displayName: await displayNameFor(db, call.fromNumber),
        durationSeconds: vm.durationSeconds,
        transcript,
        callSid: call.sid,
        baseUrl: env.PUBLIC_BASE_URL,
      });
      if (await sendWithRetry(body)) await setNotified(db, recordingSid);
    }
  } catch (err) {
    console.error("voicemail pipeline crashed", { recordingSid, err });
    try {
      await setTranscriptionStatus(db, recordingSid, "failed", { error: String(err).slice(0, 500) });
    } catch {
      // best effort; the function must never reject
    }
  }
}
