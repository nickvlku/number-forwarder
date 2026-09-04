import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "./helpers/db";
import { TEST_ENV } from "./helpers/twilio";
import type { DB } from "@/db";
import { createCall } from "@/db/repo/calls";
import { upsertContact } from "@/db/repo/contacts";
import { claimVoicemail, getVoicemail } from "@/db/repo/voicemails";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});
const fetchRecording = vi.fn();
vi.mock("@/lib/twilio/rest", () => ({ fetchRecording: (sid: string) => fetchRecording(sid) }));
const transcribe = vi.fn();
vi.mock("@/lib/transcription", () => ({ transcribe: (b: Blob, f: string) => transcribe(b, f) }));
const sendWithRetry = vi.fn(async (_body: string) => true);
vi.mock("@/lib/notify", async (orig) => {
  const mod = await orig<typeof import("@/lib/notify")>();
  return { ...mod, sendWithRetry: (b: string) => sendWithRetry(b) };
});

const { processVoicemail } = await import("@/lib/voicemail-pipeline");

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
  await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
  await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 });
  fetchRecording.mockReset();
  transcribe.mockReset();
  sendWithRetry.mockClear();
});

describe("processVoicemail", () => {
  it("downloads, transcribes, saves, and notifies with the contact name", async () => {
    await upsertContact(db, { phone: "+14155550199", name: "Dr. Patel's office" });
    fetchRecording.mockResolvedValue(new Response("mp3bytes", { status: 200, headers: { "content-type": "audio/mpeg" } }));
    transcribe.mockResolvedValue("Hi Nick, confirming Thursday.");
    await processVoicemail(db, "RE1");
    const vm = await getVoicemail(db, "RE1");
    expect(vm).toMatchObject({ transcriptionStatus: "done", transcript: "Hi Nick, confirming Thursday." });
    expect(vm?.notifiedAt).toBeInstanceOf(Date);
    expect(transcribe.mock.calls[0][1]).toBe("RE1.mp3");
    expect(sendWithRetry).toHaveBeenCalledWith(
      `[THE VLKU] Voicemail from Dr. Patel's office (0:42)\n"Hi Nick, confirming Thursday."\nhttps://vlku.test/calls/CA1`,
    );
  });

  it("marks failed but still notifies when Whisper fails", async () => {
    fetchRecording.mockResolvedValue(new Response("mp3bytes", { status: 200 }));
    transcribe.mockRejectedValue(new Error("Whisper 500: down"));
    await processVoicemail(db, "RE1");
    const vm = await getVoicemail(db, "RE1");
    expect(vm?.transcriptionStatus).toBe("failed");
    expect(vm?.transcriptionError).toMatch(/Whisper 500/);
    expect(sendWithRetry.mock.calls[0][0]).toContain("Transcription unavailable");
  });

  it("marks failed when the download fails, after retrying", async () => {
    fetchRecording.mockResolvedValue(new Response("nope", { status: 404 }));
    await processVoicemail(db, "RE1");
    expect(fetchRecording).toHaveBeenCalledTimes(3);
    expect((await getVoicemail(db, "RE1"))?.transcriptionStatus).toBe("failed");
  }, 15_000); // real backoff of 2 s + 5 s exceeds the default 5 s test timeout

  it("does not notify twice if run again after success", async () => {
    fetchRecording.mockResolvedValue(new Response("mp3bytes", { status: 200 }));
    transcribe.mockResolvedValue("hello");
    await processVoicemail(db, "RE1");
    await processVoicemail(db, "RE1");
    expect(sendWithRetry).toHaveBeenCalledTimes(1);
  });

  it("never rejects even when a status write fails, and marks the row failed", async () => {
    fetchRecording.mockResolvedValue(new Response("mp3bytes", { status: 200 }));
    transcribe.mockResolvedValue("hello");
    sendWithRetry.mockRejectedValueOnce(new Error("boom"));
    await expect(processVoicemail(db, "RE1")).resolves.toBeUndefined();
    expect((await getVoicemail(db, "RE1"))?.transcriptionStatus).toBe("failed");
  });
});
