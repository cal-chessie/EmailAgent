/**
 * Lead Scoring Engine
 * 
 * Scores incoming leads based on multiple dimensions to help
 * the sales team prioritize follow-up.
 * 
 * Score range: 0–100
 *   80–100  → Hot (priority follow-up, same day)
 *   50–79   → Warm (follow-up within 24h)
 *   20–49   → Cool (follow-up within 48h)
 *   0–19    → Cold (batch process)
 */

export const SCORING_BANDS = {
  hot:   { min: 80, label: '🔥 Hot',    urgency: 'Same day' },
  warm:  { min: 50, label: '🌤️ Warm',   urgency: 'Within 24h' },
  cool:  { min: 20, label: '❄️ Cool',   urgency: 'Within 48h' },
  cold:  { min: 0,  label: '🧊 Cold',   urgency: 'Batch' },
};

/**
 * Score a qualified lead. Returns overall score + per-dimension breakdown.
 */
export function scoreLead(qualification) {
  const breakdown = {
    billScore:    scoreBill(qualification.bill),
    timelineScore: scoreTimeline(qualification.timeline),
    typeScore:    scoreType(qualification.type),
    engagementScore: scoreEngagement(qualification),
    propertyScore: scoreProperty(qualification.property),
  };

  const total = Math.min(100,
    breakdown.billScore * 0.35 +
    breakdown.timelineScore * 0.30 +
    breakdown.typeScore * 0.15 +
    breakdown.engagementScore * 0.10 +
    breakdown.propertyScore * 0.10
  );

  return {
    total: Math.round(total),
    band: getBand(total),
    breakdown,
    recommendation: getRecommendation(total, qualification),
  };
}

// ─── Dimension Scorers ───────────────────────────────────────────────────────

function scoreBill(bill) {
  if (!bill) return 0;
  // Extract numeric value from "£180/month" or "£4,200"
  const num = parseFloat(String(bill).replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return 0;

  // Domestic: 0-50=low, 51-150=mid, 151-300=high, 300+=very high
  // Commercial: assume commercial bill is typically 10x domestic scale
  // We score on absolute £ so a £4,200/mo commercial warehouse is very high value
  if (num >= 500)  return 100;
  if (num >= 200)  return 80;
  if (num >= 100)  return 60;
  if (num >= 50)   return 40;
  if (num >= 20)   return 20;
  return 5;
}

function scoreTimeline(timeline) {
  switch (timeline?.toLowerCase()) {
    case 'eager':       return 100;
    case 'considering': return 60;
    case 'browsing':    return 20;
    default:            return 10;
  }
}

function scoreType(type) {
  switch (type?.toLowerCase()) {
    case 'commercial': return 100; // larger deal potential
    case 'domestic':  return 70;
    default:           return 30;
  }
}

function scoreEngagement(q) {
  let score = 30; // base
  
  if (q.phone) score += 30;       // willing to share phone = higher intent
  if (q.property) score += 20;   // gave property detail
  if (q.name && q.name !== 'Unknown') score += 20; // used real name

  return Math.min(100, score);
}

function scoreProperty(property) {
  if (!property) return 10;
  const p = property.toLowerCase();

  // Positive signals
  if (/south.facing|ssw|southeast|southwest/i.test(p)) return 90;
  if (/flat roof|commercial|warehouse|office|industrial/i.test(p)) return 80;
  if (/detached|bungalow|house/i.test(p)) return 70;
  if (/semi|terrace/i.test(p)) return 55;
  
  // Negative signals
  if (/north.facing|north.facing roof/i.test(p)) return 25;
  if (/shaded|trees|obstruction/i.test(p)) return 20;

  return 50; // default mid
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBand(score) {
  if (score >= 80) return SCORING_BANDS.hot;
  if (score >= 50) return SCORING_BANDS.warm;
  if (score >= 20) return SCORING_BANDS.cool;
  return SCORING_BANDS.cold;
}

function getRecommendation(score, q) {
  const band = getBand(score);

  if (score >= 80 && q.type === 'commercial') {
    return 'Priority — commercial deal, high bill. Assign to senior rep today.';
  }
  if (score >= 80) {
    return 'Hot lead — call within 2 hours, then send WhatsApp confirmation.';
  }
  if (score >= 50) {
    return 'Warm lead — follow up within 24h, offer available survey slots.';
  }
  if (score >= 20) {
    return 'Cool lead — email nurture sequence, check in 3 days.';
  }
  return 'Cold lead — batch email, marketing nurture flow.';
}

/**
 * Format score for display (used in Google Sheet and emails)
 */
export function formatScore(score) {
  return `${score.total} ${score.band.label}`;
}

/**
 * Add score to a Google Sheets row
 */
export async function addScoreToSheet(score, sheets, SHEET_ID, TAB_NAME) {
  // Find Status column and add score data after it
  // Columns: Timestamp | Name | Email | Type | Property | Bill | Timeline | Status | Slot | Notes | Score
  // We'll append to the last column or add a Score column

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!1:1`,
  });

  const headers = res.data.values?.[0] || [];
  const scoreColIndex = headers.findIndex(h => h === 'Score');
  
  // Add Score column header if not exists
  if (scoreColIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Score']] },
    });
  }

  // Score is appended at the last row when we call appendToSheet
  // This function updates the last appended row's score column
  return { scoreColIndex: scoreColIndex === -1 ? headers.length : scoreColIndex };
}