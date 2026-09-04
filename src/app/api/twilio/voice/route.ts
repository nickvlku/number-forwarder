import { getDb } from "@/db/get";
import { getEnv } from "@/lib/env";
import { resolveGreetingUrl } from "@/lib/greeting";
import { normalizePhone } from "@/lib/phone";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { dialTwiml, voicemailTwiml, errorTwiml } from "@/lib/twilio/twiml";
import { createCall, setCallStatus } from "@/db/repo/calls";
import { getForwardingEnabled } from "@/db/repo/settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, From, To } = hook.params;
  try {
    const env = getEnv();
    const db = await getDb();
    await createCall(db, { sid: CallSid, from: From ?? "", to: To ?? env.TWILIO_NUMBER });

    if (!(await getForwardingEnabled(db))) {
      await setCallStatus(db, CallSid, "voicemail_pending", { dialStatus: "forwarding_off" });
      return twiml(voicemailTwiml({ baseUrl: env.PUBLIC_BASE_URL, greetingUrl: await resolveGreetingUrl(db, env) }));
    }

    const callerId = normalizePhone(From) ?? env.TWILIO_NUMBER;
    return twiml(dialTwiml({ callSid: CallSid, callerId, cellNumber: env.CELL_NUMBER, baseUrl: env.PUBLIC_BASE_URL }));
  } catch (err) {
    console.error("voice webhook failed", { CallSid, err });
    return twiml(errorTwiml());
  }
}
