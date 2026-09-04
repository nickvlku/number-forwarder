import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function main() {
  await db.delete(schema.voicemails);
  await db.delete(schema.calls);
  await db.delete(schema.messages);
  await db.delete(schema.contacts);

  await db.insert(schema.contacts).values([
    { phone: "+14155550142", name: "Dr. Patel's office", notes: "Dentist. Front desk is Maria." },
    { phone: "+14155550177", name: "Sarah Kim" },
    { phone: "+14155550120", name: "Mom" },
  ]);

  await db.insert(schema.calls).values([
    { sid: "CAseed0001", fromNumber: "+14155550142", toNumber: "+14158438558", status: "voicemail", dialStatus: "no-answer", startedAt: minutesAgo(30), endedAt: minutesAgo(29), totalSeconds: 68 },
    { sid: "CAseed0002", fromNumber: "+14155550199", toNumber: "+14158438558", status: "missed", dialStatus: "no-answer", startedAt: minutesAgo(200), endedAt: minutesAgo(199), totalSeconds: 20 },
    { sid: "CAseed0003", fromNumber: "+14155550120", toNumber: "+14158438558", status: "completed", dialStatus: "completed", accepted: true, startedAt: minutesAgo(1500), endedAt: minutesAgo(1487), talkSeconds: 728, totalSeconds: 745 },
    { sid: "CAseed0004", fromNumber: "+16505550123", toNumber: "+14158438558", status: "voicemail", dialStatus: "busy", startedAt: minutesAgo(1700), endedAt: minutesAgo(1698), totalSeconds: 91 },
  ]);

  await db.insert(schema.voicemails).values([
    { recordingSid: "REseed0001", callSid: "CAseed0001", durationSeconds: 42, transcriptionStatus: "done", transcript: "Hi Nick, this is Dr. Patel's office calling to confirm your appointment Thursday at 3:30. Please call us back at 415-555-0142 if you need to reschedule. Thanks!", notifiedAt: minutesAgo(28) },
    { recordingSid: "REseed0004", callSid: "CAseed0004", durationSeconds: 65, transcriptionStatus: "failed", transcriptionError: "Whisper 429: rate limited", notifiedAt: minutesAgo(1697), listenedAt: minutesAgo(1000) },
  ]);

  await db.insert(schema.messages).values([
    { sid: "SMseed0001", fromNumber: "+14155550177", body: "Are you still coming Saturday? Let me know!", receivedAt: minutesAgo(90), forwardedAt: minutesAgo(90) },
    { sid: "SMseed0002", fromNumber: "+16505550123", body: "", media: [{ url: "https://api.twilio.com/example/ME1", contentType: "image/jpeg" }], receivedAt: minutesAgo(3000), forwardedAt: minutesAgo(3000), readAt: minutesAgo(2000) },
  ]);

  console.log("seeded");
}

main().finally(() => client.end());
