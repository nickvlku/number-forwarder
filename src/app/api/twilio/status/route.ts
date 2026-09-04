import { getDb } from "@/db/get";
import { readWebhook } from "@/lib/twilio/webhook";
import { getCall, setCallStatus, finishCall } from "@/db/repo/calls";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, CallStatus, CallDuration, Timestamp } = hook.params;
  if (CallStatus !== "completed") return new Response(null, { status: 200 });
  try {
    const db = await getDb();
    const call = await getCall(db, CallSid);
    if (!call) {
      console.warn("status callback for unknown call", { CallSid });
      return new Response(null, { status: 200 });
    }
    const endedAt = Timestamp && !Number.isNaN(Date.parse(Timestamp)) ? new Date(Timestamp) : new Date();
    await finishCall(db, CallSid, { endedAt, totalSeconds: Number.parseInt(CallDuration ?? "0", 10) || 0 });
    if (call.status === "ringing") await setCallStatus(db, CallSid, "missed", { dialStatus: "caller_hung_up" });
  } catch (err) {
    console.error("status webhook failed", { CallSid, err });
  }
  return new Response(null, { status: 200 });
}
