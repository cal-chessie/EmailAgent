/**
 * Check upcoming events and send reminders (24h and 1h before)
 * Can be triggered by a cron job or polling loop
 */
import { google } from 'googleapis';
import 'dotenv/config';

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      client_email: process.env.GMAIL_CLIENT_EMAIL,
      private_key: process.env.GMAIL_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  return google.calendar({ version: 'v3', auth });
}

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const REMINDER_FILE = '/tmp/solar-agent-sent-reminders.json';

function readSentLog() {
  try {
    return JSON.parse(import('fs').then(m => m.readFileSync(REMINDER_FILE, 'utf8')).catch(() => '{}'));
  } catch {
    return {};
  }
}

function writeSentLog(log) {
  import('fs').then(({ writeFileSync }) => {
    writeFileSync(REMINDER_FILE, JSON.stringify(log, null, 2));
  });
}

export async function checkReminders() {
  const calendar = getCalendarClient();
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Fetch all events in next 48 hours
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: tomorrow.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const sentLog = readSentLog();
  const events = res.data.items || [];
  const reminders = [];

  for (const event of events) {
    if (!event.start?.dateTime) continue;
    const start = new Date(event.start.dateTime);
    const minutesUntil = (start - now) / 1000 / 60;

    const reminder24h = Math.abs(minutesUntil - 1440) < 30; // ~24h
    const reminder1h = Math.abs(minutesUntil - 60) < 10;     // ~1h
    const key = `${event.id}-24h`;
    const key1h = `${event.id}-1h`;

    if (reminder24h && !sentLog[key]) {
      reminders.push({ event, minutes: 24, key });
    }
    if (reminder1h && !sentLog[key1h]) {
      reminders.push({ event, minutes: 1, key: key1h });
    }
  }

  // Send reminders
  for (const { event, minutes, key } of reminders) {
    const email = event.attendees?.[0]?.email || extractEmailFromDesc(event.description);
    const name = event.summary?.replace(/\[Solar Survey.*\] /, '') || 'there';

    if (email) {
      await sendEmailReminder(email, name, event, minutes);
      await sendWhatsAppReminder(email, name, event, minutes);
    }

    sentLog[key] = new Date().toISOString();
  }

  writeSentLog(sentLog);
  console.log(`[Reminders] ✅ Sent ${reminders.length} reminder(s)`);
  return reminders;
}

async function sendEmailReminder(email, name, event, minutes) {
  const { sendEmail } = await import('./pollEmail.js');
  const body = minutes === 24
    ? `Hi ${name}, a quick reminder — your solar survey is tomorrow at ${formatTime(event.start.dateTime)}. Reply if you need to reschedule.`
    : `Hi ${name}, your solar survey is in ${minutes} minute(s) at ${formatTime(event.start.dateTime)}. Looking forward to it!`;

  await sendEmail(email, `Solar Survey Reminder — ${formatTime(event.start.dateTime)}`, body);
}

async function sendWhatsAppReminder(email, name, event, minutes) {
  const { sendWhatsApp } = await import('./whatsapp.js');
  const phone = await lookupPhoneByEmail(email); // TODO: implement phone lookup
  if (!phone) return;

  const msg = minutes === 24
    ? `☀️ Hi ${name}! Reminder: your solar survey is tomorrow at ${formatTime(event.start.dateTime)}. Reply to reschedule if needed.`
    : `☀️ Hi ${name}! Your solar survey starts in ${minutes} min at ${formatTime(event.start.dateTime)}. See you soon!`;

  await sendWhatsApp(phone, msg);
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function extractEmailFromDesc(desc) {
  const match = desc?.match(/[\w.-]+@[\w.-]+\.\w+/);
  return match?.[0];
}

// Placeholder — implement by querying Google Sheets by email
async function lookupPhoneByEmail(email) {
  return null;
}