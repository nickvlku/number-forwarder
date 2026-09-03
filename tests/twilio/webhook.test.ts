import { describe, it, expect, vi, beforeAll } from "vitest";
import { signedRequest, TEST_ENV } from "../helpers/twilio";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});

let readWebhook: typeof import("@/lib/twilio/webhook").readWebhook;
let twiml: typeof import("@/lib/twilio/webhook").twiml;
beforeAll(async () => {
  ({ readWebhook, twiml } = await import("@/lib/twilio/webhook"));
});

describe("readWebhook", () => {
  it("returns params for a validly signed request", async () => {
    const res = await readWebhook(signedRequest("/api/twilio/voice", { CallSid: "CA1", From: "+14155550199" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.params.CallSid).toBe("CA1");
  });

  it("uses PUBLIC_BASE_URL rather than the request host when validating", async () => {
    // Fly's proxy rewrites the host; the signature is computed against the public URL.
    const req = signedRequest("/api/twilio/voice?x=1", { CallSid: "CA1" }, { baseUrl: "https://vlku.test" });
    const internal = new Request("http://10.0.0.5:3000/api/twilio/voice?x=1", {
      method: "POST",
      headers: req.headers,
      body: await req.text(),
    });
    const res = await readWebhook(internal);
    expect(res.ok).toBe(true);
  });

  it("rejects a tampered signature with 403", async () => {
    const res = await readWebhook(signedRequest("/api/twilio/voice", { CallSid: "CA1" }, { tamper: true }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });
});

describe("twiml", () => {
  it("wraps body in a Response with the XML content type", async () => {
    const r = twiml("<Response><Hangup/></Response>");
    expect(r.headers.get("content-type")).toMatch(/text\/xml/);
    expect(await r.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });
});
