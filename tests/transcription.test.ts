import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { TEST_ENV } from "./helpers/twilio";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});

const fetchMock = vi.fn();
let transcribe: typeof import("@/lib/transcription").transcribe;
beforeAll(async () => {
  vi.stubGlobal("fetch", fetchMock);
  ({ transcribe } = await import("@/lib/transcription"));
});
beforeEach(() => fetchMock.mockReset());

describe("transcribe", () => {
  it("posts multipart audio to Whisper and returns trimmed text", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: "  hello there " }), { status: 200 }));
    const text = await transcribe(new Blob(["abc"], { type: "audio/mpeg" }), "RE1.mp3");
    expect(text).toBe("hello there");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.headers.authorization).toBe("Bearer sk-test");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect((form.get("file") as File).name).toBe("RE1.mp3");
  });

  it("throws with status and body on failure", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(transcribe(new Blob(["abc"]), "x.mp3")).rejects.toThrow(/429.*rate limited/);
  });
});
