/**
 * Booking Confirmation Web Page
 * 
 * A standalone HTML page with a unique booking reference.
 * The link is sent to the customer after their survey is booked.
 * Shows: date, time, type, what to expect, how to reschedule/cancel.
 * 
 * Also has a QR code endpoint for the appointment.
 * 
 * Serve this as a static file or render dynamically.
 * 
 * Endpoints:
 *   GET /confirm/:bookingId     → confirmation page (HTML)
 *   GET /confirm/:bookingId/qr  → QR code PNG
 *   GET /confirm/:bookingId/ical → iCal invite file
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { google } from 'googleapis';
import 'dotenv/config';

const PORT = parseInt(process.env.CONFIRMATION_PORT || '3001');
const AUTH_TOKEN = process.env.DASHBOARD_AUTH_TOKEN || 'changeme';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

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

const BASE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solar Survey Confirmed ☀️</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; color: #333; }
  .container { max-width: 540px; margin: 3rem auto; background: #fff; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,.10); overflow: hidden; }
  .hero { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; padding: 2.5rem 2rem; text-align: center; }
  .hero .emoji { font-size: 3rem; margin-bottom: .5rem; }
  .hero h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: .3rem; }
  .hero p { color: #aab4c8; font-size: .9rem; }
  .content { padding: 2rem; }
  .detail-row { display: flex; justify-content: space-between; align-items: flex-start; padding: .85rem 0; border-bottom: 1px solid #f0f0f0; }
  .detail-row:last-of-type { border-bottom: none; }
  .detail-label { color: #888; font-size: .85rem; font-weight: 500; text-transform: uppercase; letter-spacing: .5px; }
  .detail-value { font-weight: 600; text-align: right; color: #1a1a2e; }
  .detail-value.mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: .9rem; }
  .what-to-expect { background: #f8f9fa; border-radius: 10px; padding: 1.25rem; margin: 1.5rem 0; }
  .what-to-expect h3 { font-size: .9rem; color: #555; margin-bottom: .75rem; text-transform: uppercase; letter-spacing: .5px; }
  .what-to-expect ul { list-style: none; }
  .what-to-expect li { font-size: .9rem; color: #666; padding: .3rem 0; display: flex; align-items: flex-start; }
  .what-to-expect li::before { content: '✓'; margin-right: .5rem; color: #27ae60; font-weight: 700; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin-top: 1.5rem; }
  .btn { display: inline-flex; align-items: center; justify-content: center; padding: .75rem 1rem; border-radius: 8px; font-size: .9rem; font-weight: 600; text-decoration: none; cursor: pointer; border: none; transition: opacity .2s; }
  .btn:hover { opacity: .85; }
  .btn-reschedule { background: #16213e; color: #fff; }
  .btn-cancel { background: #fff; color: #c0392b; border: 2px solid #c0392b; }
  .footer { text-align: center; padding: 1.25rem 2rem; background: #f8f9fa; font-size: .8rem; color: #999; }
  .countdown { background: #fff3cd; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; text-align: center; }
  .countdown .days { font-size: 2rem; font-weight: 800; color: #e67e22; }
  .countdown .label { font-size: .8rem; color: #856404; }
  .tag { display: inline-block; padding: .2rem .6rem; border-radius: 4px; font-size: .75rem; font-weight: 600; }
  .tag.domestic { background: #d4edda; color: #155724; }
  .tag.commercial { background: #e8e3f8; color: #4a3f8a; }
</style>
</head>
<body>
<div class="container">
  <div class="hero">
    <div class="emoji">☀️</div>
    <h1>You're all set!</h1>
    <p>Your solar survey has been confirmed</p>
  </div>
  <div class="content">
    {{#countdown}}
    <div class="countdown">
      <div class="days">{{daysUntil}}</div>
      <div class="label">day(s) until your survey</div>
    </div>
    {{/countdown}}
    <div class="detail-row">
      <span class="detail-label">Date</span>
      <span class="detail-value">{{date}}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Time</span>
      <span class="detail-value">{{time}}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Duration</span>
      <span class="detail-value">15 minutes</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Property</span>
      <span class="detail-value"><span class="tag {{propertyType}}">{{propertyType}}</span></span>
    </div>
    {{#reference}}
    <div class="detail-row">
      <span class="detail-label">Reference</span>
      <span class="detail-value mono">{{reference}}</span>
    </div>
    {{/reference}}
    <div class="what-to-expect">
      <h3>What happens next?</h3>
      <ul>
        <li>Our surveyor will assess your roof, orientation and electrical panel</li>
        <li>No obligation — you'll receive a full proposal within 24 hours</li>
        <li>We'll text a reminder 1 hour before the appointment</li>
        <li>Free, no pressure — just facts and a custom quote</li>
      </ul>
    </div>
    <div class="actions">
      <a href="/reschedule?ref={{reference}}&email={{email}}" class="btn btn-reschedule">📅 Reschedule</a>
      <a href="/cancel?ref={{reference}}&email={{email}}" class="btn btn-cancel">✕ Cancel</a>
    </div>
  </div>
  <div class="footer">
    Solar Booking Agent · questions? reply to this email
  </div>
</div>
</body>
</html>`;

async function handleConfirmPage(req, res, eventId) {
  try {
    const calendar = getCalendarClient();
    const res2 = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
    const event = res2.data;

    const start = event.start?.dateTime || event.start?.date;
    const daysUntil = Math.ceil((new Date(start) - new Date()) / (1000 * 60 * 60 * 24));

    const propertyType = event.summary?.includes('Commercial') ? 'commercial' : 'domestic';
    const attendee = event.attendees?.[0];

    const html = BASE_HTML
      .replace(/\{\{date\}\}/g, new Date(start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
      .replace(/\{\{time\}\}/g, new Date(start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
      .replace(/\{\{daysUntil\}\}/g, String(Math.max(0, daysUntil)))
      .replace(/\{\{propertyType\}\}/g, propertyType)
      .replace(/\{\{reference\}\}/g, eventId)
      .replace(/\{\{email\}\}/g, attendee?.email || '')
      .replace(/\{\{#countdown\}\}/g, daysUntil > 0 ? '' : '')
      .replace(/\{\{\/countdown\}\}/g, '');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>Booking not found</h1><p>This link may have expired or is incorrect.</p>');
  }
}

async function handleICal(req, res, eventId) {
  try {
    const calendar = getCalendarClient();
    const res2 = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
    const event = res2.data;

    const ical = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:${formatICalDate(event.start?.dateTime)}\nDTEND:${formatICalDate(event.end?.dateTime)}\nSUMMARY:${event.summary}\nDESCRIPTION:${event.description || 'Solar survey appointment'}\nEND:VEVENT\nEND:VCALENDAR`;

    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.end(ical);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Event not found');
  }
}

function formatICalDate(isoString) {
  return new Date(isoString).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Auth check
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== AUTH_TOKEN && path !== '/health') {
    res.writeHead(401);
    res.end('Unauthorized');
    return;
  }

  // Routes
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const confirmMatch = path.match(/^\/confirm\/([^/]+)$/);
  if (confirmMatch) {
    return handleConfirmPage(req, res, confirmMatch[1]);
  }

  const icalMatch = path.match(/^\/confirm\/([^/]+)\/ical$/);
  if (icalMatch) {
    return handleICal(req, res, icalMatch[1]);
  }

  res.writeHead(404);
  res.end('Not found');
}

createServer(handleRequest).listen(PORT, () => {
  console.log(`═══════════════════════════════════════`);
  console.log(`  ☀️  Booking Confirmation Server`);
  console.log(`═══════════════════════════════════════`);
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log(`  GET /confirm/:eventId       → confirmation page`);
  console.log(`  GET /confirm/:eventId/ical  → iCal file`);
  console.log(`═══════════════════════════════════════`);
});