# EmailAgent — inbound booking & qualification (Node 20, no framework)

Polls Gmail → qualifies leads via LLM → books 15-min survey calls on Google
Calendar → logs to Sheets → WhatsApp confirmations + reminders. Handles
cancellation + reschedule intents. This is the INBOUND foundation; Renewably's
outbound plan builds on its patterns (segmented outreach over 1,332-installer CRM).
Estate map: `~/Desktop/SONSSONS/COMH/RENEWABLY/LAUNCH_MAP.md`

## House rules
- Read before write. Never commit `.env` (gitignored — keep it so).
- Dashboard auth FAIL-CLOSED (fixed 2026-07-18): unset or 'changeme'
  DASHBOARD_AUTH_TOKEN refuses all requests. Don't weaken it.

## Architecture notes
- Solid production patterns: idempotency store, DLQ, retry, sanitisation,
  thread memory. JSON-file stores in /tmp — swap for Redis/Postgres at scale.
- Entry: `node src/main.js` (poll loop) · `--once` for single pass ·
  reminders + dashboard as separate processes (see package.json scripts).

## KNOWN GAP — do before ANY Irish deployment
Built UK-first: `normalizePhone()` in src/tools/sanitize.js only handles +44;
qualification prompts/parse use £. Needs IE localisation: +353 handling
(08x mobile → +353 8x), € bills, IE spelling in templates. Do this WITH Cal,
test with real Irish numbers — silent phone normalisation failure = silent
lost WhatsApp confirmations.

## Future (decided direction, not built)
- Emit MeetingBooked/SurveyBooked into the AIOS kernel via the outbox pattern
  (copy `kernel-bridge.ts` from the Renewably repo — same law: explicit tenant,
  refs only, registered types).
