import { getEnv } from "@/lib/env";

const API = "https://api.twilio.com/2010-04-01";

function authHeader(): string {
  const env = getEnv();
  return "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
}

function accountUrl(path: string): string {
  return `${API}/Accounts/${getEnv().TWILIO_ACCOUNT_SID}${path}`;
}

async function twilioFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: authHeader() },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  return res;
}

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  const res = await twilioFetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio ${res.status} for ${url}: ${text}`);
  }
  return res;
}

export async function sendSms(o: { to: string; body: string }): Promise<{ sid: string }> {
  const env = getEnv();
  const res = await postForm(accountUrl("/Messages.json"), { To: o.to, From: env.TWILIO_NUMBER, Body: o.body });
  const json = (await res.json()) as { sid: string };
  return { sid: json.sid };
}

/** Streams the recording as MP3. Caller checks res.ok. */
export async function fetchRecording(recordingSid: string): Promise<Response> {
  return twilioFetch(accountUrl(`/Recordings/${encodeURIComponent(recordingSid)}.mp3`));
}

export async function deleteRecording(recordingSid: string): Promise<void> {
  const res = await twilioFetch(accountUrl(`/Recordings/${encodeURIComponent(recordingSid)}.json`), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Twilio ${res.status} deleting ${recordingSid}`);
}

/** MMS media URLs from Twilio require account auth; redirects to the CDN are followed by fetch. */
export async function fetchMedia(url: string): Promise<Response> {
  return twilioFetch(url);
}

export async function updateNumberWebhooks(o: {
  phoneNumber: string;
  voiceUrl: string;
  smsUrl: string;
  statusCallback: string;
}): Promise<void> {
  const lookup = await twilioFetch(accountUrl(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(o.phoneNumber)}`));
  if (!lookup.ok) throw new Error(`Twilio ${lookup.status} looking up ${o.phoneNumber}`);
  const json = (await lookup.json()) as { incoming_phone_numbers: { sid: string }[] };
  const pn = json.incoming_phone_numbers[0];
  if (!pn) throw new Error(`Number ${o.phoneNumber} not found in account`);
  await postForm(accountUrl(`/IncomingPhoneNumbers/${pn.sid}.json`), {
    VoiceUrl: o.voiceUrl,
    VoiceMethod: "POST",
    SmsUrl: o.smsUrl,
    SmsMethod: "POST",
    StatusCallback: o.statusCallback,
    StatusCallbackMethod: "POST",
  });
}
