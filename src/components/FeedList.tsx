import Link from "next/link";
import type { FeedItem, FeedFilter } from "@/db/repo/feed";
import { dayLabel } from "@/lib/format";
import { FeedRow } from "./FeedRow";

export function FeedList({ items, selectedId, filter, nextBefore }: { items: FeedItem[]; selectedId: string | null; filter: FeedFilter; nextBefore: Date | null }) {
  if (items.length === 0) {
    return <p className="muted text-sm p-6 text-center">Nothing here yet.</p>;
  }
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  const filterQs = filter === "all" ? "" : `&filter=${filter}`;
  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="day">{g.label}</div>
          {g.items.map((item) => (
            <FeedRow key={item.id} item={item} selected={item.id === selectedId} href={`/?item=${item.id}${filterQs}`} />
          ))}
        </div>
      ))}
      {nextBefore && (
        <div className="p-4 text-center">
          <Link href={`/?before=${nextBefore.toISOString()}${filterQs}`} className="btn">Load more</Link>
        </div>
      )}
    </div>
  );
}
