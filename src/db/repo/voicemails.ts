import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { voicemails, type Voicemail, type TranscriptionStatus } from "@/db/schema";

/** Insert as pending, or reset a failed row to pending. Returns already_handled when work is in flight or done. */
export async function claimVoicemail(
  db: DB,
  o: { recordingSid: string; callSid: string; durationSeconds: number },
): Promise<"claimed" | "already_handled"> {
  const rows = await db
    .insert(voicemails)
    .values({ recordingSid: o.recordingSid, callSid: o.callSid, durationSeconds: o.durationSeconds })
    .onConflictDoUpdate({
      target: voicemails.recordingSid,
      set: { transcriptionStatus: "pending", transcriptionError: null },
      setWhere: sql`${voicemails.transcriptionStatus} = 'failed'`,
    })
    .returning({ sid: voicemails.recordingSid });
  return rows.length > 0 ? "claimed" : "already_handled";
}

export async function setTranscriptionStatus(
  db: DB,
  recordingSid: string,
  status: TranscriptionStatus,
  extra: { transcript?: string; error?: string } = {},
): Promise<void> {
  await db
    .update(voicemails)
    .set({
      transcriptionStatus: status,
      ...(extra.transcript !== undefined ? { transcript: extra.transcript } : {}),
      transcriptionError: extra.error ?? null,
    })
    .where(eq(voicemails.recordingSid, recordingSid));
}

export async function setNotified(db: DB, recordingSid: string): Promise<void> {
  await db.update(voicemails).set({ notifiedAt: new Date() }).where(eq(voicemails.recordingSid, recordingSid));
}

export async function markListened(db: DB, recordingSid: string): Promise<void> {
  await db
    .update(voicemails)
    .set({ listenedAt: new Date() })
    .where(sql`${voicemails.recordingSid} = ${recordingSid} and ${voicemails.listenedAt} is null`);
}

export async function getVoicemail(db: DB, recordingSid: string): Promise<Voicemail | null> {
  return (await db.query.voicemails.findFirst({ where: eq(voicemails.recordingSid, recordingSid) })) ?? null;
}

export async function getVoicemailByCall(db: DB, callSid: string): Promise<Voicemail | null> {
  return (await db.query.voicemails.findFirst({ where: eq(voicemails.callSid, callSid) })) ?? null;
}
