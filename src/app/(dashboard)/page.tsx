import { getDb } from "@/db/get";
import { listFeed, getFeedItem, FEED_FILTERS, type FeedFilter } from "@/db/repo/feed";
import { markRead } from "@/db/repo/messages";
import { FilterChips } from "@/components/FilterChips";
import { FeedList } from "@/components/FeedList";
import { DetailPane } from "@/components/DetailPane";

export const dynamic = "force-dynamic";
const PAGE = 50;

type Search = { filter?: string; item?: string; before?: string };

export default async function FeedPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filter = (FEED_FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as FeedFilter) : "all";
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined;
  const db = await getDb();
  const [{ items, nextBefore }, selected] = await Promise.all([
    listFeed(db, { filter, before, limit: PAGE }),
    sp.item ? getFeedItem(db, sp.item) : Promise.resolve(null),
  ]);
  if (selected?.kind === "text" && selected.unread) await markRead(db, selected.id);

  const showListOnMobile = !selected;
  return (
    <div className="flex-1 grid md:grid-cols-[minmax(320px,2fr)_3fr]" style={{ minHeight: 0 }}>
      <section className={`${showListOnMobile ? "flex" : "hidden md:flex"} flex-col border-r`} style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <FilterChips active={filter} />
        <FeedList items={items} selectedId={selected?.id ?? null} filter={filter} nextBefore={nextBefore} />
      </section>
      <section className={`${selected ? "flex" : "hidden md:flex"} flex-col`}>
        <DetailPane item={selected} filter={filter} />
      </section>
    </div>
  );
}
