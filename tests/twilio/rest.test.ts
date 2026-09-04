import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { TEST_ENV } from "../helpers/twilio";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});

let rest: typeof import("@/lib/twilio/rest");
const fetchMock = vi.fn();
beforeAll(async () => {
  vi.stubGlobal("fetch", fetchMock);
  rest = await import("@/lib/twilio/rest");
});
beforeEach(() => fetchMock.mockReset());

const expectedAuth = "Basic " + Buffer.from("ACtest:test-auth-token").toString("base64");

describe("sendSms", () => {
  it("posts form data with basic auth and returns the sid", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    const r = await rest.sendSms({ to: "+14155550100", body: "hi" });
    expect(r.sid).toBe("SM1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(expectedAuth);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("To")).toBe("+14155550100");
    expect(body.get("From")).toBe("+14158438558");
    expect(body.get("Body")).toBe("hi");
  });

  it("throws with the Twilio error body on failure", async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"bad"}', { status: 400 }));
    await expect(rest.sendSms({ to: "+1", body: "x" })).rejects.toThrow(/400.*bad/);
  });
});

describe("recordings", () => {
  it("fetches the mp3 with auth", async () => {
    fetchMock.mockResolvedValue(new Response("audio", { status: 200 }));
    await rest.fetchRecording("RE1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/RE1.mp3");
    expect(init.headers.authorization).toBe(expectedAuth);
  });

  it("forwards a Range header when given", async () => {
    fetchMock.mockResolvedValue(new Response("part", { status: 206 }));
    await rest.fetchRecording("RE1", { range: "bytes=0-99" });
    expect(fetchMock.mock.calls[0][1].headers.range).toBe("bytes=0-99");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(expectedAuth);
  });

  it("deletes a recording and tolerates 404", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(rest.deleteRecording("RE1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("updateNumberWebhooks", () => {
  it("looks up the number then posts the new urls", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ incoming_phone_numbers: [{ sid: "PN1" }] })))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await rest.updateNumberWebhooks({
      phoneNumber: "+14158438558",
      voiceUrl: "https://vlku.test/api/twilio/voice",
      smsUrl: "https://vlku.test/api/twilio/sms",
      statusCallback: "https://vlku.test/api/twilio/status",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACtest/IncomingPhoneNumbers.json?PhoneNumber=%2B14158438558",
    );
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/IncomingPhoneNumbers/PN1.json");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("VoiceUrl")).toBe("https://vlku.test/api/twilio/voice");
    expect(body.get("VoiceMethod")).toBe("POST");
    expect(body.get("SmsUrl")).toBe("https://vlku.test/api/twilio/sms");
    expect(body.get("StatusCallback")).toBe("https://vlku.test/api/twilio/status");
  });
});

describe("fetchMedia", () => {
  it("follows Twilio's redirect to the CDN without the auth header", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://media.twiliocdn.com/x?sig=1" } }))
      .mockResolvedValueOnce(new Response("jpg", { status: 200 }));
    const res = await rest.fetchMedia("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/SM1/Media/ME1");
    expect(await res.text()).toBe("jpg");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(expectedAuth);
    const [url2, init2] = fetchMock.mock.calls[1];
    expect(url2).toBe("https://media.twiliocdn.com/x?sig=1");
    expect(init2?.headers?.authorization).toBeUndefined();
  });

  it("returns the direct response when there is no redirect", async () => {
    fetchMock.mockResolvedValueOnce(new Response("jpg", { status: 200 }));
    const res = await rest.fetchMedia("https://api.twilio.com/m/ME1");
    expect(await res.text()).toBe("jpg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("error surfacing", () => {
  it("deleteRecording includes status and body on non-404 failure", async () => {
    fetchMock.mockResolvedValue(new Response("server exploded", { status: 500 }));
    await expect(rest.deleteRecording("RE1")).rejects.toThrow(/500.*server exploded/);
  });

  it("updateNumberWebhooks includes status and body when the lookup fails", async () => {
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));
    await expect(
      rest.updateNumberWebhooks({ phoneNumber: "+14158438558", voiceUrl: "v", smsUrl: "s", statusCallback: "c" }),
    ).rejects.toThrow(/403.*forbidden/);
  });

  it("updateNumberWebhooks throws a clear error when the number is not in the account", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ incoming_phone_numbers: [] }), { status: 200 }));
    await expect(
      rest.updateNumberWebhooks({ phoneNumber: "+14158438558", voiceUrl: "v", smsUrl: "s", statusCallback: "c" }),
    ).rejects.toThrow(/not found in account/);
  });
});
