import { getDb } from "@/db/get";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { acceptTwiml, hangupTwiml } from "@/lib/twilio/twiml";
import { markAccepted } from "@/db/repo/calls";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const callSid = new URL(hook.url).searchParams.get("callSid") ?? "";
  if (hook.params.Digits !== "1") return twiml(hangupTwiml());
  try {
    const db = await getDb();
    await markAccepted(db, callSid);
  } catch (err) {
    // Still bridge the call; losing the accepted flag is better than dropping Nick's answer.
    console.error("whisper-result failed to mark accepted", { callSid, err });
  }
  return twiml(acceptTwiml());
}
