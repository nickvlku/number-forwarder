# Number Forwarder: Design

Date: 2026-09-02
Status: approved design, pending implementation plan

## Purpose

Forward calls to the Twilio number 415-THE-VLKU (+1 415 843 8558) to Nick's personal cell while keeping a private dashboard of every call, voicemail, and text. The cell phone must be able to tell a forwarded call from a direct one before the call connects. Unanswered forwards must land in this system's voicemail, never the carrier's.

## Decisions already made

| Topic | Decision |
|---|---|
| Hosting | Fly.io, one always-on machine, Fly Postgres attached |
| Stack | Next.js (App Router, standalone build), Drizzle ORM, Postgres, Tailwind |
| Forward cue | Whisper announcement on answer plus press 1 to accept |
| Transcription | OpenAI Whisper API, run server-side after the recording callback |
| Dashboard auth | Single shared password from env, signed 30-day session cookie |
| Notifications | SMS to the cell for new voicemails and for inbound texts |
| Layout | Two-pane list plus detail on desktop, single-column feed on phone |
| Visual style | Clean utility: neutral palette, system font, blue accent, light and dark themes following the system setting |

## Out of scope for v1

Outbound calling, replying to texts from the dashboard, multiple forwarding targets, blocklists, multi-user accounts, retention policies. Each is a candidate follow-up and nothing in the design prevents them.

## Call flow

All webhook handlers live under `/api/twilio/`. Every handler verifies the `X-Twilio-Signature` header against the request URL and body using the auth token, and rejects with 403 on mismatch. Handlers respond within a few hundred milliseconds; anything slow runs after the response.

### 1. Incoming call: `POST /api/twilio/voice`

Twilio sends `CallSid`, `From`, `To`, `CallStatus`.

- Insert a `calls` row: sid, from, started_at now, status `ringing`.
- Look up `contacts` by `From` for a display name.
- If `settings.forwarding_enabled` is false, skip straight to the voicemail TwiML in step 4.
- Otherwise respond with TwiML:
  - `<Dial timeout="20" callerId="{From}" action="/api/twilio/dial-status" answerOnBridge="true">`
  - `<Number url="/api/twilio/whisper?callSid={CallSid}">{CELL_NUMBER}</Number>`
  - Caller ID is set to the real caller's number so the cell shows who is calling. If the caller's number is withheld or not a valid E.164 number, fall back to the Twilio number as caller ID.

`answerOnBridge` keeps the caller hearing ringback until Nick presses 1, rather than hearing silence during the whisper.

### 2. Whisper: `POST /api/twilio/whisper`

Twilio calls this on the cell's leg the moment Nick answers, before bridging.

- Look up the call and contact by `callSid`.
- Respond with `<Gather numDigits="1" timeout="5" action="/api/twilio/whisper-result?callSid=...">` wrapping `<Say>`:
  - With a contact name: "Call for THE VLKU from Jane Doe. Press 1 to accept."
  - Without: "Call for THE VLKU from 4 1 5, 5 5 5, 0 1 9 9. Press 1 to accept." Digits are read individually with pauses between groups.
- If Gather times out with no input, the TwiML falls through to `<Hangup/>`, which ends only the cell leg. Twilio then treats the Dial as not answered.

### 3. Whisper result: `POST /api/twilio/whisper-result`

- If `Digits` is `1`: respond with empty `<Response/>`. Twilio bridges the call. Record `calls.accepted = true`.
- Anything else: respond with `<Hangup/>`. Cell leg ends, Dial reports no answer.

### 4. Dial outcome: `POST /api/twilio/dial-status`

Twilio sends `DialCallStatus` (`completed`, `no-answer`, `busy`, `failed`, `canceled`) and `DialCallDuration`.

- `completed` and `calls.accepted` is true: set status `completed`, `talk_seconds = DialCallDuration`. Respond with `<Hangup/>`.
- Any other outcome, including `completed` when Nick hung up during the whisper without pressing 1: set status `voicemail_pending` and respond with:
  - `<Say>You've reached THE VLKU. Please leave a message after the tone.</Say>`
  - `<Record maxLength="180" finishOnKey="#" playBeep="true" recordingStatusCallback="/api/twilio/recording" action="/api/twilio/record-done"/>`
- `canceled` means the caller hung up while ringing. Set status `missed` and respond with `<Hangup/>`.

### 5. Record done: `POST /api/twilio/record-done`

Called when the recording stops. If `RecordingDuration` is under 2 seconds, treat it as no message: status becomes `missed` and the recording is deleted from Twilio. Otherwise status becomes `voicemail`. Respond with `<Hangup/>`.

### 6. Recording ready: `POST /api/twilio/recording`

Twilio sends `RecordingSid`, `RecordingUrl`, `RecordingDuration`, `RecordingStatus`.

