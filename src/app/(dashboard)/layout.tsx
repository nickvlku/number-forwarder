import { requireSession } from "@/lib/session";
import { getDb } from "@/db/get";
import { getForwardingEnabled } from "@/db/repo/settings";
import { countUnread } from "@/db/repo/feed";
import { Header } from "@/components/Header";
import { Poller } from "@/components/Poller";
import { UnreadTitle } from "@/components/UnreadTitle";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const db = await getDb();
  const [forwarding, unread] = await Promise.all([getForwardingEnabled(db), countUnread(db)]);
  return (
    <div className="min-h-screen flex flex-col">
      <Header forwarding={forwarding} />
      <main className="flex-1 flex flex-col">{children}</main>
      <Poller intervalMs={30_000} />
      <UnreadTitle count={unread} />
    </div>
  );
}
