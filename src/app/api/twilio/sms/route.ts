import { after } from "next/server";
import { getDb } from "@/db/get";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { emptyTwiml } from "@/lib/twilio/twiml";
import { normalizePhone } from "@/lib/phone";
import { insertMessage, setForwarded } from "@/db/repo/messages";
import { displayNameFor } from "@/db/repo/contacts";
import { composeTextRelay, sendWithRetry } from "@/lib/notify";
import type { MediaItem } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const p = hook.params;
  const sid = p.MessageSid ?? p.SmsSid ?? "";
  try {
    const db = await getDb();
    const count = Number.parseInt(p.NumMedia ?? "0", 10) || 0;
    const media: MediaItem[] = [];
    for (let i = 0; i < count; i++) {
      const url = p[`MediaUrl${i}`];
      if (url) media.push({ url, contentType: p[`MediaContentType${i}`] ?? "application/octet-stream" });
    }
    const from = normalizePhone(p.From) ?? p.From ?? "";
    const inserted = await insertMessage(db, { sid, from, body: p.Body ?? "", media });
    if (inserted) {
      after(async () => {
        try {
          const body = composeTextRelay({
            displayName: await displayNameFor(db, from),
            body: p.Body ?? "",
            mediaCount: media.length,
          });
          if (await sendWithRetry(body)) await setForwarded(db, sid);
        } catch (err) {
          console.error("sms relay failed", { sid, err });
        }
      });
    }
  } catch (err) {
    console.error("sms webhook failed", { sid, err });
  }
  return twiml(emptyTwiml());
}
