import { after } from "next/server";
import { getDb } from "@/db/get";
import { readWebhook } from "@/lib/twilio/webhook";
import { MIN_MESSAGE_SECONDS } from "@/lib/twilio/twiml";
import { getCall } from "@/db/repo/calls";
import { claimVoicemail } from "@/db/repo/voicemails";
import { processVoicemail } from "@/lib/voicemail-pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, RecordingSid, RecordingDuration, RecordingStatus } = hook.params;
  if (RecordingStatus !== "completed" || !RecordingSid) return new Response(null, { status: 200 });
  const seconds = Number.parseInt(RecordingDuration ?? "0", 10) || 0;
  if (seconds < MIN_MESSAGE_SECONDS) {
    console.warn("ignoring short recording", { CallSid, RecordingSid, seconds });
    return new Response(null, { status: 200 });
  }
  try {
    const db = await getDb();
    if (!(await getCall(db, CallSid))) {
      console.warn("recording for unknown call", { CallSid, RecordingSid });
      return new Response(null, { status: 200 });
    }
    const claim = await claimVoicemail(db, {
      recordingSid: RecordingSid,
      callSid: CallSid,
      durationSeconds: seconds,
    });
    if (claim === "claimed") {
      after(() => processVoicemail(db, RecordingSid));
    }
  } catch (err) {
    console.error("recording webhook failed", { CallSid, RecordingSid, err });
    return new Response(null, { status: 500 }); // Twilio retries on 5xx; the claim is idempotent
  }
  return new Response(null, { status: 200 });
}
