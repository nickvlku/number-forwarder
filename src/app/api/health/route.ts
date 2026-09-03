import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("health check failed", err);
    return Response.json({ ok: false }, { status: 503 });
  }
}
