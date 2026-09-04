import { getDb } from "@/db/get";
import { getGreetingAudio } from "@/db/repo/greeting";

export const dynamic = "force-dynamic";

/**
 * Public on purpose: Twilio fetches this for <Play> with no credentials. It only ever serves the one
 * greeting the dashboard saved, always as audio/wav, so nothing user-controlled reaches a browser here.
 */
export async function GET(_req: Request): Promise<Response> {
  const g = await getGreetingAudio(await getDb());
  if (!g) return new Response("no greeting recorded", { status: 404 });
  return new Response(new Uint8Array(g.audio), {
    status: 200,
    headers: {
      "content-type": "audio/wav",
      "content-length": String(g.audio.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "last-modified": g.updatedAt.toUTCString(),
    },
  });
}
