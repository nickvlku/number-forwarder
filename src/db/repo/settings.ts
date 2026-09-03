import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { settings } from "@/db/schema";

export async function getForwardingEnabled(db: DB): Promise<boolean> {
  const row = await db.query.settings.findFirst({ where: eq(settings.id, 1) });
  return row?.forwardingEnabled ?? true;
}

export async function setForwardingEnabled(db: DB, enabled: boolean): Promise<void> {
  await db
    .insert(settings)
    .values({ id: 1, forwardingEnabled: enabled })
    .onConflictDoUpdate({ target: settings.id, set: { forwardingEnabled: enabled } });
}
