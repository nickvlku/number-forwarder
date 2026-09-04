import { describe, it, expect } from "vitest";
import { loadEnv } from "@/lib/env";

const good = {
  DATABASE_URL: "postgres://localhost/x",
  TWILIO_ACCOUNT_SID: "ACxxx",
  TWILIO_AUTH_TOKEN: "tok",
  TWILIO_NUMBER: "+14158438558",
  CELL_NUMBER: "+14155550100",
  PUBLIC_BASE_URL: "https://example.fly.dev",
  OPENAI_API_KEY: "sk-x",
  DASHBOARD_PASSWORD: "pw",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("loadEnv", () => {
  it("returns all fields when valid", () => {
    const env = loadEnv({ ...good, NODE_ENV: "production" });
    expect(env.TWILIO_NUMBER).toBe("+14158438558");
    expect(env.isProd).toBe(true);
  });

  it("strips a trailing slash from PUBLIC_BASE_URL", () => {
    const env = loadEnv({ ...good, PUBLIC_BASE_URL: "https://example.fly.dev/" });
    expect(env.PUBLIC_BASE_URL).toBe("https://example.fly.dev");
  });

  it("throws naming the missing variable", () => {
    const { OPENAI_API_KEY: _omit, ...missing } = good;
    expect(() => loadEnv(missing)).toThrow(/OPENAI_API_KEY/);
  });

  it("accepts an optional greeting url and treats an empty value as unset", () => {
    expect(loadEnv(good).VOICEMAIL_GREETING_URL).toBeUndefined();
    expect(loadEnv({ ...good, VOICEMAIL_GREETING_URL: "" }).VOICEMAIL_GREETING_URL).toBeUndefined();
    expect(loadEnv({ ...good, VOICEMAIL_GREETING_URL: "https://example.fly.dev/greeting.mp3" }).VOICEMAIL_GREETING_URL).toBe(
      "https://example.fly.dev/greeting.mp3",
    );
    expect(() => loadEnv({ ...good, VOICEMAIL_GREETING_URL: "greeting.mp3" })).toThrow(/VOICEMAIL_GREETING_URL/);
  });

  it("rejects non-E.164 numbers", () => {
    expect(() => loadEnv({ ...good, CELL_NUMBER: "415-555-0100" })).toThrow(/CELL_NUMBER/);
  });
});
