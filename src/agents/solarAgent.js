/**
 * Solar Booking & Qualification Agent — Hardened Version
 * Orchestrates: poll → qualify → book → notify → remind
 * Handles cancellation emails mid-loop
 */

import { pollEmail, sendEmail, markAsRead } from '../tools/pollEmail.js';
import { qualifyLead } from '../agents/qualification.js';
import { checkCalendarSlots, bookSlot } from '../tools/calendar.js';
import { appendToSheet } from '../tools/sheets.js';
import { sendWhatsApp } from '../tools/whatsapp.js';
import { withRetry } from '../tools/retry.js';
import { enqueueDLQ, getDLQ } from '../tools/dlq.js';
import { isAlreadyProcessed, markProcessed } from '../tools/idempotency.js';
import { sanitizeHtml, isValidEmail, normalizePhone, validateQualification } from '../tools/sanitize.js';
import { sendReminders } from '../tools/reminders.js';
import { info, warn, error } from '../tools/logger.js';
import { sendConfirmationEmail, sendNoSlotsEmail } from './emailTemplates.js';
import { detectCancellationIntent, processCancellationEmail } from './cancellation.js';
import { detectRescheduleIntent, initiateReschedule, processSlotPreference } from './reschedule.js';
import { scoreLead, formatScore } from '../tools/leadScoring.js';

export async function runSolarAgent() {
  info('SolarAgent', 'Starting agent cycle');

  // 1. Process DLQ (retry previously failed messages)
  await processDLQ();

  // 2. Poll inbound emails
  const emails = await withRetry(() => pollEmail(), { label: 'pollEmail' });
  info('SolarAgent', `Found ${emails.length} new email(s)`);

  if (emails.length === 0) return;

  // 3. Send reminders for upcoming appointments
  withRetry(() => sendReminders(), { retries: 2, label: 'sendReminders' }).catch(e =>
    warn('SolarAgent', 'Reminder cycle failed', { error: e.message })
  );

  // 4. Process each email
  for (const rawEmail of emails) {
    const email = sanitizeInboundEmail(rawEmail);

    // Idempotency check
    if (isAlreadyProcessed(email.id)) {
      info('SolarAgent', `Skipping already-processed email: ${email.id}`);
      continue;
    }

    try {
      // Check for cancellation or reschedule intent first
      if (detectCancellationIntent(email)) {
        info('SolarAgent', `Cancellation intent detected: ${email.from}`);
        await withRetry(
          () => processCancellationEmail(email),
          { retries: 2, label: 'processCancellationEmail' }
        );
        markProcessed(email.id, { status: 'cancellation_processed' });
        continue;
      }

      if (detectRescheduleIntent(email)) {
        // Check if this is a reply with an actual slot preference (step 2)
        const threadId = email.threadId || email.id;
        const { getThreadMemory } = await import('../memory/threadMemory.js');
        const memory = getThreadMemory(threadId);

        if (memory?.status === 'reschedule_waiting_preference') {
          info('SolarAgent', `Slot preference detected for reschedule: ${email.from}`);
          const result = await withRetry(
            () => processSlotPreference(email),
            { retries: 2, label: 'processSlotPreference' }
          );
          if (result.booked) {
            markProcessed(email.id, { status: 'rescheduled' });
          }
          continue;
        }

        // Step 1: initiate reschedule
        info('SolarAgent', `Reschedule intent detected: ${email.from}`);
        await withRetry(
          () => initiateReschedule(email),
          { retries: 2, label: 'initiateReschedule' }
        );
        markProcessed(email.id, { status: 'reschedule_initiated' });
        continue;
      }

      await processEmail(email);
      markProcessed(email.id, { status: 'success' });

    } catch (err) {
      error('SolarAgent', `Failed to process email ${email.id}`, { error: err.message });
      enqueueDLQ({
        emailId: email.id,
        from: email.from,
        subject: email.subject,
        error: err.message,
        attempts: 0,
      });
    }
  }
}

