import Link from "next/link";
import type { FeedItem } from "@/db/repo/feed";
import { effectiveStatus } from "@/db/repo/feed";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { formatTime, formatDuration } from "@/lib/format";
import { TypePill } from "./TypePill";

export function displayName(item: FeedItem): string {
  const raw = item.kind === "call" ? item.call.fromNumber : item.message.fromNumber;
  const phone = normalizePhone(raw);
  return item.contact?.name?.trim() || (phone ? formatPhone(phone) : "Unknown number");
}

export function preview(item: FeedItem): string {
  if (item.kind === "text") {
    return item.message.body.trim() || `${item.message.media.length} attachment${item.message.media.length === 1 ? "" : "s"}`;
  }
  const status = effectiveStatus(item.call);
  if (item.voicemail?.transcript) return item.voicemail.transcript;
  if (item.voicemail?.transcriptionStatus === "failed") return "Transcription failed";
  if (item.voicemail) return "Transcribing…";
  if (status === "completed") return item.call.accepted ? "Accepted after whisper" : "Answered";
  if (status === "missed") return "No message left";
  if (status === "failed") return "Call failed";
  return "In progress";
}

export function durationLabel(item: FeedItem): string {
  if (item.kind === "text") return "";
  if (item.voicemail) return `${formatDuration(item.voicemail.durationSeconds)} msg`;
  if (item.call.talkSeconds != null) return `${formatDuration(item.call.talkSeconds)} call`;
  return "";
}

export function FeedRow({ item, selected, href }: { item: FeedItem; selected: boolean; href: string }) {
  return (
    <Link href={href} className={`row ${selected ? "row-selected" : ""}`} aria-current={selected ? "true" : undefined}>
      <span className={`dot ${item.unread ? "dot-unread" : ""}`} aria-label={item.unread ? "unread" : undefined} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">{displayName(item)}</span>
          <TypePill item={item} />
        </div>
        <div className="muted text-xs truncate mt-0.5">{preview(item)}</div>
      </div>
      <div className="text-right text-xs num">
        <div className="font-semibold">{formatTime(item.at)}</div>
        <div className="muted">{durationLabel(item) || "—"}</div>
      </div>
    </Link>
  );
}
