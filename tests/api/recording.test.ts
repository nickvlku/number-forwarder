import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext, flushAfter } from "../helpers/handlers";
import { signedRequest, voiceParams } from "../helpers/twilio";
import { createCall } from "@/db/repo/calls";
import { getVoicemail } from "@/db/repo/voicemails";
import { calls, voicemails } from "@/db/schema";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());
const processVoicemail = vi.fn(async (_db: unknown, _sid: string) => {});
vi.mock("@/lib/voicemail-pipeline", () => ({ processVoicemail: (db: unknown, sid: string) => processVoicemail(db, sid) }));

const { db } = await handlerTestContext();
const { POST: recording } = await import("@/app/api/twilio/recording/route");

const SID = voiceParams().CallSid;
const params = (over: Record<string, string> = {}) => ({
  CallSid: SID, RecordingSid: "RE1", RecordingUrl: "https://api.twilio.com/x/RE1", RecordingDuration: "42", RecordingStatus: "completed", ...over,
});

beforeEach(async () => {
  await db.delete(voicemails);
  await db.delete(calls);
  await createCall(db, { sid: SID, from: "+14155550199", to: "+14158438558" });
  processVoicemail.mockClear();
});

describe("POST /api/twilio/recording", () => {
  it("creates the voicemail row and kicks off processing", async () => {
    const res = await recording(signedRequest("/api/twilio/recording", params()));
    expect(res.status).toBe(200);
    await flushAfter();
    expect((await getVoicemail(db, "RE1"))?.durationSeconds).toBe(42);
    expect(processVoicemail).toHaveBeenCalledTimes(1);
  });

  it("ignores retries once processing is in flight or done", async () => {
    await recording(signedRequest("/api/twilio/recording", params()));
    await flushAfter();
    await db.update(voicemails).set({ transcriptionStatus: "done" });
    await recording(signedRequest("/api/twilio/recording", params()));
    await flushAfter();
    expect(processVoicemail).toHaveBeenCalledTimes(1);
  });

  it("ignores non-completed statuses", async () => {
    await recording(signedRequest("/api/twilio/recording", params({ RecordingStatus: "in-progress" })));
    expect(await getVoicemail(db, "RE1")).toBeNull();
  });

  it("returns 200 without a row when the call is unknown", async () => {
    const res = await recording(signedRequest("/api/twilio/recording", params({ CallSid: "CAunknown" })));
    expect(res.status).toBe(200);
    expect(await getVoicemail(db, "RE1")).toBeNull();
  });

  it("ignores recordings under 2 seconds", async () => {
    const res = await recording(signedRequest("/api/twilio/recording", params({ RecordingDuration: "1" })));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(await getVoicemail(db, "RE1")).toBeNull();
    expect(processVoicemail).not.toHaveBeenCalled();
  });
});
