import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { getDb } from "@/db/get";
import { getForwardingEnabled } from "@/db/repo/settings";
import { countUnread } from "@/db/repo/feed";
import { Header } from "@/components/Header";
import { Poller } from "@/components/Poller";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const unread = await countUnread(await getDb());
  return { title: unread > 0 ? `(${unread}) THE VLKU` : "THE VLKU" };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const db = await getDb();
  const forwarding = await getForwardingEnabled(db);
  return (
    <div className="h-screen flex flex-col">
      <Header forwarding={forwarding} />
      <main className="flex-1 min-h-0 flex flex-col">{children}</main>
      <Poller intervalMs={30_000} />
    </div>
  );
}
