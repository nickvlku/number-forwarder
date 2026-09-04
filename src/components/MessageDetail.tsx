import type { FeedItem } from "@/db/repo/feed";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/format";
import { ContactCard } from "./ContactCard";
import { TypePill } from "./TypePill";
import { displayName } from "./FeedRow";

export function MessageDetail({ item }: { item: Extract<FeedItem, { kind: "text" }> }) {
  const { message } = item;
  const phone = normalizePhone(message.fromNumber);
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{displayName(item)}</h1>
          <TypePill item={item} />
        </div>
        <div className="muted text-sm mt-0.5 num">{phone ? formatPhone(phone) : message.fromNumber} · {formatDateTime(message.receivedAt)}</div>
      </div>
      {message.body && <div className="quote">{message.body}</div>}
      {message.media.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {message.media.map((m, i) =>
            m.contentType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={`/api/media/${message.sid}/${i}`} alt={`Attachment ${i + 1}`} className="max-w-xs rounded-lg border" style={{ borderColor: "var(--line)" }} />
            ) : (
              <a key={i} href={`/api/media/${message.sid}/${i}`} className="btn">Attachment {i + 1} ({m.contentType})</a>
            ),
          )}
        </div>
      )}
      {message.forwardedAt ? <p className="muted text-xs">Relayed to your cell.</p> : <p className="text-xs text-danger">Relay to your cell failed.</p>}
      {phone && <ContactCard phone={phone} name={item.contact?.name ?? ""} notes={item.contact?.notes ?? ""} />}
    </div>
  );
}
