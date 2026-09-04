import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { DB } from "@/db";
import { calls, messages } from "@/db/schema";
import { upsertContact } from "@/db/repo/contacts";
import { claimVoicemail, setTranscriptionStatus, markListened } from "@/db/repo/voicemails";
import { markRead } from "@/db/repo/messages";
import { listFeed, getFeedItem, countUnread, historyFor, effectiveStatus } from "@/db/repo/feed";

let db: DB;
const t = (min: number) => new Date(Date.UTC(2026, 8, 2, 12, min));

beforeEach(async () => {
  db = await createTestDb();
  await upsertContact(db, { phone: "+14155550199", name: "Jane" });
  await db.insert(calls).values([
    { sid: "CA1", fromNumber: "+14155550199", toNumber: "+1", status: "completed", accepted: true, startedAt: t(0), talkSeconds: 90 },
    { sid: "CA2", fromNumber: "+16505550123", toNumber: "+1", status: "missed", startedAt: t(10) },
    { sid: "CA3", fromNumber: "+14155550199", toNumber: "+1", status: "voicemail", startedAt: t(20) },
  ]);
  await claimVoicemail(db, { recordingSid: "RE3", callSid: "CA3", durationSeconds: 42 });
  await setTranscriptionStatus(db, "RE3", "done", { transcript: "hi" });
  await db.insert(messages).values([
    { sid: "SM1", fromNumber: "+14155550199", body: "yo", receivedAt: t(5) },
    { sid: "SM2", fromNumber: "+16505550123", body: "hey", receivedAt: t(30) },
  ]);
});

describe("listFeed", () => {
  it("interleaves calls and texts newest first with contacts joined", async () => {
    const { items } = await listFeed(db, { filter: "all", limit: 10 });
    expect(items.map((i) => i.id)).toEqual(["SM2", "CA3", "CA2", "SM1", "CA1"]);
    expect(items[1].contact?.name).toBe("Jane");
    expect(items[1].kind === "call" && items[1].voicemail?.transcript).toBe("hi");
  });

  it("filters", async () => {
    expect((await listFeed(db, { filter: "voicemail", limit: 10 })).items.map((i) => i.id)).toEqual(["CA3"]);
    expect((await listFeed(db, { filter: "missed", limit: 10 })).items.map((i) => i.id)).toEqual(["CA2"]);
    expect((await listFeed(db, { filter: "text", limit: 10 })).items.map((i) => i.id)).toEqual(["SM2", "SM1"]);
    expect((await listFeed(db, { filter: "answered", limit: 10 })).items.map((i) => i.id)).toEqual(["CA1"]);
  });

  it("paginates with a before cursor", async () => {
    const page1 = await listFeed(db, { filter: "all", limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(["SM2", "CA3"]);
    expect(page1.nextBefore).toEqual(t(20));
    const page2 = await listFeed(db, { filter: "all", limit: 2, before: page1.nextBefore! });
    expect(page2.items.map((i) => i.id)).toEqual(["CA2", "SM1"]);
    const page3 = await listFeed(db, { filter: "all", limit: 2, before: page2.nextBefore! });
    expect(page3.items.map((i) => i.id)).toEqual(["CA1"]);
    expect(page3.nextBefore).toBeNull();
  });

  it("missed filter excludes a live ringing call and includes a stale pending voicemail", async () => {
    const now = new Date();
    await db.insert(calls).values([
      { sid: "CA_live", fromNumber: "+14155550000", toNumber: "+1", status: "ringing", startedAt: new Date(now.getTime() - 60_000) },
      { sid: "CA_stale", fromNumber: "+14155550000", toNumber: "+1", status: "voicemail_pending", startedAt: new Date(now.getTime() - 20 * 60_000) },
    ]);
    const ids = (await listFeed(db, { filter: "missed", limit: 20 })).items.map((i) => i.id);
    expect(ids).toContain("CA_stale");
    expect(ids).toContain("CA2");
    expect(ids).not.toContain("CA_live");
  });

  it("voicemail filter includes a fresh pending voicemail but not a stale one", async () => {
    const now = new Date();
    await db.insert(calls).values([
      { sid: "CA_fresh", fromNumber: "+14155550000", toNumber: "+1", status: "voicemail_pending", startedAt: new Date(now.getTime() - 60_000) },
      { sid: "CA_stale", fromNumber: "+14155550000", toNumber: "+1", status: "voicemail_pending", startedAt: new Date(now.getTime() - 20 * 60_000) },
    ]);
    const ids = (await listFeed(db, { filter: "voicemail", limit: 20 })).items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["CA_fresh", "CA3"]));
    expect(ids).not.toContain("CA_stale");
  });

  it("marks unread voicemails and texts", async () => {
    expect(await countUnread(db)).toBe(3); // RE3, SM1, SM2
    await markListened(db, "RE3");
    await markRead(db, "SM1");
    expect(await countUnread(db)).toBe(1);
    const { items } = await listFeed(db, { filter: "all", limit: 10 });
    expect(items.find((i) => i.id === "CA3")?.unread).toBe(false);
    expect(items.find((i) => i.id === "SM2")?.unread).toBe(true);
    expect(items.find((i) => i.id === "CA2")?.unread).toBe(false); // missed calls are never "unread"
  });
});

