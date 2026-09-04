import { db, type DB } from "@/db";

/** In tests `db` may be a Promise (see tests/helpers/handlers.ts); in production it is the client. */
export async function getDb(): Promise<DB> {
  return await (db as unknown as DB | Promise<DB>);
}
