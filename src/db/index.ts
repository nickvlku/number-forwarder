import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  return drizzle(client, { schema });
}

export type DB = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as { __db?: DB };
export const db: DB = globalForDb.__db ?? (globalForDb.__db = createDb());