describe("getFeedItem and historyFor", () => {
  it("fetches by call or message sid", async () => {
    expect((await getFeedItem(db, "CA3"))?.kind).toBe("call");
    expect((await getFeedItem(db, "SM1"))?.kind).toBe("text");
    expect(await getFeedItem(db, "nope")).toBeNull();
  });
  it("lists one number's history newest first", async () => {
    expect((await historyFor(db, "+14155550199")).map((i) => i.id)).toEqual(["CA3", "SM1", "CA1"]);
  });
});

describe("effectiveStatus", () => {
  it("treats stale ringing as missed", () => {
    const call = { status: "ringing", startedAt: t(0) } as never;
    expect(effectiveStatus(call, t(5))).toBe("ringing");
    expect(effectiveStatus(call, t(20))).toBe("missed");
  });
  it("treats a stale voicemail with no recording as missed, a fresh one as voicemail", () => {
    const call = { status: "voicemail", startedAt: t(0) } as never;
    expect(effectiveStatus(call, t(5), { hasVoicemail: false })).toBe("voicemail");
    expect(effectiveStatus(call, t(20), { hasVoicemail: false })).toBe("missed");
    expect(effectiveStatus(call, t(20), { hasVoicemail: true })).toBe("voicemail");
    expect(effectiveStatus(call, t(20))).toBe("voicemail");
  });
});

describe("listFeed filters agree with effectiveStatus for a voicemail that never got a recording", () => {
  it("shows a stale recording-less voicemail under Missed, not Voicemail", async () => {
    const now = new Date();
    await db.insert(calls).values([
      { sid: "CA_norec_stale", fromNumber: "+14155550000", toNumber: "+1", status: "voicemail", startedAt: new Date(now.getTime() - 20 * 60_000) },
      { sid: "CA_norec_fresh", fromNumber: "+14155550000", toNumber: "+1", status: "voicemail", startedAt: new Date(now.getTime() - 60_000) },
    ]);
    const missed = (await listFeed(db, { filter: "missed", limit: 20 })).items.map((i) => i.id);
    const voicemail = (await listFeed(db, { filter: "voicemail", limit: 20 })).items.map((i) => i.id);
    expect(missed).toContain("CA_norec_stale");
    expect(missed).not.toContain("CA_norec_fresh");
    expect(voicemail).toContain("CA_norec_fresh");
    expect(voicemail).toContain("CA3");
    expect(voicemail).not.toContain("CA_norec_stale");
  });
});
