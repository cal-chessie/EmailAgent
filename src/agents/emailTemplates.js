/**
 * Email templates — confirmation, no slots, qualification questions
 */

export async function sendConfirmationEmail(email, booked, qualification) {
  const { sendEmail } = await import('../tools/pollEmail.js');

  const slotStr = formatSlot(booked.start);
  const typeLabel = qualification.type === 'commercial' ? 'commercial' : 'domestic';
  const name = qualification.name || 'there';

  const body = `
Hi ${name},

Great news — your solar survey is confirmed! ✅

📋 Booking Details
─────────────────
Type: ${typeLabel} property
Date/Time: ${slotStr}
Duration: 15 minutes

📍 What happens next
─────────────────────
Our surveyor will visit your property to assess roof suitability, 
orientation, and electrical setup. No obligation — you'll get a 
full proposal within 24 hours.

We'll send you a reminder 1 hour before the appointment.

If you need to reschedule, just reply to this email.

Good choice going solar! ☀️

—
The Solar Team
  `.trim();

  await sendEmail(email.from, `Solar Survey Confirmed — ${formatDate(booked.start)}`, body);
}

export async function sendNoSlotsEmail(email, qualification) {
  const { sendEmail } = await import('../tools/pollEmail.js');

  const name = qualification.name || 'there';

  const body = `
Hi ${name},

Thank you for your interest in going solar! We've received your enquiry
and would love to help.

Unfortunately all our survey slots are booked at the moment — we're
running at high demand. A team member will be in touch within 24 hours
to arrange a time that works for you.

In the meantime, feel free to reply with any questions about installation,
financing, or savings estimates.

—
The Solar Team
  `.trim();

  await sendEmail(email.from, 'Re: Your Solar Enquiry — We\'ll be in touch soon', body);
}

export async function sendQualificationEmail(email, question) {
  const { sendEmail } = await import('../tools/pollEmail.js');

  const body = `
Hi,

Thanks for getting in touch about solar installation. To give you an
accurate quote, I just need one quick piece of information:

${question}

Just reply to this email — I have your details from your original message.

—
The Solar Team
  `.trim();

  await sendEmail(email.from, 'Quick question about your solar enquiry', body);
}

function formatSlot(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}