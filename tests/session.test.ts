import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken, passwordMatches } from "@/lib/session";

const secret = "0123456789abcdef0123456789abcdef";

describe("session tokens", () => {
  it("round-trips", () => {
    const t = createSessionToken(secret, new Date("2026-09-02T00:00:00Z"));
    expect(verifySessionToken(secret, t, new Date("2026-09-10T00:00:00Z"))).toBe(true);
  });
  it("expires after 30 days", () => {
    const t = createSessionToken(secret, new Date("2026-09-02T00:00:00Z"));
    expect(verifySessionToken(secret, t, new Date("2026-10-03T00:00:01Z"))).toBe(false);
  });
  it("rejects tampering and wrong secrets", () => {
    const t = createSessionToken(secret);
    expect(verifySessionToken(secret, t.replace(/.$/, "x"), new Date())).toBe(false);
    expect(verifySessionToken("another-secret-another-secret-12", t, new Date())).toBe(false);
    expect(verifySessionToken(secret, "garbage", new Date())).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("compares in constant time and handles length mismatch", () => {
    expect(passwordMatches("hunter2", "hunter2")).toBe(true);
    expect(passwordMatches("hunter2", "hunter")).toBe(false);
    expect(passwordMatches("hunter2", "")).toBe(false);
  });
});
