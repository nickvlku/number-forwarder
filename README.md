# Number Forwarder (415-THE-VLKU)

Forwards calls to 415-THE-VLKU to a cell phone with a whisper screen ("press 1 to accept"),
records voicemails with Whisper transcripts, relays inbound texts, and shows it all in a
password-protected dashboard.

Design: `docs/superpowers/specs/2026-09-02-number-forwarder-design.md`

## Local development

1. Postgres running locally. On this machine Homebrew Postgres 17 listens on port 55432, so
   `DATABASE_URL=postgres://localhost:55432/number_forwarder`; then
   `createdb -h localhost -p 55432 number_forwarder`.
2. `cp .env.example .env.local` and fill it in. `SESSION_SECRET`: `openssl rand -hex 32`.
3. `npm install && npm run db:migrate && npm run db:seed` (these load `.env.local` automatically via
   `--env-file-if-exists`; the Fly release command runs `node scripts/migrate.mjs` directly, without that
   flag, since production has no `.env.local`)
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

## Legal pages for Twilio A2P registration

`content/legal/privacy.md` and `content/legal/terms.md` are served publicly (no login) at `/privacy` and `/terms`, so the campaign form can link to `https://<your host>/privacy` and `https://<your host>/terms`. Edit the markdown to change them; the contact address and effective date are in the files.

## Operations

- Forwarding can be paused from the dashboard header; calls then go straight to voicemail.
- Caller ID on the forwarded leg is the Twilio number by default (`FORWARD_CALLER_ID=twilio`), because carriers intercept calls that present a number Twilio does not own; the whisper announces the real caller. Set `FORWARD_CALLER_ID=caller` to show the caller's number instead if your carrier allows it.
- A failed transcription shows a retry button on the call.
- Voicemail greeting: record one in the dashboard under Settings (mic access needs HTTPS or localhost). It is stored in Postgres and served publicly at `/api/greeting.wav` for Twilio to play. Precedence: dashboard recording, then `VOICEMAIL_GREETING_URL` (a public MP3/WAV you host yourself), then text-to-speech with a Polly neural voice. The greeting text and the whisper text live in `src/lib/twilio/twiml.ts`.
- Logs: `fly logs`. Health: `https://vlku-line.fly.dev/api/health`.
