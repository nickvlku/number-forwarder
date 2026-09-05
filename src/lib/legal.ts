import { readFileSync } from "node:fs";
import path from "node:path";
import { marked } from "marked";

/** Public legal documents served without a session; Twilio's A2P campaign form links to them. */
export const LEGAL_SLUGS = ["privacy", "terms"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export type LegalDoc = { slug: LegalSlug; title: string; html: string };

const cache = new Map<string, LegalDoc>();

/** Reads content/legal/<slug>.md and renders it. Authored content, so no sanitizing is needed. */
export function loadLegal(slug: string): LegalDoc {
  if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) throw new Error(`unknown legal document: ${slug}`);
  const hit = cache.get(slug);
  if (hit) return hit;
  const markdown = readFileSync(path.join(process.cwd(), "content", "legal", `${slug}.md`), "utf8");
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug;
  const html = marked.parse(markdown, { async: false }) as string;
  const doc = { slug: slug as LegalSlug, title, html };
  cache.set(slug, doc);
  return doc;
}
