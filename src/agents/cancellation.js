/**
 * Booking Cancellation Flow
 * 
 * Detects cancellation intent from inbound emails and:
 * 1. Cancels the calendar event
 * 2. Updates the Google Sheet row
 * 3. Sends a cancellation confirmation email
 * 4. Optionally triggers WhatsApp notification
 */

import { google } from 'googleapis';
import { sendEmail } from '../tools/pollEmail.js';
import { sendWhatsApp } from '../tools/whatsapp.js';
import { withRetry } from '../tools/retry.js';
import { appendToSheet } from '../tools/sheets.js';
import { info, warn, error } from '../tools/logger.js';
import 'dotenv/config';

const CANCELLATION_KEYWORDS = [
  'cancel', 'cancelled', 'cancelling', 'cancellation',
  'reschedule', 'rescheduling', 'not available', 'unable to make it',
  'something came up', 'won\'t be able', 'can\'t make', 'stop the visit',
  'don\'t come', 'do not attend', 'no longer interested', 'changed my mind',
];

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      client_email: process.env.GMAIL_CLIENT_EMAIL,
      private_key: process.env.GMAIL_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

/**
 * Detect cancellation intent from email body
 */
export function detectCancellationIntent(email) {
  const text = `${email.subject} ${email.body}`.toLowerCase();
  return CANCELLATION_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * Find and cancel a booked appointment from an inbound cancellation email
 */
export async function processCancellationEmail(email) {
  info('Cancellation', `Processing cancellation request from ${email.from}`, { subject: email.subject });

  const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

  // 1. Find the event to cancel
  const calendar = getCalendarClient();
  const now = new Date();

  // Look for events with this attendee in the next 30 days
  const res = await withRetry(() => calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: true,
    q: email.from.split('@')[0], // search by name part of email
  }), { label: 'calendarEventSearch' });

  const events = res.data.items || [];

  // Match the event: upcoming, not already cancelled, has this email as attendee
  const event = events.find(e => {
    if (e.status === 'cancelled') return false;
    const attendee = e.attendees?.find(a => a.email === email.from);
    return !!attendee;
  });

  if (!event) {
    warn('Cancellation', 'No matching event found for cancellation', { from: email.from });
    return { cancelled: false, reason: 'no_event_found' };
  }

  // 2. Cancel the calendar event
  const cancelledEvent = await withRetry(() => calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: event.id,
    requestBody: { status: 'cancelled' },
    sendUpdates: 'all',
  }), { label: 'cancelCalendarEvent' });

  info('Cancellation', 'Calendar event cancelled', { eventId: event.id });

  // 3. Update Google Sheet — find row by email and update status
  await withRetry(() => updateSheetRow(event, 'Cancelled — Customer Request'), {
    retries: 3,
    label: 'updateSheetCancellation',
  });

  // 4. Extract attendee info for notification
  const name = extractNameFromEvent(event) || 'there';
  const attendee = event.attendees?.find(a => a.email === email.from);
  const phone = attendee?.comment || null; // phone not stored in calendar by default

  // 5. Send cancellation confirmation email
  const slotStr = event.start?.dateTime
    ? formatSlot(event.start.dateTime)
    : 'your scheduled visit';

  const body = `
Hi ${name},

Your solar survey has been cancelled as requested. ✅

We'd love to reschedule when you're ready — just reply to this email
with a new date/time that works for you and we'll get it booked in.

No hard feelings. Solar is a big decision and timing matters.

—
The Solar Team
  `.trim();

  await withRetry(
    () => sendEmail(email.from, 'Solar Survey Cancelled', body),
    { retries: 3, label: 'sendCancellationEmail' }
  );

  // 6. WhatsApp notification (if we have the phone)
  if (phone) {
    withRetry(
      () => sendWhatsApp(phone, `☀️ Hi ${name}, your solar survey on ${slotStr} has been cancelled. Reply to reschedule when you're ready.`),
      { retries: 2, label: 'sendCancellationWhatsApp' }
    ).catch(e => warn('Cancellation', 'WhatsApp cancellation notify failed', { error: e.message }));
  }

  info('Cancellation', `✅ Booking cancelled for ${email.from}`, { eventId: event.id });
  return { cancelled: true, eventId: event.id };
}

async function updateSheetRow(event, newStatus) {
  // Find the row by matching the event start time + email in the sheet
  // This is a simplified approach — in production you'd use a unique booking ID
  const { findAndUpdateRow } = await import('../tools/sheets.js');
  return findAndUpdateRow?.(event, newStatus) || { updated: false };
}

function extractNameFromEvent(event) {
  // Try to extract from event description
  const nameMatch = event.description?.match(/Name:\s*(.+)/i);
  if (nameMatch) return nameMatch[1].trim();

  // Fall back to attendee display name
  const attendee = event.attendees?.[0];
  return attendee?.displayName || attendee?.email?.split('@')[0] || 'there';
}

function formatSlot(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });
}
