/**
 * Input sanitization and validation for all external data
 */

// Strip HTML tags from email body
export function sanitizeHtml(str = '') {
  return str.replace(/<[^>]*>/g, '').trim();
}

// Validate email address format
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Normalize phone number to E.164 format. Ireland-first: Irish national
// numbers are 9-10 digits after the leading 0 (mobiles 083/085/086/087/089
// + 7 digits; landlines 01/02x/04x... + 7). UK national numbers are always
// 11 digits, so length disambiguates the two.
export function normalizePhone(phone = '') {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2); // 00353... → 353...
  if (digits.startsWith('353')) return `+${digits}`;
  if (digits.startsWith('44') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0')) {
    if (digits.length === 11) return `+44${digits.slice(1)}`;             // UK national (07x/02x + 9)
    if (digits.length >= 9 && digits.length <= 10) return `+353${digits.slice(1)}`; // IE national
  }
  return digits.length >= 10 ? `+${digits}` : phone;
}

// Validate a lead qualification object
export function validateQualification(q) {
  const errors = [];

  if (q.type && !['domestic', 'commercial'].includes(q.type)) {
    errors.push(`Invalid type: ${q.type}`);
  }
  if (q.bill && isNaN(parseFloat(String(q.bill).replace(/[^0-9.]/g, '')))) {
    errors.push(`Invalid bill: ${q.bill}`);
  }
  if (q.timeline && !['eager', 'considering', 'browsing'].includes(q.timeline)) {
    errors.push(`Invalid timeline: ${q.timeline}`);
  }

  return { valid: errors.length === 0, errors };
}

// Sanitize a calendar event description
export function sanitizeForCalendar(str = '') {
  return str.replace(/[^\x20-\x7E\n]/g, '').slice(0, 500);
}