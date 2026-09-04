import { getDb } from "@/db/get";
import { getGreetingMeta } from "@/db/repo/greeting";
import { VOICEMAIL_GREETING_TEXT } from "@/lib/twilio/twiml";
import { formatDuration, formatDateTime } from "@/lib/format";
import { GreetingRecorder } from "@/components/GreetingRecorder";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const meta = await getGreetingMeta(await getDb());
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 max-w-2xl w-full mx-auto flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="surface p-4 flex flex-col gap-3">
        <div className="label">Voicemail greeting</div>
        {meta ? (
          <div className="flex flex-col gap-2">
            <audio controls preload="none" src={`/api/greeting.wav?v=${meta.updatedAt.getTime()}`} className="w-full" />
            <div className="muted text-xs num">
              Your recording · {formatDuration(meta.durationSeconds)} · saved {formatDateTime(meta.updatedAt)}
            </div>
          </div>
        ) : (
          <p className="text-sm">
            No recording yet. Callers hear text-to-speech: <span className="muted">&ldquo;{VOICEMAIL_GREETING_TEXT}&rdquo;</span>
          </p>
        )}
        <GreetingRecorder hasRecording={meta !== null} />
      </section>
    </div>
  );
}
