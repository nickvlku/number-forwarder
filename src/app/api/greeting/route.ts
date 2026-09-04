import { getDb } from "@/db/get";
import { hasSession } from "@/lib/session";
import { isWav, wavDurationSeconds } from "@/lib/wav";
import { saveGreeting, deleteGreeting } from "@/db/repo/greeting";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8_000_000;
const MIN_SECONDS = 1;
const MAX_SECONDS = 120;

/** Save a new greeting. Body is a 16-bit PCM WAV produced by the dashboard recorder. */
export async function PUT(req: Request): Promise<Response> {
  if (!(await hasSession())) return new Response("unauthorized", { status: 401 });
  const declared = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!/^audio\/(wav|x-wav|wave)$/.test(declared)) return new Response("expected audio/wav", { status: 400 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return new Response("recording too large", { status: 413 });
  if (!isWav(buf)) return new Response("not a WAV file", { status: 400 });
  const seconds = wavDurationSeconds(buf);
  if (seconds === null || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    return new Response(`recording must be between ${MIN_SECONDS} and ${MAX_SECONDS} seconds`, { status: 400 });
  }
  const meta = await saveGreeting(await getDb(), {
    audio: Buffer.from(buf),
    contentType: "audio/wav",
    durationSeconds: Math.round(seconds),
  });
  return Response.json(meta);
}

export async function DELETE(): Promise<Response> {
  if (!(await hasSession())) return new Response("unauthorized", { status: 401 });
  await deleteGreeting(await getDb());
  return Response.json({ ok: true });
}
