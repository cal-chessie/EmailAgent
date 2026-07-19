/**
 * Google Calendar — check free slots and book a 15-min survey call
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
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

/**
 * Find next N available 15-min slots for a survey call
 */
export async function checkCalendarSlots(type = 'domestic') {
  const calendar = getCalendarClient();
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // next 7 days

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: CALENDAR_ID }],
    },
  });

  const busySlots = res.data.calendars[CALENDAR_ID]?.busy || [];

  // Generate candidate slots (9am–5pm, Mon–Fri)
  const slots = [];
  const cursor = new Date(now);
  cursor.setHours(9, 0, 0, 0);

  while (cursor < end) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) { // skip weekends
      const slotEnd = new Date(cursor.getTime() + 15 * 60 * 1000);
      
      // Check not busy
      const isBusy = busySlots.some(busy => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        return slotEnd > busyStart && cursor < busyEnd;
      });

      if (!isBusy) {
        slots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
      }
    }
    cursor.setTime(cursor.getTime() + 15 * 60 * 1000); // advance 15 min
  }

  return slots.slice(0, 10); // top 10
}

/**
 * Create a calendar event for the survey call
 */
export async function bookSlot(slot, email, qualification) {
  const calendar = getCalendarClient();

  const event = {
    summary: `[Solar Survey — ${qualification.type}] ${email.from}`,
    description: `
Solar installation survey booked.
Type: ${qualification.type}
Property: ${qualification.property || 'TBC'}
Bill: ${qualification.bill || 'TBC'}
Timeline: ${qualification.timeline || 'TBC'}
Original email: ${email.subject}
    `.trim(),
    start: { dateTime: slot.start, timeZone: 'Europe/London' },
    end: { dateTime: slot.end, timeZone: 'Europe/London' },
    attendees: [{ email: email.from }],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
  };

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: event,
    sendUpdates: 'all',
  });

  return res.data;
}