- Only act on `RecordingStatus = completed`.
- Upsert a `voicemails` row keyed on `RecordingSid` with duration and `transcription_status = pending`. If the row already exists with status `done` or `in_progress`, return 200 and stop. This makes Twilio retries idempotent.
- Respond 200 immediately, then in a detached task:
  1. Set `transcription_status = in_progress`.
  2. Download the recording as MP3 from Twilio using account SID and auth token.
  3. Send to Whisper (`whisper-1`, language unset so it auto-detects).
  4. Save the transcript, set `transcription_status = done`.
  5. Send the notification SMS (see Notifications) and set `notified_at`.
  6. On any failure, set `transcription_status = failed` with the error message. Still send the notification SMS, without the transcript, so a Whisper outage never hides a voicemail.

### 7. Call status: `POST /api/twilio/status`

Configured as the number's status callback for `completed`. Sets `calls.ended_at` and `total_seconds = CallDuration`. This covers ring time plus talk or voicemail time, distinct from `talk_seconds` and the voicemail's own duration.

### Status summary

| Status | Meaning |
|---|---|
| `ringing` | Voice webhook received, outcome unknown |
| `completed` | Nick pressed 1 and talked |
| `missed` | No answer and the caller left no message |
| `voicemail_pending` | Recording in progress |
| `voicemail` | Message left; see `voicemails` row |
| `failed` | Twilio reported an error on the call |

A `ringing` or `voicemail_pending` row older than 15 minutes is displayed as `missed`, since a callback was lost. No background reconciliation in v1.

## Inbound SMS: `POST /api/twilio/sms`

Twilio sends `MessageSid`, `From`, `Body`, `NumMedia`, `MediaUrl0..n`, `MediaContentType0..n`.

- Insert a `messages` row keyed on `MessageSid`. Duplicate SID returns 200 and stops.
- Respond with empty `<Response/>` so Twilio sends no auto-reply.
- After the response, forward to the cell: `[THE VLKU] Jane Doe: body` or `[THE VLKU] +1 415 555 0199: body`. Media is relayed as MMS when Twilio allows it, otherwise the message notes "1 attachment, see dashboard". Set `forwarded_at` on success.

Media URLs are stored as-is and proxied through `/api/media/[messageSid]/[index]` with account credentials, same as recordings.

## Notifications

One SMS from the Twilio number to the cell per voicemail:

```
[THE VLKU] Voicemail from Dr. Patel's office (0:42)
"Hi Nick, this is Dr. Patel's office calling to confirm your appointment Thursday at 3:30. Please call..."
https://vlku-line.fly.dev/calls/CAxxxx
```

Transcript is truncated to keep the whole message under 320 characters (two SMS segments). If transcription failed, the second line reads "Transcription unavailable, listen in the dashboard."

Sending never blocks a webhook response, and a failed send is logged and retried once after 30 seconds.

## Data model

Drizzle schema in `src/db/schema.ts`. All phone numbers stored in E.164.

**contacts**
- `phone` text primary key
- `name` text nullable
- `notes` text nullable
- `created_at`, `updated_at` timestamptz

**calls**
- `sid` text primary key (Twilio CallSid)
- `from_number` text, indexed
- `to_number` text
- `status` text enum as above
- `dial_status` text nullable (raw Twilio DialCallStatus)
- `accepted` boolean default false
- `started_at` timestamptz, indexed desc
- `ended_at` timestamptz nullable
- `talk_seconds` integer nullable
- `total_seconds` integer nullable

**voicemails**
- `recording_sid` text primary key
- `call_sid` text references calls, unique
- `duration_seconds` integer
- `transcript` text nullable
- `transcription_status` text enum: pending, in_progress, done, failed
- `transcription_error` text nullable
- `notified_at` timestamptz nullable
- `listened_at` timestamptz nullable
- `created_at` timestamptz

**messages**
- `sid` text primary key
- `from_number` text, indexed
- `body` text
- `media` jsonb array of `{url, contentType}`
- `received_at` timestamptz, indexed desc
- `forwarded_at` timestamptz nullable
- `read_at` timestamptz nullable

**settings**
- `id` integer primary key, always 1
- `forwarding_enabled` boolean default true

Contacts are joined by number at read time. Saving a name or note for a number creates the contact row if missing.

## Dashboard

### Routes

| Route | Purpose |
|---|---|
| `/login` | Password form. Posts to a server action, sets an HttpOnly signed cookie for 30 days. |
| `/` | Activity feed. Two-pane on desktop, single column on phone. |
| `/?item=CAxxx` or `/?item=SMxxx` | Feed with that item selected in the detail pane. On phone this route renders the detail full-screen with a back link. |
| `/calls/[sid]` | Redirects to `/?item=` so SMS links work on both form factors. |
| `/contacts` | Everyone with a name or note. |
| `/contacts/[phone]` | Name and notes editor plus that number's full history. |
| `/api/recordings/[sid]` | Streams the recording MP3 from Twilio. Session required. Marks `listened_at` on first play. |
| `/api/media/[sid]/[index]` | Streams MMS media from Twilio. Session required. |

All routes except `/login` and `/api/twilio/*` require the session cookie, enforced in `middleware.ts`.

