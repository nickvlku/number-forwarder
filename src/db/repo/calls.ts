import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { calls, type Call, type CallStatus } from "@/db/schema";

export async function createCall(db: DB, o: { sid: string; from: string; to: string }): Promise<void> {
  await db
    .insert(calls)
    .values({ sid: o.sid, fromNumber: o.from, toNumber: o.to, status: "ringing" })
    .onConflictDoNothing();
}

export async function getCall(db: DB, sid: string): Promise<Call | null> {
  return (await db.query.calls.findFirst({ where: eq(calls.sid, sid) })) ?? null;
}

export async function markAccepted(db: DB, sid: string): Promise<void> {
  await db.update(calls).set({ accepted: true }).where(eq(calls.sid, sid));
}

export async function setCallStatus(
  db: DB,
  sid: string,
  status: CallStatus,
  extra: { dialStatus?: string; talkSeconds?: number } = {},
): Promise<void> {
  await db.update(calls).set({ status, ...extra }).where(eq(calls.sid, sid));
}

export async function finishCall(db: DB, sid: string, o: { endedAt: Date; totalSeconds: number }): Promise<void> {
  await db.update(calls).set({ endedAt: o.endedAt, totalSeconds: o.totalSeconds }).where(eq(calls.sid, sid));
}
