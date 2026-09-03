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
  const yesterday = ymd(new Date(now.getTime() - 86_400_000));
  const target = ymd(d);
  if (target === today) return "Today";
  if (target === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d);
}

export function formatDateTime(d: Date): string {
  return `${dayLabel(d)} ${formatTime(d)}`;
}