### Feed page

- Header: "THE VLKU" wordmark on the left, the forwarding toggle on the right with an explicit "Forwarding on" or "Forwarding off" label. Toggling calls a server action and updates `settings`.
- Filter chips under the header: All, Voicemail, Missed, Texts, Answered. Selection is a query param so it survives refresh.
- Left list, newest first, grouped by day with a day label. Each row shows: unread dot, contact name or formatted number, type pill, one-line preview (transcript start, text body, or "Rang 20s, no message"), time, and duration (talk time for answered, message length for voicemail).
- The list loads 50 rows and paginates with a "Load more" button.
- Right detail pane for a call: name and number, timestamp, timeline (rang, answered or no answer, voicemail ended, total length), audio player for the voicemail, transcript with a "Transcription failed, retry" button when applicable, and the contact card with name and notes fields that save on blur.
- Right detail pane for a text: sender, timestamp, body, inline media, and the same contact card.
- Selecting a row marks a voicemail or text read. Unread count appears in the browser tab title.
- The feed polls every 30 seconds for new rows while the tab is visible.

### Visual system

- System font stack, 14px base, tabular numerals for all times and durations.
- Light theme: white surfaces, near-black text, muted grey secondary text, blue accent for selection and unread. Dark theme: near-black surfaces, off-white text, same accent lifted for contrast. Theme follows `prefers-color-scheme`.
- Type pills: answered green, voicemail amber, missed red, text blue, each with distinct tinted background, border, and solid text color that passes contrast in both themes.
- Rows have a hover tint and a selected state with an accent left bar.
- Durations render as `m:ss`, or `h:mm:ss` past an hour.

## Configuration

Environment variables, documented in `.env.example`:

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | API auth and signature validation |
| `TWILIO_NUMBER` | +14158438558 |
| `CELL_NUMBER` | Nick's cell, E.164 |
| `PUBLIC_BASE_URL` | The deployed origin, e.g. https://vlku-line.fly.dev (app name chosen at deploy time), used for webhook URLs and SMS links |
| `OPENAI_API_KEY` | Whisper |
| `DASHBOARD_PASSWORD` | Login |
| `SESSION_SECRET` | Cookie signing, 32+ random bytes |

`scripts/configure-twilio.ts` reads these and updates the phone number's voice URL, SMS URL, and status callback via the Twilio REST API. It prints the current configuration first and asks for confirmation. For local development it accepts a tunnel URL as an override.

## Deployment

- `Dockerfile` builds the Next.js standalone output on a Node 22 Alpine image.
- `fly.toml` with `min_machines_running = 1`, a release command that runs `drizzle-kit migrate`, and an HTTP health check on `/api/health` that verifies the database connection.
- Fly Postgres attached, which injects `DATABASE_URL`. Remaining secrets set with `fly secrets set`.
- A `README.md` covers: creating the Fly app, attaching Postgres, setting secrets, deploying, running the Twilio configuration script, and local development with a tunnel.

## Error handling

- Signature validation failure: 403, logged with the path. No row written.
- Any unexpected exception in a voice webhook: respond with TwiML that says "Sorry, something went wrong" and hangs up, so the caller never hears dead air, and log the error with the CallSid.
- Twilio retries webhooks that return 5xx. All handlers are idempotent on the Twilio SID they receive so retries are safe.
- Whisper failures are captured per voicemail with a retry button. The retry action runs the same detached transcription task.
- Recording download uses a 30 second timeout and two retries with backoff.

## Testing

- **Unit (Vitest)**: TwiML builders for each step, whisper text with and without a contact name, digit-by-digit number reading, duration formatting, E.164 normalization, SMS notification composition and truncation.
- **Integration (Vitest + PGlite)**: each webhook handler called with a signed request body, asserting rows and TwiML. A full sequence test walks one call through voice, whisper, whisper-result, dial-status, record-done, recording, status. Retried recording callbacks produce one transcription and one SMS. Twilio's REST client and the OpenAI client are mocked at the module boundary.
- **E2E (Playwright)**: login, feed renders seeded data, selecting a row shows detail, editing a contact name persists and appears in the list.
- **Manual before done**: place a real call, press 1 and talk; place a call, ignore it, leave a voicemail, confirm SMS and transcript; send a text to the number, confirm it is relayed.

## Project layout

```
src/
  app/
    (dashboard)/            layout with header, feed page, contacts pages
    login/
    api/twilio/             voice, whisper, whisper-result, dial-status, record-done, recording, status, sms
    api/recordings/[sid]/
    api/media/[sid]/[index]/
    api/health/
  db/                       schema.ts, client.ts, migrations/
  lib/
    twilio/                 signature.ts, twiml.ts, client.ts
    transcription.ts        Whisper call
    notify.ts               SMS composition and send
    phone.ts                E.164 and display formatting
    session.ts              cookie signing and verification
    format.ts               durations and dates
  components/               feed list, detail pane, player, contact card, pills
scripts/configure-twilio.ts
docs/superpowers/specs/
```
