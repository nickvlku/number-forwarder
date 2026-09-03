import { computeSignature } from "@/lib/twilio/signature";

export const TEST_ENV = {
  DATABASE_URL: "postgres://unused",
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "test-auth-token",
  TWILIO_NUMBER: "+14158438558",
  CELL_NUMBER: "+14155550100",
  PUBLIC_BASE_URL: "https://vlku.test",
  OPENAI_API_KEY: "sk-test",
  DASHBOARD_PASSWORD: "pw",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

/** Builds a form-encoded POST the way Twilio sends it, with a valid (or deliberately wrong) signature. */
export function signedRequest(
  path: string,
  params: Record<string, string>,
  opts: { authToken?: string; baseUrl?: string; tamper?: boolean } = {},
): Request {
  const base = opts.baseUrl ?? TEST_ENV.PUBLIC_BASE_URL;
  const url = base + path;
  const sig = computeSignature(opts.authToken ?? TEST_ENV.TWILIO_AUTH_TOKEN, url, params);
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": opts.tamper ? "bad" : sig,
    },
    body: new URLSearchParams(params).toString(),
  });
}

/** Common Twilio voice params for a fresh inbound call. */
export function voiceParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    CallSid: "CA0000000000000000000000000000001",
    AccountSid: "ACtest",
    From: "+14155550199",
    To: "+14158438558",
    CallStatus: "ringing",
    Direction: "inbound",
    ...overrides,
  };
}
