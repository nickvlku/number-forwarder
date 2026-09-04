const TZ = process.env.DISPLAY_TZ ?? "America/Los_Angeles";

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

export function formatTime(d: Date, _now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(d);
}

function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function dayLabel(d: Date, now: Date = new Date()): string {
  const today = ymd(now);
  const target = ymd(d);
  if (target === today) return "Today";

  // Compute yesterday using calendar-day arithmetic to handle DST transitions
  const [y, m, day] = today.split("-").map(Number);
  const yesterday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(Date.UTC(y, m - 1, day - 1)));

  if (target === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d);
}

export function formatDateTime(d: Date): string {
  return `${dayLabel(d)} ${formatTime(d)}`;
}

const DIAL_STATUS_LABELS: Record<string, string> = {
  "no-answer": "no answer",
  busy: "busy",
  failed: "call failed",
  canceled: "caller hung up",
  completed: "declined at whisper",
  forwarding_off: "forwarding was off",
  caller_hung_up: "caller hung up",
  unknown: "no answer",
};

export function dialStatusLabel(status: string | null): string {
  return DIAL_STATUS_LABELS[status ?? "unknown"] ?? "no answer";
}

const RELAY_GRACE_MS = 2 * 60_000;

/** True while a text is still within its relay grace window and hasn't been forwarded yet. */
export function isRelayPending(o: { forwardedAt: Date | null; receivedAt: Date }, now: Date = new Date()): boolean {
  return !o.forwardedAt && now.getTime() - o.receivedAt.getTime() < RELAY_GRACE_MS;
}
