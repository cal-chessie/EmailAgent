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

// Normalize phone number to E.164 format (basic)
export function normalizePhone(phone = '') {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('44') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `+44${digits.slice(1)}`;
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