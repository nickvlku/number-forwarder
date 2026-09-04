import { getDb } from "@/db/get";
import { getEnv } from "@/lib/env";
import { resolveGreetingUrl } from "@/lib/greeting";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { voicemailTwiml, hangupTwiml, errorTwiml } from "@/lib/twilio/twiml";
import { getCall, setCallStatus } from "@/db/repo/calls";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, DialCallStatus, DialCallDuration } = hook.params;
  try {
    const env = getEnv();
    const db = await getDb();
    const call = await getCall(db, CallSid);

    if (DialCallStatus === "completed" && call?.accepted) {
      await setCallStatus(db, CallSid, "completed", {
        dialStatus: DialCallStatus,
        talkSeconds: Number.parseInt(DialCallDuration ?? "0", 10) || 0,
      });
      return twiml(hangupTwiml());
    }
    if (DialCallStatus === "canceled") {
      await setCallStatus(db, CallSid, "missed", { dialStatus: DialCallStatus });
      return twiml(hangupTwiml());
    }
    await setCallStatus(db, CallSid, "voicemail_pending", { dialStatus: DialCallStatus ?? "unknown" });
    return twiml(voicemailTwiml({ baseUrl: env.PUBLIC_BASE_URL, greetingUrl: await resolveGreetingUrl(db, env) }));
  } catch (err) {
    console.error("dial-status webhook failed", { CallSid, err });
    return twiml(errorTwiml());
  }
}
