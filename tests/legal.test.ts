import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadLegal, LEGAL_SLUGS } from "@/lib/legal";

const md = (slug: string) => readFileSync(`content/legal/${slug}.md`, "utf8");

describe("legal documents", () => {
  it("exposes exactly the two Twilio A2P documents", () => {
    expect(LEGAL_SLUGS).toEqual(["privacy", "terms"]);
  });

  it("renders each markdown file to html with a title", () => {
    for (const slug of LEGAL_SLUGS) {
      const doc = loadLegal(slug);
      expect(doc.title.length).toBeGreaterThan(5);
      expect(doc.html).toMatch(/^<h1[\s>]/);
      expect(doc.html).toContain("<p>");
    }
    expect(() => loadLegal("nope")).toThrow(/unknown legal document/);
  });

  it("privacy policy carries the mobile-data non-sharing statement Twilio requires", () => {
    const text = md("privacy");
    expect(text).toMatch(/No mobile information will be shared with third parties\/affiliates for marketing\/promotional purposes/);
    expect(text).toMatch(/text messaging originator opt-in data and consent/i);
    expect(text).toMatch(/will not be shared with any third parties/i);
    expect(text).toMatch(/Effective/);
  });

  it("terms carry program description, frequency, rates, STOP, HELP, carrier disclaimer, and a privacy link", () => {
    const text = md("terms");
    expect(text).toMatch(/Message frequency/i);
    expect(text).toMatch(/Message and data rates may apply/);
    expect(text).toMatch(/\bSTOP\b/);
    expect(text).toMatch(/\bHELP\b/);
    expect(text).toMatch(/Carriers are not liable for delayed or undelivered messages/);
    expect(text).toMatch(/\/privacy\b/);
  });
});
