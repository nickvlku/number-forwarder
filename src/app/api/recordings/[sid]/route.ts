import { getDb } from "@/db/get";
import { hasSession } from "@/lib/session";
import { fetchRecording } from "@/lib/twilio/rest";
import { getVoicemail, markListened } from "@/db/repo/voicemails";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ sid: string }> }): Promise<Response> {
  if (!(await hasSession())) return new Response("unauthorized", { status: 401 });
  const { sid } = await ctx.params;
  const db = await getDb();
  const vm = await getVoicemail(db, sid);
  if (!vm) return new Response("not found", { status: 404 });

  const range = req.headers.get("range") ?? undefined;
  const upstream = await fetchRecording(sid, { range });
  if (!upstream.ok) return new Response("recording unavailable", { status: 502 });
  await markListened(db, sid);

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("content-range", contentRange);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) headers.set("accept-ranges", acceptRanges);
  return new Response(upstream.body, { status: upstream.status, headers });
}
