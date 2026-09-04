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

  const upstream = await fetchRecording(sid);
  if (!upstream.ok) return new Response("recording unavailable", { status: 502 });
  await markListened(db, sid);

  const headers = new Headers({ "content-type": upstream.headers.get("content-type") ?? "audio/mpeg", "cache-control": "private, max-age=3600" });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  const range = req.headers.get("range");
  if (range) headers.set("accept-ranges", "bytes");
  return new Response(upstream.body, { status: 200, headers });
}
