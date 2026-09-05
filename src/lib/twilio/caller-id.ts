import { normalizePhone } from "@/lib/phone";

export type CallerIdMode = "twilio" | "caller";

/** Which number the cell sees for a forwarded call. See FORWARD_CALLER_ID in env.ts. */
export function forwardCallerId(o: { mode: CallerIdMode; twilioNumber: string; from: string }): string {
  if (o.mode === "caller") return normalizePhone(o.from) ?? o.twilioNumber;
  return o.twilioNumber;
}
