import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext, flushAfter } from "../helpers/handlers";
import { signedRequest } from "../helpers/twilio";
import { upsertContact } from "@/db/repo/contacts";
import { getMessage } from "@/db/repo/messages";
import { messages, contacts } from "@/db/schema";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());
const sendWithRetry = vi.fn(async (_b: string) => true);
vi.mock("@/lib/notify", async (orig) => {
  const mod = await orig<typeof import("@/lib/notify")>();
  return { ...mod, sendWithRetry: (b: string) => sendWithRetry(b) };
});

const { db } = await handlerTestContext();
const { POST: sms } = await import("@/app/api/twilio/sms/route");

const params = (over: Record<string, string> = {}) => ({
  MessageSid: "SM1", From: "+14155550199", To: "+14158438558", Body: "Are you still coming Saturday?", NumMedia: "0", ...over,
});

beforeEach(async () => {
  await db.delete(contacts);
  await db.delete(messages);
  sendWithRetry.mockClear();
});

describe("POST /api/twilio/sms", () => {
  it("stores the text, replies with empty TwiML, and relays to the cell", async () => {
    await upsertContact(db, { phone: "+14155550199", name: "Sarah Kim" });
    const res = await sms(signedRequest("/api/twilio/sms", params()));
    expect(await res.text()).toContain("<Response></Response>");
    await flushAfter();
    const m = await getMessage(db, "SM1");
    expect(m?.body).toBe("Are you still coming Saturday?");
    expect(m?.forwardedAt).toBeInstanceOf(Date);
    expect(sendWithRetry).toHaveBeenCalledWith("[THE VLKU] Sarah Kim: Are you still coming Saturday?");
  });

  it("stores media urls and mentions attachments in the relay", async () => {
    await sms(
      signedRequest("/api/twilio/sms", params({ Body: "", NumMedia: "1", MediaUrl0: "https://api.twilio.com/m/ME1", MediaContentType0: "image/jpeg" })),
    );
    await flushAfter();
    const m = await getMessage(db, "SM1");
    expect(m?.media).toEqual([{ url: "https://api.twilio.com/m/ME1", contentType: "image/jpeg" }]);
    expect(sendWithRetry).toHaveBeenCalledWith("[THE VLKU] +1 (415) 555-0199: (1 attachment, see dashboard)");
  });

  it("is idempotent on MessageSid", async () => {
    await sms(signedRequest("/api/twilio/sms", params()));
    await sms(signedRequest("/api/twilio/sms", params()));
    await flushAfter();
    expect(sendWithRetry).toHaveBeenCalledTimes(1);
  });

  it("rejects bad signatures", async () => {
    const res = await sms(signedRequest("/api/twilio/sms", params(), { tamper: true }));
    expect(res.status).toBe(403);
    expect(await getMessage(db, "SM1")).toBeNull();
  });
});