async function processEmail(email) {
  info('SolarAgent', `Processing: ${email.from} — "${email.subject}"`);

  // Validate sender
  if (!isValidEmail(email.from)) {
    warn('SolarAgent', 'Invalid sender email, skipping', { from: email.from });
    return;
  }

  // 1. Qualify the lead
  const qualification = await withRetry(
    () => qualifyLead(email),
    { retries: 3, baseDelayMs: 1500, label: 'qualifyLead' }
  );
  info('SolarAgent', 'Qualification result', qualification);

  // Validate qualification output
  const { valid, errors } = validateQualification(qualification);
  if (!valid) {
    warn('SolarAgent', 'Qualification validation failed', { errors });
  }

  // Normalize phone if present
  if (qualification.phone) {
    qualification.phone = normalizePhone(qualification.phone);
  }

  // 2. Check available survey slots
  const slots = await withRetry(
    () => checkCalendarSlots(qualification.type || 'domestic'),
    { retries: 3, label: 'checkCalendarSlots' }
  );
  info('SolarAgent', `Found ${slots.length} available slot(s)`);

  if (slots.length === 0) {
    await withRetry(
      () => sendNoSlotsEmail(email, qualification),
      { retries: 2, label: 'sendNoSlotsEmail' }
    );
    await appendToSheet({ ...qualification, email: email.from, name: qualification.name, status: 'No slots — follow up needed' });
    return;
  }

  // 3. Book the slot
  const booked = await withRetry(
    () => bookSlot(slots[0], email, qualification),
    { retries: 3, baseDelayMs: 2000, label: 'bookSlot' }
  );
  info('SolarAgent', 'Slot booked', { start: booked.start });

  // 4. Score the lead
  const leadScore = scoreLead(qualification);
  info('SolarAgent', 'Lead score', { score: leadScore.total, band: leadScore.band.label });

  // 5. Log to Google Sheets
  await withRetry(
    () => appendToSheet({
      name: qualification.name || email.from.split('@')[0],
      email: email.from,
      type: qualification.type || 'unknown',
      property: qualification.property || '',
      bill: qualification.bill || '',
      timeline: qualification.timeline || '',
      status: 'Booked',
      slot: booked.start,
      notes: qualification.notes || '',
      score: leadScore.total,
      band: leadScore.band.label,
      recommendation: leadScore.recommendation,
    }),
    { retries: 3, label: 'appendToSheet' }
  );

  // 5. Send WhatsApp notification (non-blocking)
  if (qualification.phone) {
    withRetry(
      () => sendWhatsApp(qualification.phone,
        `Hi ${qualification.name || 'there'}, your solar survey is booked for ${formatSlot(booked.start)}. See you soon!`
      ),
      { retries: 2, label: 'sendWhatsApp' }
    ).catch(e => warn('SolarAgent', 'WhatsApp notification failed', { phone: qualification.phone, error: e.message }));
  }

  // 6. Reply to confirm booking
  await withRetry(
    () => sendConfirmationEmail(email, booked, qualification),
    { retries: 3, label: 'sendConfirmationEmail' }
  );

  // Mark as read
  await markAsRead(email.id).catch(e => warn('SolarAgent', 'Failed to mark as read', { error: e.message }));

  info('SolarAgent', `✅ Booked for ${email.from} at ${booked.start}`);
}

async function processDLQ() {
  const dlq = getDLQ();
  if (dlq.length === 0) return;
  warn('SolarAgent', `Processing ${dlq.length} DLQ entry/entries`);
}

function sanitizeInboundEmail(email) {
  return {
    ...email,
    from: email.from?.trim() || '',
    subject: sanitizeHtml(email.subject || ''),
    body: sanitizeHtml(email.body || '').slice(0, 5000),
  };
}

function formatSlot(isoString) {
  return new Date(isoString).toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}
