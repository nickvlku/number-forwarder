import { getDb } from "@/db/get";
import { getEnv } from "@/lib/env";
import { normalizePhone, spokenDigits } from "@/lib/phone";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { whisperTwiml, hangupTwiml } from "@/lib/twilio/twiml";
import { getCall } from "@/db/repo/calls";
import { getContact } from "@/db/repo/contacts";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const callSid = new URL(hook.url).searchParams.get("callSid") ?? "";
  try {
    const env = getEnv();
    const db = await getDb();
    const call = await getCall(db, callSid);
    if (!call) return twiml(hangupTwiml());
    const phone = normalizePhone(call.fromNumber);
    const contact = phone ? await getContact(db, phone) : null;
    const displayName = contact?.name?.trim() || (phone ? spokenDigits(phone) : "an unknown number");
    return twiml(whisperTwiml({ callSid, displayName, baseUrl: env.PUBLIC_BASE_URL }));
  } catch (err) {
    console.error("whisper webhook failed", { callSid, err });
    return twiml(hangupTwiml());
  }
}
