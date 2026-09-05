import { describe, it, expect } from "vitest";
import { forwardCallerId } from "@/lib/twilio/caller-id";

const twilio = "+14158438558";

describe("forwardCallerId", () => {
  it("presents the Twilio number in twilio mode regardless of the caller", () => {
    expect(forwardCallerId({ mode: "twilio", twilioNumber: twilio, from: "+18722739598" })).toBe(twilio);
    expect(forwardCallerId({ mode: "twilio", twilioNumber: twilio, from: "anonymous" })).toBe(twilio);
  });
  it("presents the caller's number in caller mode, falling back to the Twilio number when withheld", () => {
    expect(forwardCallerId({ mode: "caller", twilioNumber: twilio, from: "+18722739598" })).toBe("+18722739598");
    expect(forwardCallerId({ mode: "caller", twilioNumber: twilio, from: "(872) 273-9598" })).toBe("+18722739598");
    expect(forwardCallerId({ mode: "caller", twilioNumber: twilio, from: "anonymous" })).toBe(twilio);
    expect(forwardCallerId({ mode: "caller", twilioNumber: twilio, from: "" })).toBe(twilio);
  });
});
