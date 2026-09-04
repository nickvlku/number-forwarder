import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext } from "../helpers/handlers";
import { encodeWav } from "@/lib/wav";
import { greeting } from "@/db/schema";
import { getGreetingMeta } from "@/db/repo/greeting";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());
const hasSession = vi.fn(async () => true);
vi.mock("@/lib/session", () => ({ hasSession: () => hasSession() }));

const { db } = await handlerTestContext();
const { PUT, DELETE } = await import("@/app/api/greeting/route");
const { GET } = await import("@/app/api/greeting.wav/route");

const wav = () => encodeWav(new Float32Array(16000 * 2), 16000);
const put = (body: ArrayBuffer | string, type = "audio/wav") =>
  PUT(new Request("http://x/api/greeting", { method: "PUT", headers: { "content-type": type }, body }));

beforeEach(async () => {
  await db.delete(greeting);
  hasSession.mockResolvedValue(true);
});

describe("PUT /api/greeting", () => {
  it("requires a session", async () => {
    hasSession.mockResolvedValue(false);
    expect((await put(wav())).status).toBe(401);
    expect(await getGreetingMeta(db)).toBeNull();
  });

  it("rejects non-wav bodies", async () => {
    const res = await put("<svg onload=alert(1)/>", "image/svg+xml");
    expect(res.status).toBe(400);
    expect(await getGreetingMeta(db)).toBeNull();
  });

  it("rejects an empty or absurdly long recording", async () => {
    expect((await put(encodeWav(new Float32Array(0), 16000))).status).toBe(400);
    expect((await put(encodeWav(new Float32Array(16000 * 121), 16000))).status).toBe(400);
  });

  it("saves and returns the metadata", async () => {
    const res = await put(wav());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ durationSeconds: 2, contentType: "audio/wav" });
    expect((await getGreetingMeta(db))?.durationSeconds).toBe(2);
  });
});

describe("GET /api/greeting.wav", () => {
  it("404s when nothing is recorded", async () => {
    expect((await GET(new Request("http://x/api/greeting.wav"))).status).toBe(404);
  });

  it("serves the audio publicly with fixed audio headers", async () => {
    hasSession.mockResolvedValue(false);
    const body = wav();
    hasSession.mockResolvedValueOnce(true);
    await put(body);
    const res = await GET(new Request("http://x/api/greeting.wav?v=123"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("content-length")).toBe(String(body.byteLength));
    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(body))).toBe(true);
  });
});

describe("DELETE /api/greeting", () => {
  it("requires a session and removes the recording", async () => {
    await put(wav());
    hasSession.mockResolvedValueOnce(false);
    expect((await DELETE()).status).toBe(401);
    expect((await DELETE()).status).toBe(200);
    expect(await getGreetingMeta(db)).toBeNull();
  });
});
