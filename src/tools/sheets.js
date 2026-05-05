/**
 * Google Sheets — append qualified leads to a tracking sheet
 */
import { google } from 'googleapis';
import 'dotenv/config';

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      client_email: process.env.GMAIL_CLIENT_EMAIL,
      private_key: process.env.GMAIL_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || 'Leads';

/**
 * Append a row to the Google Sheet
 * Columns: Timestamp | Name | Email | Type | Property | Bill | Timeline | Status | Slot | Notes | Score | Band | Recommendation
 */
export async function appendToSheet(data) {
  const sheets = getSheetsClient();
  const timestamp = new Date().toISOString();

  const row = [
    timestamp,
    data.name || '',
    data.email || '',
    data.type || '',
    data.property || '',
    data.bill || '',
    data.timeline || '',
    data.status || 'New',
    data.slot || '',
    data.notes || '',
    data.score ?? '',
    data.band || '',
    data.recommendation || '',
  ];

  const range = `${TAB_NAME}!A:A`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });

  console.log(`[Sheets] ✅ Row appended for ${data.name} (score: ${data.score ?? 'n/a'})`);
}
