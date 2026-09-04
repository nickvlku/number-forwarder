import type { FeedItem } from "@/db/repo/feed";
import { effectiveStatus } from "@/db/repo/feed";

export type PillTone = "answered" | "voicemail" | "missed" | "text" | "pending";

export function pillFor(item: FeedItem): { label: string; tone: PillTone } {
  if (item.kind === "text") return { label: "Text", tone: "text" };
  switch (effectiveStatus(item.call, new Date(), { hasVoicemail: item.voicemail !== null })) {
    case "completed": return { label: "Answered", tone: "answered" };
    case "voicemail": return { label: "Voicemail", tone: "voicemail" };
    case "voicemail_pending": return { label: "Recording", tone: "pending" };
    case "ringing": return { label: "Ringing", tone: "pending" };
    case "failed": return { label: "Failed", tone: "missed" };
    default: return { label: "Missed", tone: "missed" };
  }
}

export function TypePill({ item }: { item: FeedItem }) {
  const { label, tone } = pillFor(item);
  return <span className={`pill pill-${tone}`}>{label}</span>;
}
