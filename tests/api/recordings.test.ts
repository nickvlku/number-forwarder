import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext } from "../helpers/handlers";
import { createCall } from "@/db/repo/calls";
import { claimVoicemail, getVoicemail } from "@/db/repo/voicemails";
import { insertMessage } from "@/db/repo/messages";
import { calls, voicemails, messages } from "@/db/schema";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());
const hasSession = vi.fn(async () => true);
vi.mock("@/lib/session", () => ({ hasSession: () => hasSession() }));
const fetchRecording = vi.fn<(s: string, o?: { range?: string }) => Promise<Response>>();
const fetchMedia = vi.fn();
vi.mock("@/lib/twilio/rest", () => ({
  fetchRecording: (s: string, o?: { range?: string }) => fetchRecording(s, o),
  fetchMedia: (u: string) => fetchMedia(u),
}));

const { db } = await handlerTestContext();
const { GET: getRecording } = await import("@/app/api/recordings/[sid]/route");
const { GET: getMedia } = await import("@/app/api/media/[sid]/[index]/route");

beforeEach(async () => {
  await db.delete(voicemails);
  await db.delete(calls);
  await db.delete(messages);
  await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
  await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 });
  await insertMessage(db, { sid: "SM1", from: "+14155550199", body: "", media: [{ url: "https://api.twilio.com/m/ME1", contentType: "image/jpeg" }] });
  hasSession.mockResolvedValue(true);
  fetchRecording.mockReset();
  fetchMedia.mockReset();
});

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe("GET /api/recordings/[sid]", () => {
  it("requires a session", async () => {
    hasSession.mockResolvedValue(false);
    const res = await getRecording(new Request("http://x/api/recordings/RE1"), params({ sid: "RE1" }));
    expect(res.status).toBe(401);
  });

  it("streams the mp3 and marks listened", async () => {
    fetchRecording.mockResolvedValue(new Response("mp3", { status: 200, headers: { "content-type": "audio/mpeg", "content-length": "3" } }));
    const res = await getRecording(new Request("http://x/api/recordings/RE1"), params({ sid: "RE1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(await res.text()).toBe("mp3");
    expect((await getVoicemail(db, "RE1"))?.listenedAt).toBeInstanceOf(Date);
  });

  it("404s for unknown recording without calling Twilio", async () => {
    const res = await getRecording(new Request("http://x/api/recordings/REnope"), params({ sid: "REnope" }));
    expect(res.status).toBe(404);
    expect(fetchRecording).not.toHaveBeenCalled();
  });

  it("passes a range request through as 206 with content-range", async () => {
    fetchRecording.mockResolvedValue(
      new Response("part", { status: 206, headers: { "content-type": "audio/mpeg", "content-range": "bytes 0-3/100", "accept-ranges": "bytes" } }),
    );
    const res = await getRecording(new Request("http://x/api/recordings/RE1", { headers: { range: "bytes=0-3" } }), params({ sid: "RE1" }));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-3/100");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(fetchRecording).toHaveBeenCalledWith("RE1", { range: "bytes=0-3" });
  });
});

describe("GET /api/media/[sid]/[index]", () => {
  it("proxies the stored media url", async () => {
    fetchMedia.mockResolvedValue(new Response("jpg", { status: 200, headers: { "content-type": "image/jpeg" } }));
    const res = await getMedia(new Request("http://x/api/media/SM1/0"), params({ sid: "SM1", index: "0" }));
    expect(res.status).toBe(200);
    expect(fetchMedia).toHaveBeenCalledWith("https://api.twilio.com/m/ME1");
  });
  it("404s for an out-of-range index", async () => {
    const res = await getMedia(new Request("http://x/api/media/SM1/5"), params({ sid: "SM1", index: "5" }));
    expect(res.status).toBe(404);
  });

  it("serves safe image types inline with nosniff and a sandbox CSP", async () => {
    fetchMedia.mockResolvedValue(new Response("jpg", { status: 200, headers: { "content-type": "image/jpeg" } }));
    const res = await getMedia(new Request("http://x/api/media/SM1/0"), params({ sid: "SM1", index: "0" }));
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  it("forces download for unsafe types like svg or html", async () => {
    fetchMedia.mockResolvedValue(new Response("<svg onload=alert(1)/>", { status: 200, headers: { "content-type": "image/svg+xml" } }));
    const res = await getMedia(new Request("http://x/api/media/SM1/0"), params({ sid: "SM1", index: "0" }));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
  });
});
