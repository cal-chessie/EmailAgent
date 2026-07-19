/**
 * Find and update a Google Sheet row by matching event details
 * Add this to sheets.js — called by cancellation flow
 */

/**
 * Find row by email + slot time and update status column
 * Returns the updated row or null if not found
 */
export async function findAndUpdateRow(event, newStatus) {
  const sheets = getSheetsClient();
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || 'Leads';

  // Get all rows
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:J`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return null; // no data rows

  const headers = rows[0];
  const statusCol = headers.indexOf('Status');
  const emailCol = headers.indexOf('Email');
  const slotCol = headers.indexOf('Slot');

  if (emailCol === -1 || statusCol === -1) {
    console.warn('[Sheets] Could not find Email or Status column');
    return null;
  }

  const eventEmail = event.attendees?.[0]?.email;
  const eventStart = event.start?.dateTime;

  // Find matching row
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const rowEmail = rows[i][emailCol];
    const rowSlot = rows[i][slotCol];

    if (rowEmail === eventEmail) {
      // Match by slot time if available
      if (eventStart && rowSlot) {
        const rowSlotNorm = new Date(rowSlot).toISOString().slice(0, 16);
        const eventNorm = new Date(eventStart).toISOString().slice(0, 16);
        if (rowSlotNorm === eventNorm) {
          rowIndex = i + 1; // sheet row is 1-indexed + header
          break;
        }
      } else {
        rowIndex = i + 1;
        break;
      }
    }
  }

  if (rowIndex === -1) {
    console.warn('[Sheets] No matching row found for cancellation');
    return null;
  }

  const range = `${TAB_NAME}!${String.fromCharCode(65 + statusCol)}${rowIndex}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [[newStatus]] },
  });

  console.log(`[Sheets] ✅ Row ${rowIndex} status updated to "${newStatus}"`);
  return { rowIndex, status: newStatus };
}
