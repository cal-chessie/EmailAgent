/**
 * Reschedule Flow
 * 
 * Triggered when a customer replies asking to reschedule.
 * Detects intent, finds the current booking, presents available slots,
 * sends a reply with the next available options, then books the new slot.
 * 
 * Flow:
 * 1. Detect reschedule intent in inbound email
 * 2. Find the current booked event
 * 3. Send a "here are new slots" reply
 * 4. Customer replies with their preferred slot
 * 5. Agent detects slot preference in reply and re-books
 */

import { google } from 'googleapis';
import { sendEmail } from '../tools/pollEmail.js';
import { withRetry } from '../tools/retry.js';
import { checkCalendarSlots } from '../tools/calendar.js';
import { findAndUpdateRow } from '../tools/sheetsFindUpdate.js';
import { sendWhatsApp } from '../tools/whatsapp.js';
import { info, warn } from '../tools/logger.js';
import { getThreadMemory, saveThreadMemory } from '../memory/threadMemory.js';
import 'dotenv/config';

const RESCHEDULE_KEYWORDS = [
  'reschedule', 'rescheduling', 'different day', 'different time',
  'change the date', 'change the time', 'move the appointment',
  'another day', 'another time', 'next week', 'next month',
  'not that day', 'pick a new', 'find another', 'see other slots',
  'when else', 'any other', 'other slots', 'available',
];

const SLOT_PREFERENCE_PATTERNS = [
  /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i,
  /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/,
  /(morning|afternoon|evening)/i,
  /next week|this week|week after/i,
  /tomorrow|today/i,
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
 * Detect reschedule intent from email
 */
export function detectRescheduleIntent(email) {
  const text = `${email.subject} ${email.body}`.toLowerCase();
  return RESCHEDULE_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * Detect if the reply contains a specific slot preference
 */
export function detectSlotPreference(email) {
  const text = email.body;
  const preferences = {};

  // Day of week
  const dayMatch = text.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (dayMatch) preferences.day = dayMatch[1].toLowerCase();

  // Date pattern
  const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dateMatch) preferences.date = dateMatch[0];

  // Time of day
  const timeMatch = text.match(/(morning|afternoon|evening)/i);
  if (timeMatch) preferences.timeOfDay = timeMatch[1].toLowerCase();

  // Relative
  if (/tomorrow/i.test(text)) preferences.relative = 'tomorrow';
  else if (/next week/i.test(text)) preferences.relative = 'next_week';
  else if (/this week/i.test(text)) preferences.relative = 'this_week';

  return Object.keys(preferences).length > 0 ? preferences : null;
}

/**
 * Step 1 of reschedule: find the existing booking and send available slots
 */
export async function initiateReschedule(email) {
  const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
  const calendar = getCalendarClient();
  const threadId = email.threadId || email.id;

  info('Reschedule', `Initiating reschedule for ${email.from}`);

  // Find current event
  const now = new Date();
  const res = await withRetry(() => calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), // look back 7 days
    timeMax: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: true,
    q: email.from.split('@')[0],
  }), { label: 'findEventForReschedule' });

  const events = (res.data.items || []).filter(e => e.status !== 'cancelled');
  const currentEvent = events.find(e => e.attendees?.some(a => a.email === email.from));

  if (!currentEvent) {
    warn('Reschedule', 'No current booking found', { from: email.from });
    return { initiated: false, reason: 'no_current_booking' };
  }

  // Save thread state — waiting for slot preference
  const memory = getThreadMemory(threadId);
  saveThreadMemory(threadId, {
    ...memory,
    status: 'reschedule_waiting_preference',
    originalEventId: currentEvent.id,
    originalSlot: currentEvent.start?.dateTime,
    emailFrom: email.from,
    initiatedAt: new Date().toISOString(),
  });

  // Get available slots
  const slots = await checkCalendarSlots('domestic');
  const formattedSlots = slots.slice(0, 5).map(formatSlotOption).join('\n');

  const body = `
Hi,

I found your current booking on ${formatDate(currentEvent.start?.dateTime)}.
I'll cancel that and we can pick a new time together.

Here are our next available slots:

${formattedSlots || 'No slots currently available — a team member will be in touch.'}

Just reply with your preferred day/time and I'll get it booked in right away.

—
The Solar Team
  `.trim();

  await withRetry(
    () => sendEmail(email.from, 'Re: Rescheduling Your Solar Survey', body),
    { retries: 3, label: 'sendRescheduleSlotsEmail' }
  );

  info('Reschedule', `Sent slot options to ${email.from}`);
  return { initiated: true, currentEventId: currentEvent.id };
}

