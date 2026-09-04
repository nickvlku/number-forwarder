import { after } from "next/server";
import { getDb } from "@/db/get";
import { readWebhook } from "@/lib/twilio/webhook";
import { MIN_MESSAGE_SECONDS } from "@/lib/twilio/twiml";
import { getCall, setCallStatus } from "@/db/repo/calls";
import { claimVoicemail, getVoicemailByCall } from "@/db/repo/voicemails";
import { processVoicemail } from "@/lib/voicemail-pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, RecordingSid, RecordingDuration, RecordingStatus } = hook.params;
  if (RecordingStatus === "absent" || RecordingStatus === "failed") return noRecording(CallSid, RecordingSid, RecordingStatus);
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

/**
 * Twilio reports "absent" when the caller hung up before any audio was captured (typically at the beep)
 * and "failed" when it could not produce media. record-done has usually already marked the call a
 * voicemail by then, so correct it to missed unless a real recording exists for the call.
 */
async function noRecording(CallSid: string, RecordingSid: string | undefined, status: string): Promise<Response> {
  try {
    const db = await getDb();
    const call = await getCall(db, CallSid);
    if (!call) return new Response(null, { status: 200 });
    if (await getVoicemailByCall(db, CallSid)) return new Response(null, { status: 200 });
    if (call.status === "voicemail" || call.status === "voicemail_pending") {
      console.warn("recording unavailable, marking call missed", { CallSid, RecordingSid, status });
      await setCallStatus(db, CallSid, "missed");
    }
  } catch (err) {
    console.error("recording webhook failed", { CallSid, RecordingSid, err });
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}
