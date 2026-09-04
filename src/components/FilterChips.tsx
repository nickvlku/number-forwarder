import Link from "next/link";
import { FEED_FILTERS, type FeedFilter } from "@/db/repo/feed";

const LABELS: Record<FeedFilter, string> = { all: "All", voicemail: "Voicemail", missed: "Missed", text: "Texts", answered: "Answered" };

export function FilterChips({ active }: { active: FeedFilter }) {
  return (
    <div className="flex gap-2 px-4 py-3 border-b overflow-x-auto" style={{ borderColor: "var(--line)" }}>
      {FEED_FILTERS.map((f) => (
        <Link key={f} href={f === "all" ? "/" : `/?filter=${f}`} className={`chip ${f === active ? "chip-on" : ""}`}>
          {LABELS[f]}
        </Link>
      ))}
    </div>
  );
}
