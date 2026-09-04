import { describe, it, expect } from "vitest";
import { pillFor } from "@/components/TypePill";
import type { FeedItem } from "@/db/repo/feed";

const call = (status: string, extra: Partial<FeedItem & { kind: "call" }> = {}): FeedItem =>
  ({ kind: "call", id: "CA", at: new Date(), unread: false, contact: null, voicemail: null,
     call: { sid: "CA", status, startedAt: new Date() }, ...extra }) as never;

describe("pillFor", () => {
  it("maps statuses to labels and tones", () => {
    expect(pillFor(call("completed"))).toEqual({ label: "Answered", tone: "answered" });
    expect(pillFor(call("voicemail"))).toEqual({ label: "Voicemail", tone: "voicemail" });
    expect(pillFor(call("voicemail_pending"))).toEqual({ label: "Recording", tone: "pending" });
    expect(pillFor(call("missed"))).toEqual({ label: "Missed", tone: "missed" });
    expect(pillFor(call("failed"))).toEqual({ label: "Failed", tone: "missed" });
    expect(pillFor(call("ringing"))).toEqual({ label: "Ringing", tone: "pending" });
    expect(pillFor({ kind: "text" } as never)).toEqual({ label: "Text", tone: "text" });
  });
  it("uses effective status so a stale ringing call shows Missed", () => {
    const stale = call("ringing");
    (stale as { call: { startedAt: Date } }).call.startedAt = new Date(Date.now() - 60 * 60_000);
    expect(pillFor(stale).label).toBe("Missed");
  });

  it("shows Missed for a stale voicemail-status call with no recording, Voicemail when fresh", () => {
    const stale = call("voicemail");
    (stale as { call: { startedAt: Date } }).call.startedAt = new Date(Date.now() - 60 * 60_000);
    expect(pillFor(stale).label).toBe("Missed");
    expect(pillFor(call("voicemail")).label).toBe("Voicemail");
  });
});
