import { after } from "next/server";
import { getDb } from "@/db/get";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { hangupTwiml, MIN_MESSAGE_SECONDS } from "@/lib/twilio/twiml";
import { setCallStatus } from "@/db/repo/calls";
import { deleteRecording } from "@/lib/twilio/rest";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, RecordingSid, RecordingDuration } = hook.params;
  try {
    const db = await getDb();
    const seconds = Number.parseInt(RecordingDuration ?? "0", 10) || 0;
    if (seconds < MIN_MESSAGE_SECONDS) {
      await setCallStatus(db, CallSid, "missed");
      if (RecordingSid) {
        after(async () => {
          try {
            await deleteRecording(RecordingSid);
          } catch (err) {
            console.error("failed to delete empty recording", { RecordingSid, err });
          }
        });
      }
    } else {
      await setCallStatus(db, CallSid, "voicemail");
    }
  } catch (err) {
    console.error("record-done webhook failed", { CallSid, err });
  }
  return twiml(hangupTwiml());
}
