import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext } from "../helpers/handlers";
import { signedRequest, voiceParams } from "../helpers/twilio";
import { upsertContact } from "@/db/repo/contacts";
import { setForwardingEnabled } from "@/db/repo/settings";
import { getCall } from "@/db/repo/calls";
import { calls, contacts, greeting } from "@/db/schema";
import { saveGreeting } from "@/db/repo/greeting";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());

const { db } = await handlerTestContext();
const { POST: voice } = await import("@/app/api/twilio/voice/route");
const { POST: whisper } = await import("@/app/api/twilio/whisper/route");
const { POST: whisperResult } = await import("@/app/api/twilio/whisper-result/route");

beforeEach(async () => {
  await db.delete(contacts);
  await db.delete(calls);
  await db.delete(greeting);
  await setForwardingEnabled(db, true);
});

describe("POST /api/twilio/voice", () => {
  it("rejects bad signatures without writing", async () => {
    const res = await voice(signedRequest("/api/twilio/voice", voiceParams(), { tamper: true }));
    expect(res.status).toBe(403);
    expect(await getCall(db, voiceParams().CallSid)).toBeNull();
  });

  it("creates a ringing call and dials the cell with the caller's number as caller id", async () => {
    const res = await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const xml = await res.text();
    expect(res.status).toBe(200);
    expect(xml).toContain('callerId="+14155550199"');
    expect(xml).toContain(">+14155550100</Number>");
    expect(xml).toContain("/api/twilio/whisper?callSid=CA0000000000000000000000000000001");
    expect((await getCall(db, voiceParams().CallSid))?.status).toBe("ringing");
  });

  it("falls back to the Twilio number as caller id when From is withheld", async () => {
    const res = await voice(signedRequest("/api/twilio/voice", voiceParams({ From: "anonymous" })));
    expect(await res.text()).toContain('callerId="+14158438558"');
    expect((await getCall(db, voiceParams().CallSid))?.fromNumber).toBe("anonymous");
  });

  it("goes straight to voicemail when forwarding is off", async () => {
    await setForwardingEnabled(db, false);
    const res = await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const xml = await res.text();
    expect(xml).toContain("You've reached THE VLKU");
    expect(xml).not.toContain("<Dial");
    expect((await getCall(db, voiceParams().CallSid))?.status).toBe("voicemail_pending");
  });
});

describe("POST /api/twilio/voice greeting precedence", () => {
  it("plays the recorded greeting from the app when one is saved", async () => {
    await setForwardingEnabled(db, false);
    const meta = await saveGreeting(db, { audio: Buffer.from([1, 2, 3]), contentType: "audio/wav", durationSeconds: 3 });
    const res = await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const xml = await res.text();
    expect(xml).toContain(`<Play>https://vlku.test/api/greeting.wav?v=${meta.updatedAt.getTime()}</Play>`);
    expect(xml).not.toContain("<Say");
  });
});

describe("POST /api/twilio/whisper", () => {
  it("speaks the contact name when known", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams()));
    await upsertContact(db, { phone: "+14155550199", name: "Jane Doe" });
    const res = await whisper(
      signedRequest("/api/twilio/whisper?callSid=CA0000000000000000000000000000001", { CallSid: "CAchild", From: "+14158438558" }),
    );
    const xml = await res.text();
    expect(xml).toContain("Call for THE VLKU from Jane Doe. Press 1 to accept.");
    expect(xml).toContain("/api/twilio/whisper-result?callSid=CA0000000000000000000000000000001");
  });

  it("reads digits when unknown", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const res = await whisper(
      signedRequest("/api/twilio/whisper?callSid=CA0000000000000000000000000000001", { CallSid: "CAchild" }),
    );
    expect(await res.text()).toContain("from 4 1 5, 5 5 5, 0 1 9 9. Press 1");
  });

  it("says unknown caller when the number was withheld", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams({ From: "anonymous" })));
    const res = await whisper(
      signedRequest("/api/twilio/whisper?callSid=CA0000000000000000000000000000001", { CallSid: "CAchild" }),
    );
    expect(await res.text()).toContain("from an unknown number. Press 1");
  });
});

describe("POST /api/twilio/whisper-result", () => {
  it("accepts on 1 and marks the call accepted", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const res = await whisperResult(
      signedRequest("/api/twilio/whisper-result?callSid=CA0000000000000000000000000000001", { Digits: "1", CallSid: "CAchild" }),
    );
    expect(await res.text()).toContain("<Response></Response>");
    expect((await getCall(db, voiceParams().CallSid))?.accepted).toBe(true);
  });

  it("hangs up the cell leg on any other digit", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const res = await whisperResult(
      signedRequest("/api/twilio/whisper-result?callSid=CA0000000000000000000000000000001", { Digits: "2", CallSid: "CAchild" }),
    );
    expect(await res.text()).toContain("<Hangup/>");
    expect((await getCall(db, voiceParams().CallSid))?.accepted).toBe(false);
  });
});
