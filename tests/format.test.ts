import { describe, it, expect } from "vitest";
import { formatDuration, formatTime, dayLabel, dialStatusLabel, isRelayPending } from "@/lib/format";

describe("formatDuration", () => {
  it("m:ss under an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(728)).toBe("12:08");
  });
  it("h:mm:ss past an hour", () => expect(formatDuration(3725)).toBe("1:02:05"));
  it("dash for missing", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
  });
});

describe("formatTime and dayLabel", () => {
  const now = new Date("2026-09-02T20:00:00-07:00");
  it("time of day for today", () => {
    const d = new Date("2026-09-02T14:14:00-07:00");
    expect(formatTime(d, now)).toBe("2:14 PM");
    expect(dayLabel(d, now)).toBe("Today");
  });
  it("Yesterday label", () => {
    const d = new Date("2026-09-01T18:30:00-07:00");
    expect(dayLabel(d, now)).toBe("Yesterday");
  });
  it("weekday-month-day for older", () => {
    const d = new Date("2026-08-20T09:00:00-07:00");
    expect(dayLabel(d, now)).toBe("Thu, Aug 20");
  });
  it("Yesterday survives the DST spring-forward day", () => {
    const dstNow = new Date("2027-03-15T00:30:00-07:00");
    const d = new Date("2027-03-14T12:00:00-07:00");
    expect(dayLabel(d, dstNow)).toBe("Yesterday");
  });
});

describe("dialStatusLabel", () => {
  it("maps no-answer to a plain no answer label", () => {
    expect(dialStatusLabel("no-answer")).toBe("no answer");
  });
  it("maps completed (declined at whisper) to a distinct label", () => {
    expect(dialStatusLabel("completed")).toBe("declined at whisper");
  });
  it("falls back to no answer for null/unknown", () => {
    expect(dialStatusLabel(null)).toBe("no answer");
    expect(dialStatusLabel("something-weird")).toBe("no answer");
  });
});

describe("isRelayPending", () => {
  const now = new Date("2026-09-02T20:00:00-07:00");
  it("pending when unforwarded and fresh", () => {
    const receivedAt = new Date(now.getTime() - 30_000);
    expect(isRelayPending({ forwardedAt: null, receivedAt }, now)).toBe(true);
  });
  it("not pending once past the grace window", () => {
    const receivedAt = new Date(now.getTime() - 3 * 60_000);
    expect(isRelayPending({ forwardedAt: null, receivedAt }, now)).toBe(false);
  });
  it("not pending once forwarded", () => {
    const receivedAt = new Date(now.getTime() - 5_000);
    expect(isRelayPending({ forwardedAt: now, receivedAt }, now)).toBe(false);
  });
});
