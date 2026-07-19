# ☀️ Solar Agent — Email Booking & Qualification

Automated lead qualification and appointment booking for solar installations (domestic & commercial).

## Stack

- **Gmail API** — receive and reply to inbound emails
- **Google Calendar** — freebusy lookup + slot booking (15-min survey call)
- **Google Sheets** — lead tracking spreadsheet
- **WhatsApp Cloud API** — booking confirmations and reminders
- **OpenAI** — lead qualification via LLM
- **Web Dashboard** — real-time view of appointments, leads, and DLQ
- **Confirmation Page** — branded booking confirmation for customers

## Flow

```
Inbound Email
    ↓
[Cancel intent?]  → cancellation flow → cancel event + update sheet + re-engagement email
    ↓
[Reschedule intent?] → reschedule flow → find booking → send slot options → re-book
    ↓
Qualify (LLM extracts: name, type, bill, timeline, phone)
    ↓
Check Calendar (find next available 15-min slot)
    ↓
Book Slot (create calendar event, send invite)
    ↓
Log to Sheets (append lead row)
    ↓
Notify via WhatsApp (if phone provided)
    ↓
Reply to confirm with /confirm/:eventId link
    ↓
Send reminders (24h + 1h before appointment)
```

## Setup

### 1. Environment

```bash
cp .env.example .env
# Fill in all variables
```

### 2. Google Cloud Service Account

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable: **Gmail API**, **Google Calendar API**, **Google Sheets API**
3. Create a **Service Account** → download JSON key
4. Share your Gmail inbox, Calendar, and Sheets with the service account email

```env
GMAIL_CLIENT_EMAIL=sa-name@project.iam.gserviceaccount.com
GMAIL_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GMAIL_USER_EMAIL=inbox@yourcompany.com
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com
GOOGLE_SHEET_ID=your-spreadsheet-id
GOOGLE_SHEET_TAB_NAME=Leads
```

### 3. WhatsApp Cloud API

1. Create a **Meta Business App** at [business.facebook.com](https://business.facebook.com)
2. Add **WhatsApp** product → get your Phone Number ID and Business Account ID
3. Generate a **permanent access token**

```env
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789
WHATSAPP_PHONE_NUMBER_ID=987654321
WHATSAPP_ACCESS_TOKEN=EAAALong...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your-verify-token
```

### 4. OpenAI

```env
OPENAI_API_KEY=sk-...
```

## Run

```bash
npm install

# Main agent (continuous polling)
node src/main.js --once        # poll once (test)
node src/main.js               # continuous

# Web dashboard (port 3000)
node src/tools/dashboard.js

# Booking confirmation page server (port 3001)
node src/tools/confirmationPage.js

# Reminder checker (cron every 5 min)
node src/tools/checkReminders.js

# Tests
node src/tools/runTests.js
```

## Services

### Dashboard (`/api/events`, `/api/sheet`, `/api/dlq`)
Real-time view of upcoming appointments, recent leads, and failed messages. Auth token required.

### Confirmation Page (`/confirm/:eventId`)
Branded HTML page sent to customers after booking. Shows date/time, what to expect, reschedule + cancel links. Also serves `.ics` calendar invite.

### Cancellation Flow
Detects: `cancel`, `cancelled`, `reschedule`, `can't make it`, etc.
- Cancels the calendar event
- Updates Google Sheet to `Cancelled — Customer Request`
- Sends re-engagement email ("reply to reschedule anytime")

### Reschedule Flow
Detects: `reschedule`, `different day`, `change the date`, etc.
1. Finds the existing booking
2. Sends reply with next 5 available slots
3. Customer replies with preference
4. Detects day/time preference from reply
5. Cancels old event, books new slot, sends confirmation

## Production Hardening

### Reverse Proxy (HTTPS)

**Caddy** (recommended — automatic HTTPS):
```bash
caddy run --config Caddyfile
```
See `Caddyfile` in this project.

**Nginx** (see `nginx.conf`):
```bash
sudo ln -s /etc/nginx/sites-available/solar-agent /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Firewall (UFW + fail2ban)

```bash
chmod +x firewall.sh && sudo ./firewall.sh
```

Rules: allow SSH (rate-limited), 443 (HTTPS), 80 (Let's Encrypt). Deny all other inbound.

### systemd Service

```bash
sudo cp solar-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable solar-agent
sudo systemctl start solar-agent
```

### Cron for Reminders

```bash
# crontab -e
*/5 * * * * cd /home/engine/solar-agent && node src/tools/checkReminders.js >> /tmp/solar-agent-reminders.log 2>&1
```

## Hardening Features

| Feature | Purpose |
|---------|---------|
| **Idempotency** | Skip already-processed emails |
| **Retry + backoff** | Exponential backoff on all API calls |
| **Input sanitization** | Strip HTML, validate email/phone formats |
| **DLQ** | Failed messages stored for manual review |
| **Reminder system** | 24h + 1h WhatsApp/email reminders |
| **Structured logging** | Configurable log levels (DEBUG/INFO/WARN/ERROR) |
| **Non-blocking notifications** | WhatsApp failures don't block email reply |
| **Multi-turn qualification** | Asks follow-up questions if info is missing |
| **Thread memory** | Persists state across email reply threads |
| **Cancellation detection** | Auto-detects cancel/reschedule intent |
| **Reschedule flow** | 2-step: send slots → detect preference → re-book |
| **Confirmation page** | Branded customer-facing booking page |

## Project Structure

```
solar-agent/
├── .env.example
├── package.json
├── README.md
├── Caddyfile                     # Caddy reverse proxy + HTTPS
├── nginx.conf                    # Nginx reverse proxy config
├── firewall.sh                   # UFW + fail2ban setup
├── solar-agent.service           # systemd service
├── crontab.example               # cron config
└── src/
    ├── main.js
    ├── agents/
    │   ├── solarAgent.js          # Main orchestration
    │   ├── qualification.js       # Single + multi-turn qualification
    │   ├── cancellation.js       # Cancellation detection + handling
    │   ├── reschedule.js         # 2-step reschedule flow
    │   └── emailTemplates.js
    ├── tools/
    │   ├── llm.js
    │   ├── pollEmail.js
    │   ├── calendar.js
    │   ├── sheets.js
    │   ├── sheetsFindUpdate.js   # Find + update sheet row
    │   ├── whatsapp.js
    │   ├── reminders.js
    │   ├── checkReminders.js
    │   ├── retry.js
    │   ├── dlq.js
    │   ├── idempotency.js
    │   ├── sanitize.js
    │   ├── logger.js
    │   ├── dashboard.js           # Web dashboard server
    │   ├── confirmationPage.js    # Customer booking confirmation page
    │   ├── runTests.js
    │   └── simulateEmails.js
    └── memory/
        └── threadMemory.js
```