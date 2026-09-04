import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { greeting } from "@/db/schema";

export type GreetingMeta = { durationSeconds: number; contentType: string; byteLength: number; updatedAt: Date };

const META = {
  durationSeconds: greeting.durationSeconds,
  contentType: greeting.contentType,
  byteLength: greeting.byteLength,
  updatedAt: greeting.updatedAt,
};

/** Metadata only; never loads the audio bytes. Used by the call flow on every voicemail. */
export async function getGreetingMeta(db: DB): Promise<GreetingMeta | null> {
  const [row] = await db.select(META).from(greeting).where(eq(greeting.id, 1));
  return row ?? null;
}

export async function getGreetingAudio(db: DB): Promise<{ audio: Buffer; contentType: string; updatedAt: Date } | null> {
  const [row] = await db
    .select({ audio: greeting.audio, contentType: greeting.contentType, updatedAt: greeting.updatedAt })
    .from(greeting)
    .where(eq(greeting.id, 1));
  return row ?? null;
}

export async function saveGreeting(
  db: DB,
  o: { audio: Buffer; contentType: string; durationSeconds: number },
): Promise<GreetingMeta> {
  const values = { audio: o.audio, contentType: o.contentType, durationSeconds: o.durationSeconds, byteLength: o.audio.byteLength, updatedAt: new Date() };
  const [row] = await db
    .insert(greeting)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: greeting.id, set: values })
    .returning(META);
  return row;
}

export async function deleteGreeting(db: DB): Promise<void> {
  await db.delete(greeting).where(eq(greeting.id, 1));
}
