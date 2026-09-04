"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getDb } from "@/db/get";
import { requireSession } from "@/lib/session";
import { normalizePhone } from "@/lib/phone";
import { setForwardingEnabled } from "@/db/repo/settings";
import { upsertContact } from "@/db/repo/contacts";
import { claimVoicemail, getVoicemail } from "@/db/repo/voicemails";
import { processVoicemail } from "@/lib/voicemail-pipeline";

export async function toggleForwarding(enabled: boolean): Promise<void> {
  await requireSession();
  await setForwardingEnabled(await getDb(), enabled);
  revalidatePath("/");
}

export async function saveContact(phoneRaw: string, name: string, notes: string): Promise<void> {
  await requireSession();
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  await upsertContact(await getDb(), { phone, name: name.trim() || null, notes: notes.trim() || null });
  revalidatePath("/");
  revalidatePath("/contacts");
}

export async function retryTranscription(recordingSid: string): Promise<void> {
  await requireSession();
  const db = await getDb();
  const vm = await getVoicemail(db, recordingSid);
  if (!vm) return;
  if (vm.transcriptionStatus === "in_progress") return;
  const claim = await claimVoicemail(db, { recordingSid, callSid: vm.callSid, durationSeconds: vm.durationSeconds });
  if (claim === "claimed") after(() => processVoicemail(db, recordingSid));
  revalidatePath("/");
}
