# Number Forwarder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward calls to 415-THE-VLKU to Nick's cell with a whisper-and-press-1 screen, capture voicemails with Whisper transcripts, relay inbound texts, and show everything in a password-protected two-pane dashboard on Fly.io.

**Architecture:** One Next.js App Router service. Twilio webhooks are route handlers under `/api/twilio/*` that validate signatures, write rows via Drizzle, and return TwiML strings built by pure functions. Slow work (recording download, Whisper, SMS send) runs in `after()` so webhooks respond fast. The dashboard is server-rendered with a few small client components for the toggle, contact editor, and polling.

**Tech Stack:** Next.js 16 (App Router, TypeScript), React 19, Tailwind CSS 4, Drizzle ORM 0.45 + postgres-js, Postgres (PGlite in tests), Vitest 4, Playwright, zod 4. Twilio and OpenAI are called with plain `fetch`, no SDKs.

**Spec:** `docs/superpowers/specs/2026-09-02-number-forwarder-design.md`

## Global Constraints

- All phone numbers are stored in E.164 (`+14155550199`). Display format for NANP numbers is `+1 (415) 555-0199`.
- Every `/api/twilio/*` handler validates `X-Twilio-Signature` and returns 403 on mismatch, before touching the database.
- Every webhook handler is idempotent on the Twilio SID it receives.
- Webhook handlers return within a few hundred milliseconds; anything slow goes in `after()` from `next/server`.
- The whisper says "Call for THE VLKU from …. Press 1 to accept." Voicemail greeting says "You've reached THE VLKU. Please leave a message after the tone."
- Notification SMS prefix is `[THE VLKU]`. Voicemail SMS stays under 320 characters.
- Durations render as `m:ss`, or `h:mm:ss` past an hour.
- Dashboard: 14px base, system font stack, tabular numerals for times and durations, blue accent, light and dark via `prefers-color-scheme`.
- Env vars: `DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`, `CELL_NUMBER`, `PUBLIC_BASE_URL`, `OPENAI_API_KEY`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`.
- Deviation from spec, deliberate: the Docker image runs `next start` with full production `node_modules` instead of the standalone bundle, so the Fly release command can run Drizzle migrations from the same image with no extra tooling.
- Commit after every task. Commit messages end with the Co-Authored-By and Claude-Session trailers shown in Task 1.

## File Structure

```
package.json, tsconfig.json, next.config.ts, postcss.config.mjs, eslint.config.mjs
vitest.config.ts, drizzle.config.ts, playwright.config.ts
.env.example, Dockerfile, fly.toml, README.md
drizzle/                                  generated SQL migrations
scripts/migrate.mjs                       runs migrations in the Fly release command
scripts/configure-twilio.ts               points the number's webhooks at PUBLIC_BASE_URL
scripts/seed.ts                           sample rows for local dev and e2e
src/lib/env.ts                            zod-validated env access
src/lib/phone.ts                          E.164 normalize, display, spoken digits
src/lib/format.ts                         durations, dates
src/lib/session.ts                        cookie sign/verify, requireSession
src/lib/twilio/signature.ts               HMAC-SHA1 signature check
src/lib/twilio/webhook.ts                 parse + validate a webhook Request, TwiML Response helper
src/lib/twilio/twiml.ts                   pure TwiML builders
src/lib/twilio/rest.ts                    sendSms, fetchRecording, deleteRecording, fetchMedia
src/lib/transcription.ts                  Whisper call
src/lib/notify.ts                         SMS composition + send for voicemails and texts
src/lib/voicemail-pipeline.ts             download -> transcribe -> notify, with status updates
src/db/schema.ts, src/db/index.ts, src/db/get.ts   get.ts: getDb() accessor used by every handler/page
src/db/repo/calls.ts, contacts.ts, voicemails.ts, messages.ts, settings.ts, feed.ts
src/app/api/health/route.ts
src/app/api/twilio/{voice,whisper,whisper-result,dial-status,record-done,recording,status,sms}/route.ts
src/app/api/recordings/[sid]/route.ts
src/app/api/media/[sid]/[index]/route.ts
src/app/login/page.tsx, src/app/login/actions.ts
src/app/(dashboard)/layout.tsx, page.tsx, actions.ts
src/app/(dashboard)/contacts/page.tsx, contacts/[phone]/page.tsx
src/app/calls/[sid]/route.ts              redirect to /?item=
src/app/globals.css
src/components/{Header,ForwardingToggle,FilterChips,FeedList,FeedRow,TypePill,DetailPane,CallDetail,MessageDetail,ContactCard,Poller,UnreadTitle}.tsx
tests/helpers/db.ts, tests/helpers/twilio.ts
tests/**/*.test.ts
e2e/smoke.spec.ts
```

---

### Task 1: Project scaffold, env module, health endpoint

**Files:**
- Create: `package.json` (via create-next-app, then edited), `vitest.config.ts`, `.env.example`, `src/lib/env.ts`, `src/app/api/health/route.ts`
- Test: `tests/env.test.ts`

**Interfaces:**
- Produces: `env` object from `src/lib/env.ts` with the nine string fields listed in Global Constraints, plus `isProd: boolean`. `loadEnv(source: Record<string, string | undefined>)` for tests.

- [ ] **Step 1: Scaffold Next.js in the existing directory**

```bash
cd /Users/nick/Developer/personal/number-forwarder
npx create-next-app@16 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

If it complains the directory is not empty (it contains `docs/`, `.git`, `.gitignore`), run it in a temp dir and copy the results in:

```bash
npx create-next-app@16 /private/tmp/nf-scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
rsync -a --exclude .git --exclude node_modules /private/tmp/nf-scaffold/ ./
npm install
```

Append to `.gitignore` if missing: `node_modules/`, `.next/`, `.env`, `.env.local`, `.superpowers/`, `test-results/`, `playwright-report/`.

- [ ] **Step 2: Install dependencies**

```bash
npm install drizzle-orm@^0.45 postgres@^3.4 zod@^4
npm install -D drizzle-kit@^0.31 @electric-sql/pglite@^0.5 vitest@^4 tsx@^4 @playwright/test@^1.61
```

- [ ] **Step 3: Add scripts to package.json**

Edit the `scripts` block to:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "node scripts/migrate.mjs",
  "db:seed": "tsx scripts/seed.ts",
  "twilio:configure": "tsx scripts/configure-twilio.ts"
}
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 5: Write the failing env test**

`tests/env.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadEnv } from "@/lib/env";

const good = {
  DATABASE_URL: "postgres://localhost/x",
  TWILIO_ACCOUNT_SID: "ACxxx",
  TWILIO_AUTH_TOKEN: "tok",
  TWILIO_NUMBER: "+14158438558",
  CELL_NUMBER: "+14155550100",
  PUBLIC_BASE_URL: "https://example.fly.dev",
  OPENAI_API_KEY: "sk-x",
  DASHBOARD_PASSWORD: "pw",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("loadEnv", () => {
  it("returns all fields when valid", () => {
    const env = loadEnv({ ...good, NODE_ENV: "production" });
    expect(env.TWILIO_NUMBER).toBe("+14158438558");
    expect(env.isProd).toBe(true);
  });

  it("strips a trailing slash from PUBLIC_BASE_URL", () => {
    const env = loadEnv({ ...good, PUBLIC_BASE_URL: "https://example.fly.dev/" });
    expect(env.PUBLIC_BASE_URL).toBe("https://example.fly.dev");
  });

  it("throws naming the missing variable", () => {
    const { OPENAI_API_KEY: _omit, ...missing } = good;
    expect(() => loadEnv(missing)).toThrow(/OPENAI_API_KEY/);
  });

  it("rejects non-E.164 numbers", () => {
    expect(() => loadEnv({ ...good, CELL_NUMBER: "415-555-0100" })).toThrow(/CELL_NUMBER/);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/env.test.ts`
Expected: FAIL, cannot resolve `@/lib/env`.

- [ ] **Step 7: Implement src/lib/env.ts**

```ts
import { z } from "zod";

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "must be E.164, e.g. +14155550100");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_NUMBER: e164,
  CELL_NUMBER: e164,
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .transform((u) => u.replace(/\/+$/, "")),
  OPENAI_API_KEY: z.string().min(1),
  DASHBOARD_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "at least 32 characters"),
  NODE_ENV: z.string().optional(),
});

export type Env = z.infer<typeof schema> & { isProd: boolean };

export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return { ...parsed.data, isProd: parsed.data.NODE_ENV === "production" };
}

let cached: Env | undefined;
/** Lazily parsed so importing this module in tests does not require real env. */
export function getEnv(): Env {
  if (!cached) cached = loadEnv(process.env);
  return cached;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/env.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Create .env.example**

```
# Postgres connection string (Fly Postgres injects this on attach)
DATABASE_URL=postgres://localhost/number_forwarder

# Twilio console -> Account info
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# The Twilio number, E.164
TWILIO_NUMBER=+14158438558
# Where calls and texts are forwarded, E.164
CELL_NUMBER=+14155550100

# Public origin of this app, no trailing slash. Local dev: your tunnel URL.
PUBLIC_BASE_URL=https://vlku-line.fly.dev

OPENAI_API_KEY=sk-...

# Dashboard login
DASHBOARD_PASSWORD=change-me
# openssl rand -hex 32
SESSION_SECRET=
```

- [ ] **Step 10: Create the health route (placeholder DB check comes in Task 2)**

`src/app/api/health/route.ts`:

```ts
export async function GET() {
  return Response.json({ ok: true });
}
```

- [ ] **Step 11: Verify the app builds and lint passes**

Run: `npm run lint && npm run build`
Expected: no errors. Delete the scaffold's `src/app/page.tsx` content later in Task 12; leave it for now.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with env module and health route

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 2: Database schema, migrations, test helper, repos for contacts and settings

**Files:**
- Create: `drizzle.config.ts`, `src/db/schema.ts`, `src/db/index.ts`, `drizzle/0000_*.sql` (generated), `tests/helpers/db.ts`, `src/db/repo/contacts.ts`, `src/db/repo/settings.ts`
- Modify: `src/app/api/health/route.ts`
- Test: `tests/db/contacts.test.ts`, `tests/db/settings.test.ts`

**Interfaces:**
- Produces: `db` (type `DB`) from `@/db`; tables `contacts`, `calls`, `voicemails`, `messages`, `settings` from `@/db/schema`; `createTestDb(): Promise<DB>`.
- Produces: `getContact(db, phone)`, `upsertContact(db, {phone, name?, notes?})`, `listContacts(db)`, `getForwardingEnabled(db)`, `setForwardingEnabled(db, enabled)`.

- [ ] **Step 1: Create drizzle.config.ts**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/number_forwarder" },
});
```

- [ ] **Step 2: Create src/db/schema.ts**

```ts
import { pgTable, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

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

export type Call = typeof calls.$inferSelect;
export type Voicemail = typeof voicemails.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
```

- [ ] **Step 3: Create src/db/index.ts**

```ts
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
```

Note: the `postgres()` client connects lazily, so importing this module without a database does not fail. Tests replace this module with `vi.mock("@/db", ...)`.

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: `drizzle/0000_<name>.sql` and `drizzle/meta/` created. Open the SQL and confirm five `CREATE TABLE` statements.

- [ ] **Step 5: Create tests/helpers/db.ts**

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { DB } from "@/db";

export async function createTestDb(): Promise<DB> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as DB;
}
```

- [ ] **Step 6: Write failing contact and settings tests**

`tests/db/contacts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { DB } from "@/db";
import { getContact, upsertContact, listContacts } from "@/db/repo/contacts";

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe("contacts repo", () => {
  it("returns null for unknown number", async () => {
    expect(await getContact(db, "+14155550199")).toBeNull();
  });

  it("creates then updates a contact, keeping fields not passed", async () => {
    await upsertContact(db, { phone: "+14155550199", name: "Jane" });
    await upsertContact(db, { phone: "+14155550199", notes: "Dentist" });
    const c = await getContact(db, "+14155550199");
    expect(c?.name).toBe("Jane");
    expect(c?.notes).toBe("Dentist");
  });

  it("lists contacts alphabetically by name, unnamed last", async () => {
    await upsertContact(db, { phone: "+14155550001", name: "Zed" });
    await upsertContact(db, { phone: "+14155550002", notes: "no name" });
    await upsertContact(db, { phone: "+14155550003", name: "Amy" });
    const names = (await listContacts(db)).map((c) => c.name);
    expect(names).toEqual(["Amy", "Zed", null]);
  });
});
```

`tests/db/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "../helpers/db";
import { getForwardingEnabled, setForwardingEnabled } from "@/db/repo/settings";

describe("settings repo", () => {
  it("defaults to forwarding enabled when no row exists", async () => {
    const db = await createTestDb();
    expect(await getForwardingEnabled(db)).toBe(true);
  });

  it("persists a toggle", async () => {
    const db = await createTestDb();
    await setForwardingEnabled(db, false);
    expect(await getForwardingEnabled(db)).toBe(false);
    await setForwardingEnabled(db, true);
    expect(await getForwardingEnabled(db)).toBe(true);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run tests/db`
Expected: FAIL, cannot resolve `@/db/repo/contacts` and `@/db/repo/settings`.

- [ ] **Step 8: Implement src/db/repo/contacts.ts**

```ts
import { asc, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { contacts, type Contact } from "@/db/schema";

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
```

- [ ] **Step 9: Implement src/db/repo/settings.ts**

```ts
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
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run tests/db`
Expected: 5 passed.

- [ ] **Step 11: Make the health route check the database**

`src/app/api/health/route.ts`:

```ts
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
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "Add Drizzle schema, migrations, and contact/settings repos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 3: Phone and formatting utilities

**Files:**
- Create: `src/lib/phone.ts`, `src/lib/format.ts`
- Test: `tests/phone.test.ts`, `tests/format.test.ts`

**Interfaces:**
- Produces: `normalizePhone(raw: string): string | null`, `formatPhone(e164: string): string`, `spokenDigits(e164: string): string`, `formatDuration(seconds: number | null | undefined): string`, `formatTime(d: Date, now?: Date): string`, `dayLabel(d: Date, now?: Date): string`.

- [ ] **Step 1: Write failing phone tests**

`tests/phone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizePhone, formatPhone, spokenDigits } from "@/lib/phone";

describe("normalizePhone", () => {
  it("keeps valid E.164", () => expect(normalizePhone("+14155550199")).toBe("+14155550199"));
  it("adds +1 to ten US digits", () => expect(normalizePhone("(415) 555-0199")).toBe("+14155550199"));
  it("adds + to eleven digits starting with 1", () => expect(normalizePhone("1 415 555 0199")).toBe("+14155550199"));
  it("returns null for withheld or junk", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("anonymous")).toBeNull();
    expect(normalizePhone("+266696687")).toBe("+266696687"); // non-NANP kept as is
  });
});

describe("formatPhone", () => {
  it("formats NANP", () => expect(formatPhone("+14155550199")).toBe("+1 (415) 555-0199"));
  it("passes through others", () => expect(formatPhone("+442071234567")).toBe("+44 2071234567"));
});

describe("spokenDigits", () => {
  it("reads NANP digits in groups with pauses", () => {
    expect(spokenDigits("+14155550199")).toBe("4 1 5, 5 5 5, 0 1 9 9");
  });
  it("reads other numbers digit by digit", () => {
    expect(spokenDigits("+442071234567")).toBe("4 4 2 0 7 1 2 3 4 5 6 7");
  });
});
```

- [ ] **Step 2: Write failing format tests**

`tests/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatDuration, formatTime, dayLabel } from "@/lib/format";

describe("formatDuration", () => {
  it("m:ss under an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(728)).toBe("12:08");
  });
  it("h:mm:ss past an hour", () => expect(formatDuration(3725)).toBe("1:02:05"));
  it("dash for missing", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
  });
});

describe("formatTime and dayLabel", () => {
  const now = new Date("2026-09-02T20:00:00-07:00");
  it("time of day for today", () => {
    const d = new Date("2026-09-02T14:14:00-07:00");
    expect(formatTime(d, now)).toBe("2:14 PM");
    expect(dayLabel(d, now)).toBe("Today");
  });
  it("Yesterday label", () => {
    const d = new Date("2026-09-01T18:30:00-07:00");
    expect(dayLabel(d, now)).toBe("Yesterday");
  });
  it("weekday-month-day for older", () => {
    const d = new Date("2026-08-20T09:00:00-07:00");
    expect(dayLabel(d, now)).toBe("Thu, Aug 20");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/phone.test.ts tests/format.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement src/lib/phone.ts**

```ts
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
```

- [ ] **Step 5: Implement src/lib/format.ts**

```ts
const TZ = process.env.DISPLAY_TZ ?? "America/Los_Angeles";

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

export function formatTime(d: Date, _now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(d);
}

function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function dayLabel(d: Date, now: Date = new Date()): string {
  const today = ymd(now);
  const yesterday = ymd(new Date(now.getTime() - 86_400_000));
  const target = ymd(d);
  if (target === today) return "Today";
  if (target === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d);
}

export function formatDateTime(d: Date): string {
  return `${dayLabel(d)} ${formatTime(d)}`;
}
```

`DISPLAY_TZ` is an optional env override; it is not part of the required env set.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/phone.test.ts tests/format.test.ts`
Expected: all passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add phone normalization and duration/date formatting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---
### Task 4: Twilio signature validation and webhook request helper

**Files:**
- Create: `src/lib/twilio/signature.ts`, `src/lib/twilio/webhook.ts`, `tests/helpers/twilio.ts`
- Test: `tests/twilio/signature.test.ts`, `tests/twilio/webhook.test.ts`

**Interfaces:**
- Produces: `computeSignature(authToken, url, params: Record<string,string>): string`, `verifySignature(authToken, url, params, header: string | null): boolean`.
- Produces: `readWebhook(req: Request): Promise<{ ok: true; params: Record<string,string>; url: string } | { ok: false; response: Response }>`, `twiml(body: string): Response`, `forbidden(): Response`.
- Produces test helper: `signedRequest(path: string, params: Record<string,string>, opts?: { authToken?: string; baseUrl?: string; tamper?: boolean }): Request`.

- [ ] **Step 1: Write failing signature test**

`tests/twilio/signature.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeSignature, verifySignature } from "@/lib/twilio/signature";

// Values from Twilio's documented example.
const token = "12345";
const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
const params = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+12349013030",
  Digits: "1234",
  From: "+12349013030",
  To: "+18005551212",
};

describe("twilio signature", () => {
  it("matches Twilio's documented example", () => {
    expect(computeSignature(token, url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });
  it("verifies a correct header and rejects a wrong one", () => {
    expect(verifySignature(token, url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(true);
    expect(verifySignature(token, url, params, "nope")).toBe(false);
    expect(verifySignature(token, url, params, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/twilio/signature.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/lib/twilio/signature.ts**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/** Twilio: URL + each POST param key+value sorted by key, HMAC-SHA1 with the auth token, base64. */
export function computeSignature(authToken: string, url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  const data = url + keys.map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifySignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | null | undefined,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(computeSignature(authToken, url, params));
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/twilio/signature.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Create the test helper tests/helpers/twilio.ts**

```ts
import { computeSignature } from "@/lib/twilio/signature";

export const TEST_ENV = {
  DATABASE_URL: "postgres://unused",
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "test-auth-token",
  TWILIO_NUMBER: "+14158438558",
  CELL_NUMBER: "+14155550100",
  PUBLIC_BASE_URL: "https://vlku.test",
  OPENAI_API_KEY: "sk-test",
  DASHBOARD_PASSWORD: "pw",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

/** Builds a form-encoded POST the way Twilio sends it, with a valid (or deliberately wrong) signature. */
export function signedRequest(
  path: string,
  params: Record<string, string>,
  opts: { authToken?: string; baseUrl?: string; tamper?: boolean } = {},
): Request {
  const base = opts.baseUrl ?? TEST_ENV.PUBLIC_BASE_URL;
  const url = base + path;
  const sig = computeSignature(opts.authToken ?? TEST_ENV.TWILIO_AUTH_TOKEN, url, params);
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": opts.tamper ? "bad" : sig,
    },
    body: new URLSearchParams(params).toString(),
  });
}

/** Common Twilio voice params for a fresh inbound call. */
export function voiceParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    CallSid: "CA0000000000000000000000000000001",
    AccountSid: "ACtest",
    From: "+14155550199",
    To: "+14158438558",
    CallStatus: "ringing",
    Direction: "inbound",
    ...overrides,
  };
}
```

- [ ] **Step 6: Write failing webhook helper test**

`tests/twilio/webhook.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import { signedRequest, TEST_ENV } from "../helpers/twilio";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});

