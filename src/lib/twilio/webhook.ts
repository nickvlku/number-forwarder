import { getEnv } from "@/lib/env";
import { verifySignature } from "./signature";

export type WebhookResult =
  | { ok: true; params: Record<string, string>; url: string }
  | { ok: false; response: Response };

export function forbidden(): Response {
  return new Response("invalid signature", { status: 403 });
}

/** Parses the form body and validates the signature against the public URL. */
export async function readWebhook(req: Request): Promise<WebhookResult> {
  const env = getEnv();
  const incoming = new URL(req.url);
  const url = env.PUBLIC_BASE_URL + incoming.pathname + incoming.search;
  const text = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) params[k] = v;
  const header = req.headers.get("x-twilio-signature");
  if (!verifySignature(env.TWILIO_AUTH_TOKEN, url, params, header)) {
    console.warn("twilio signature mismatch", { path: incoming.pathname });
    return { ok: false, response: forbidden() };
  }
  return { ok: true, params, url };
}

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}
