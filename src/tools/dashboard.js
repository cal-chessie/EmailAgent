/**
 * Simple Web Dashboard — shows upcoming booked solar surveys
 * 
 * Serves:
 *   GET /              → HTML dashboard
 *   GET /api/events    → JSON list of upcoming events
 *   GET /api/dlq       → JSON list of failed messages
 *   GET /health        → health check
 * 
 * Run with: node src/tools/dashboard.js
 * Requires AUTH_TOKEN set in .env
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';
import 'dotenv/config';

const PORT = parseInt(process.env.DASHBOARD_PORT || '3000');
const AUTH_TOKEN = process.env.DASHBOARD_AUTH_TOKEN || 'changeme';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || 'Leads';

// ─── Calendar Client ─────────────────────────────────────────────────────────

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

// ─── Sheet Client ─────────────────────────────────────────────────────────────

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      client_email: process.env.GMAIL_CLIENT_EMAIL,
      private_key: process.env.GMAIL_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────

function requireAuth(req) {
  // Fail closed: if the token is unset or left at the 'changeme' default,
  // refuse everything rather than exposing leads/DLQ with a known token.
  if (!AUTH_TOKEN || AUTH_TOKEN === 'changeme') return false;
  const token = req.headers.authorization?.replace('Bearer ', '');
  return token === AUTH_TOKEN;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleHealth(res) {
  respond(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
}

async function handleEvents(req, res) {
  if (!requireAuth(req)) return respond(res, 401, { error: 'Unauthorized' });

  try {
    const calendar = getCalendarClient();
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const res2 = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
      q: 'Solar Survey',
    });

    const events = (res2.data.items || [])
      .filter(e => e.status !== 'cancelled')
      .map(e => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        attendee: e.attendees?.[0]?.email || 'unknown',
        created: e.created,
      }));

    respond(res, 200, { count: events.length, events });
  } catch (err) {
    respond(res, 500, { error: err.message });
  }
}

async function handleSheet(req, res) {
  if (!requireAuth(req)) return respond(res, 401, { error: 'Unauthorized' });

  try {
    const sheets = getSheetsClient();

    const res2 = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!A:J`,
    });

    const rows = res2.data.values || [];
    const [headers, ...data] = rows;
    const leads = data.map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h.trim()] = row[i] || ''; });
      return obj;
    });

    respond(res, 200, { count: leads.length, leads });
  } catch (err) {
    respond(res, 500, { error: err.message });
  }
}

async function handleDLQ(req, res) {
  if (!requireAuth(req)) return respond(res, 401, { error: 'Unauthorized' });

  try {
    const { getDLQ } = await import('./dlq.js');
    const dlq = getDLQ();
    respond(res, 200, { count: dlq.length, dlq });
  } catch (err) {
    respond(res, 500, { error: err.message });
  }
}

async function handleDashboard(req, res) {
  if (!requireAuth(req)) return respond(res, 401, { error: 'Unauthorized' });

  const eventsRes = await getEventsData();
  const sheetRes = await getSheetData();
  const dlqRes = await getDLQData();

  const html = buildDashboardHtml({
    events: eventsRes,
    sheet: sheetRes,
    dlq: dlqRes,
    authToken: AUTH_TOKEN,
  });

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ─── Data Fetchers ────────────────────────────────────────────────────────────

async function getEventsData() {
  try {
    const calendar = getCalendarClient();
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });

    return (res.data.items || []).filter(e => e.status !== 'cancelled').map(e => ({
      id: e.id,
      summary: e.summary || 'Solar Survey',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      attendee: e.attendees?.[0]?.email || '—',
    }));
  } catch {
    return [];
  }
}

async function getSheetData() {
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!A:J`,
    });
    const rows = res.data.values || [];
    return rows.slice(-10).reverse(); // last 10, newest first
  } catch {
    return [];
  }
}

async function getDLQData() {
  try {
    const { getDLQ } = await import('./dlq.js');
    return getDLQ();
  } catch {
    return [];
  }
}

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function buildDashboardHtml({ events, sheet, dlq }) {
  const eventsRows = events.length === 0
    ? '<tr><td colspan="5" class="empty">No upcoming appointments</td></tr>'
    : events.map(e => `
      <tr>
        <td>${formatDate(e.start)}</td>
        <td>${e.summary}</td>
        <td>${e.attendee}</td>
        <td>${formatTime(e.start)}</td>
        <td><span class="badge booked">Booked</span></td>
      </tr>`).join('\n');

  const getBandClass = (band = '') => {
    if (band.includes('Hot')) return 'hot';
    if (band.includes('Warm')) return 'warm';
    if (band.includes('Cool')) return 'cool';
    if (band.includes('Cold')) return 'cold';
    return '';
  };

  const sheetRows = sheet.length === 0
    ? '<tr><td colspan="10" class="empty">No leads yet</td></tr>'
    : sheet.map(row => {
      const band = row.Band || '';
      const bandClass = getBandClass(band);
      return `<tr>
        <td>${(row.Timestamp || '').slice(0, 10)}</td>
        <td>${row.Name || row.Email || ''}</td>
        <td>${row.Type || ''}</td>
        <td>${row['Monthly Bill'] || row.Bill || ''}</td>
        <td>${row.Timeline || ''}</td>
        <td>${row.Status || ''}</td>
        <td>${row.Slot ? row.Slot.slice(0, 16).replace('T', ' ') : ''}</td>
        <td class="score-val ${bandClass}">${row.Score || ''}</td>
        <td>${band ? `<span class="badge ${bandClass}">${band}</span>` : ''}</td>
        <td style="font-size:.75rem;color:#666">${row.Recommendation || ''}</td>
      </tr>`;
    }).join('\n');

  const dlqRows = dlq.length === 0
    ? '<tr><td colspan="4" class="empty">No failed messages</td></tr>'
    : dlq.map(d => `
      <tr>
        <td>${d.enqueuedAt}</td>
        <td>${d.emailId}</td>
        <td>${d.from}</td>
        <td class="error-msg">${d.error}</td>
      </tr>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solar Agent Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f9; color: #333; }
  header { background: #1a1a2e; color: #fff; padding: 1rem 2rem; }
  header h1 { font-size: 1.2rem; }
  header span { color: #f0a500; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; padding: 1.5rem 2rem; }
  .card { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.08); overflow: hidden; }
  .card-header { background: #16213e; color: #fff; padding: .75rem 1rem; font-size: .85rem; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
  .card-header span { color: #f0a500; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th { background: #f0f0f0; text-align: left; padding: .5rem .75rem; font-weight: 600; }
  td { padding: .5rem .75rem; border-bottom: 1px solid #f0f0f0; }
  tr:last-child td { border-bottom: none; }
  .empty { color: #888; font-style: italic; text-align: center; padding: 1rem; }
  .badge { padding: .2rem .5rem; border-radius: 4px; font-size: .75rem; font-weight: 600; }
  .badge.booked { background: #d4edda; color: #155724; }
  .badge.cancelled { background: #f8d7da; color: #721c24; }
  .badge.needs-info { background: #fff3cd; color: #856404; }
  .badge.hot { background: #f8d7da; color: #721c24; }
  .badge.warm { background: #fff3cd; color: #856404; }
  .badge.cool { background: #d1ecf1; color: #0c5460; }
  .badge.cold { background: #e2e3e5; color: #383d41; }
  .score-val { font-weight: 800; }
  .score-val.hot { color: #c0392b; }
  .score-val.warm { color: #e67e22; }
  .score-val.cool { color: #2980b9; }
  .score-val.cold { color: #7f8c8d; }
  .full-width { grid-column: 1 / -1; }
  .error-msg { color: #c0392b; font-size: .8rem; }
  .dlq .card-header { background: #c0392b; }
  .api-note { font-size: .75rem; color: #888; padding: .5rem 1rem; background: #fafafa; }
  .api-note code { background: #eee; padding: .1rem .3rem; border-radius: 3px; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>☀️ Solar Agent <span>Dashboard</span></h1>
</header>
<div class="grid">
  <div class="card">
    <div class="card-header">📅 Upcoming Appointments <span>${events.length}</span></div>
    <table>
      <thead><tr><th>Date</th><th>Event</th><th>Attendee</th><th>Time</th><th>Status</th></tr></thead>
      <tbody>${eventsRows}</tbody>
    </table>
  </div>
  <div class="card">
    <div class="card-header">📋 Recent Leads <span>${sheet.length}/last 10</span></div>
    <table>
      <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Bill</th><th>Timeline</th><th>Status</th><th>Slot</th><th>Score</th><th>Band</th><th>Recommendation</th></tr></thead>
      <tbody>${sheetRows}</tbody>
    </table>
  </div>
  <div class="card full-width dlq">
    <div class="card-header">⚠️ Dead Letter Queue <span>${dlq.length}</span></div>
    <table>
      <thead><tr><th>Enqueued</th><th>Email ID</th><th>From</th><th>Error</th></tr></thead>
      <tbody>${dlqRows}</tbody>
    </table>
  </div>
</div>
<div class="api-note">
  API: <code>GET /api/events</code> <code>GET /api/sheet</code> <code>GET /api/dlq</code> — Auth: <code>Authorization: Bearer ${authToken}</code>
</div>
</body>
</html>`;
}

// ─── Router ──────────────────────────────────────────────────────────────────

const ROUTES = {
  '/': handleDashboard,
  '/health': handleHealth,
  '/api/events': handleEvents,
  '/api/sheet': handleSheet,
  '/api/dlq': handleDLQ,
};

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const handler = ROUTES[url.pathname];

  if (!handler) {
    return respond(res, 404, { error: 'Not found' });
  }

  try {
    await handler(req, res);
  } catch (err) {
    respond(res, 500, { error: err.message });
  }
}

function respond(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ─── Start ────────────────────────────────────────────────────────────────────

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`═══════════════════════════════════════`);
  console.log(`  ☀️  Solar Agent Dashboard`);
  console.log(`═══════════════════════════════════════`);
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log(`  Auth token: ${AUTH_TOKEN}`);
  console.log(`  Endpoints:`);
  console.log(`    GET /           → HTML dashboard`);
  console.log(`    GET /health    → Health check`);
  console.log(`    GET /api/events → Upcoming appointments (JSON)`);
  console.log(`    GET /api/sheet  → Recent leads (JSON)`);
  console.log(`    GET /api/dlq    → Failed messages (JSON)`);
  console.log(`═══════════════════════════════════════`);
});
