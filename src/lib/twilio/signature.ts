import { createHmac, timingSafeEqual } from "node:crypto";

/** Twilio: URL + each POST param key+value sorted by key, HMAC-SHA1 with the auth token, base64. */
export function computeSignature(authToken: string, url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  const data = url + keys.map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifySignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | null | undefined,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(computeSignature(authToken, url, params));
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
