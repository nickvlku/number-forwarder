import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { DB } from "@/db";
import { createCall } from "@/db/repo/calls";
import { claimVoicemail, setTranscriptionStatus, getVoicemail, markListened } from "@/db/repo/voicemails";

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
  await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
});

describe("voicemails repo", () => {
  it("claims a new recording once", async () => {
    expect(await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 })).toBe("claimed");
    await setTranscriptionStatus(db, "RE1", "in_progress");
    expect(await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 })).toBe("already_handled");
  });

  it("lets a failed transcription be claimed again for retry", async () => {
    await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 });
    await setTranscriptionStatus(db, "RE1", "failed", { error: "boom" });
    expect(await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 })).toBe("claimed");
    expect((await getVoicemail(db, "RE1"))?.transcriptionStatus).toBe("pending");
  });

  it("stores transcript and listened time", async () => {
    await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 });
    await setTranscriptionStatus(db, "RE1", "done", { transcript: "hello" });
    await markListened(db, "RE1");
    const vm = await getVoicemail(db, "RE1");
    expect(vm?.transcript).toBe("hello");
    expect(vm?.listenedAt).toBeInstanceOf(Date);
  });
});