let readWebhook: typeof import("@/lib/twilio/webhook").readWebhook;
let twiml: typeof import("@/lib/twilio/webhook").twiml;
beforeAll(async () => {
  ({ readWebhook, twiml } = await import("@/lib/twilio/webhook"));
});

describe("readWebhook", () => {
  it("returns params for a validly signed request", async () => {
    const res = await readWebhook(signedRequest("/api/twilio/voice", { CallSid: "CA1", From: "+14155550199" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.params.CallSid).toBe("CA1");
  });

  it("uses PUBLIC_BASE_URL rather than the request host when validating", async () => {
    // Fly's proxy rewrites the host; the signature is computed against the public URL.
    const req = signedRequest("/api/twilio/voice?x=1", { CallSid: "CA1" }, { baseUrl: "https://vlku.test" });
    const internal = new Request("http://10.0.0.5:3000/api/twilio/voice?x=1", {
      method: "POST",
      headers: req.headers,
      body: await req.text(),
    });
    const res = await readWebhook(internal);
    expect(res.ok).toBe(true);
  });

  it("rejects a tampered signature with 403", async () => {
    const res = await readWebhook(signedRequest("/api/twilio/voice", { CallSid: "CA1" }, { tamper: true }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });
});

describe("twiml", () => {
  it("wraps body in a Response with the XML content type", async () => {
    const r = twiml("<Response><Hangup/></Response>");
    expect(r.headers.get("content-type")).toMatch(/text\/xml/);
    expect(await r.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/twilio/webhook.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 8: Implement src/lib/twilio/webhook.ts**

```ts
import { getEnv } from "@/lib/env";
import { verifySignature } from "./signature";

export type WebhookResult =
  | { ok: true; params: Record<string, string>; url: string }
  | { ok: false; response: Response };

export function forbidden(): Response {
  return new Response("invalid signature", { status: 403 });
}

/** Parses the form body and validates the signature against the public URL. */
export async function readWebhook(req: Request): Promise<WebhookResult> {
  const env = getEnv();
  const incoming = new URL(req.url);
  const url = env.PUBLIC_BASE_URL + incoming.pathname + incoming.search;
  const text = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) params[k] = v;
  const header = req.headers.get("x-twilio-signature");
  if (!verifySignature(env.TWILIO_AUTH_TOKEN, url, params, header)) {
    console.warn("twilio signature mismatch", { path: incoming.pathname });
    return { ok: false, response: forbidden() };
  }
  return { ok: true, params, url };
}

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/twilio`
Expected: all passed.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add Twilio signature validation and webhook helper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 5: TwiML builders

**Files:**
- Create: `src/lib/twilio/twiml.ts`
- Test: `tests/twilio/twiml.test.ts`

**Interfaces:**
- Produces, all returning strings starting with `<Response>`:
  - `dialTwiml({ callSid, callerId, cellNumber, baseUrl })`
  - `whisperTwiml({ callSid, displayName, baseUrl })` where `displayName` is either a contact name or the output of `spokenDigits`
  - `acceptTwiml()` returns `<Response></Response>`
  - `hangupTwiml()`
  - `voicemailTwiml({ baseUrl })`
  - `errorTwiml()`
  - `emptyTwiml()` for SMS acknowledgement
- Also `escapeXml(s: string): string`.

- [ ] **Step 1: Write failing tests**

`tests/twilio/twiml.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  dialTwiml, whisperTwiml, acceptTwiml, hangupTwiml, voicemailTwiml, errorTwiml, emptyTwiml, escapeXml,
} from "@/lib/twilio/twiml";

const baseUrl = "https://vlku.test";

describe("twiml builders", () => {
  it("dials the cell with whisper url, caller id, timeout 20, answerOnBridge", () => {
    const xml = dialTwiml({ callSid: "CA1", callerId: "+14155550199", cellNumber: "+14155550100", baseUrl });
    expect(xml).toBe(
      '<Response><Dial timeout="20" callerId="+14155550199" answerOnBridge="true" action="https://vlku.test/api/twilio/dial-status">' +
        '<Number url="https://vlku.test/api/twilio/whisper?callSid=CA1">+14155550100</Number></Dial></Response>',
    );
  });

  it("whisper gathers one digit and hangs up on timeout", () => {
    const xml = whisperTwiml({ callSid: "CA1", displayName: "Jane Doe", baseUrl });
    expect(xml).toBe(
      '<Response><Gather numDigits="1" timeout="5" action="https://vlku.test/api/twilio/whisper-result?callSid=CA1">' +
        "<Say>Call for THE VLKU from Jane Doe. Press 1 to accept.</Say></Gather><Hangup/></Response>",
    );
  });

  it("escapes names in the whisper", () => {
    const xml = whisperTwiml({ callSid: "CA1", displayName: "Tom & Jerry <LLC>", baseUrl });
    expect(xml).toContain("from Tom &amp; Jerry &lt;LLC&gt;. Press 1");
  });

  it("voicemail greeting records with callbacks", () => {
    expect(voicemailTwiml({ baseUrl })).toBe(
      "<Response><Say>You've reached THE VLKU. Please leave a message after the tone.</Say>" +
        '<Record maxLength="180" finishOnKey="#" playBeep="true" recordingStatusCallback="https://vlku.test/api/twilio/recording" action="https://vlku.test/api/twilio/record-done"/></Response>',
    );
  });

  it("small builders", () => {
    expect(acceptTwiml()).toBe("<Response></Response>");
    expect(emptyTwiml()).toBe("<Response></Response>");
    expect(hangupTwiml()).toBe("<Response><Hangup/></Response>");
    expect(errorTwiml()).toBe("<Response><Say>Sorry, something went wrong.</Say><Hangup/></Response>");
    expect(escapeXml(`a"b'c`)).toBe("a&quot;b&apos;c");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/twilio/twiml.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/lib/twilio/twiml.ts**

```ts
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const wrap = (inner: string) => `<Response>${inner}</Response>`;

export function dialTwiml(o: { callSid: string; callerId: string; cellNumber: string; baseUrl: string }): string {
  const whisper = `${o.baseUrl}/api/twilio/whisper?callSid=${encodeURIComponent(o.callSid)}`;
  const action = `${o.baseUrl}/api/twilio/dial-status`;
  return wrap(
    `<Dial timeout="20" callerId="${escapeXml(o.callerId)}" answerOnBridge="true" action="${escapeXml(action)}">` +
      `<Number url="${escapeXml(whisper)}">${escapeXml(o.cellNumber)}</Number></Dial>`,
  );
}

export function whisperTwiml(o: { callSid: string; displayName: string; baseUrl: string }): string {
  const action = `${o.baseUrl}/api/twilio/whisper-result?callSid=${encodeURIComponent(o.callSid)}`;
  return wrap(
    `<Gather numDigits="1" timeout="5" action="${escapeXml(action)}">` +
      `<Say>Call for THE VLKU from ${escapeXml(o.displayName)}. Press 1 to accept.</Say></Gather><Hangup/>`,
  );
}

export function acceptTwiml(): string {
  return wrap("");
}

export function emptyTwiml(): string {
  return wrap("");
}

export function hangupTwiml(): string {
  return wrap("<Hangup/>");
}

export function voicemailTwiml(o: { baseUrl: string }): string {
  return wrap(
    "<Say>You've reached THE VLKU. Please leave a message after the tone.</Say>" +
      `<Record maxLength="180" finishOnKey="#" playBeep="true" ` +
      `recordingStatusCallback="${escapeXml(`${o.baseUrl}/api/twilio/recording`)}" ` +
      `action="${escapeXml(`${o.baseUrl}/api/twilio/record-done`)}"/>`,
  );
}

export function errorTwiml(): string {
  return wrap("<Say>Sorry, something went wrong.</Say><Hangup/>");
}
```

Note: the apostrophe inside `<Say>` text of the greeting is literal, not escaped, because it is content we author, and the test asserts the literal form. Only user-supplied strings pass through `escapeXml`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/twilio/twiml.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add pure TwiML builders for the call flow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 6: Twilio REST client (send SMS, fetch and delete recordings, fetch media)

**Files:**
- Create: `src/lib/twilio/rest.ts`
- Test: `tests/twilio/rest.test.ts`

**Interfaces:**
- Produces: `sendSms({ to, body }): Promise<{ sid: string }>`, `fetchRecording(recordingSid): Promise<Response>` (streams MP3), `deleteRecording(recordingSid): Promise<void>`, `fetchMedia(url): Promise<Response>`, `updateNumberWebhooks({ phoneNumber, voiceUrl, smsUrl, statusCallback })`. All use `getEnv()` and global `fetch`.

- [ ] **Step 1: Write failing tests**

`tests/twilio/rest.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { TEST_ENV } from "../helpers/twilio";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});

let rest: typeof import("@/lib/twilio/rest");
const fetchMock = vi.fn();
beforeAll(async () => {
  vi.stubGlobal("fetch", fetchMock);
  rest = await import("@/lib/twilio/rest");
});
beforeEach(() => fetchMock.mockReset());

const expectedAuth = "Basic " + Buffer.from("ACtest:test-auth-token").toString("base64");

describe("sendSms", () => {
  it("posts form data with basic auth and returns the sid", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    const r = await rest.sendSms({ to: "+14155550100", body: "hi" });
    expect(r.sid).toBe("SM1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(expectedAuth);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("To")).toBe("+14155550100");
    expect(body.get("From")).toBe("+14158438558");
    expect(body.get("Body")).toBe("hi");
  });

  it("throws with the Twilio error body on failure", async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"bad"}', { status: 400 }));
    await expect(rest.sendSms({ to: "+1", body: "x" })).rejects.toThrow(/400.*bad/);
  });
});

describe("recordings", () => {
  it("fetches the mp3 with auth", async () => {
    fetchMock.mockResolvedValue(new Response("audio", { status: 200 }));
    await rest.fetchRecording("RE1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/RE1.mp3");
    expect(init.headers.authorization).toBe(expectedAuth);
  });

  it("deletes a recording and tolerates 404", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(rest.deleteRecording("RE1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("updateNumberWebhooks", () => {
  it("looks up the number then posts the new urls", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ incoming_phone_numbers: [{ sid: "PN1" }] })))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await rest.updateNumberWebhooks({
      phoneNumber: "+14158438558",
      voiceUrl: "https://vlku.test/api/twilio/voice",
      smsUrl: "https://vlku.test/api/twilio/sms",
      statusCallback: "https://vlku.test/api/twilio/status",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACtest/IncomingPhoneNumbers.json?PhoneNumber=%2B14158438558",
    );
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/IncomingPhoneNumbers/PN1.json");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("VoiceUrl")).toBe("https://vlku.test/api/twilio/voice");
    expect(body.get("VoiceMethod")).toBe("POST");
    expect(body.get("SmsUrl")).toBe("https://vlku.test/api/twilio/sms");
    expect(body.get("StatusCallback")).toBe("https://vlku.test/api/twilio/status");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/twilio/rest.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/lib/twilio/rest.ts**

```ts
import { getEnv } from "@/lib/env";

const API = "https://api.twilio.com/2010-04-01";

function authHeader(): string {
  const env = getEnv();
  return "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
}

function accountUrl(path: string): string {
  return `${API}/Accounts/${getEnv().TWILIO_ACCOUNT_SID}${path}`;
}

async function twilioFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: authHeader() },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  return res;
}

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  const res = await twilioFetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio ${res.status} for ${url}: ${text}`);
  }
  return res;
}

export async function sendSms(o: { to: string; body: string }): Promise<{ sid: string }> {
  const env = getEnv();
  const res = await postForm(accountUrl("/Messages.json"), { To: o.to, From: env.TWILIO_NUMBER, Body: o.body });
  const json = (await res.json()) as { sid: string };
  return { sid: json.sid };
}

/** Streams the recording as MP3. Caller checks res.ok. */
export async function fetchRecording(recordingSid: string): Promise<Response> {
  return twilioFetch(accountUrl(`/Recordings/${encodeURIComponent(recordingSid)}.mp3`));
}

export async function deleteRecording(recordingSid: string): Promise<void> {
  const res = await twilioFetch(accountUrl(`/Recordings/${encodeURIComponent(recordingSid)}.json`), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Twilio ${res.status} deleting ${recordingSid}`);
}

/** MMS media URLs from Twilio require account auth; redirects to the CDN are followed by fetch. */
export async function fetchMedia(url: string): Promise<Response> {
  return twilioFetch(url);
}

export async function updateNumberWebhooks(o: {
  phoneNumber: string;
  voiceUrl: string;
  smsUrl: string;
  statusCallback: string;
}): Promise<void> {
  const lookup = await twilioFetch(accountUrl(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(o.phoneNumber)}`));
  if (!lookup.ok) throw new Error(`Twilio ${lookup.status} looking up ${o.phoneNumber}`);
  const json = (await lookup.json()) as { incoming_phone_numbers: { sid: string }[] };
  const pn = json.incoming_phone_numbers[0];
  if (!pn) throw new Error(`Number ${o.phoneNumber} not found in account`);
  await postForm(accountUrl(`/IncomingPhoneNumbers/${pn.sid}.json`), {
    VoiceUrl: o.voiceUrl,
    VoiceMethod: "POST",
    SmsUrl: o.smsUrl,
    SmsMethod: "POST",
    StatusCallback: o.statusCallback,
    StatusCallbackMethod: "POST",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/twilio/rest.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add Twilio REST client for SMS, recordings, and number config

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---
### Task 7: Calls repo and the voice, whisper, and whisper-result handlers

**Files:**
- Create: `src/db/repo/calls.ts`, `src/app/api/twilio/voice/route.ts`, `src/app/api/twilio/whisper/route.ts`, `src/app/api/twilio/whisper-result/route.ts`, `tests/helpers/handlers.ts`
- Test: `tests/db/calls.test.ts`, `tests/api/voice.test.ts`

**Interfaces:**
- Produces from `@/db/repo/calls`: `createCall(db, {sid, from, to})` (no-op if sid exists), `getCall(db, sid)`, `markAccepted(db, sid)`, `setCallStatus(db, sid, status, extra?: {dialStatus?, talkSeconds?})`, `finishCall(db, sid, {endedAt, totalSeconds})`.
- Produces test helper `tests/helpers/handlers.ts` exporting `setupHandlerTest()` which mocks `@/db` with a fresh PGlite and `@/lib/env` with `TEST_ENV`, and returns `{ db }`. Every route handler test uses it.
- Route handlers export `POST(req: Request): Promise<Response>`.

- [ ] **Step 1: Write failing calls repo test**

`tests/db/calls.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { DB } from "@/db";
import { createCall, getCall, markAccepted, setCallStatus, finishCall } from "@/db/repo/calls";

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe("calls repo", () => {
  it("creates a ringing call and ignores duplicates", async () => {
    await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
    await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
    const c = await getCall(db, "CA1");
    expect(c?.status).toBe("ringing");
    expect(c?.accepted).toBe(false);
  });

  it("marks accepted and completes with talk seconds", async () => {
    await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
    await markAccepted(db, "CA1");
    await setCallStatus(db, "CA1", "completed", { dialStatus: "completed", talkSeconds: 90 });
    await finishCall(db, "CA1", { endedAt: new Date("2026-09-02T21:00:00Z"), totalSeconds: 112 });
    const c = await getCall(db, "CA1");
    expect(c).toMatchObject({ accepted: true, status: "completed", dialStatus: "completed", talkSeconds: 90, totalSeconds: 112 });
    expect(c?.endedAt?.toISOString()).toBe("2026-09-02T21:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/calls.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/db/repo/calls.ts**

```ts
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { calls, type Call, type CallStatus } from "@/db/schema";

export async function createCall(db: DB, o: { sid: string; from: string; to: string }): Promise<void> {
  await db
    .insert(calls)
    .values({ sid: o.sid, fromNumber: o.from, toNumber: o.to, status: "ringing" })
    .onConflictDoNothing();
}

export async function getCall(db: DB, sid: string): Promise<Call | null> {
  return (await db.query.calls.findFirst({ where: eq(calls.sid, sid) })) ?? null;
}

export async function markAccepted(db: DB, sid: string): Promise<void> {
  await db.update(calls).set({ accepted: true }).where(eq(calls.sid, sid));
}

export async function setCallStatus(
  db: DB,
  sid: string,
  status: CallStatus,
  extra: { dialStatus?: string; talkSeconds?: number } = {},
): Promise<void> {
  await db.update(calls).set({ status, ...extra }).where(eq(calls.sid, sid));
}

export async function finishCall(db: DB, sid: string, o: { endedAt: Date; totalSeconds: number }): Promise<void> {
  await db.update(calls).set({ endedAt: o.endedAt, totalSeconds: o.totalSeconds }).where(eq(calls.sid, sid));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/calls.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Create tests/helpers/handlers.ts**

Vitest hoists `vi.mock`, so the mock declarations must live in each test file. This helper centralizes the factories so every test file is two lines of setup.

```ts
import { vi } from "vitest";
import { createTestDb } from "./db";
import { TEST_ENV } from "./twilio";
import type { DB } from "@/db";

/**
 * Usage at the top of a handler test file:
 *
 *   vi.mock("@/db", () => dbMockFactory());
 *   vi.mock("@/lib/env", () => envMockFactory());
 *   vi.mock("next/server", () => nextServerMockFactory());
 *   const { db } = await handlerTestContext();
 */
export function dbMockFactory() {
  return { db: createTestDb() };
}

export async function envMockFactory() {
  const mod = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
}

/** `after()` runs its callback immediately in tests so background work is awaited by the test. */
export const afterCalls: Promise<unknown>[] = [];
export function nextServerMockFactory() {
  return {
    after: (fn: () => unknown) => {
      afterCalls.push(Promise.resolve().then(fn));
    },
  };
}

export async function flushAfter(): Promise<void> {
  await Promise.allSettled(afterCalls.splice(0));
}

export async function handlerTestContext(): Promise<{ db: DB }> {
  const mod = await import("@/db");
  const db = await (mod.db as unknown as Promise<DB>);
  return { db };
}
```

Important: because `dbMockFactory` returns a Promise as `db`, route handlers must import `db` via a small accessor so the promise is awaited in tests but the real object is used in production. Create `src/db/get.ts`:

```ts
import { db, type DB } from "@/db";

/** In tests `db` may be a Promise (see tests/helpers/handlers.ts); in production it is the client. */
export async function getDb(): Promise<DB> {
  return await (db as unknown as DB | Promise<DB>);
}
```

All route handlers, actions, and pages use `const db = await getDb();`.

- [ ] **Step 6: Write failing voice-flow handler tests**

`tests/api/voice.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext } from "../helpers/handlers";
import { signedRequest, voiceParams } from "../helpers/twilio";
import { upsertContact } from "@/db/repo/contacts";
import { setForwardingEnabled } from "@/db/repo/settings";
import { getCall } from "@/db/repo/calls";
import { calls } from "@/db/schema";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());

const { db } = await handlerTestContext();
const { POST: voice } = await import("@/app/api/twilio/voice/route");
const { POST: whisper } = await import("@/app/api/twilio/whisper/route");
const { POST: whisperResult } = await import("@/app/api/twilio/whisper-result/route");

beforeEach(async () => {
  await db.delete(calls);
  await setForwardingEnabled(db, true);
});

describe("POST /api/twilio/voice", () => {
  it("rejects bad signatures without writing", async () => {
    const res = await voice(signedRequest("/api/twilio/voice", voiceParams(), { tamper: true }));
    expect(res.status).toBe(403);
    expect(await getCall(db, voiceParams().CallSid)).toBeNull();
  });

  it("creates a ringing call and dials the cell with the caller's number as caller id", async () => {
    const res = await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const xml = await res.text();
    expect(res.status).toBe(200);
    expect(xml).toContain('callerId="+14155550199"');
    expect(xml).toContain(">+14155550100</Number>");
    expect(xml).toContain("/api/twilio/whisper?callSid=CA0000000000000000000000000000001");
    expect((await getCall(db, voiceParams().CallSid))?.status).toBe("ringing");
  });

  it("falls back to the Twilio number as caller id when From is withheld", async () => {
    const res = await voice(signedRequest("/api/twilio/voice", voiceParams({ From: "anonymous" })));
    expect(await res.text()).toContain('callerId="+14158438558"');
    expect((await getCall(db, voiceParams().CallSid))?.fromNumber).toBe("anonymous");
  });

  it("goes straight to voicemail when forwarding is off", async () => {
    await setForwardingEnabled(db, false);
    const res = await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const xml = await res.text();
    expect(xml).toContain("You've reached THE VLKU");
    expect(xml).not.toContain("<Dial");
    expect((await getCall(db, voiceParams().CallSid))?.status).toBe("voicemail_pending");
  });
});

describe("POST /api/twilio/whisper", () => {
  it("speaks the contact name when known", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams()));
    await upsertContact(db, { phone: "+14155550199", name: "Jane Doe" });
    const res = await whisper(
      signedRequest("/api/twilio/whisper?callSid=CA0000000000000000000000000000001", { CallSid: "CAchild", From: "+14158438558" }),
    );
    const xml = await res.text();
    expect(xml).toContain("Call for THE VLKU from Jane Doe. Press 1 to accept.");
    expect(xml).toContain("/api/twilio/whisper-result?callSid=CA0000000000000000000000000000001");
  });

  it("reads digits when unknown", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const res = await whisper(
      signedRequest("/api/twilio/whisper?callSid=CA0000000000000000000000000000001", { CallSid: "CAchild" }),
    );
    expect(await res.text()).toContain("from 4 1 5, 5 5 5, 0 1 9 9. Press 1");
  });

  it("says unknown caller when the number was withheld", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams({ From: "anonymous" })));
    const res = await whisper(
      signedRequest("/api/twilio/whisper?callSid=CA0000000000000000000000000000001", { CallSid: "CAchild" }),
    );
    expect(await res.text()).toContain("from an unknown number. Press 1");
  });
});

describe("POST /api/twilio/whisper-result", () => {
  it("accepts on 1 and marks the call accepted", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const res = await whisperResult(
      signedRequest("/api/twilio/whisper-result?callSid=CA0000000000000000000000000000001", { Digits: "1", CallSid: "CAchild" }),
    );
    expect(await res.text()).toContain("<Response></Response>");
    expect((await getCall(db, voiceParams().CallSid))?.accepted).toBe(true);
  });

  it("hangs up the cell leg on any other digit", async () => {
    await voice(signedRequest("/api/twilio/voice", voiceParams()));
    const res = await whisperResult(
      signedRequest("/api/twilio/whisper-result?callSid=CA0000000000000000000000000000001", { Digits: "2", CallSid: "CAchild" }),
    );
    expect(await res.text()).toContain("<Hangup/>");
    expect((await getCall(db, voiceParams().CallSid))?.accepted).toBe(false);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run tests/api/voice.test.ts`
Expected: FAIL, route modules not found.

- [ ] **Step 8: Implement src/app/api/twilio/voice/route.ts**

```ts
import { getDb } from "@/db/get";
import { getEnv } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { dialTwiml, voicemailTwiml, errorTwiml } from "@/lib/twilio/twiml";
import { createCall, setCallStatus } from "@/db/repo/calls";
import { getForwardingEnabled } from "@/db/repo/settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, From, To } = hook.params;
  try {
    const env = getEnv();
    const db = await getDb();
    await createCall(db, { sid: CallSid, from: From ?? "", to: To ?? env.TWILIO_NUMBER });

    if (!(await getForwardingEnabled(db))) {
      await setCallStatus(db, CallSid, "voicemail_pending", { dialStatus: "forwarding_off" });
      return twiml(voicemailTwiml({ baseUrl: env.PUBLIC_BASE_URL }));
    }

    const callerId = normalizePhone(From) ?? env.TWILIO_NUMBER;
    return twiml(dialTwiml({ callSid: CallSid, callerId, cellNumber: env.CELL_NUMBER, baseUrl: env.PUBLIC_BASE_URL }));
  } catch (err) {
    console.error("voice webhook failed", { CallSid, err });
    return twiml(errorTwiml());
  }
}
```

- [ ] **Step 9: Implement src/app/api/twilio/whisper/route.ts**

```ts
import { getDb } from "@/db/get";
import { getEnv } from "@/lib/env";
import { normalizePhone, spokenDigits } from "@/lib/phone";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { whisperTwiml, hangupTwiml } from "@/lib/twilio/twiml";
import { getCall } from "@/db/repo/calls";
import { getContact } from "@/db/repo/contacts";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const callSid = new URL(hook.url).searchParams.get("callSid") ?? "";
  try {
    const env = getEnv();
    const db = await getDb();
    const call = await getCall(db, callSid);
    if (!call) return twiml(hangupTwiml());
    const phone = normalizePhone(call.fromNumber);
    const contact = phone ? await getContact(db, phone) : null;
    const displayName = contact?.name?.trim() || (phone ? spokenDigits(phone) : "an unknown number");
    return twiml(whisperTwiml({ callSid, displayName, baseUrl: env.PUBLIC_BASE_URL }));
  } catch (err) {
    console.error("whisper webhook failed", { callSid, err });
    return twiml(hangupTwiml());
  }
}
```

- [ ] **Step 10: Implement src/app/api/twilio/whisper-result/route.ts**

```ts
import { getDb } from "@/db/get";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { acceptTwiml, hangupTwiml } from "@/lib/twilio/twiml";
import { markAccepted } from "@/db/repo/calls";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const callSid = new URL(hook.url).searchParams.get("callSid") ?? "";
  if (hook.params.Digits !== "1") return twiml(hangupTwiml());
  try {
    const db = await getDb();
    await markAccepted(db, callSid);
  } catch (err) {
    // Still bridge the call; losing the accepted flag is better than dropping Nick's answer.
    console.error("whisper-result failed to mark accepted", { callSid, err });
  }
  return twiml(acceptTwiml());
}
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `npx vitest run tests/api/voice.test.ts`
Expected: 9 passed.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "Add voice, whisper, and whisper-result webhooks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 8: Dial-status, record-done, and call status handlers

**Files:**
- Create: `src/app/api/twilio/dial-status/route.ts`, `src/app/api/twilio/record-done/route.ts`, `src/app/api/twilio/status/route.ts`
- Test: `tests/api/dial-status.test.ts`

**Interfaces:**
- Consumes: `setCallStatus`, `finishCall`, `getCall` from Task 7; `voicemailTwiml`, `hangupTwiml` from Task 5; `deleteRecording` from Task 6.

- [ ] **Step 1: Write failing tests**

`tests/api/dial-status.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext, flushAfter } from "../helpers/handlers";
import { signedRequest, voiceParams } from "../helpers/twilio";
import { createCall, getCall, markAccepted } from "@/db/repo/calls";
import { calls } from "@/db/schema";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());
const deleteRecording = vi.fn(async () => {});
vi.mock("@/lib/twilio/rest", () => ({ deleteRecording: (sid: string) => deleteRecording(sid) }));

const { db } = await handlerTestContext();
const { POST: dialStatus } = await import("@/app/api/twilio/dial-status/route");
const { POST: recordDone } = await import("@/app/api/twilio/record-done/route");
const { POST: status } = await import("@/app/api/twilio/status/route");

const SID = voiceParams().CallSid;
beforeEach(async () => {
  await db.delete(calls);
  await createCall(db, { sid: SID, from: "+14155550199", to: "+14158438558" });
  deleteRecording.mockClear();
});

describe("POST /api/twilio/dial-status", () => {
  it("completes an accepted call with talk seconds", async () => {
    await markAccepted(db, SID);
    const res = await dialStatus(
      signedRequest("/api/twilio/dial-status", voiceParams({ DialCallStatus: "completed", DialCallDuration: "95" })),
    );
    expect(await res.text()).toContain("<Hangup/>");
    expect(await getCall(db, SID)).toMatchObject({ status: "completed", talkSeconds: 95, dialStatus: "completed" });
  });

  it("goes to voicemail when completed but never accepted (hung up during whisper)", async () => {
    const res = await dialStatus(
      signedRequest("/api/twilio/dial-status", voiceParams({ DialCallStatus: "completed", DialCallDuration: "4" })),
    );
    expect(await res.text()).toContain("<Record");
    expect((await getCall(db, SID))?.status).toBe("voicemail_pending");
  });

  it.each(["no-answer", "busy", "failed"])("goes to voicemail on %s", async (s) => {
    const res = await dialStatus(signedRequest("/api/twilio/dial-status", voiceParams({ DialCallStatus: s })));
    expect(await res.text()).toContain("You've reached THE VLKU");
    expect(await getCall(db, SID)).toMatchObject({ status: "voicemail_pending", dialStatus: s });
  });

  it("marks missed on canceled", async () => {
    const res = await dialStatus(signedRequest("/api/twilio/dial-status", voiceParams({ DialCallStatus: "canceled" })));
    expect(await res.text()).toContain("<Hangup/>");
    expect((await getCall(db, SID))?.status).toBe("missed");
  });
});

describe("POST /api/twilio/record-done", () => {
  it("marks voicemail when a real message was left", async () => {
    const res = await recordDone(
      signedRequest("/api/twilio/record-done", voiceParams({ RecordingSid: "RE1", RecordingDuration: "42" })),
    );
    expect(await res.text()).toContain("<Hangup/>");
    expect((await getCall(db, SID))?.status).toBe("voicemail");
    expect(deleteRecording).not.toHaveBeenCalled();
  });

  it("marks missed and deletes the recording when under 2 seconds", async () => {
    await recordDone(signedRequest("/api/twilio/record-done", voiceParams({ RecordingSid: "RE1", RecordingDuration: "1" })));
    await flushAfter();
    expect((await getCall(db, SID))?.status).toBe("missed");
    expect(deleteRecording).toHaveBeenCalledWith("RE1");
  });
});

describe("POST /api/twilio/status", () => {
  it("records end time and total duration", async () => {
    const res = await status(
      signedRequest("/api/twilio/status", voiceParams({ CallStatus: "completed", CallDuration: "68", Timestamp: "Wed, 02 Sep 2026 21:14:00 +0000" })),
    );
    expect(res.status).toBe(200);
    const c = await getCall(db, SID);
    expect(c?.totalSeconds).toBe(68);
    expect(c?.endedAt).toBeInstanceOf(Date);
  });

  it("turns a still-ringing call into missed (caller hung up before dial action)", async () => {
    await status(signedRequest("/api/twilio/status", voiceParams({ CallStatus: "completed", CallDuration: "8" })));
    expect((await getCall(db, SID))?.status).toBe("missed");
  });

  it("ignores non-completed statuses", async () => {
    await status(signedRequest("/api/twilio/status", voiceParams({ CallStatus: "in-progress" })));
    expect((await getCall(db, SID))?.totalSeconds).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/dial-status.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/app/api/twilio/dial-status/route.ts**

```ts
import { getDb } from "@/db/get";
import { getEnv } from "@/lib/env";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { voicemailTwiml, hangupTwiml, errorTwiml } from "@/lib/twilio/twiml";
import { getCall, setCallStatus } from "@/db/repo/calls";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, DialCallStatus, DialCallDuration } = hook.params;
  try {
    const env = getEnv();
    const db = await getDb();
    const call = await getCall(db, CallSid);

    if (DialCallStatus === "completed" && call?.accepted) {
      await setCallStatus(db, CallSid, "completed", {
        dialStatus: DialCallStatus,
        talkSeconds: Number.parseInt(DialCallDuration ?? "0", 10) || 0,
      });
      return twiml(hangupTwiml());
    }
    if (DialCallStatus === "canceled") {
      await setCallStatus(db, CallSid, "missed", { dialStatus: DialCallStatus });
      return twiml(hangupTwiml());
    }
    await setCallStatus(db, CallSid, "voicemail_pending", { dialStatus: DialCallStatus ?? "unknown" });
    return twiml(voicemailTwiml({ baseUrl: env.PUBLIC_BASE_URL }));
  } catch (err) {
    console.error("dial-status webhook failed", { CallSid, err });
    return twiml(errorTwiml());
  }
}
```

- [ ] **Step 4: Implement src/app/api/twilio/record-done/route.ts**

```ts
import { after } from "next/server";
import { getDb } from "@/db/get";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { hangupTwiml } from "@/lib/twilio/twiml";
import { setCallStatus } from "@/db/repo/calls";
import { deleteRecording } from "@/lib/twilio/rest";

export const dynamic = "force-dynamic";
const MIN_MESSAGE_SECONDS = 2;

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, RecordingSid, RecordingDuration } = hook.params;
  try {
    const db = await getDb();
    const seconds = Number.parseInt(RecordingDuration ?? "0", 10) || 0;
    if (seconds < MIN_MESSAGE_SECONDS) {
      await setCallStatus(db, CallSid, "missed");
      if (RecordingSid) {
        after(async () => {
          try {
            await deleteRecording(RecordingSid);
          } catch (err) {
            console.error("failed to delete empty recording", { RecordingSid, err });
          }
        });
      }
    } else {
      await setCallStatus(db, CallSid, "voicemail");
    }
  } catch (err) {
    console.error("record-done webhook failed", { CallSid, err });
  }
  return twiml(hangupTwiml());
}
```

- [ ] **Step 5: Implement src/app/api/twilio/status/route.ts**

```ts
import { getDb } from "@/db/get";
import { readWebhook } from "@/lib/twilio/webhook";
import { getCall, setCallStatus, finishCall } from "@/db/repo/calls";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, CallStatus, CallDuration, Timestamp } = hook.params;
  if (CallStatus !== "completed") return new Response(null, { status: 204 });
  try {
    const db = await getDb();
    const call = await getCall(db, CallSid);
    if (!call) return new Response(null, { status: 204 });
    const endedAt = Timestamp && !Number.isNaN(Date.parse(Timestamp)) ? new Date(Timestamp) : new Date();
    await finishCall(db, CallSid, { endedAt, totalSeconds: Number.parseInt(CallDuration ?? "0", 10) || 0 });
    if (call.status === "ringing") await setCallStatus(db, CallSid, "missed", { dialStatus: "caller_hung_up" });
  } catch (err) {
    console.error("status webhook failed", { CallSid, err });
  }
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/api/dial-status.test.ts`
Expected: 10 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add dial-status, record-done, and call status webhooks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---
### Task 9: Voicemails repo, Whisper transcription, notification text

**Files:**
- Create: `src/db/repo/voicemails.ts`, `src/lib/transcription.ts`, `src/lib/notify.ts`
- Test: `tests/db/voicemails.test.ts`, `tests/transcription.test.ts`, `tests/notify.test.ts`

**Interfaces:**
- Produces from `@/db/repo/voicemails`: `claimVoicemail(db, {recordingSid, callSid, durationSeconds}): Promise<"claimed" | "already_handled">` (inserts pending or returns already_handled when status is in_progress/done), `setTranscriptionStatus(db, recordingSid, status, extra?: {transcript?, error?})`, `setNotified(db, recordingSid)`, `markListened(db, recordingSid)`, `getVoicemail(db, recordingSid)`, `getVoicemailByCall(db, callSid)`.
- Produces `transcribe(audio: Blob, filename: string): Promise<string>` from `@/lib/transcription`.
- Produces from `@/lib/notify`: `composeVoicemailSms({ displayName, durationSeconds, transcript, callSid, baseUrl }): string`, `composeTextRelay({ displayName, body, mediaCount }): string`, `notifyVoicemail(...)` and `relayText(...)` which call `sendSms` with one retry after 30 s.

- [ ] **Step 1: Write failing voicemails repo test**

`tests/db/voicemails.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { DB } from "@/db";
import { createCall } from "@/db/repo/calls";
import { claimVoicemail, setTranscriptionStatus, getVoicemail, markListened } from "@/db/repo/voicemails";

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
  await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
});

