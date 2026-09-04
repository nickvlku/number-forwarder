import { describe, it, expect } from "vitest";
import {
  dialTwiml, whisperTwiml, acceptTwiml, hangupTwiml, voicemailTwiml, errorTwiml, emptyTwiml, escapeXml,
} from "@/lib/twilio/twiml";

const baseUrl = "https://vlku.test";

describe("twiml builders", () => {
  it("dials the cell with whisper url, caller id, timeout 20, answerOnBridge", () => {
    const xml = dialTwiml({ callSid: "CA1", callerId: "+14155550199", cellNumber: "+14155550100", baseUrl });
    expect(xml).toBe(
      '<Response><Dial timeout="20" callerId="+14155550199" answerOnBridge="true" action="https://vlku.test/api/twilio/dial-status">' +
        '<Number url="https://vlku.test/api/twilio/whisper?callSid=CA1">+14155550100</Number></Dial></Response>',
    );
  });

  it("whisper gathers one digit and hangs up on timeout", () => {
    const xml = whisperTwiml({ callSid: "CA1", displayName: "Jane Doe", baseUrl });
    expect(xml).toBe(
      '<Response><Gather numDigits="1" timeout="5" action="https://vlku.test/api/twilio/whisper-result?callSid=CA1">' +
        '<Say voice="Polly.Matthew-Neural">Call for THE VLKU from Jane Doe. Press 1 to accept.</Say></Gather><Hangup/></Response>',
    );
  });

  it("escapes names in the whisper", () => {
    const xml = whisperTwiml({ callSid: "CA1", displayName: "Tom & Jerry <LLC>", baseUrl });
    expect(xml).toContain("from Tom &amp; Jerry &lt;LLC&gt;. Press 1");
  });

  it("voicemail greeting records with callbacks", () => {
    expect(voicemailTwiml({ baseUrl })).toBe(
      '<Response><Say voice="Polly.Matthew-Neural">You\'ve reached THE VLKU. Please leave a message after the tone.</Say>' +
        '<Record maxLength="180" finishOnKey="#" playBeep="true" recordingStatusCallback="https://vlku.test/api/twilio/recording" action="https://vlku.test/api/twilio/record-done"/></Response>',
    );
  });

  it("plays a recorded greeting instead of TTS when a url is given, escaping it", () => {
    const xml = voicemailTwiml({ baseUrl, greetingUrl: "https://vlku.test/greeting.mp3?v=1&x=2" });
    expect(xml.startsWith("<Response><Play>https://vlku.test/greeting.mp3?v=1&amp;x=2</Play><Record ")).toBe(true);
    expect(xml).not.toContain("<Say");
  });

  it("small builders", () => {
    expect(acceptTwiml()).toBe("<Response></Response>");
    expect(emptyTwiml()).toBe("<Response></Response>");
    expect(hangupTwiml()).toBe("<Response><Hangup/></Response>");
    expect(errorTwiml()).toBe('<Response><Say voice="Polly.Matthew-Neural">Sorry, something went wrong.</Say><Hangup/></Response>');
    expect(escapeXml(`a"b'c`)).toBe("a&quot;b&apos;c");
  });
});
