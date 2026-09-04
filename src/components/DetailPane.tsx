import Link from "next/link";
import type { FeedItem, FeedFilter } from "@/db/repo/feed";
import { CallDetail } from "./CallDetail";
import { MessageDetail } from "./MessageDetail";

export function DetailPane({ item, filter }: { item: FeedItem | null; filter: FeedFilter }) {
  if (!item) {
    return <div className="flex-1 flex items-center justify-center muted text-sm">Select a call or text.</div>;
  }
  const back = filter === "all" ? "/" : `/?filter=${filter}`;
  return (
    <div className="flex-1 overflow-y-auto p-5 md:p-6">
      <Link href={back} className="md:hidden muted text-sm inline-block mb-3">← Back</Link>
      {item.kind === "call" ? <CallDetail item={item} /> : <MessageDetail item={item} />}
    </div>
  );
}
