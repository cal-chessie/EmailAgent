/**
 * Reminder System — sends WhatsApp + email reminders before booked appointments
 * Runs as a separate cron-like process
 */
import { google } from 'googleapis';
import 'dotenv/config';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

/**
 * Scan upcoming calendar events and send reminders for any booked within
 * the reminder window (24h and 1h before).
 */
export async function sendReminders() {
  const { checkReminders } = await import('./checkReminders.js');
  return checkReminders();
}