import { getDb } from "@/db/get";
import { hasSession } from "@/lib/session";
import { fetchMedia } from "@/lib/twilio/rest";
import { getMessage } from "@/db/repo/messages";

export const dynamic = "force-dynamic";

const INLINE_TYPES = /^(image\/(jpeg|png|gif|webp)|audio\/[\w.+-]+|video\/(mp4|3gpp))$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ sid: string; index: string }> }): Promise<Response> {
  if (!(await hasSession())) return new Response("unauthorized", { status: 401 });
  const { sid, index } = await ctx.params;
  const i = Number.parseInt(index, 10);
  const msg = await getMessage(await getDb(), sid);
  const item = msg?.media[i];
  if (!item) return new Response("not found", { status: 404 });

  const upstream = await fetchMedia(item.url);
  if (!upstream.ok) return new Response("media unavailable", { status: 502 });

  const declared = (upstream.headers.get("content-type") ?? item.contentType).split(";")[0].trim().toLowerCase();
  const safe = INLINE_TYPES.test(declared);
  const headers = new Headers({
    "content-type": safe ? declared : "application/octet-stream",
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
    "cache-control": "private, max-age=86400",
  });
  if (!safe) headers.set("content-disposition", `attachment; filename="attachment-${i}"`);
  return new Response(upstream.body, { status: 200, headers });
}
