import type { FeedItem } from "@/db/repo/feed";
import { effectiveStatus } from "@/db/repo/feed";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { formatDateTime, formatTime, formatDuration } from "@/lib/format";
import { retryTranscription } from "@/app/(dashboard)/actions";
import { ContactCard } from "./ContactCard";
import { TypePill } from "./TypePill";
import { displayName } from "./FeedRow";

export function CallDetail({ item }: { item: Extract<FeedItem, { kind: "call" }> }) {
  const { call, voicemail } = item;
  const phone = normalizePhone(call.fromNumber);
  const status = effectiveStatus(call);
  const answeredAt = call.accepted && call.talkSeconds != null && call.endedAt
    ? new Date(call.endedAt.getTime() - call.talkSeconds * 1000)
    : null;

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{displayName(item)}</h1>
          <TypePill item={item} />
        </div>
        <div className="muted text-sm mt-0.5 num">{phone ? formatPhone(phone) : "Unknown number"} · {formatDateTime(call.startedAt)}</div>
      </div>

      <section>
        <div className="label mb-2">Timeline</div>
        <div className="timeline text-sm">
          <div><span className="num font-semibold">{formatTime(call.startedAt)}</span> Incoming call</div>
          {answeredAt && <div><span className="num font-semibold">{formatTime(answeredAt)}</span> Accepted, talked {formatDuration(call.talkSeconds)}</div>}
          {!call.accepted && status !== "ringing" && <div className="muted">No answer{call.dialStatus ? ` (${call.dialStatus})` : ""}</div>}
          {voicemail && <div>Voicemail {formatDuration(voicemail.durationSeconds)}</div>}
          {call.endedAt && <div><span className="num font-semibold">{formatTime(call.endedAt)}</span> Ended · total {formatDuration(call.totalSeconds)}</div>}
        </div>
      </section>

      {voicemail && (
        <section className="surface p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="label">Voicemail · {formatDuration(voicemail.durationSeconds)}</div>
            {voicemail.transcriptionStatus === "failed" && (
              <form action={retryTranscription.bind(null, voicemail.recordingSid)}>
                <button className="btn" type="submit">Retry transcription</button>
              </form>
            )}
          </div>
          <audio controls preload="none" src={`/api/recordings/${voicemail.recordingSid}`} className="w-full" />
          {voicemail.transcript ? (
            <div className="quote">{voicemail.transcript}</div>
          ) : voicemail.transcriptionStatus === "failed" ? (
            <p className="text-sm text-danger">Transcription failed{voicemail.transcriptionError ? `: ${voicemail.transcriptionError}` : ""}.</p>
          ) : (
            <p className="muted text-sm">Transcribing…</p>
          )}
        </section>
      )}

      {phone && <ContactCard phone={phone} name={item.contact?.name ?? ""} notes={item.contact?.notes ?? ""} />}
    </div>
  );
}