/**
 * Step 2 of reschedule: customer replied with a slot preference — match and re-book
 */
export async function processSlotPreference(email) {
  const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
  const threadId = email.threadId || email.id;
  const memory = getThreadMemory(threadId);

  if (memory.status !== 'reschedule_waiting_preference') {
    return { booked: false, reason: 'not_waiting_for_preference' };
  }

  const preferences = detectSlotPreference(email);
  if (!preferences) {
    // Can't parse preference — ask again
    const body = `
Hi,

I'm not sure I understood your preferred time. Could you let me know:

• A day that works (e.g. Tuesday)
• Morning, afternoon, or evening

Or just reply with a specific date/time and I'll sort it out.

—
The Solar Team
    `.trim();

    await sendEmail(email.from, 'Re: Rescheduling Your Solar Survey', body);
    return { booked: false, reason: 'preference_unclear' };
  }

  info('Reschedule', `Processing slot preference:`, preferences);

  // Get all available slots
  const allSlots = await checkCalendarSlots('domestic');

  // Filter by preferences
  const filtered = filterSlots(allSlots, preferences);
  const chosenSlot = filtered[0];

  if (!chosenSlot) {
    const body = `
Hi,

Unfortunately none of our upcoming slots match "${preferences.date || preferences.day || 'your preference'}".
A team member will be in touch within 24 hours to find a time that works.

Apologies for the inconvenience.

—
The Solar Team
    `.trim();

    await sendEmail(email.from, 'Re: Rescheduling Your Solar Survey', body);
    memory.status = 'reschedule_no_match';
    saveThreadMemory(threadId, memory);
    return { booked: false, reason: 'no_matching_slots' };
  }

  const calendar = getCalendarClient();

  // Cancel old event
  await withRetry(() => calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: memory.originalEventId,
    requestBody: { status: 'cancelled' },
    sendUpdates: 'all',
  }), { retries: 3, label: 'cancelOldEvent' });

  // Create new event
  const newEvent = await withRetry(() => calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: currentEvent.summary,
      description: currentEvent.description?.replace(
        `Slot: ${memory.originalSlot}`,
        `Slot: ${chosenSlot.start}`
      ),
      start: { dateTime: chosenSlot.start, timeZone: 'Europe/London' },
      end: { dateTime: chosenSlot.end, timeZone: 'Europe/London' },
      attendees: currentEvent.attendees,
      reminders: currentEvent.reminders,
    },
    sendUpdates: 'all',
  }), { retries: 3, label: 'bookNewSlot' });

  // Update sheet
  await findAndUpdateRow({ ...currentEvent, start: { dateTime: chosenSlot.start } }, 'Rescheduled');

  // WhatsApp
  const attendee = currentEvent.attendees?.[0];
  if (attendee?.comment) {
    sendWhatsApp(attendee.comment,
      `☀️ Your solar survey has been rescheduled to ${formatSlot(chosenSlot.start)}. See you then!`
    ).catch(() => {});
  }

  // Confirm to customer
  const body = `
Hi,

All sorted! Your solar survey has been moved to:

📅 ${formatSlot(chosenSlot.start)}

A new calendar invite has been sent to your email.

If you need to change again, just reply — no problem at all.

—
The Solar Team
  `.trim();

  await sendEmail(email.from, `Solar Survey Rescheduled — ${formatDate(chosenSlot.start)}`, body);

  memory.status = 'reschedule_complete';
  saveThreadMemory(threadId, memory);

  info('Reschedule', `✅ Rescheduled for ${email.from} to ${chosenSlot.start}`);
  return { booked: true, newEventId: newEvent.data.id, newSlot: chosenSlot.start };
}

function filterSlots(slots, preferences) {
  return slots.filter(slot => {
    const d = new Date(slot.start);

    if (preferences.day) {
      const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' }).toLowerCase();
      if (!dayName.includes(preferences.day)) return false;
    }

    if (preferences.timeOfDay) {
      const hour = d.getHours();
      if (preferences.timeOfDay === 'morning' && hour >= 12) return false;
      if (preferences.timeOfDay === 'afternoon' && (hour < 12 || hour >= 17)) return false;
      if (preferences.timeOfDay === 'evening' && hour < 17) return false;
    }

    return true;
  });
}

function formatSlotOption(slot) {
  const d = new Date(slot.start);
  return `  • ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatSlot(iso) {
  return new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}