/**
 * Kernel bridge — emits booking events into the AIOS kernel's immutable,
 * per-tenant hash chain via public.kernel_emit (service_role only).
 *
 * THE LAW (KERNEL_INTELLIGENCE.md):
 *  - Tenant always EXPLICIT — no fallback, crash not misfile.
 *  - Refs only, never PII: no names, emails or phone numbers in payloads.
 *  - Event types must be pre-registered in kernel.event_types.
 *
 * Env:
 *  KERNEL_SUPABASE_URL      https://<kernel-project>.supabase.co
 *  KERNEL_SERVICE_ROLE_KEY  service_role key (server-only — never ship to a client)
 *  KERNEL_TENANT_ID         the tenant whose chain these bookings belong to
 *                           (steward chain for Renewably installer calls;
 *                            the county operator's tenant for homeowner surveys)
 *  KERNEL_EVENT_TYPE        registered type: 'CallBooked' (installer sales
 *                           calls) or 'SurveyBookingCreated' (homeowner surveys)
 *
 * Fail-safe: if unconfigured, logs and returns — the booking flow must never
 * break because the kernel is unreachable. Failed emits land in the DLQ for
 * manual replay.
 */
import { createHash } from 'crypto';
import { withRetry } from './retry.js';
import { enqueueDLQ } from './dlq.js';
import { info, warn } from './logger.js';

const url = process.env.KERNEL_SUPABASE_URL;
const key = process.env.KERNEL_SERVICE_ROLE_KEY;
const tenantId = process.env.KERNEL_TENANT_ID;
const eventType = process.env.KERNEL_EVENT_TYPE || 'CallBooked';

export function kernelConfigured() {
  return Boolean(url && key && tenantId);
}

// Stable pseudonymous ref for a contact — lets the kernel correlate events
// for the same person without ever carrying their address.
export function contactRef(emailAddress = '') {
  return 'sha256:' + createHash('sha256').update(emailAddress.trim().toLowerCase()).digest('hex').slice(0, 24);
}

export async function emitBookingEvent({ emailAddress, slotStart, slotEnd, calendarEventId, score, band, leadType }) {
  if (!kernelConfigured()) {
    warn('Kernel', 'KERNEL_SUPABASE_URL/SERVICE_ROLE_KEY/TENANT_ID not set — booking not emitted to kernel.');
    return null;
  }

  const payload = {
    contact_ref: contactRef(emailAddress),
    slot_start: slotStart,
    slot_end: slotEnd || null,
    calendar_event_id: calendarEventId || null,
    lead_type: leadType || null,
    score: typeof score === 'number' ? score : null,
    band: band || null,
    source: 'email-agent',
  };

  try {
    const result = await withRetry(async () => {
      const res = await fetch(`${url}/rest/v1/rpc/kernel_emit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ p_tenant: tenantId, p_type: eventType, p_payload: payload }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`kernel_emit ${res.status}: ${text}`);
      // kernel_emit may return an empty body — a 2xx IS success. Never throw
      // after this point: the event is on the immutable chain, and a retry
      // would write a duplicate.
      try { return text ? JSON.parse(text) : { ok: true }; } catch { return { ok: true, raw: text }; }
    }, { retries: 3, baseDelayMs: 1500, label: 'kernelEmit' });

    info('Kernel', `${eventType} emitted to tenant chain`, { contact_ref: payload.contact_ref });
    return result;
  } catch (err) {
    enqueueDLQ({ emailId: `kernel:${payload.contact_ref}`, error: err.message, kind: 'kernel-emit', eventType, payload });
    return null;
  }
}
