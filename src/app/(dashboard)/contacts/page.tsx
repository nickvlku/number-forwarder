import Link from "next/link";
import { getDb } from "@/db/get";
import { listContacts } from "@/db/repo/contacts";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const rows = await listContacts(await getDb());
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 max-w-2xl w-full mx-auto flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Contacts</h1>
      {rows.length === 0 ? (
        <p className="muted text-sm">Name a caller from any call or text and they will show up here.</p>
      ) : (
        <div className="surface overflow-hidden">
          {rows.map((c) => (
            <Link key={c.phone} href={`/contacts/${encodeURIComponent(c.phone)}`} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
              <div className="min-w-0">
                <div className="font-semibold truncate">{c.name?.trim() || formatPhone(c.phone)}</div>
                <div className="muted text-xs truncate">{c.name ? formatPhone(c.phone) : ""}{c.notes ? (c.name ? " · " : "") + c.notes : ""}</div>
              </div>
              <span className="muted text-xs">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