describe("voicemails repo", () => {
  it("claims a new recording once", async () => {
    expect(await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 })).toBe("claimed");
    await setTranscriptionStatus(db, "RE1", "in_progress");
    expect(await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 })).toBe("already_handled");
  });

  it("lets a failed transcription be claimed again for retry", async () => {
    await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 });
    await setTranscriptionStatus(db, "RE1", "failed", { error: "boom" });
    expect(await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 })).toBe("claimed");
    expect((await getVoicemail(db, "RE1"))?.transcriptionStatus).toBe("pending");
  });

  it("stores transcript and listened time", async () => {
    await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 });
    await setTranscriptionStatus(db, "RE1", "done", { transcript: "hello" });
    await markListened(db, "RE1");
    const vm = await getVoicemail(db, "RE1");
    expect(vm?.transcript).toBe("hello");
    expect(vm?.listenedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/voicemails.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/db/repo/voicemails.ts**

```ts
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { voicemails, type Voicemail, type TranscriptionStatus } from "@/db/schema";

/** Insert as pending, or reset a failed row to pending. Returns already_handled when work is in flight or done. */
export async function claimVoicemail(
  db: DB,
  o: { recordingSid: string; callSid: string; durationSeconds: number },
): Promise<"claimed" | "already_handled"> {
  const rows = await db
    .insert(voicemails)
    .values({ recordingSid: o.recordingSid, callSid: o.callSid, durationSeconds: o.durationSeconds })
    .onConflictDoUpdate({
      target: voicemails.recordingSid,
      set: { transcriptionStatus: "pending", transcriptionError: null },
      setWhere: sql`${voicemails.transcriptionStatus} = 'failed'`,
    })
    .returning({ sid: voicemails.recordingSid });
  return rows.length > 0 ? "claimed" : "already_handled";
}

export async function setTranscriptionStatus(
  db: DB,
  recordingSid: string,
  status: TranscriptionStatus,
  extra: { transcript?: string; error?: string } = {},
): Promise<void> {
  await db
    .update(voicemails)
    .set({
      transcriptionStatus: status,
      ...(extra.transcript !== undefined ? { transcript: extra.transcript } : {}),
      transcriptionError: extra.error ?? null,
    })
    .where(eq(voicemails.recordingSid, recordingSid));
}

export async function setNotified(db: DB, recordingSid: string): Promise<void> {
  await db.update(voicemails).set({ notifiedAt: new Date() }).where(eq(voicemails.recordingSid, recordingSid));
}

export async function markListened(db: DB, recordingSid: string): Promise<void> {
  await db
    .update(voicemails)
    .set({ listenedAt: new Date() })
    .where(sql`${voicemails.recordingSid} = ${recordingSid} and ${voicemails.listenedAt} is null`);
}

export async function getVoicemail(db: DB, recordingSid: string): Promise<Voicemail | null> {
  return (await db.query.voicemails.findFirst({ where: eq(voicemails.recordingSid, recordingSid) })) ?? null;
}

export async function getVoicemailByCall(db: DB, callSid: string): Promise<Voicemail | null> {
  return (await db.query.voicemails.findFirst({ where: eq(voicemails.callSid, callSid) })) ?? null;
}
```

Note on `onConflictDoUpdate` with `setWhere`: when the conflict row does not satisfy `setWhere`, Postgres performs no update and `returning` yields zero rows. That is what makes the claim atomic.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/voicemails.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write failing transcription test**

`tests/transcription.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { TEST_ENV } from "./helpers/twilio";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});

const fetchMock = vi.fn();
let transcribe: typeof import("@/lib/transcription").transcribe;
beforeAll(async () => {
  vi.stubGlobal("fetch", fetchMock);
  ({ transcribe } = await import("@/lib/transcription"));
});
beforeEach(() => fetchMock.mockReset());

describe("transcribe", () => {
  it("posts multipart audio to Whisper and returns trimmed text", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: "  hello there " }), { status: 200 }));
    const text = await transcribe(new Blob(["abc"], { type: "audio/mpeg" }), "RE1.mp3");
    expect(text).toBe("hello there");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.headers.authorization).toBe("Bearer sk-test");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect((form.get("file") as File).name).toBe("RE1.mp3");
  });

  it("throws with status and body on failure", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(transcribe(new Blob(["abc"]), "x.mp3")).rejects.toThrow(/429.*rate limited/);
  });
});
```

- [ ] **Step 6: Implement src/lib/transcription.ts**

```ts
import { getEnv } from "@/lib/env";

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const env = getEnv();
  const form = new FormData();
  form.append("file", new File([audio], filename, { type: audio.type || "audio/mpeg" }));
  form.append("model", "whisper-1");
  form.append("response_format", "json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Whisper ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}
```

- [ ] **Step 7: Run transcription test**

Run: `npx vitest run tests/transcription.test.ts`
Expected: 2 passed.

- [ ] **Step 8: Write failing notify tests**

`tests/notify.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { TEST_ENV } from "./helpers/twilio";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});
const sendSms = vi.fn();
vi.mock("@/lib/twilio/rest", () => ({ sendSms: (o: unknown) => sendSms(o) }));

let notify: typeof import("@/lib/notify");
beforeAll(async () => {
  notify = await import("@/lib/notify");
});
beforeEach(() => {
  sendSms.mockReset();
  vi.useRealTimers();
});

describe("composeVoicemailSms", () => {
  const base = { displayName: "Dr. Patel's office", durationSeconds: 42, callSid: "CA1", baseUrl: "https://vlku.test" };

  it("includes name, duration, quoted transcript, and link", () => {
    const s = notify.composeVoicemailSms({ ...base, transcript: "Hi Nick, confirming Thursday." });
    expect(s).toBe(
      `[THE VLKU] Voicemail from Dr. Patel's office (0:42)\n"Hi Nick, confirming Thursday."\nhttps://vlku.test/calls/CA1`,
    );
  });

  it("truncates long transcripts to keep the whole message under 320 chars", () => {
    const s = notify.composeVoicemailSms({ ...base, transcript: "word ".repeat(200) });
    expect(s.length).toBeLessThanOrEqual(320);
    expect(s).toContain('..."');
    expect(s.endsWith("https://vlku.test/calls/CA1")).toBe(true);
  });

  it("explains when transcription failed", () => {
    const s = notify.composeVoicemailSms({ ...base, transcript: null });
    expect(s).toContain("Transcription unavailable, listen in the dashboard.");
  });
});

