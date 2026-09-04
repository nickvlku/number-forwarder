import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { DB } from "@/db";
import { createCall, getCall, markAccepted, setCallStatus, finishCall } from "@/db/repo/calls";

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe("calls repo", () => {
  it("creates a ringing call and ignores duplicates", async () => {
    await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
    await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
    const c = await getCall(db, "CA1");
    expect(c?.status).toBe("ringing");
    expect(c?.accepted).toBe(false);
  });

  it("marks accepted and completes with talk seconds", async () => {
    await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
    await markAccepted(db, "CA1");
    await setCallStatus(db, "CA1", "completed", { dialStatus: "completed", talkSeconds: 90 });
    await finishCall(db, "CA1", { endedAt: new Date("2026-09-02T21:00:00Z"), totalSeconds: 112 });
    const c = await getCall(db, "CA1");
    expect(c).toMatchObject({ accepted: true, status: "completed", dialStatus: "completed", talkSeconds: 90, totalSeconds: 112 });
    expect(c?.endedAt?.toISOString()).toBe("2026-09-02T21:00:00.000Z");
  });
});
