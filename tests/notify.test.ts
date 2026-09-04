import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { TEST_ENV } from "./helpers/twilio";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});
const sendSms = vi.fn();
vi.mock("@/lib/twilio/rest", () => ({ sendSms: (o: unknown) => sendSms(o) }));

let notify: typeof import("@/lib/notify");
beforeAll(async () => {
  notify = await import("@/lib/notify");
});
beforeEach(() => {
  sendSms.mockReset();
  vi.useRealTimers();
});

describe("composeVoicemailSms", () => {
  const base = { displayName: "Dr. Patel's office", durationSeconds: 42, callSid: "CA1", baseUrl: "https://vlku.test" };

  it("includes name, duration, quoted transcript, and link", () => {
    const s = notify.composeVoicemailSms({ ...base, transcript: "Hi Nick, confirming Thursday." });
    expect(s).toBe(
      `[THE VLKU] Voicemail from Dr. Patel's office (0:42)\n"Hi Nick, confirming Thursday."\nhttps://vlku.test/calls/CA1`,
    );
  });

  it("truncates long transcripts to keep the whole message under 320 chars", () => {
    const s = notify.composeVoicemailSms({ ...base, transcript: "word ".repeat(200) });
    expect(s.length).toBeLessThanOrEqual(320);
    expect(s).toContain('..."');
    expect(s.endsWith("https://vlku.test/calls/CA1")).toBe(true);
  });

  it("explains when transcription failed", () => {
    const s = notify.composeVoicemailSms({ ...base, transcript: null });
    expect(s).toContain("Transcription unavailable, listen in the dashboard.");
  });

  it("caps a very long display name so the whole message stays under 320 chars", () => {
    const s = notify.composeVoicemailSms({ ...base, displayName: "X".repeat(400), transcript: "word ".repeat(100) });
    expect(s.length).toBeLessThanOrEqual(320);
    expect(s).toMatch(/^\[THE VLKU\] Voicemail from X{59}… \(0:42\)\n/);
    expect(s.endsWith("https://vlku.test/calls/CA1")).toBe(true);
  });
});

describe("composeTextRelay", () => {
  it("prefixes with the sender", () => {
    expect(notify.composeTextRelay({ displayName: "Sarah Kim", body: "still on?", mediaCount: 0 })).toBe("[THE VLKU] Sarah Kim: still on?");
  });
  it("notes attachments", () => {
    expect(notify.composeTextRelay({ displayName: "+1 (415) 555-0199", body: "", mediaCount: 2 })).toBe(
      "[THE VLKU] +1 (415) 555-0199: (2 attachments, see dashboard)",
    );
  });

  it("caps a very long sender name", () => {
    const s = notify.composeTextRelay({ displayName: "Y".repeat(100), body: "hi", mediaCount: 0 });
    expect(s).toBe(`[THE VLKU] ${"Y".repeat(59)}…: hi`);
  });
});

describe("sendWithRetry", () => {
  it("retries once after 30 seconds then succeeds", async () => {
    vi.useFakeTimers();
    sendSms.mockRejectedValueOnce(new Error("Twilio 500")).mockResolvedValueOnce({ sid: "SM1" });
    const p = notify.sendWithRetry("hello");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBe(true);
    expect(sendSms).toHaveBeenCalledTimes(2);
    expect(sendSms).toHaveBeenCalledWith({ to: "+14155550100", body: "hello" });
  });

  it("returns false after the retry fails", async () => {
    vi.useFakeTimers();
    sendSms.mockRejectedValue(new Error("Twilio 500"));
    const p = notify.sendWithRetry("hello");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBe(false);
  });
});
