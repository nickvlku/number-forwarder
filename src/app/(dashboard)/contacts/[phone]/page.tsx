import { notFound } from "next/navigation";
import { getDb } from "@/db/get";
import { getContact } from "@/db/repo/contacts";
import { historyFor } from "@/db/repo/feed";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { ContactCard } from "@/components/ContactCard";
import { FeedRow } from "@/components/FeedRow";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ phone: string }> }) {
  const phone = normalizePhone(decodeURIComponent((await params).phone));
  if (!phone) notFound();
  const db = await getDb();
  const [contact, history] = await Promise.all([getContact(db, phone), historyFor(db, phone)]);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 max-w-2xl w-full mx-auto flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">{contact?.name?.trim() || formatPhone(phone)}</h1>
        <div className="muted text-sm num">{formatPhone(phone)}</div>
      </div>
      <ContactCard phone={phone} name={contact?.name ?? ""} notes={contact?.notes ?? ""} />
      <section>
        <div className="label mb-2">History</div>
        {history.length === 0 ? (
          <p className="muted text-sm">No calls or texts yet.</p>
        ) : (
          <div className="surface overflow-hidden">
            {history.map((item) => (
              <FeedRow key={item.id} item={item} selected={false} href={`/?item=${item.id}`} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
