const E164 = /^\+[1-9]\d{6,14}$/;

/** Returns E.164 or null when the input cannot be a phone number (withheld caller ID, junk). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (E164.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+") && E164.test(`+${digits}`)) return `+${digits}`;
  return null;
}

export function isNanp(e164: string): boolean {
  return /^\+1\d{10}$/.test(e164);
}

export function formatPhone(e164: string): string {
  if (isNanp(e164)) {
    const d = e164.slice(2);
    return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  // Best effort for non-NANP: country code guess of 2 digits, rest as one block.
  return `${e164.slice(0, 3)} ${e164.slice(3)}`;
}

/** Digits spaced for text-to-speech, grouped 3-3-4 for NANP. */
export function spokenDigits(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const spaced = (s: string) => s.split("").join(" ");
  if (isNanp(e164)) {
    const d = digits.slice(1);
    return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].map(spaced).join(", ");
  }
  return spaced(digits);
}
