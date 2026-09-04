import { and, desc, eq, inArray, lt, isNull, count } from "drizzle-orm";
import type { DB } from "@/db";
import { calls, voicemails, messages, contacts, type Call, type Voicemail, type Message, type Contact, type CallStatus } from "@/db/schema";

export type FeedFilter = "all" | "voicemail" | "missed" | "text" | "answered";
export const FEED_FILTERS: FeedFilter[] = ["all", "voicemail", "missed", "text", "answered"];

export type FeedItem =
  | { kind: "call"; id: string; at: Date; call: Call; voicemail: Voicemail | null; contact: Contact | null; unread: boolean }
  | { kind: "text"; id: string; at: Date; message: Message; contact: Contact | null; unread: boolean };

const STALE_MS = 15 * 60_000;

export function effectiveStatus(call: Call, now: Date = new Date()): CallStatus {
  if ((call.status === "ringing" || call.status === "voicemail_pending") && now.getTime() - call.startedAt.getTime() > STALE_MS) {
    return "missed";
  }
  return call.status;
}

function callItem(row: { calls: Call; voicemails: Voicemail | null; contacts: Contact | null }): FeedItem {
  return {
    kind: "call",
    id: row.calls.sid,
    at: row.calls.startedAt,
    call: row.calls,
    voicemail: row.voicemails,
    contact: row.contacts,
    unread: !!row.voicemails && row.voicemails.listenedAt === null,
  };
}

function textItem(row: { messages: Message; contacts: Contact | null }): FeedItem {
  return {
    kind: "text",
    id: row.messages.sid,
    at: row.messages.receivedAt,
    message: row.messages,
    contact: row.contacts,
    unread: row.messages.readAt === null,
  };
}

function callStatusesFor(filter: FeedFilter): CallStatus[] | null {
  switch (filter) {
    case "voicemail": return ["voicemail", "voicemail_pending"];
    case "missed": return ["missed", "failed", "ringing"];
    case "answered": return ["completed"];
    case "text": return [];
    default: return null;
  }
}

async function queryCalls(db: DB, o: { statuses: CallStatus[] | null; before?: Date; limit: number; phone?: string }) {
  const where = and(
    o.statuses ? inArray(calls.status, o.statuses) : undefined,
    o.before ? lt(calls.startedAt, o.before) : undefined,
    o.phone ? eq(calls.fromNumber, o.phone) : undefined,
  );
  const rows = await db
    .select()
    .from(calls)
    .leftJoin(voicemails, eq(voicemails.callSid, calls.sid))
    .leftJoin(contacts, eq(contacts.phone, calls.fromNumber))
    .where(where)
    .orderBy(desc(calls.startedAt))
    .limit(o.limit);
  return rows.map(callItem);
}

async function queryTexts(db: DB, o: { before?: Date; limit: number; phone?: string }) {
  const where = and(
    o.before ? lt(messages.receivedAt, o.before) : undefined,
    o.phone ? eq(messages.fromNumber, o.phone) : undefined,
  );
  const rows = await db
    .select()
    .from(messages)
    .leftJoin(contacts, eq(contacts.phone, messages.fromNumber))
    .where(where)
    .orderBy(desc(messages.receivedAt))
    .limit(o.limit);
  return rows.map(textItem);
}

export async function listFeed(
  db: DB,
  o: { filter: FeedFilter; before?: Date; limit: number },
): Promise<{ items: FeedItem[]; nextBefore: Date | null }> {
  const statuses = callStatusesFor(o.filter);
  const wantCalls = o.filter !== "text";
  const wantTexts = o.filter === "all" || o.filter === "text";
  const [c, t] = await Promise.all([
    wantCalls ? queryCalls(db, { statuses, before: o.before, limit: o.limit + 1 }) : [],
    wantTexts ? queryTexts(db, { before: o.before, limit: o.limit + 1 }) : [],
  ]);
  const merged = [...c, ...t].sort((a, b) => b.at.getTime() - a.at.getTime());
  const items = merged.slice(0, o.limit);
  const hasMore = merged.length > o.limit;
  return { items, nextBefore: hasMore ? items[items.length - 1].at : null };
}

export async function getFeedItem(db: DB, id: string): Promise<FeedItem | null> {
  if (id.startsWith("CA")) {
    const [row] = await db
      .select()
      .from(calls)
      .leftJoin(voicemails, eq(voicemails.callSid, calls.sid))
      .leftJoin(contacts, eq(contacts.phone, calls.fromNumber))
      .where(eq(calls.sid, id));
    return row ? callItem(row) : null;
  }
  const [row] = await db
    .select()
    .from(messages)
    .leftJoin(contacts, eq(contacts.phone, messages.fromNumber))
    .where(eq(messages.sid, id));
  return row ? textItem(row) : null;
}

export async function countUnread(db: DB): Promise<number> {
  const [[vm], [tx]] = await Promise.all([
    db.select({ n: count() }).from(voicemails).where(isNull(voicemails.listenedAt)),
    db.select({ n: count() }).from(messages).where(isNull(messages.readAt)),
  ]);
  return Number(vm.n) + Number(tx.n);
}

export async function historyFor(db: DB, phone: string): Promise<FeedItem[]> {
  const [c, t] = await Promise.all([
    queryCalls(db, { statuses: null, limit: 500, phone }),
    queryTexts(db, { limit: 500, phone }),
  ]);
  return [...c, ...t].sort((a, b) => b.at.getTime() - a.at.getTime());
}
