/**
 * Solar Agent entry point
 * Run with: node src/main.js
 */
import { runSolarAgent } from './agents/solarAgent.js';
import 'dotenv/config';

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000');

console.log('═══════════════════════════════════════');
console.log('  ☀️  Solar Agent — Email Booking & Qualification');
console.log('═══════════════════════════════════════');
console.log(`  Polling every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`  Gmail: ${process.env.GMAIL_USER_EMAIL || '❌ not set'}`);
console.log(`  Calendar: ${process.env.GOOGLE_CALENDAR_ID || '❌ not set'}`);
console.log(`  Sheets: ${process.env.GOOGLE_SHEET_ID || '❌ not set'}`);
console.log(`  Dashboard: http://localhost:${process.env.DASHBOARD_PORT || 3000}`);
console.log('═══════════════════════════════════════\n');

if (process.argv.includes('--once')) {
  await runSolarAgent();
  process.exit(0);
}

let running = true;
while (running) {
  try {
    await runSolarAgent();
  } catch (err) {
    console.error('[Solar Agent] Fatal error:', err.message);
  }
  await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
}
