import { describe, it, expect } from "vitest";
import { computeSignature, verifySignature } from "@/lib/twilio/signature";

// Values from Twilio's documented example.
const token = "12345";
const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
const params = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+12349013030",
  Digits: "1234",
  From: "+12349013030",
  To: "+18005551212",
};

describe("twilio signature", () => {
  it("matches Twilio's documented example", () => {
    expect(computeSignature(token, url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });
  it("verifies a correct header and rejects a wrong one", () => {
    expect(verifySignature(token, url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(true);
    expect(verifySignature(token, url, params, "nope")).toBe(false);
    expect(verifySignature(token, url, params, null)).toBe(false);
  });
});
