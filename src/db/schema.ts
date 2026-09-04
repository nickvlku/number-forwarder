import { pgTable, text, integer, boolean, timestamp, jsonb, index, customType } from "drizzle-orm/pg-core";

/** Postgres bytea; postgres-js hands back a Buffer, PGlite a Uint8Array. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return Buffer.from(value as Uint8Array);
  },
});

export const CALL_STATUSES = ["ringing", "completed", "missed", "voicemail_pending", "voicemail", "failed"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const TRANSCRIPTION_STATUSES = ["pending", "in_progress", "done", "failed"] as const;
export type TranscriptionStatus = (typeof TRANSCRIPTION_STATUSES)[number];

export type MediaItem = { url: string; contentType: string };

export const contacts = pgTable("contacts", {
  phone: text("phone").primaryKey(),
  name: text("name"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calls = pgTable(
  "calls",
  {
    sid: text("sid").primaryKey(),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    status: text("status", { enum: CALL_STATUSES }).notNull(),
    dialStatus: text("dial_status"),
    accepted: boolean("accepted").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    talkSeconds: integer("talk_seconds"),
    totalSeconds: integer("total_seconds"),
  },
  (t) => [index("calls_from_idx").on(t.fromNumber), index("calls_started_idx").on(t.startedAt)],
);

export const voicemails = pgTable("voicemails", {
  recordingSid: text("recording_sid").primaryKey(),
  callSid: text("call_sid")
    .notNull()
    .unique()
    .references(() => calls.sid),
  durationSeconds: integer("duration_seconds").notNull(),
  transcript: text("transcript"),
  transcriptionStatus: text("transcription_status", { enum: TRANSCRIPTION_STATUSES }).notNull().default("pending"),
  transcriptionError: text("transcription_error"),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  listenedAt: timestamp("listened_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    sid: text("sid").primaryKey(),
    fromNumber: text("from_number").notNull(),
    body: text("body").notNull().default(""),
    media: jsonb("media").$type<MediaItem[]>().notNull().default([]),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    forwardedAt: timestamp("forwarded_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("messages_from_idx").on(t.fromNumber), index("messages_received_idx").on(t.receivedAt)],
);

export const settings = pgTable("settings", {
  id: integer("id").primaryKey(),
  forwardingEnabled: boolean("forwarding_enabled").notNull().default(true),
});

/** Single-row table (id = 1) holding the recorded voicemail greeting, if any. */
export const greeting = pgTable("greeting", {
  id: integer("id").primaryKey(),
  audio: bytea("audio").notNull(),
  contentType: text("content_type").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  byteLength: integer("byte_length").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Call = typeof calls.$inferSelect;
export type Voicemail = typeof voicemails.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
