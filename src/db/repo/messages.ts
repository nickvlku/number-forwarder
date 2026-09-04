import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { messages, type Message, type MediaItem } from "@/db/schema";

export async function insertMessage(
  db: DB,
  o: { sid: string; from: string; body: string; media: MediaItem[] },
): Promise<boolean> {
  const rows = await db
    .insert(messages)
    .values({ sid: o.sid, fromNumber: o.from, body: o.body, media: o.media })
    .onConflictDoNothing()
    .returning({ sid: messages.sid });
  return rows.length > 0;
}

export async function getMessage(db: DB, sid: string): Promise<Message | null> {
  return (await db.query.messages.findFirst({ where: eq(messages.sid, sid) })) ?? null;
}

export async function setForwarded(db: DB, sid: string): Promise<void> {
  await db.update(messages).set({ forwardedAt: new Date() }).where(eq(messages.sid, sid));
}

export async function markRead(db: DB, sid: string): Promise<void> {
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(sql`${messages.sid} = ${sid} and ${messages.readAt} is null`);
}
