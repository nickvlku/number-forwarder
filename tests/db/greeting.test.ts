import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { DB } from "@/db";
import { getGreetingMeta, getGreetingAudio, saveGreeting, deleteGreeting } from "@/db/repo/greeting";

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe("greeting repo", () => {
  it("is empty by default", async () => {
    expect(await getGreetingMeta(db)).toBeNull();
    expect(await getGreetingAudio(db)).toBeNull();
  });

  it("round-trips audio bytes and metadata, replacing on save", async () => {
    const first = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3]);
    await saveGreeting(db, { audio: first, contentType: "audio/wav", durationSeconds: 12 });
    const meta = await getGreetingMeta(db);
    expect(meta).toMatchObject({ durationSeconds: 12, contentType: "audio/wav", byteLength: 7 });
    expect(meta?.updatedAt).toBeInstanceOf(Date);
    expect(Buffer.from((await getGreetingAudio(db))!.audio).equals(first)).toBe(true);

    const second = Buffer.from([9, 9]);
    await saveGreeting(db, { audio: second, contentType: "audio/wav", durationSeconds: 4 });
    expect((await getGreetingMeta(db))?.byteLength).toBe(2);
    expect(Buffer.from((await getGreetingAudio(db))!.audio).equals(second)).toBe(true);
  });

  it("deletes", async () => {
    await saveGreeting(db, { audio: Buffer.from([1]), contentType: "audio/wav", durationSeconds: 1 });
    await deleteGreeting(db);
    expect(await getGreetingMeta(db)).toBeNull();
    await expect(deleteGreeting(db)).resolves.toBeUndefined();
  });
});
