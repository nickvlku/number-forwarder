import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext, flushAfter } from "../helpers/handlers";
import { signedRequest, voiceParams } from "../helpers/twilio";
import { createCall, getCall, markAccepted } from "@/db/repo/calls";
import { calls } from "@/db/schema";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());
const deleteRecording = vi.fn(async (_sid: string) => {});
vi.mock("@/lib/twilio/rest", () => ({ deleteRecording: (sid: string) => deleteRecording(sid) }));

const { db } = await handlerTestContext();
const { POST: dialStatus } = await import("@/app/api/twilio/dial-status/route");
const { POST: recordDone } = await import("@/app/api/twilio/record-done/route");
const { POST: status } = await import("@/app/api/twilio/status/route");

const SID = voiceParams().CallSid;
beforeEach(async () => {
  await db.delete(calls);
  await createCall(db, { sid: SID, from: "+14155550199", to: "+14158438558" });
  deleteRecording.mockClear();
});

describe("POST /api/twilio/dial-status", () => {
  it("completes an accepted call with talk seconds", async () => {
    await markAccepted(db, SID);
    const res = await dialStatus(
      signedRequest("/api/twilio/dial-status", voiceParams({ DialCallStatus: "completed", DialCallDuration: "95" })),
    );
    expect(await res.text()).toContain("<Hangup/>");
    expect(await getCall(db, SID)).toMatchObject({ status: "completed", talkSeconds: 95, dialStatus: "completed" });
  });

  it("goes to voicemail when completed but never accepted (hung up during whisper)", async () => {
    const res = await dialStatus(
      signedRequest("/api/twilio/dial-status", voiceParams({ DialCallStatus: "completed", DialCallDuration: "4" })),
    );
    expect(await res.text()).toContain("<Record");
    expect((await getCall(db, SID))?.status).toBe("voicemail_pending");
  });

  it.each(["no-answer", "busy", "failed"])("goes to voicemail on %s", async (s) => {
    const res = await dialStatus(signedRequest("/api/twilio/dial-status", voiceParams({ DialCallStatus: s })));
    expect(await res.text()).toContain("You've reached THE VLKU");
    expect(await getCall(db, SID)).toMatchObject({ status: "voicemail_pending", dialStatus: s });
  });

  it("marks missed on canceled", async () => {
    const res = await dialStatus(signedRequest("/api/twilio/dial-status", voiceParams({ DialCallStatus: "canceled" })));
    expect(await res.text()).toContain("<Hangup/>");
    expect((await getCall(db, SID))?.status).toBe("missed");
  });
});

describe("POST /api/twilio/record-done", () => {
  it("marks voicemail when a real message was left", async () => {
    const res = await recordDone(
      signedRequest("/api/twilio/record-done", voiceParams({ RecordingSid: "RE1", RecordingDuration: "42" })),
    );
    expect(await res.text()).toContain("<Hangup/>");
    expect((await getCall(db, SID))?.status).toBe("voicemail");
    expect(deleteRecording).not.toHaveBeenCalled();
  });

  it("marks missed and deletes the recording when under 2 seconds", async () => {
    await recordDone(signedRequest("/api/twilio/record-done", voiceParams({ RecordingSid: "RE1", RecordingDuration: "1" })));
    await flushAfter();
    expect((await getCall(db, SID))?.status).toBe("missed");
    expect(deleteRecording).toHaveBeenCalledWith("RE1");
  });
});

describe("POST /api/twilio/status", () => {
  it("records end time and total duration", async () => {
    const res = await status(
      signedRequest("/api/twilio/status", voiceParams({ CallStatus: "completed", CallDuration: "68", Timestamp: "Wed, 02 Sep 2026 21:14:00 +0000" })),
    );
    expect(res.status).toBe(200);
    const c = await getCall(db, SID);
    expect(c?.totalSeconds).toBe(68);
    expect(c?.endedAt).toBeInstanceOf(Date);
  });

  it("turns a still-ringing call into missed (caller hung up before dial action)", async () => {
    await status(signedRequest("/api/twilio/status", voiceParams({ CallStatus: "completed", CallDuration: "8" })));
    expect((await getCall(db, SID))?.status).toBe("missed");
  });

  it("ignores non-completed statuses", async () => {
    await status(signedRequest("/api/twilio/status", voiceParams({ CallStatus: "in-progress" })));
    expect((await getCall(db, SID))?.totalSeconds).toBeNull();
  });
});
