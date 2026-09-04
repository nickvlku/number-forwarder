/** A recording shorter than this is dead air (hang up during the beep, etc.), not a message. */
export const MIN_MESSAGE_SECONDS = 2;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const wrap = (inner: string) => `<Response>${inner}</Response>`;

export function dialTwiml(o: { callSid: string; callerId: string; cellNumber: string; baseUrl: string }): string {
  const whisper = `${o.baseUrl}/api/twilio/whisper?callSid=${encodeURIComponent(o.callSid)}`;
  const action = `${o.baseUrl}/api/twilio/dial-status`;
  return wrap(
    `<Dial timeout="20" callerId="${escapeXml(o.callerId)}" answerOnBridge="true" action="${escapeXml(action)}">` +
      `<Number url="${escapeXml(whisper)}">${escapeXml(o.cellNumber)}</Number></Dial>`,
  );
}

export function whisperTwiml(o: { callSid: string; displayName: string; baseUrl: string }): string {
  const action = `${o.baseUrl}/api/twilio/whisper-result?callSid=${encodeURIComponent(o.callSid)}`;
  return wrap(
    `<Gather numDigits="1" timeout="5" action="${escapeXml(action)}">` +
      `<Say>Call for THE VLKU from ${escapeXml(o.displayName)}. Press 1 to accept.</Say></Gather><Hangup/>`,
  );
}

export function acceptTwiml(): string {
  return wrap("");
}

export function emptyTwiml(): string {
  return wrap("");
}

export function hangupTwiml(): string {
  return wrap("<Hangup/>");
}

export function voicemailTwiml(o: { baseUrl: string }): string {
  return wrap(
    "<Say>You've reached THE VLKU. Please leave a message after the tone.</Say>" +
      `<Record maxLength="180" finishOnKey="#" playBeep="true" ` +
      `recordingStatusCallback="${escapeXml(`${o.baseUrl}/api/twilio/recording`)}" ` +
      `action="${escapeXml(`${o.baseUrl}/api/twilio/record-done`)}"/>`,
  );
}

export function errorTwiml(): string {
  return wrap("<Say>Sorry, something went wrong.</Say><Hangup/>");
}