describe("composeTextRelay", () => {
  it("prefixes with the sender", () => {
    expect(notify.composeTextRelay({ displayName: "Sarah Kim", body: "still on?", mediaCount: 0 })).toBe("[THE VLKU] Sarah Kim: still on?");
  });
  it("notes attachments", () => {
    expect(notify.composeTextRelay({ displayName: "+1 (415) 555-0199", body: "", mediaCount: 2 })).toBe(
      "[THE VLKU] +1 (415) 555-0199: (2 attachments, see dashboard)",
    );
  });
});

describe("sendWithRetry", () => {
  it("retries once after 30 seconds then succeeds", async () => {
    vi.useFakeTimers();
    sendSms.mockRejectedValueOnce(new Error("Twilio 500")).mockResolvedValueOnce({ sid: "SM1" });
    const p = notify.sendWithRetry("hello");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBe(true);
    expect(sendSms).toHaveBeenCalledTimes(2);
    expect(sendSms).toHaveBeenCalledWith({ to: "+14155550100", body: "hello" });
  });

  it("returns false after the retry fails", async () => {
    vi.useFakeTimers();
    sendSms.mockRejectedValue(new Error("Twilio 500"));
    const p = notify.sendWithRetry("hello");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBe(false);
  });
});
```

- [ ] **Step 9: Implement src/lib/notify.ts**

```ts
import { getEnv } from "@/lib/env";
import { formatDuration } from "@/lib/format";
import { sendSms } from "@/lib/twilio/rest";

const MAX_SMS = 320;
const PREFIX = "[THE VLKU]";

export function composeVoicemailSms(o: {
  displayName: string;
  durationSeconds: number;
  transcript: string | null;
  callSid: string;
  baseUrl: string;
}): string {
  const head = `${PREFIX} Voicemail from ${o.displayName} (${formatDuration(o.durationSeconds)})`;
  const link = `${o.baseUrl}/calls/${o.callSid}`;
  if (!o.transcript) return `${head}\nTranscription unavailable, listen in the dashboard.\n${link}`;
  const budget = MAX_SMS - head.length - link.length - 2 /* newlines */ - 2 /* quotes */;
  let body = o.transcript.replace(/\s+/g, " ").trim();
  if (body.length > budget) body = body.slice(0, Math.max(0, budget - 3)).trimEnd() + "...";
  return `${head}\n"${body}"\n${link}`;
}

export function composeTextRelay(o: { displayName: string; body: string; mediaCount: number }): string {
  const parts: string[] = [];
  if (o.body.trim()) parts.push(o.body.trim());
  if (o.mediaCount > 0) parts.push(`(${o.mediaCount} attachment${o.mediaCount === 1 ? "" : "s"}, see dashboard)`);
  return `${PREFIX} ${o.displayName}: ${parts.join(" ")}`;
}

const RETRY_DELAY_MS = 30_000;

/** Sends to the cell. One retry after 30 s. Never throws; returns whether a send succeeded. */
export async function sendWithRetry(body: string): Promise<boolean> {
  const env = getEnv();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sendSms({ to: env.CELL_NUMBER, body });
      return true;
    } catch (err) {
      console.error("sms send failed", { attempt, err });
      if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  return false;
}
```

- [ ] **Step 10: Run notify tests**

Run: `npx vitest run tests/notify.test.ts`
Expected: 7 passed.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Add voicemail repo, Whisper client, and SMS notification composer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 10: Voicemail pipeline and the recording callback

**Files:**
- Create: `src/lib/voicemail-pipeline.ts`, `src/app/api/twilio/recording/route.ts`
- Test: `tests/voicemail-pipeline.test.ts`, `tests/api/recording.test.ts`

**Interfaces:**
- Produces `processVoicemail(db, recordingSid): Promise<void>` from `@/lib/voicemail-pipeline`. Assumes the row was just claimed. Sets in_progress, downloads, transcribes, saves, notifies, sets done or failed. Never throws.
- Produces `displayNameFor(db, rawFrom): Promise<string>` in `@/db/repo/contacts` (contact name, else `formatPhone`, else "Unknown number").

- [ ] **Step 1: Add displayNameFor to src/db/repo/contacts.ts**

Append:

```ts
import { normalizePhone, formatPhone } from "@/lib/phone";

export async function displayNameFor(db: DB, rawFrom: string): Promise<string> {
  const phone = normalizePhone(rawFrom);
  if (!phone) return "Unknown number";
  const c = await getContact(db, phone);
  return c?.name?.trim() || formatPhone(phone);
}
```

(Move the import to the top of the file.)

- [ ] **Step 2: Write failing pipeline test**

`tests/voicemail-pipeline.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "./helpers/db";
import { TEST_ENV } from "./helpers/twilio";
import type { DB } from "@/db";
import { createCall } from "@/db/repo/calls";
import { upsertContact } from "@/db/repo/contacts";
import { claimVoicemail, getVoicemail } from "@/db/repo/voicemails";

vi.mock("@/lib/env", async (orig) => {
  const mod = await orig<typeof import("@/lib/env")>();
  return { ...mod, getEnv: () => mod.loadEnv(TEST_ENV) };
});
const fetchRecording = vi.fn();
vi.mock("@/lib/twilio/rest", () => ({ fetchRecording: (sid: string) => fetchRecording(sid) }));
const transcribe = vi.fn();
vi.mock("@/lib/transcription", () => ({ transcribe: (b: Blob, f: string) => transcribe(b, f) }));
const sendWithRetry = vi.fn(async () => true);
vi.mock("@/lib/notify", async (orig) => {
  const mod = await orig<typeof import("@/lib/notify")>();
  return { ...mod, sendWithRetry: (b: string) => sendWithRetry(b) };
});

const { processVoicemail } = await import("@/lib/voicemail-pipeline");

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
  await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
  await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 });
  fetchRecording.mockReset();
  transcribe.mockReset();
  sendWithRetry.mockClear();
});

