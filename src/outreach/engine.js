/**
 * Outreach engine — draft, approve, send. Cohort one: EVERY send is
 * explicitly approved by Cal (kernel require_approval philosophy, enforced
 * here until harness-v2 deploys).
 *
 * Message lifecycle in outreach_messages.status:
 *   pending_approval → approved → sent   (or → rejected)
 *
 * Env (on top of crm.js):
 *  RESEND_API_KEY        Resend API key — absent = dry-run, nothing sends
 *  OUTREACH_FROM         e.g. "Cal Chesters <cal@aisolar.ie>" (verified in Resend)
 *  OUTREACH_REPLY_TO     e.g. "connect@aisolar.ie" (the agent-polled mailbox)
 *  OUTREACH_DAILY_CAP    default 40
 */
import { CAMPAIGN, renderSubject, renderBody } from './template.js';
import * as crm from './crm.js';
import { withRetry } from '../tools/retry.js';
import { enqueueDLQ } from '../tools/dlq.js';
import { info, warn } from '../tools/logger.js';

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.OUTREACH_FROM || 'Cal <cal@aisolar.ie>';
const REPLY_TO = process.env.OUTREACH_REPLY_TO || 'connect@aisolar.ie';
const DAILY_CAP = parseInt(process.env.OUTREACH_DAILY_CAP || '40', 10);

export async function draftBatch({ limit = 10, priority = 'A' } = {}) {
  const contacts = await crm.pickContacts({ campaign: CAMPAIGN, limit, priority });
  const drafts = [];
  for (const c of contacts) {
    const fields = {
      name: c.name,
      company: c.companies?.name,
      county: c.companies?.counties,
      installsPerYear: c.companies?.installs_per_year,
    };
    const draft = await crm.insertDraft({
      contact_id: c.id,
      company_id: c.company_id,
      channel: 'email',
      direction: 'outbound',
      touch: 1,
      campaign: CAMPAIGN,
      subject: renderSubject(fields),
      body: renderBody(fields),
      status: 'pending_approval',
      send_from: FROM,
      reply_to: REPLY_TO,
    });
    drafts.push(draft);
    info('Outreach', `Draft for ${c.name} <${c.email}> (${fields.company})`);
  }
  return drafts;
}

export async function approve(id) {
  return crm.setStatus(id, 'approved');
}

export async function reject(id) {
  return crm.setStatus(id, 'rejected');
}

export async function sendApproved({ dryRun = false } = {}) {
  const approved = await crm.listMessages('approved', CAMPAIGN);
  if (!approved?.length) {
    info('Outreach', 'Nothing approved to send.');
    return { sent: 0, skipped: 0 };
  }

  const alreadyToday = await crm.sentTodayCount(CAMPAIGN);
  let budget = Math.max(0, DAILY_CAP - alreadyToday);
  let sent = 0, skipped = 0;

  for (const m of approved) {
    if (budget <= 0) { skipped++; continue; }
    const full = await crm.getMessage(m.id);
    const to = full?.contacts?.email;
    if (!to) { warn('Outreach', `No email on contact for message ${m.id} — skipping`); skipped++; continue; }

    if (dryRun || !RESEND_KEY) {
      info('Outreach', `[DRY-RUN] Would send "${full.subject}" → ${to}`);
      skipped++;
      continue;
    }

    try {
      const result = await withRetry(async () => {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: full.send_from || FROM,
            to: [to],
            reply_to: full.reply_to || REPLY_TO,
            subject: full.subject,
            text: full.body,
          }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Resend ${res.status}: ${text}`);
        return text ? JSON.parse(text) : {};
      }, { retries: 2, baseDelayMs: 2000, label: 'resendSend' });

      await crm.setStatus(m.id, 'sent', { provider_id: result.id || null });
      await crm.touchContact(full.contact_id);
      emitOutreachSent(full, to);
      sent++; budget--;
      info('Outreach', `Sent "${full.subject}" → ${to}`);
    } catch (err) {
      enqueueDLQ({ emailId: `outreach:${m.id}`, error: err.message, kind: 'outreach-send' });
      skipped++;
    }
  }
  return { sent, skipped };
}

// Refs-only kernel event on the steward chain (fire-and-forget)
async function emitOutreachSent(message, to) {
  try {
    const { emitBookingEvent, contactRef, kernelConfigured } = await import('../tools/kernel.js');
    if (!kernelConfigured()) return;
    const url = process.env.KERNEL_SUPABASE_URL;
    const key = process.env.KERNEL_SERVICE_ROLE_KEY;
    const tenantId = process.env.KERNEL_TENANT_ID;
    await fetch(`${url}/rest/v1/rpc/kernel_emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        p_tenant: tenantId,
        p_type: 'OutreachSent',
        p_payload: {
          contact_ref: contactRef(to),
          message_id: message.id,
          campaign: message.campaign,
          touch: message.touch,
          channel: message.channel,
          source: 'email-agent-outreach',
        },
      }),
    });
  } catch (err) {
    warn('Outreach', `OutreachSent kernel emit failed (non-blocking): ${err.message}`);
  }
}
