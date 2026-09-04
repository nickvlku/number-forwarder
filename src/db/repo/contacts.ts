import { asc, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { contacts, type Contact } from "@/db/schema";
import { normalizePhone, formatPhone } from "@/lib/phone";

export async function getContact(db: DB, phone: string): Promise<Contact | null> {
  const row = await db.query.contacts.findFirst({ where: (c, { eq }) => eq(c.phone, phone) });
  return row ?? null;
}

export async function upsertContact(
  db: DB,
  input: { phone: string; name?: string | null; notes?: string | null },
): Promise<Contact> {
  const set: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.notes !== undefined) set.notes = input.notes;
  const [row] = await db
    .insert(contacts)
    .values({ phone: input.phone, name: input.name ?? null, notes: input.notes ?? null })
    .onConflictDoUpdate({ target: contacts.phone, set })
    .returning();
  return row;
}

export async function listContacts(db: DB): Promise<Contact[]> {
  return db
    .select()
    .from(contacts)
    .orderBy(sql`${contacts.name} IS NULL`, asc(contacts.name), asc(contacts.phone));
}

export async function displayNameFor(db: DB, rawFrom: string): Promise<string> {
  const phone = normalizePhone(rawFrom);
  if (!phone) return "Unknown number";
  const c = await getContact(db, phone);
  return c?.name?.trim() || formatPhone(phone);
}