describe("processVoicemail", () => {
  it("downloads, transcribes, saves, and notifies with the contact name", async () => {
    await upsertContact(db, { phone: "+14155550199", name: "Dr. Patel's office" });
    fetchRecording.mockResolvedValue(new Response("mp3bytes", { status: 200, headers: { "content-type": "audio/mpeg" } }));
    transcribe.mockResolvedValue("Hi Nick, confirming Thursday.");
    await processVoicemail(db, "RE1");
    const vm = await getVoicemail(db, "RE1");
    expect(vm).toMatchObject({ transcriptionStatus: "done", transcript: "Hi Nick, confirming Thursday." });
    expect(vm?.notifiedAt).toBeInstanceOf(Date);
    expect(transcribe.mock.calls[0][1]).toBe("RE1.mp3");
    expect(sendWithRetry).toHaveBeenCalledWith(
      `[THE VLKU] Voicemail from Dr. Patel's office (0:42)\n"Hi Nick, confirming Thursday."\nhttps://vlku.test/calls/CA1`,
    );
  });

  it("marks failed but still notifies when Whisper fails", async () => {
    fetchRecording.mockResolvedValue(new Response("mp3bytes", { status: 200 }));
    transcribe.mockRejectedValue(new Error("Whisper 500: down"));
    await processVoicemail(db, "RE1");
    const vm = await getVoicemail(db, "RE1");
    expect(vm?.transcriptionStatus).toBe("failed");
    expect(vm?.transcriptionError).toMatch(/Whisper 500/);
    expect(sendWithRetry.mock.calls[0][0]).toContain("Transcription unavailable");
  });

  it("marks failed when the download fails, after retrying", async () => {
    fetchRecording.mockResolvedValue(new Response("nope", { status: 404 }));
    await processVoicemail(db, "RE1");
    expect(fetchRecording).toHaveBeenCalledTimes(3);
    expect((await getVoicemail(db, "RE1"))?.transcriptionStatus).toBe("failed");
  }, 15_000); // real backoff of 2 s + 5 s exceeds the default 5 s test timeout

  it("does not notify twice if run again after success", async () => {
    fetchRecording.mockResolvedValue(new Response("mp3bytes", { status: 200 }));
    transcribe.mockResolvedValue("hello");
    await processVoicemail(db, "RE1");
    await processVoicemail(db, "RE1");
    expect(sendWithRetry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/voicemail-pipeline.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement src/lib/voicemail-pipeline.ts**

```ts
import type { DB } from "@/db";
import { getEnv } from "@/lib/env";
import { fetchRecording } from "@/lib/twilio/rest";
import { transcribe } from "@/lib/transcription";
import { composeVoicemailSms, sendWithRetry } from "@/lib/notify";
import { getVoicemail, setTranscriptionStatus, setNotified } from "@/db/repo/voicemails";
import { getCall } from "@/db/repo/calls";
import { displayNameFor } from "@/db/repo/contacts";

const DOWNLOAD_ATTEMPTS = 3;
const BACKOFF_MS = [0, 2_000, 5_000];

async function downloadWithRetry(recordingSid: string): Promise<Blob> {
  let lastErr: unknown;
  for (let i = 0; i < DOWNLOAD_ATTEMPTS; i++) {
    if (BACKOFF_MS[i]) await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
    try {
      const res = await fetchRecording(recordingSid);
      if (res.ok) return await res.blob();
      lastErr = new Error(`recording download ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Runs the full post-recording pipeline. Safe to call after claimVoicemail returned "claimed". */
export async function processVoicemail(db: DB, recordingSid: string): Promise<void> {
  const env = getEnv();
  const vm = await getVoicemail(db, recordingSid);
  if (!vm) return;
  if (vm.transcriptionStatus === "done" || vm.transcriptionStatus === "in_progress") return;
  const call = await getCall(db, vm.callSid);
  if (!call) return;

  await setTranscriptionStatus(db, recordingSid, "in_progress");
  let transcript: string | null = null;
  try {
    const audio = await downloadWithRetry(recordingSid);
    transcript = await transcribe(audio, `${recordingSid}.mp3`);
    await setTranscriptionStatus(db, recordingSid, "done", { transcript });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("voicemail pipeline failed", { recordingSid, message });
    await setTranscriptionStatus(db, recordingSid, "failed", { error: message.slice(0, 500) });
  }

  if (!vm.notifiedAt) {
    const body = composeVoicemailSms({
      displayName: await displayNameFor(db, call.fromNumber),
      durationSeconds: vm.durationSeconds,
      transcript,
      callSid: call.sid,
      baseUrl: env.PUBLIC_BASE_URL,
    });
    if (await sendWithRetry(body)) await setNotified(db, recordingSid);
  }
}
```

- [ ] **Step 5: Run pipeline test**

Run: `npx vitest run tests/voicemail-pipeline.test.ts`
Expected: 4 passed. (The download-retry test waits about 7 seconds of real backoff; acceptable.)

- [ ] **Step 6: Write failing recording handler test**

`tests/api/recording.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext, flushAfter } from "../helpers/handlers";
import { signedRequest, voiceParams } from "../helpers/twilio";
import { createCall } from "@/db/repo/calls";
import { getVoicemail } from "@/db/repo/voicemails";
import { calls, voicemails } from "@/db/schema";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());
const processVoicemail = vi.fn(async () => {});
vi.mock("@/lib/voicemail-pipeline", () => ({ processVoicemail: (...a: unknown[]) => processVoicemail(...(a as [])) }));

const { db } = await handlerTestContext();
const { POST: recording } = await import("@/app/api/twilio/recording/route");

const SID = voiceParams().CallSid;
const params = (over: Record<string, string> = {}) => ({
  CallSid: SID, RecordingSid: "RE1", RecordingUrl: "https://api.twilio.com/x/RE1", RecordingDuration: "42", RecordingStatus: "completed", ...over,
});

beforeEach(async () => {
  await db.delete(voicemails);
  await db.delete(calls);
  await createCall(db, { sid: SID, from: "+14155550199", to: "+14158438558" });
  processVoicemail.mockClear();
});

describe("POST /api/twilio/recording", () => {
  it("creates the voicemail row and kicks off processing", async () => {
    const res = await recording(signedRequest("/api/twilio/recording", params()));
    expect(res.status).toBe(200);
    await flushAfter();
    expect((await getVoicemail(db, "RE1"))?.durationSeconds).toBe(42);
    expect(processVoicemail).toHaveBeenCalledTimes(1);
  });

  it("ignores retries once processing is in flight or done", async () => {
    await recording(signedRequest("/api/twilio/recording", params()));
    await flushAfter();
    await db.update(voicemails).set({ transcriptionStatus: "done" });
    await recording(signedRequest("/api/twilio/recording", params()));
    await flushAfter();
    expect(processVoicemail).toHaveBeenCalledTimes(1);
  });

  it("ignores non-completed statuses", async () => {
    await recording(signedRequest("/api/twilio/recording", params({ RecordingStatus: "in-progress" })));
    expect(await getVoicemail(db, "RE1")).toBeNull();
  });

  it("returns 200 without a row when the call is unknown", async () => {
    const res = await recording(signedRequest("/api/twilio/recording", params({ CallSid: "CAunknown" })));
    expect(res.status).toBe(200);
    expect(await getVoicemail(db, "RE1")).toBeNull();
  });
});
```

- [ ] **Step 7: Implement src/app/api/twilio/recording/route.ts**

```ts
import { after } from "next/server";
import { getDb } from "@/db/get";
import { readWebhook } from "@/lib/twilio/webhook";
import { getCall } from "@/db/repo/calls";
import { claimVoicemail } from "@/db/repo/voicemails";
import { processVoicemail } from "@/lib/voicemail-pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const { CallSid, RecordingSid, RecordingDuration, RecordingStatus } = hook.params;
  if (RecordingStatus !== "completed" || !RecordingSid) return new Response(null, { status: 200 });
  try {
    const db = await getDb();
    if (!(await getCall(db, CallSid))) {
      console.warn("recording for unknown call", { CallSid, RecordingSid });
      return new Response(null, { status: 200 });
    }
    const claim = await claimVoicemail(db, {
      recordingSid: RecordingSid,
      callSid: CallSid,
      durationSeconds: Number.parseInt(RecordingDuration ?? "0", 10) || 0,
    });
    if (claim === "claimed") {
      after(() => processVoicemail(db, RecordingSid));
    }
  } catch (err) {
    console.error("recording webhook failed", { CallSid, RecordingSid, err });
    return new Response(null, { status: 500 }); // Twilio retries on 5xx; the claim is idempotent
  }
  return new Response(null, { status: 200 });
}
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run tests/api/recording.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add voicemail pipeline and recording callback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 11: Messages repo and inbound SMS webhook

**Files:**
- Create: `src/db/repo/messages.ts`, `src/app/api/twilio/sms/route.ts`
- Test: `tests/api/sms.test.ts`

**Interfaces:**
- Produces from `@/db/repo/messages`: `insertMessage(db, {sid, from, body, media}): Promise<boolean>` (false when duplicate), `getMessage(db, sid)`, `setForwarded(db, sid)`, `markRead(db, sid)`.

- [ ] **Step 1: Write failing test**

`tests/api/sms.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext, flushAfter } from "../helpers/handlers";
import { signedRequest } from "../helpers/twilio";
import { upsertContact } from "@/db/repo/contacts";
import { getMessage } from "@/db/repo/messages";
import { messages } from "@/db/schema";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());
const sendWithRetry = vi.fn(async () => true);
vi.mock("@/lib/notify", async (orig) => {
  const mod = await orig<typeof import("@/lib/notify")>();
  return { ...mod, sendWithRetry: (b: string) => sendWithRetry(b) };
});

const { db } = await handlerTestContext();
const { POST: sms } = await import("@/app/api/twilio/sms/route");

const params = (over: Record<string, string> = {}) => ({
  MessageSid: "SM1", From: "+14155550199", To: "+14158438558", Body: "Are you still coming Saturday?", NumMedia: "0", ...over,
});

beforeEach(async () => {
  await db.delete(messages);
  sendWithRetry.mockClear();
});

describe("POST /api/twilio/sms", () => {
  it("stores the text, replies with empty TwiML, and relays to the cell", async () => {
    await upsertContact(db, { phone: "+14155550199", name: "Sarah Kim" });
    const res = await sms(signedRequest("/api/twilio/sms", params()));
    expect(await res.text()).toContain("<Response></Response>");
    await flushAfter();
    const m = await getMessage(db, "SM1");
    expect(m?.body).toBe("Are you still coming Saturday?");
    expect(m?.forwardedAt).toBeInstanceOf(Date);
    expect(sendWithRetry).toHaveBeenCalledWith("[THE VLKU] Sarah Kim: Are you still coming Saturday?");
  });

  it("stores media urls and mentions attachments in the relay", async () => {
    await sms(
      signedRequest("/api/twilio/sms", params({ Body: "", NumMedia: "1", MediaUrl0: "https://api.twilio.com/m/ME1", MediaContentType0: "image/jpeg" })),
    );
    await flushAfter();
    const m = await getMessage(db, "SM1");
    expect(m?.media).toEqual([{ url: "https://api.twilio.com/m/ME1", contentType: "image/jpeg" }]);
    expect(sendWithRetry).toHaveBeenCalledWith("[THE VLKU] +1 (415) 555-0199: (1 attachment, see dashboard)");
  });

  it("is idempotent on MessageSid", async () => {
    await sms(signedRequest("/api/twilio/sms", params()));
    await sms(signedRequest("/api/twilio/sms", params()));
    await flushAfter();
    expect(sendWithRetry).toHaveBeenCalledTimes(1);
  });

  it("rejects bad signatures", async () => {
    const res = await sms(signedRequest("/api/twilio/sms", params(), { tamper: true }));
    expect(res.status).toBe(403);
    expect(await getMessage(db, "SM1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/sms.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/db/repo/messages.ts**

```ts
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { messages, type Message, type MediaItem } from "@/db/schema";

export async function insertMessage(
  db: DB,
  o: { sid: string; from: string; body: string; media: MediaItem[] },
): Promise<boolean> {
  const rows = await db
    .insert(messages)
    .values({ sid: o.sid, fromNumber: o.from, body: o.body, media: o.media })
    .onConflictDoNothing()
    .returning({ sid: messages.sid });
  return rows.length > 0;
}

export async function getMessage(db: DB, sid: string): Promise<Message | null> {
  return (await db.query.messages.findFirst({ where: eq(messages.sid, sid) })) ?? null;
}

export async function setForwarded(db: DB, sid: string): Promise<void> {
  await db.update(messages).set({ forwardedAt: new Date() }).where(eq(messages.sid, sid));
}

export async function markRead(db: DB, sid: string): Promise<void> {
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(sql`${messages.sid} = ${sid} and ${messages.readAt} is null`);
}
```

- [ ] **Step 4: Implement src/app/api/twilio/sms/route.ts**

```ts
import { after } from "next/server";
import { getDb } from "@/db/get";
import { readWebhook, twiml } from "@/lib/twilio/webhook";
import { emptyTwiml } from "@/lib/twilio/twiml";
import { normalizePhone } from "@/lib/phone";
import { insertMessage, setForwarded } from "@/db/repo/messages";
import { displayNameFor } from "@/db/repo/contacts";
import { composeTextRelay, sendWithRetry } from "@/lib/notify";
import type { MediaItem } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const hook = await readWebhook(req);
  if (!hook.ok) return hook.response;
  const p = hook.params;
  const sid = p.MessageSid ?? p.SmsSid ?? "";
  try {
    const db = await getDb();
    const count = Number.parseInt(p.NumMedia ?? "0", 10) || 0;
    const media: MediaItem[] = [];
    for (let i = 0; i < count; i++) {
      const url = p[`MediaUrl${i}`];
      if (url) media.push({ url, contentType: p[`MediaContentType${i}`] ?? "application/octet-stream" });
    }
    const from = normalizePhone(p.From) ?? p.From ?? "";
    const inserted = await insertMessage(db, { sid, from, body: p.Body ?? "", media });
    if (inserted) {
      after(async () => {
        const body = composeTextRelay({
          displayName: await displayNameFor(db, from),
          body: p.Body ?? "",
          mediaCount: media.length,
        });
        if (await sendWithRetry(body)) await setForwarded(db, sid);
      });
    }
  } catch (err) {
    console.error("sms webhook failed", { sid, err });
  }
  return twiml(emptyTwiml());
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/api/sms.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add inbound SMS webhook with relay to cell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---
### Task 12: Session cookie and login page

**Files:**
- Create: `src/lib/session.ts`, `src/app/login/page.tsx`, `src/app/login/actions.ts`
- Test: `tests/session.test.ts`

**Interfaces:**
- Produces from `@/lib/session`: `createSessionToken(secret, now?): string`, `verifySessionToken(secret, token, now?): boolean`, `passwordMatches(expected, given): boolean`, `SESSION_COOKIE = "vlku_session"`, `SESSION_TTL_SECONDS = 30 * 24 * 3600`, `hasSession(): Promise<boolean>` (reads `cookies()` from `next/headers`), `requireSession(): Promise<void>` (redirects to `/login`).
- Produces server action `login(prevState, formData)` in `src/app/login/actions.ts`.

- [ ] **Step 1: Write failing test**

`tests/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken, passwordMatches } from "@/lib/session";

const secret = "0123456789abcdef0123456789abcdef";

describe("session tokens", () => {
  it("round-trips", () => {
    const t = createSessionToken(secret, new Date("2026-09-02T00:00:00Z"));
    expect(verifySessionToken(secret, t, new Date("2026-09-10T00:00:00Z"))).toBe(true);
  });
  it("expires after 30 days", () => {
    const t = createSessionToken(secret, new Date("2026-09-02T00:00:00Z"));
    expect(verifySessionToken(secret, t, new Date("2026-10-03T00:00:01Z"))).toBe(false);
  });
  it("rejects tampering and wrong secrets", () => {
    const t = createSessionToken(secret);
    expect(verifySessionToken(secret, t.replace(/.$/, "x"), new Date())).toBe(false);
    expect(verifySessionToken("another-secret-another-secret-12", t, new Date())).toBe(false);
    expect(verifySessionToken(secret, "garbage", new Date())).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("compares in constant time and handles length mismatch", () => {
    expect(passwordMatches("hunter2", "hunter2")).toBe(true);
    expect(passwordMatches("hunter2", "hunter")).toBe(false);
    expect(passwordMatches("hunter2", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/lib/session.ts**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";

export const SESSION_COOKIE = "vlku_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(secret: string, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${exp}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySessionToken(secret: string, token: string, now: Date = new Date()): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const [, expStr, sig] = parts;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp * 1000 < now.getTime()) return false;
  const expected = Buffer.from(sign(secret, `v1.${expStr}`));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function passwordMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hasSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return !!token && verifySessionToken(getEnv().SESSION_SECRET, token);
}

export async function requireSession(): Promise<void> {
  if (!(await hasSession())) redirect("/login");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/session.test.ts`
Expected: 4 passed. (Importing `next/headers` in Vitest works because the functions are only called at runtime.)

- [ ] **Step 5: Create src/app/login/actions.ts**

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const env = getEnv();
  const given = String(formData.get("password") ?? "");
  if (!passwordMatches(env.DASHBOARD_PASSWORD, given)) {
    await new Promise((r) => setTimeout(r, 500)); // slow down guessing
    return { error: "Wrong password." };
  }
  (await cookies()).set(SESSION_COOKIE, createSessionToken(env.SESSION_SECRET), {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
```

- [ ] **Step 6: Create src/app/login/page.tsx**

```tsx
"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form action={action} className="w-full max-w-sm surface p-6 flex flex-col gap-4">
        <div>
          <div className="wordmark">THE VLKU</div>
          <p className="muted text-sm mt-1">Sign in to the call dashboard.</p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="label">Password</span>
          <input name="password" type="password" autoFocus required className="input" />
        </label>
        {state.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
```

The `surface`, `wordmark`, `muted`, `label`, `input`, `btn-primary`, `text-danger` classes are defined in Task 14's `globals.css`. The page renders unstyled until then, which is fine.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add signed session cookie and login page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 13: Feed query

**Files:**
- Create: `src/db/repo/feed.ts`
- Test: `tests/db/feed.test.ts`

**Interfaces:**
- Produces:

```ts
export type FeedFilter = "all" | "voicemail" | "missed" | "text" | "answered";
export type FeedItem =
  | { kind: "call"; id: string; at: Date; call: Call; voicemail: Voicemail | null; contact: Contact | null; unread: boolean }
  | { kind: "text"; id: string; at: Date; message: Message; contact: Contact | null; unread: boolean };
export async function listFeed(db, o: { filter: FeedFilter; before?: Date; limit: number }): Promise<{ items: FeedItem[]; nextBefore: Date | null }>;
export async function getFeedItem(db, id: string): Promise<FeedItem | null>;   // id is a CallSid or MessageSid
export async function countUnread(db): Promise<number>;
export async function historyFor(db, phone: string): Promise<FeedItem[]>;
export function effectiveStatus(call: Call, now?: Date): CallStatus;             // stale ringing/voicemail_pending -> missed
```

- [ ] **Step 1: Write failing test**

`tests/db/feed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { DB } from "@/db";
import { calls, messages } from "@/db/schema";
import { upsertContact } from "@/db/repo/contacts";
import { claimVoicemail, setTranscriptionStatus, markListened } from "@/db/repo/voicemails";
import { markRead } from "@/db/repo/messages";
import { listFeed, getFeedItem, countUnread, historyFor, effectiveStatus } from "@/db/repo/feed";

let db: DB;
const t = (min: number) => new Date(Date.UTC(2026, 8, 2, 12, min));

beforeEach(async () => {
  db = await createTestDb();
  await upsertContact(db, { phone: "+14155550199", name: "Jane" });
  await db.insert(calls).values([
    { sid: "CA1", fromNumber: "+14155550199", toNumber: "+1", status: "completed", accepted: true, startedAt: t(0), talkSeconds: 90 },
    { sid: "CA2", fromNumber: "+16505550123", toNumber: "+1", status: "missed", startedAt: t(10) },
    { sid: "CA3", fromNumber: "+14155550199", toNumber: "+1", status: "voicemail", startedAt: t(20) },
  ]);
  await claimVoicemail(db, { recordingSid: "RE3", callSid: "CA3", durationSeconds: 42 });
  await setTranscriptionStatus(db, "RE3", "done", { transcript: "hi" });
  await db.insert(messages).values([
    { sid: "SM1", fromNumber: "+14155550199", body: "yo", receivedAt: t(5) },
    { sid: "SM2", fromNumber: "+16505550123", body: "hey", receivedAt: t(30) },
  ]);
});

describe("listFeed", () => {
  it("interleaves calls and texts newest first with contacts joined", async () => {
    const { items } = await listFeed(db, { filter: "all", limit: 10 });
    expect(items.map((i) => i.id)).toEqual(["SM2", "CA3", "CA2", "SM1", "CA1"]);
    expect(items[1].contact?.name).toBe("Jane");
    expect(items[1].kind === "call" && items[1].voicemail?.transcript).toBe("hi");
  });

  it("filters", async () => {
    expect((await listFeed(db, { filter: "voicemail", limit: 10 })).items.map((i) => i.id)).toEqual(["CA3"]);
    expect((await listFeed(db, { filter: "missed", limit: 10 })).items.map((i) => i.id)).toEqual(["CA2"]);
    expect((await listFeed(db, { filter: "text", limit: 10 })).items.map((i) => i.id)).toEqual(["SM2", "SM1"]);
    expect((await listFeed(db, { filter: "answered", limit: 10 })).items.map((i) => i.id)).toEqual(["CA1"]);
  });

  it("paginates with a before cursor", async () => {
    const page1 = await listFeed(db, { filter: "all", limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(["SM2", "CA3"]);
    expect(page1.nextBefore).toEqual(t(20));
    const page2 = await listFeed(db, { filter: "all", limit: 2, before: page1.nextBefore! });
    expect(page2.items.map((i) => i.id)).toEqual(["CA2", "SM1"]);
    const page3 = await listFeed(db, { filter: "all", limit: 2, before: page2.nextBefore! });
    expect(page3.items.map((i) => i.id)).toEqual(["CA1"]);
    expect(page3.nextBefore).toBeNull();
  });

  it("marks unread voicemails and texts", async () => {
    expect(await countUnread(db)).toBe(3); // RE3, SM1, SM2
    await markListened(db, "RE3");
    await markRead(db, "SM1");
    expect(await countUnread(db)).toBe(1);
    const { items } = await listFeed(db, { filter: "all", limit: 10 });
    expect(items.find((i) => i.id === "CA3")?.unread).toBe(false);
    expect(items.find((i) => i.id === "SM2")?.unread).toBe(true);
    expect(items.find((i) => i.id === "CA2")?.unread).toBe(false); // missed calls are never "unread"
  });
});

describe("getFeedItem and historyFor", () => {
  it("fetches by call or message sid", async () => {
    expect((await getFeedItem(db, "CA3"))?.kind).toBe("call");
    expect((await getFeedItem(db, "SM1"))?.kind).toBe("text");
    expect(await getFeedItem(db, "nope")).toBeNull();
  });
  it("lists one number's history newest first", async () => {
    expect((await historyFor(db, "+14155550199")).map((i) => i.id)).toEqual(["CA3", "SM1", "CA1"]);
  });
});

describe("effectiveStatus", () => {
  it("treats stale ringing as missed", () => {
    const call = { status: "ringing", startedAt: t(0) } as never;
    expect(effectiveStatus(call, t(5))).toBe("ringing");
    expect(effectiveStatus(call, t(20))).toBe("missed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/feed.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/db/repo/feed.ts**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/feed.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add interleaved feed query with filters and pagination

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 14: Dashboard shell, theme, feed page, detail pane, contact card, actions

**Files:**
- Create: `src/app/globals.css` (replace scaffold), `src/app/layout.tsx` (replace scaffold), `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/page.tsx`, `src/app/(dashboard)/actions.ts`, `src/components/Header.tsx`, `src/components/ForwardingToggle.tsx`, `src/components/FilterChips.tsx`, `src/components/FeedList.tsx`, `src/components/FeedRow.tsx`, `src/components/TypePill.tsx`, `src/components/DetailPane.tsx`, `src/components/CallDetail.tsx`, `src/components/MessageDetail.tsx`, `src/components/ContactCard.tsx`, `src/components/Poller.tsx`, `src/components/UnreadTitle.tsx`
- Delete: `src/app/page.tsx` (scaffold)
- Test: `tests/components/pill.test.ts` (pure helper), visual check with the dev server against seeded data (Task 17 provides the seed; until then, insert two rows by hand with `psql` or run this task's visual check after Task 17)

**Interfaces:**
- Consumes: `listFeed`, `getFeedItem`, `countUnread`, `effectiveStatus`, `FEED_FILTERS` (Task 13); `requireSession` (Task 12); `getForwardingEnabled`, `setForwardingEnabled` (Task 2); `upsertContact` (Task 2); `markRead` (Task 11); `claimVoicemail`, `getVoicemail` (Task 9); `processVoicemail` (Task 10); `formatDuration`, `formatTime`, `dayLabel` (Task 3); `formatPhone` (Task 3).
- Produces server actions in `src/app/(dashboard)/actions.ts`: `toggleForwarding(enabled: boolean)`, `saveContact(phone, name, notes)`, `retryTranscription(recordingSid)`.
- Produces `pillFor(item: FeedItem): { label: string; tone: "answered" | "voicemail" | "missed" | "text" | "pending" }` in `src/components/TypePill.tsx` (exported pure function, tested).

- [ ] **Step 1: Write failing pill helper test**

`tests/components/pill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pillFor } from "@/components/TypePill";
import type { FeedItem } from "@/db/repo/feed";

const call = (status: string, extra: Partial<FeedItem & { kind: "call" }> = {}): FeedItem =>
  ({ kind: "call", id: "CA", at: new Date(), unread: false, contact: null, voicemail: null,
     call: { sid: "CA", status, startedAt: new Date() }, ...extra }) as never;

describe("pillFor", () => {
  it("maps statuses to labels and tones", () => {
    expect(pillFor(call("completed"))).toEqual({ label: "Answered", tone: "answered" });
    expect(pillFor(call("voicemail"))).toEqual({ label: "Voicemail", tone: "voicemail" });
    expect(pillFor(call("voicemail_pending"))).toEqual({ label: "Recording", tone: "pending" });
    expect(pillFor(call("missed"))).toEqual({ label: "Missed", tone: "missed" });
    expect(pillFor(call("failed"))).toEqual({ label: "Failed", tone: "missed" });
    expect(pillFor(call("ringing"))).toEqual({ label: "Ringing", tone: "pending" });
    expect(pillFor({ kind: "text" } as never)).toEqual({ label: "Text", tone: "text" });
  });
  it("uses effective status so a stale ringing call shows Missed", () => {
    const stale = call("ringing");
    (stale as { call: { startedAt: Date } }).call.startedAt = new Date(Date.now() - 60 * 60_000);
    expect(pillFor(stale).label).toBe("Missed");
  });
});
```

- [ ] **Step 2: Implement src/components/TypePill.tsx**

```tsx
import type { FeedItem } from "@/db/repo/feed";
import { effectiveStatus } from "@/db/repo/feed";

export type PillTone = "answered" | "voicemail" | "missed" | "text" | "pending";

export function pillFor(item: FeedItem): { label: string; tone: PillTone } {
  if (item.kind === "text") return { label: "Text", tone: "text" };
  switch (effectiveStatus(item.call)) {
    case "completed": return { label: "Answered", tone: "answered" };
    case "voicemail": return { label: "Voicemail", tone: "voicemail" };
    case "voicemail_pending": return { label: "Recording", tone: "pending" };
    case "ringing": return { label: "Ringing", tone: "pending" };
    case "failed": return { label: "Failed", tone: "missed" };
    default: return { label: "Missed", tone: "missed" };
  }
}

export function TypePill({ item }: { item: FeedItem }) {
  const { label, tone } = pillFor(item);
  return <span className={`pill pill-${tone}`}>{label}</span>;
}
```

- [ ] **Step 3: Run pill test**

Run: `npx vitest run tests/components/pill.test.ts`
Expected: 2 passed.

- [ ] **Step 4: Replace src/app/globals.css with the theme**

```css
@import "tailwindcss";

:root {
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-2: #f2f4f8;
  --line: #e4e7ee;
  --line-strong: #cfd4de;
  --ink: #171b26;
  --muted: #6b7180;
  --accent: #3b5bdb;
  --accent-soft: rgba(59, 91, 219, 0.10);
  --accent-line: rgba(59, 91, 219, 0.40);
  --danger: #b42318;
  --shadow: 0 1px 2px rgba(11, 18, 32, 0.06), 0 1px 8px rgba(11, 18, 32, 0.04);

  --tone-answered: #137a3a; --tone-answered-bg: rgba(19, 122, 58, 0.12); --tone-answered-line: rgba(19, 122, 58, 0.40);
  --tone-voicemail: #b45309; --tone-voicemail-bg: rgba(180, 83, 9, 0.12); --tone-voicemail-line: rgba(180, 83, 9, 0.40);
  --tone-missed: #b42318; --tone-missed-bg: rgba(180, 35, 24, 0.12); --tone-missed-line: rgba(180, 35, 24, 0.40);
  --tone-text: #2f4fc4; --tone-text-bg: rgba(47, 79, 196, 0.12); --tone-text-line: rgba(47, 79, 196, 0.40);
  --tone-pending: #6b7180; --tone-pending-bg: rgba(107, 113, 128, 0.12); --tone-pending-line: rgba(107, 113, 128, 0.40);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1117;
    --surface: #161922;
    --surface-2: #1c2030;
    --line: #262b38;
    --line-strong: #353b4b;
    --ink: #e8eaf0;
    --muted: #8f96a6;
    --accent: #7b96ff;
    --accent-soft: rgba(123, 150, 255, 0.14);
    --accent-line: rgba(123, 150, 255, 0.45);
    --danger: #ff7b7b;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 10px rgba(0, 0, 0, 0.30);

    --tone-answered: #5ad38a; --tone-answered-bg: rgba(90, 211, 138, 0.14); --tone-answered-line: rgba(90, 211, 138, 0.40);
    --tone-voicemail: #ffb057; --tone-voicemail-bg: rgba(255, 176, 87, 0.14); --tone-voicemail-line: rgba(255, 176, 87, 0.40);
    --tone-missed: #ff8a80; --tone-missed-bg: rgba(255, 138, 128, 0.14); --tone-missed-line: rgba(255, 138, 128, 0.40);
    --tone-text: #9db4ff; --tone-text-bg: rgba(157, 180, 255, 0.14); --tone-text-line: rgba(157, 180, 255, 0.40);
    --tone-pending: #8f96a6; --tone-pending-bg: rgba(143, 150, 166, 0.14); --tone-pending-line: rgba(143, 150, 166, 0.40);
  }
}

html { color-scheme: light dark; }
body {
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.surface { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); }
.muted { color: var(--muted); }
.text-danger { color: var(--danger); }
.wordmark { font-weight: 700; letter-spacing: 0.13em; font-size: 13px; }
.label { font-size: 11px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; color: var(--muted); }
.num { font-variant-numeric: tabular-nums; }

.input, .textarea {
  width: 100%; background: var(--surface); color: var(--ink);
  border: 1px solid var(--line-strong); border-radius: 6px; padding: 7px 9px; font: inherit;
}
.input:focus, .textarea:focus { outline: 2px solid var(--accent-line); outline-offset: 1px; border-color: var(--accent); }
.textarea { min-height: 72px; resize: vertical; }

.btn { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
.btn:hover { background: var(--surface-2); }
.btn-primary { display: inline-flex; align-items: center; justify-content: center; height: 36px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.btn-primary:disabled { opacity: 0.6; cursor: default; }

.pill { display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 9px; font-size: 10px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; line-height: 1; border: 1px solid transparent; }
.pill-answered { color: var(--tone-answered); background: var(--tone-answered-bg); border-color: var(--tone-answered-line); }
.pill-voicemail { color: var(--tone-voicemail); background: var(--tone-voicemail-bg); border-color: var(--tone-voicemail-line); }
.pill-missed { color: var(--tone-missed); background: var(--tone-missed-bg); border-color: var(--tone-missed-line); }
.pill-text { color: var(--tone-text); background: var(--tone-text-bg); border-color: var(--tone-text-line); }
.pill-pending { color: var(--tone-pending); background: var(--tone-pending-bg); border-color: var(--tone-pending-line); }

.chip { display: inline-flex; align-items: center; height: 26px; padding: 0 11px; border-radius: 13px; border: 1px solid var(--line-strong); color: var(--muted); font-size: 12px; font-weight: 600; text-decoration: none; }
.chip:hover { background: var(--surface-2); color: var(--ink); }
.chip-on { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.chip-on:hover { background: var(--ink); color: var(--surface); }

.row { display: grid; grid-template-columns: 8px 1fr auto; gap: 12px; align-items: center; padding: 11px 14px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.row:hover { background: var(--surface-2); }
.row-selected { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.row-selected:hover { background: var(--accent-soft); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; }
.dot-unread { background: var(--accent); }

.day { padding: 6px 14px; background: var(--surface-2); border-bottom: 1px solid var(--line); font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); position: sticky; top: 0; }

.timeline { border-left: 2px solid var(--line); padding-left: 12px; display: flex; flex-direction: column; gap: 6px; }
.quote { background: var(--surface-2); border-radius: 8px; padding: 12px; white-space: pre-wrap; }

.switch { width: 34px; height: 20px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--surface-2); position: relative; cursor: pointer; padding: 0; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--muted); transition: transform 120ms ease; }
.switch-on { background: var(--tone-answered); border-color: var(--tone-answered); }
.switch-on::after { background: #fff; transform: translateX(14px); }
```

- [ ] **Step 5: Replace src/app/layout.tsx**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "THE VLKU", description: "Calls, voicemails, and texts for 415-THE-VLKU" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Delete `src/app/page.tsx` from the scaffold.

- [ ] **Step 6: Create src/app/(dashboard)/actions.ts**

```ts
"use server";

import { revalidatePath } from "next/cache";
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
  const claim = await claimVoicemail(db, { recordingSid, callSid: vm.callSid, durationSeconds: vm.durationSeconds });
  if (claim === "claimed") await processVoicemail(db, recordingSid);
  revalidatePath("/");
}
```

- [ ] **Step 7: Create src/app/(dashboard)/layout.tsx and Header**

`src/app/(dashboard)/layout.tsx`:

```tsx
import { requireSession } from "@/lib/session";
import { getDb } from "@/db/get";
import { getForwardingEnabled } from "@/db/repo/settings";
import { countUnread } from "@/db/repo/feed";
import { Header } from "@/components/Header";
import { Poller } from "@/components/Poller";
import { UnreadTitle } from "@/components/UnreadTitle";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const db = await getDb();
  const [forwarding, unread] = await Promise.all([getForwardingEnabled(db), countUnread(db)]);
  return (
    <div className="min-h-screen flex flex-col">
      <Header forwarding={forwarding} />
      <main className="flex-1 flex flex-col">{children}</main>
      <Poller intervalMs={30_000} />
      <UnreadTitle count={unread} />
    </div>
  );
}
```

`src/components/Header.tsx`:

```tsx
import Link from "next/link";
import { ForwardingToggle } from "./ForwardingToggle";
import { logout } from "@/app/login/actions";

export function Header({ forwarding }: { forwarding: boolean }) {
  return (
    <header className="flex items-center justify-between px-4 h-14 border-b" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
      <nav className="flex items-center gap-5">
        <Link href="/" className="wordmark">THE VLKU</Link>
        <Link href="/contacts" className="muted text-sm font-semibold hover:underline">Contacts</Link>
      </nav>
      <div className="flex items-center gap-4">
        <ForwardingToggle enabled={forwarding} />
        <form action={logout}><button className="muted text-sm hover:underline" type="submit">Sign out</button></form>
      </div>
    </header>
  );
}
```

`src/components/ForwardingToggle.tsx`:

```tsx
"use client";

import { useOptimistic, useTransition } from "react";
import { toggleForwarding } from "@/app/(dashboard)/actions";

export function ForwardingToggle({ enabled }: { enabled: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(enabled);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          await toggleForwarding(!optimistic);
        })
      }
      className="flex items-center gap-2 text-sm font-semibold"
    >
      <span className={optimistic ? "" : "muted"}>{optimistic ? "Forwarding on" : "Forwarding off"}</span>
      <span className={`switch ${optimistic ? "switch-on" : ""}`} aria-hidden />
    </button>
  );
}
```

- [ ] **Step 8: Create Poller and UnreadTitle**

`src/components/Poller.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function Poller({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);
  return null;
}
```

`src/components/UnreadTitle.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export function UnreadTitle({ count }: { count: number }) {
  useEffect(() => {
    document.title = count > 0 ? `(${count}) THE VLKU` : "THE VLKU";
  }, [count]);
  return null;
}
```

- [ ] **Step 9: Create the feed page**

`src/app/(dashboard)/page.tsx`:

```tsx
import { getDb } from "@/db/get";
import { listFeed, getFeedItem, FEED_FILTERS, type FeedFilter } from "@/db/repo/feed";
import { markRead } from "@/db/repo/messages";
import { FilterChips } from "@/components/FilterChips";
import { FeedList } from "@/components/FeedList";
import { DetailPane } from "@/components/DetailPane";

export const dynamic = "force-dynamic";
const PAGE = 50;

type Search = { filter?: string; item?: string; before?: string };

export default async function FeedPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filter = (FEED_FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as FeedFilter) : "all";
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined;
  const db = await getDb();
  const [{ items, nextBefore }, selected] = await Promise.all([
    listFeed(db, { filter, before, limit: PAGE }),
    sp.item ? getFeedItem(db, sp.item) : Promise.resolve(null),
  ]);
  if (selected?.kind === "text" && selected.unread) await markRead(db, selected.id);

  const showListOnMobile = !selected;
  return (
    <div className="flex-1 grid md:grid-cols-[minmax(320px,2fr)_3fr]" style={{ minHeight: 0 }}>
      <section className={`${showListOnMobile ? "flex" : "hidden md:flex"} flex-col border-r`} style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <FilterChips active={filter} />
        <FeedList items={items} selectedId={selected?.id ?? null} filter={filter} nextBefore={nextBefore} />
      </section>
      <section className={`${selected ? "flex" : "hidden md:flex"} flex-col`}>
        <DetailPane item={selected} filter={filter} />
      </section>
    </div>
  );
}
```

`src/components/FilterChips.tsx`:

```tsx
import Link from "next/link";
import { FEED_FILTERS, type FeedFilter } from "@/db/repo/feed";

const LABELS: Record<FeedFilter, string> = { all: "All", voicemail: "Voicemail", missed: "Missed", text: "Texts", answered: "Answered" };

export function FilterChips({ active }: { active: FeedFilter }) {
  return (
    <div className="flex gap-2 px-4 py-3 border-b overflow-x-auto" style={{ borderColor: "var(--line)" }}>
      {FEED_FILTERS.map((f) => (
        <Link key={f} href={f === "all" ? "/" : `/?filter=${f}`} className={`chip ${f === active ? "chip-on" : ""}`}>
          {LABELS[f]}
        </Link>
      ))}
    </div>
  );
}
```

`src/components/FeedList.tsx`:

```tsx
import Link from "next/link";
import type { FeedItem, FeedFilter } from "@/db/repo/feed";
import { dayLabel } from "@/lib/format";
import { FeedRow } from "./FeedRow";

export function FeedList({ items, selectedId, filter, nextBefore }: { items: FeedItem[]; selectedId: string | null; filter: FeedFilter; nextBefore: Date | null }) {
  if (items.length === 0) {
    return <p className="muted text-sm p-6 text-center">Nothing here yet.</p>;
  }
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  const filterQs = filter === "all" ? "" : `&filter=${filter}`;
  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="day">{g.label}</div>
          {g.items.map((item) => (
            <FeedRow key={item.id} item={item} selected={item.id === selectedId} href={`/?item=${item.id}${filterQs}`} />
          ))}
        </div>
      ))}
      {nextBefore && (
        <div className="p-4 text-center">
          <Link href={`/?before=${nextBefore.toISOString()}${filterQs}`} className="btn">Load more</Link>
        </div>
      )}
    </div>
  );
}
```

`src/components/FeedRow.tsx`:

```tsx
import Link from "next/link";
import type { FeedItem } from "@/db/repo/feed";
import { effectiveStatus } from "@/db/repo/feed";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { formatTime, formatDuration } from "@/lib/format";
import { TypePill } from "./TypePill";

export function displayName(item: FeedItem): string {
  const raw = item.kind === "call" ? item.call.fromNumber : item.message.fromNumber;
  const phone = normalizePhone(raw);
  return item.contact?.name?.trim() || (phone ? formatPhone(phone) : "Unknown number");
}

export function preview(item: FeedItem): string {
  if (item.kind === "text") {
    return item.message.body.trim() || `${item.message.media.length} attachment${item.message.media.length === 1 ? "" : "s"}`;
  }
  const status = effectiveStatus(item.call);
  if (item.voicemail?.transcript) return item.voicemail.transcript;
  if (item.voicemail?.transcriptionStatus === "failed") return "Transcription failed";
  if (item.voicemail) return "Transcribing…";
  if (status === "completed") return item.call.accepted ? "Accepted after whisper" : "Answered";
  if (status === "missed") return "No message left";
  if (status === "failed") return "Call failed";
  return "In progress";
}

export function durationLabel(item: FeedItem): string {
  if (item.kind === "text") return "";
  if (item.voicemail) return `${formatDuration(item.voicemail.durationSeconds)} msg`;
  if (item.call.talkSeconds != null) return `${formatDuration(item.call.talkSeconds)} call`;
  return "";
}

export function FeedRow({ item, selected, href }: { item: FeedItem; selected: boolean; href: string }) {
  return (
    <Link href={href} className={`row ${selected ? "row-selected" : ""}`} aria-current={selected ? "true" : undefined}>
      <span className={`dot ${item.unread ? "dot-unread" : ""}`} aria-label={item.unread ? "unread" : undefined} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">{displayName(item)}</span>
          <TypePill item={item} />
        </div>
        <div className="muted text-xs truncate mt-0.5">{preview(item)}</div>
      </div>
      <div className="text-right text-xs num">
        <div className="font-semibold">{formatTime(item.at)}</div>
        <div className="muted">{durationLabel(item) || "—"}</div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 10: Create the detail pane and its parts**

`src/components/DetailPane.tsx`:

```tsx
import Link from "next/link";
import type { FeedItem, FeedFilter } from "@/db/repo/feed";
import { CallDetail } from "./CallDetail";
import { MessageDetail } from "./MessageDetail";

export function DetailPane({ item, filter }: { item: FeedItem | null; filter: FeedFilter }) {
  if (!item) {
    return <div className="flex-1 flex items-center justify-center muted text-sm">Select a call or text.</div>;
  }
  const back = filter === "all" ? "/" : `/?filter=${filter}`;
  return (
    <div className="flex-1 overflow-y-auto p-5 md:p-6">
      <Link href={back} className="md:hidden muted text-sm inline-block mb-3">← Back</Link>
      {item.kind === "call" ? <CallDetail item={item} /> : <MessageDetail item={item} />}
    </div>
  );
}
```

`src/components/CallDetail.tsx`:

```tsx
import type { FeedItem } from "@/db/repo/feed";
import { effectiveStatus } from "@/db/repo/feed";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { formatDateTime, formatTime, formatDuration } from "@/lib/format";
import { retryTranscription } from "@/app/(dashboard)/actions";
import { ContactCard } from "./ContactCard";
import { TypePill } from "./TypePill";
import { displayName } from "./FeedRow";

export function CallDetail({ item }: { item: Extract<FeedItem, { kind: "call" }> }) {
  const { call, voicemail } = item;
  const phone = normalizePhone(call.fromNumber);
  const status = effectiveStatus(call);
  const answeredAt = call.accepted && call.talkSeconds != null && call.endedAt
    ? new Date(call.endedAt.getTime() - call.talkSeconds * 1000)
    : null;

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{displayName(item)}</h1>
          <TypePill item={item} />
        </div>
        <div className="muted text-sm mt-0.5 num">{phone ? formatPhone(phone) : "Unknown number"} · {formatDateTime(call.startedAt)}</div>
      </div>

      <section>
        <div className="label mb-2">Timeline</div>
        <div className="timeline text-sm">
          <div><span className="num font-semibold">{formatTime(call.startedAt)}</span> Incoming call</div>
          {answeredAt && <div><span className="num font-semibold">{formatTime(answeredAt)}</span> Accepted, talked {formatDuration(call.talkSeconds)}</div>}
          {!call.accepted && status !== "ringing" && <div className="muted">No answer{call.dialStatus ? ` (${call.dialStatus})` : ""}</div>}
          {voicemail && <div>Voicemail {formatDuration(voicemail.durationSeconds)}</div>}
          {call.endedAt && <div><span className="num font-semibold">{formatTime(call.endedAt)}</span> Ended · total {formatDuration(call.totalSeconds)}</div>}
        </div>
      </section>

      {voicemail && (
        <section className="surface p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="label">Voicemail · {formatDuration(voicemail.durationSeconds)}</div>
            {voicemail.transcriptionStatus === "failed" && (
              <form action={retryTranscription.bind(null, voicemail.recordingSid)}>
                <button className="btn" type="submit">Retry transcription</button>
              </form>
            )}
          </div>
          <audio controls preload="none" src={`/api/recordings/${voicemail.recordingSid}`} className="w-full" />
          {voicemail.transcript ? (
            <div className="quote">{voicemail.transcript}</div>
          ) : voicemail.transcriptionStatus === "failed" ? (
            <p className="text-sm text-danger">Transcription failed{voicemail.transcriptionError ? `: ${voicemail.transcriptionError}` : ""}.</p>
          ) : (
            <p className="muted text-sm">Transcribing…</p>
          )}
        </section>
      )}

      {phone && <ContactCard phone={phone} name={item.contact?.name ?? ""} notes={item.contact?.notes ?? ""} />}
    </div>
  );
}
```

`src/components/MessageDetail.tsx`:

```tsx
import type { FeedItem } from "@/db/repo/feed";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/format";
import { ContactCard } from "./ContactCard";
import { TypePill } from "./TypePill";
import { displayName } from "./FeedRow";

export function MessageDetail({ item }: { item: Extract<FeedItem, { kind: "text" }> }) {
  const { message } = item;
  const phone = normalizePhone(message.fromNumber);
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{displayName(item)}</h1>
          <TypePill item={item} />
        </div>
        <div className="muted text-sm mt-0.5 num">{phone ? formatPhone(phone) : message.fromNumber} · {formatDateTime(message.receivedAt)}</div>
      </div>
      {message.body && <div className="quote">{message.body}</div>}
      {message.media.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {message.media.map((m, i) =>
            m.contentType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={`/api/media/${message.sid}/${i}`} alt={`Attachment ${i + 1}`} className="max-w-xs rounded-lg border" style={{ borderColor: "var(--line)" }} />
            ) : (
              <a key={i} href={`/api/media/${message.sid}/${i}`} className="btn">Attachment {i + 1} ({m.contentType})</a>
            ),
          )}
        </div>
      )}
      {message.forwardedAt ? <p className="muted text-xs">Relayed to your cell.</p> : <p className="text-xs text-danger">Relay to your cell failed.</p>}
      {phone && <ContactCard phone={phone} name={item.contact?.name ?? ""} notes={item.contact?.notes ?? ""} />}
    </div>
  );
}
```

`src/components/ContactCard.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { saveContact } from "@/app/(dashboard)/actions";

export function ContactCard({ phone, name, notes }: { phone: string; name: string; notes: string }) {
  const [n, setN] = useState(name);
  const [t, setT] = useState(notes);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [, start] = useTransition();

  const save = () => {
    if (n === name && t === notes) return;
    setSaved("saving");
    start(async () => {
      await saveContact(phone, n, t);
      setSaved("saved");
      setTimeout(() => setSaved("idle"), 1500);
    });
  };

  return (
    <section className="surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="label">Contact</div>
        <div className="flex items-center gap-3">
          <span className="muted text-xs" aria-live="polite">{saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : ""}</span>
          <Link href={`/contacts/${encodeURIComponent(phone)}`} className="muted text-xs hover:underline">History</Link>
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="muted text-xs">Name</span>
        <input className="input" value={n} onChange={(e) => setN(e.target.value)} onBlur={save} placeholder="Add a name" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="muted text-xs">Notes</span>
        <textarea className="textarea" value={t} onChange={(e) => setT(e.target.value)} onBlur={save} placeholder="Anything worth remembering" />
      </label>
    </section>
  );
}
```

- [ ] **Step 11: Build and visually verify**

Run: `npm run lint && npm run build`
Expected: clean. Then, with a local Postgres and `.env.local` filled in (`DATABASE_URL=postgres://localhost/number_forwarder`, other vars can be dummies except `SESSION_SECRET` and `DASHBOARD_PASSWORD`), run `createdb number_forwarder && npm run db:migrate && npm run dev`, log in at http://localhost:3000/login, and confirm the empty state renders. Seeded data comes in Task 17; return to check the full feed, both themes (toggle macOS appearance), and the phone width (narrow the window under 768px) after that task. Check spacing, pill contrast in both themes, the selected row bar, and hover tints.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "Add dashboard shell, feed, detail pane, and contact editor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---
### Task 15: Recording and media proxies, SMS link redirect

**Files:**
- Create: `src/app/api/recordings/[sid]/route.ts`, `src/app/api/media/[sid]/[index]/route.ts`, `src/app/calls/[sid]/route.ts`
- Test: `tests/api/recordings.test.ts`

**Interfaces:**
- Consumes: `hasSession` (Task 12), `fetchRecording`, `fetchMedia` (Task 6), `getVoicemail`, `markListened` (Task 9), `getMessage` (Task 11).

- [ ] **Step 1: Write failing test**

`tests/api/recordings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockFactory, envMockFactory, nextServerMockFactory, handlerTestContext } from "../helpers/handlers";
import { createCall } from "@/db/repo/calls";
import { claimVoicemail, getVoicemail } from "@/db/repo/voicemails";
import { insertMessage } from "@/db/repo/messages";
import { calls, voicemails, messages } from "@/db/schema";

vi.mock("@/db", () => dbMockFactory());
vi.mock("@/lib/env", () => envMockFactory());
vi.mock("next/server", () => nextServerMockFactory());
const hasSession = vi.fn(async () => true);
vi.mock("@/lib/session", () => ({ hasSession: () => hasSession() }));
const fetchRecording = vi.fn();
const fetchMedia = vi.fn();
vi.mock("@/lib/twilio/rest", () => ({ fetchRecording: (s: string) => fetchRecording(s), fetchMedia: (u: string) => fetchMedia(u) }));

const { db } = await handlerTestContext();
const { GET: getRecording } = await import("@/app/api/recordings/[sid]/route");
const { GET: getMedia } = await import("@/app/api/media/[sid]/[index]/route");

beforeEach(async () => {
  await db.delete(voicemails);
  await db.delete(calls);
  await db.delete(messages);
  await createCall(db, { sid: "CA1", from: "+14155550199", to: "+14158438558" });
  await claimVoicemail(db, { recordingSid: "RE1", callSid: "CA1", durationSeconds: 42 });
  await insertMessage(db, { sid: "SM1", from: "+14155550199", body: "", media: [{ url: "https://api.twilio.com/m/ME1", contentType: "image/jpeg" }] });
  hasSession.mockResolvedValue(true);
  fetchRecording.mockReset();
  fetchMedia.mockReset();
});

const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

describe("GET /api/recordings/[sid]", () => {
  it("requires a session", async () => {
    hasSession.mockResolvedValue(false);
    const res = await getRecording(new Request("http://x/api/recordings/RE1"), params({ sid: "RE1" }));
    expect(res.status).toBe(401);
  });

  it("streams the mp3 and marks listened", async () => {
    fetchRecording.mockResolvedValue(new Response("mp3", { status: 200, headers: { "content-type": "audio/mpeg", "content-length": "3" } }));
    const res = await getRecording(new Request("http://x/api/recordings/RE1"), params({ sid: "RE1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(await res.text()).toBe("mp3");
    expect((await getVoicemail(db, "RE1"))?.listenedAt).toBeInstanceOf(Date);
  });

  it("404s for unknown recording without calling Twilio", async () => {
    const res = await getRecording(new Request("http://x/api/recordings/REnope"), params({ sid: "REnope" }));
    expect(res.status).toBe(404);
    expect(fetchRecording).not.toHaveBeenCalled();
  });
});

describe("GET /api/media/[sid]/[index]", () => {
  it("proxies the stored media url", async () => {
    fetchMedia.mockResolvedValue(new Response("jpg", { status: 200, headers: { "content-type": "image/jpeg" } }));
    const res = await getMedia(new Request("http://x/api/media/SM1/0"), params({ sid: "SM1", index: "0" }));
    expect(res.status).toBe(200);
    expect(fetchMedia).toHaveBeenCalledWith("https://api.twilio.com/m/ME1");
  });
  it("404s for an out-of-range index", async () => {
    const res = await getMedia(new Request("http://x/api/media/SM1/5"), params({ sid: "SM1", index: "5" }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/recordings.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/app/api/recordings/[sid]/route.ts**

```ts
import { getDb } from "@/db/get";
import { hasSession } from "@/lib/session";
import { fetchRecording } from "@/lib/twilio/rest";
import { getVoicemail, markListened } from "@/db/repo/voicemails";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ sid: string }> }): Promise<Response> {
  if (!(await hasSession())) return new Response("unauthorized", { status: 401 });
  const { sid } = await ctx.params;
  const db = await getDb();
  const vm = await getVoicemail(db, sid);
  if (!vm) return new Response("not found", { status: 404 });

  const upstream = await fetchRecording(sid);
  if (!upstream.ok) return new Response("recording unavailable", { status: 502 });
  await markListened(db, sid);

  const headers = new Headers({ "content-type": upstream.headers.get("content-type") ?? "audio/mpeg", "cache-control": "private, max-age=3600" });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  const range = req.headers.get("range");
  if (range) headers.set("accept-ranges", "bytes");
  return new Response(upstream.body, { status: 200, headers });
}
```

- [ ] **Step 4: Implement src/app/api/media/[sid]/[index]/route.ts**

```ts
import { getDb } from "@/db/get";
import { hasSession } from "@/lib/session";
import { fetchMedia } from "@/lib/twilio/rest";
import { getMessage } from "@/db/repo/messages";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ sid: string; index: string }> }): Promise<Response> {
  if (!(await hasSession())) return new Response("unauthorized", { status: 401 });
  const { sid, index } = await ctx.params;
  const i = Number.parseInt(index, 10);
  const msg = await getMessage(await getDb(), sid);
  const item = msg?.media[i];
  if (!item) return new Response("not found", { status: 404 });

  const upstream = await fetchMedia(item.url);
  if (!upstream.ok) return new Response("media unavailable", { status: 502 });
  return new Response(upstream.body, {
    status: 200,
    headers: { "content-type": upstream.headers.get("content-type") ?? item.contentType, "cache-control": "private, max-age=86400" },
  });
}
```

- [ ] **Step 5: Implement src/app/calls/[sid]/route.ts**

```ts
import { redirect } from "next/navigation";

export async function GET(_req: Request, ctx: { params: Promise<{ sid: string }> }) {
  const { sid } = await ctx.params;
  redirect(`/?item=${encodeURIComponent(sid)}`);
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/api/recordings.test.ts`
Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add authenticated recording and media proxies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 16: Contacts pages

**Files:**
- Create: `src/app/(dashboard)/contacts/page.tsx`, `src/app/(dashboard)/contacts/[phone]/page.tsx`

**Interfaces:**
- Consumes: `listContacts` (Task 2), `historyFor` (Task 13), `ContactCard`, `FeedRow` (Task 14), `formatPhone`, `normalizePhone` (Task 3).

- [ ] **Step 1: Create src/app/(dashboard)/contacts/page.tsx**

```tsx
import Link from "next/link";
import { getDb } from "@/db/get";
import { listContacts } from "@/db/repo/contacts";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const rows = await listContacts(await getDb());
  return (
    <div className="p-5 md:p-6 max-w-2xl w-full mx-auto flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Contacts</h1>
      {rows.length === 0 ? (
        <p className="muted text-sm">Name a caller from any call or text and they will show up here.</p>
      ) : (
        <div className="surface overflow-hidden">
          {rows.map((c) => (
            <Link key={c.phone} href={`/contacts/${encodeURIComponent(c.phone)}`} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
              <div className="min-w-0">
                <div className="font-semibold truncate">{c.name?.trim() || formatPhone(c.phone)}</div>
                <div className="muted text-xs truncate">{c.name ? formatPhone(c.phone) : ""}{c.notes ? (c.name ? " · " : "") + c.notes : ""}</div>
              </div>
              <span className="muted text-xs">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create src/app/(dashboard)/contacts/[phone]/page.tsx**

```tsx
import { notFound } from "next/navigation";
import { getDb } from "@/db/get";
import { getContact } from "@/db/repo/contacts";
import { historyFor } from "@/db/repo/feed";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { ContactCard } from "@/components/ContactCard";
import { FeedRow } from "@/components/FeedRow";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ phone: string }> }) {
  const phone = normalizePhone(decodeURIComponent((await params).phone));
  if (!phone) notFound();
  const db = await getDb();
  const [contact, history] = await Promise.all([getContact(db, phone), historyFor(db, phone)]);
  return (
    <div className="p-5 md:p-6 max-w-2xl w-full mx-auto flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">{contact?.name?.trim() || formatPhone(phone)}</h1>
        <div className="muted text-sm num">{formatPhone(phone)}</div>
      </div>
      <ContactCard phone={phone} name={contact?.name ?? ""} notes={contact?.notes ?? ""} />
      <section>
        <div className="label mb-2">History</div>
        {history.length === 0 ? (
          <p className="muted text-sm">No calls or texts yet.</p>
        ) : (
          <div className="surface overflow-hidden">
            {history.map((item) => (
              <FeedRow key={item.id} item={item} selected={false} href={`/?item=${item.id}`} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Build and check**

Run: `npm run lint && npm run build`
Expected: clean. In the dev server, name a contact from a detail pane, open Contacts, confirm the row and its history page.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add contacts list and per-number history pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 17: Migration runner, seed script, Twilio configuration script

**Files:**
- Create: `scripts/migrate.mjs`, `scripts/seed.ts`, `scripts/configure-twilio.ts`

**Interfaces:**
- Consumes: `updateNumberWebhooks` (Task 6), `loadEnv` (Task 1), schema tables (Task 2).

- [ ] **Step 1: Create scripts/migrate.mjs**

```js
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
} finally {
  await client.end();
}
```

Verify locally: `createdb number_forwarder 2>/dev/null; DATABASE_URL=postgres://localhost/number_forwarder npm run db:migrate` prints `migrations applied`.

- [ ] **Step 2: Create scripts/seed.ts**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function main() {
  await db.delete(schema.voicemails);
  await db.delete(schema.calls);
  await db.delete(schema.messages);
  await db.delete(schema.contacts);

  await db.insert(schema.contacts).values([
    { phone: "+14155550142", name: "Dr. Patel's office", notes: "Dentist. Front desk is Maria." },
    { phone: "+14155550177", name: "Sarah Kim" },
    { phone: "+14155550120", name: "Mom" },
  ]);

  await db.insert(schema.calls).values([
    { sid: "CAseed0001", fromNumber: "+14155550142", toNumber: "+14158438558", status: "voicemail", dialStatus: "no-answer", startedAt: minutesAgo(30), endedAt: minutesAgo(29), totalSeconds: 68 },
    { sid: "CAseed0002", fromNumber: "+14155550199", toNumber: "+14158438558", status: "missed", dialStatus: "no-answer", startedAt: minutesAgo(200), endedAt: minutesAgo(199), totalSeconds: 20 },
    { sid: "CAseed0003", fromNumber: "+14155550120", toNumber: "+14158438558", status: "completed", dialStatus: "completed", accepted: true, startedAt: minutesAgo(1500), endedAt: minutesAgo(1487), talkSeconds: 728, totalSeconds: 745 },
    { sid: "CAseed0004", fromNumber: "+16505550123", toNumber: "+14158438558", status: "voicemail", dialStatus: "busy", startedAt: minutesAgo(1700), endedAt: minutesAgo(1698), totalSeconds: 91 },
  ]);

  await db.insert(schema.voicemails).values([
    { recordingSid: "REseed0001", callSid: "CAseed0001", durationSeconds: 42, transcriptionStatus: "done", transcript: "Hi Nick, this is Dr. Patel's office calling to confirm your appointment Thursday at 3:30. Please call us back at 415-555-0142 if you need to reschedule. Thanks!", notifiedAt: minutesAgo(28) },
    { recordingSid: "REseed0004", callSid: "CAseed0004", durationSeconds: 65, transcriptionStatus: "failed", transcriptionError: "Whisper 429: rate limited", notifiedAt: minutesAgo(1697), listenedAt: minutesAgo(1000) },
  ]);

  await db.insert(schema.messages).values([
    { sid: "SMseed0001", fromNumber: "+14155550177", body: "Are you still coming Saturday? Let me know!", receivedAt: minutesAgo(90), forwardedAt: minutesAgo(90) },
    { sid: "SMseed0002", fromNumber: "+16505550123", body: "", media: [{ url: "https://api.twilio.com/example/ME1", contentType: "image/jpeg" }], receivedAt: minutesAgo(3000), forwardedAt: minutesAgo(3000), readAt: minutesAgo(2000) },
  ]);

  console.log("seeded");
}

main().finally(() => client.end());
```

Verify: `DATABASE_URL=postgres://localhost/number_forwarder npm run db:seed`, then reload the dashboard: five rows across "Today" and "Yesterday" groups, one unread voicemail dot, one unread text dot, the failed transcription shows the retry button. Do the visual audit from Task 14 Step 11 now, in both themes and at phone width.

- [ ] **Step 3: Create scripts/configure-twilio.ts**

```ts
import { createInterface } from "node:readline/promises";
import { loadEnv } from "../src/lib/env";
import { updateNumberWebhooks } from "../src/lib/twilio/rest";

const env = loadEnv(process.env);
const base = process.argv[2]?.replace(/\/+$/, "") || env.PUBLIC_BASE_URL;
const urls = {
  voiceUrl: `${base}/api/twilio/voice`,
  smsUrl: `${base}/api/twilio/sms`,
  statusCallback: `${base}/api/twilio/status`,
};

async function main() {
  console.log(`Number: ${env.TWILIO_NUMBER}`);
  console.log(`Voice URL:        ${urls.voiceUrl}`);
  console.log(`SMS URL:          ${urls.smsUrl}`);
  console.log(`Status callback:  ${urls.statusCallback}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Apply these to the Twilio number? [y/N] ");
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("aborted");
    return;
  }
  await updateNumberWebhooks({ phoneNumber: env.TWILIO_NUMBER, ...urls });
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Usage: `npm run twilio:configure` uses `PUBLIC_BASE_URL`; `npm run twilio:configure -- https://abc123.ngrok-free.app` overrides for local development. Note `scripts/configure-twilio.ts` needs the `@/` alias resolved; it imports by relative path to avoid tsx alias configuration.

- [ ] **Step 4: Verify the script loads and prints without applying**

Run with a filled `.env.local`: `set -a; source .env.local; set +a; npm run twilio:configure` and answer `N`.
Expected: prints the three URLs, then `aborted`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add migration runner, seed data, and Twilio webhook configuration script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 18: Dockerfile, fly.toml, README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `fly.toml`, `README.md`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/next.config.ts ./
EXPOSE 3000
CMD ["npm", "start"]
```

`.dockerignore`:

```
node_modules
.next
.git
.env*
.superpowers
docs
e2e
tests
test-results
playwright-report
```

- [ ] **Step 2: Create fly.toml**

Replace `vlku-line` with the app name chosen at `fly launch` time if different.

```toml
app = "vlku-line"
primary_region = "sjc"

[build]

[deploy]
  release_command = "node scripts/migrate.mjs"

[env]
  PORT = "3000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "20s"
    method = "GET"
    path = "/api/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

- [ ] **Step 3: Build the image locally to prove it works**

Run: `docker build -t vlku-line .`
Expected: image builds. Then `docker run --rm -e DATABASE_URL=postgres://host.docker.internal/number_forwarder -e SESSION_SECRET=... (all env vars) -p 3000:3000 vlku-line` and open http://localhost:3000/login. If Docker is not installed, skip this step and rely on `fly deploy` in the README steps.

- [ ] **Step 4: Create README.md**

````markdown
# Number Forwarder (415-THE-VLKU)

Forwards calls to 415-THE-VLKU to a cell phone with a whisper screen ("press 1 to accept"),
records voicemails with Whisper transcripts, relays inbound texts, and shows it all in a
password-protected dashboard.

Design: `docs/superpowers/specs/2026-09-02-number-forwarder-design.md`

## Local development

1. Postgres running locally, then `createdb number_forwarder`.
2. `cp .env.example .env.local` and fill it in. `SESSION_SECRET`: `openssl rand -hex 32`.
3. `npm install && npm run db:migrate && npm run db:seed`
4. `npm run dev`, open http://localhost:3000, sign in with `DASHBOARD_PASSWORD`.
5. To receive real webhooks locally: `ngrok http 3000`, then
   `npm run twilio:configure -- https://<your-ngrok-host>` and set `PUBLIC_BASE_URL` in `.env.local`
   to the same URL (signature validation depends on it). Restart `npm run dev`.

Tests: `npm test`. End-to-end: `npm run e2e` (needs the local Postgres).

## Deploy to Fly.io

```bash
fly launch --no-deploy --copy-config --name vlku-line
fly postgres create --name vlku-line-db --region sjc
fly postgres attach vlku-line-db            # sets DATABASE_URL
fly secrets set \
  TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... \
  TWILIO_NUMBER=+14158438558 CELL_NUMBER=+1... \
  PUBLIC_BASE_URL=https://vlku-line.fly.dev \
  OPENAI_API_KEY=sk-... DASHBOARD_PASSWORD=... SESSION_SECRET=$(openssl rand -hex 32)
fly deploy                                   # release command runs migrations
```

Then point the Twilio number at the app (run locally with the production values exported):

```bash
PUBLIC_BASE_URL=https://vlku-line.fly.dev TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_NUMBER=+14158438558 \
  CELL_NUMBER=+1... OPENAI_API_KEY=x DASHBOARD_PASSWORD=x SESSION_SECRET=00000000000000000000000000000000 DATABASE_URL=x \
  npm run twilio:configure
```

## How a call flows

voice → Dial cell with whisper → whisper (Gather "press 1") → whisper-result → dial-status
→ (voicemail: Record) → record-done → recording (Whisper transcript + SMS) → status (totals).

Every webhook validates `X-Twilio-Signature` against `PUBLIC_BASE_URL`, so that value must
exactly match the URL Twilio calls, including scheme and host.

## Operations

- Forwarding can be paused from the dashboard header; calls then go straight to voicemail.
- A failed transcription shows a retry button on the call.
- Logs: `fly logs`. Health: `https://vlku-line.fly.dev/api/health`.
````

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add Dockerfile, Fly config, and README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 19: Playwright smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`

Requires local Postgres. Uses a dedicated database so it never touches dev data.

- [ ] **Step 1: Create playwright.config.ts**

```ts
import { defineConfig } from "@playwright/test";

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://localhost/number_forwarder_e2e";
const env = {
  DATABASE_URL,
  TWILIO_ACCOUNT_SID: "ACe2e",
  TWILIO_AUTH_TOKEN: "e2e-token",
  TWILIO_NUMBER: "+14158438558",
  CELL_NUMBER: "+14155550100",
  PUBLIC_BASE_URL: "http://localhost:3100",
  OPENAI_API_KEY: "sk-e2e",
  DASHBOARD_PASSWORD: "e2e-password",
  SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-32",
  PORT: "3100",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "npm run db:migrate && npm run db:seed && npx next dev -p 3100",
    url: "http://localhost:3100/login",
    env,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Create e2e/smoke.spec.ts**

```ts
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
});

test("feed lists seeded calls and texts with pills", async ({ page }) => {
  await expect(page.getByText("Dr. Patel's office")).toBeVisible();
  await expect(page.getByText("Sarah Kim")).toBeVisible();
  await expect(page.locator(".pill-voicemail").first()).toBeVisible();
  await expect(page.locator(".pill-text").first()).toBeVisible();
});

test("selecting a voicemail shows transcript and player", async ({ page }) => {
  await page.getByRole("link", { name: /Dr\. Patel's office/ }).first().click();
  await expect(page).toHaveURL(/item=CAseed0001/);
  await expect(page.getByText("confirm your appointment Thursday")).toBeVisible();
  await expect(page.locator("audio")).toHaveAttribute("src", "/api/recordings/REseed0001");
});

test("naming a number persists and appears in the list and contacts", async ({ page }) => {
  await page.getByRole("link", { name: /\+1 \(415\) 555-0199/ }).first().click();
  await page.getByPlaceholder("Add a name").fill("Unknown Caller Test");
  await page.getByPlaceholder("Anything worth remembering").click(); // blur triggers save
  await expect(page.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: /Unknown Caller Test/ }).first()).toBeVisible();
  await page.goto("/contacts");
  await expect(page.getByText("Unknown Caller Test")).toBeVisible();
});

test("filter chips narrow the list", async ({ page }) => {
  await page.getByRole("link", { name: "Texts" }).click();
  await expect(page).toHaveURL(/filter=text/);
  await expect(page.locator(".pill-voicemail")).toHaveCount(0);
  await expect(page.locator(".pill-text").first()).toBeVisible();
});
```

- [ ] **Step 3: Run it**

Run: `createdb number_forwarder_e2e 2>/dev/null; npx playwright install chromium; npm run e2e`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add Playwright smoke tests for login, feed, detail, and contacts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```

---

### Task 20: Deploy and verify end to end with real calls

This task is manual. It is done when every checkbox has been observed, not assumed.

- [ ] **Step 1: Deploy** following the README's Fly section. Confirm `curl https://<app>.fly.dev/api/health` returns `{"ok":true}` and `/login` renders.

- [ ] **Step 2: Configure the number** with `npm run twilio:configure` against the production URL. Confirm in the Twilio console that the number's voice URL, messaging URL, and status callback match.

- [ ] **Step 3: Answered call.** Call 415-THE-VLKU from another phone. Expect: cell rings showing the caller's number; on answer, whisper says "Call for THE VLKU from 4 1 5, ..., press 1 to accept"; press 1; both sides talk; hang up. Dashboard row: Answered pill, talk duration, timeline with accepted time and total.

- [ ] **Step 4: Ignored call with voicemail.** Call again, do not answer. Expect the caller hears ringing for about 20 s, then "You've reached THE VLKU...", leaves a message, presses #. Within about a minute: SMS on the cell with `[THE VLKU] Voicemail from +1 (...) (0:NN)`, a quoted transcript, and a link. Tapping the link opens the dashboard (after login) with that call selected. Audio plays. Unread dot clears after playing.

- [ ] **Step 5: Declined at whisper.** Call, answer on the cell, press 2 (or wait 5 s). Expect the cell leg drops, the caller is sent to voicemail, and the row shows Voicemail (dial status `completed`, accepted false). The cell's carrier voicemail must never pick up.

- [ ] **Step 6: Caller hangs up while ringing.** Call, hang up after 5 s. Expect a Missed row with total seconds set by the status callback and no voicemail.

- [ ] **Step 7: Text.** Send an SMS to the number. Expect `[THE VLKU] +1 (...): <body>` on the cell within seconds and a Text row in the feed. Send an MMS with a photo; expect the "(1 attachment, see dashboard)" note and the image inline in the detail pane.

- [ ] **Step 8: Name a caller** from the detail pane, then call from that number again. Expect the whisper to say the name and the SMS to use the name.

- [ ] **Step 9: Forwarding off.** Toggle off in the header, call. Expect straight to voicemail with no ring on the cell. Toggle back on.

- [ ] **Step 10: Save a note** in the README's Operations section about anything surprising found during verification, commit, and push.

```bash
git add -A
git commit -m "Document verification notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0147Hvzfrg5Fp57V5ghm8g8z"
```
