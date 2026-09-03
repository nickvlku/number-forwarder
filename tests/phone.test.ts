import { describe, it, expect } from "vitest";
import { normalizePhone, formatPhone, spokenDigits } from "@/lib/phone";

describe("normalizePhone", () => {
  it("keeps valid E.164", () => expect(normalizePhone("+14155550199")).toBe("+14155550199"));
  it("adds +1 to ten US digits", () => expect(normalizePhone("(415) 555-0199")).toBe("+14155550199"));
  it("adds + to eleven digits starting with 1", () => expect(normalizePhone("1 415 555 0199")).toBe("+14155550199"));
  it("returns null for withheld or junk", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("anonymous")).toBeNull();
    expect(normalizePhone("+266696687")).toBe("+266696687"); // non-NANP kept as is
  });
});

describe("formatPhone", () => {
  it("formats NANP", () => expect(formatPhone("+14155550199")).toBe("+1 (415) 555-0199"));
  it("passes through others", () => expect(formatPhone("+442071234567")).toBe("+44 2071234567"));
});

describe("spokenDigits", () => {
  it("reads NANP digits in groups with pauses", () => {
    expect(spokenDigits("+14155550199")).toBe("4 1 5, 5 5 5, 0 1 9 9");
  });
  it("reads other numbers digit by digit", () => {
    expect(spokenDigits("+442071234567")).toBe("4 4 2 0 7 1 2 3 4 5 6 7");
  });
});
