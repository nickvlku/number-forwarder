import { getEnv } from "@/lib/env";

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const env = getEnv();
  const form = new FormData();
  form.append("file", new File([audio], filename, { type: audio.type || "audio/mpeg" }));
  form.append("model", "whisper-1");
  form.append("response_format", "json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Whisper ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}
