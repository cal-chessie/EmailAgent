/**
 * Outreach CLI — Cal's approval gate until the harness-v2 ApprovalsPanel lands.
 *
 *   npm run outreach -- draft [N] [priority]   draft N messages (default 5, priority A)
 *   npm run outreach -- list [status]          list campaign messages
 *   npm run outreach -- show <id>              full body of one draft
 *   npm run outreach -- approve <id>|all       approve one (or all pending)
 *   npm run outreach -- reject <id>            reject one
 *   npm run outreach -- send [--dry-run]       send approved (daily-capped)
 */
import { CAMPAIGN } from './template.js';
import * as crm from './crm.js';
import { draftBatch, approve, reject, sendApproved } from './engine.js';

const [cmd, ...args] = process.argv.slice(2);

if (!crm.crmConfigured()) {
  console.error('Set CRM_SUPABASE_URL and CRM_SERVICE_ROLE_KEY first.');
  process.exit(1);
}

const fmt = (m) =>
  `${m.id.slice(0, 8)}  [${m.status}]  ${m.contacts?.companies?.name ?? '?'} — ${m.contacts?.name ?? '?'} <${m.contacts?.email ?? '?'}>`;

switch (cmd) {
  case 'draft': {
    const n = parseInt(args[0] || '5', 10);
    const priority = args[1] || 'A';
    const drafts = await draftBatch({ limit: n, priority });
    console.log(`\nDrafted ${drafts.length} message(s) for campaign "${CAMPAIGN}" (priority ${priority}).`);
    console.log('Review with: npm run outreach -- list pending_approval');
    break;
  }
  case 'list': {
    const rows = await crm.listMessages(args[0] || null, CAMPAIGN);
    rows.forEach((m) => console.log(fmt(m)));
    console.log(`\n${rows.length} message(s).`);
    break;
  }
  case 'show': {
    const m = await crm.getMessage(args[0]);
    if (!m) { console.error('Not found (use the full uuid from list).'); process.exit(1); }
    console.log(`To:      ${m.contacts?.name} <${m.contacts?.email}> (${m.contacts?.companies?.name})`);
    console.log(`From:    ${m.send_from}\nReplyTo: ${m.reply_to}\nStatus:  ${m.status}`);
    console.log(`Subject: ${m.subject}\n\n${m.body}`);
    break;
  }
  case 'approve': {
    if (args[0] === 'all') {
      const rows = await crm.listMessages('pending_approval', CAMPAIGN);
      for (const m of rows) await approve(m.id);
      console.log(`Approved ${rows.length} message(s).`);
    } else {
      await approve(args[0]);
      console.log('Approved.');
    }
    break;
  }
  case 'reject': {
    await reject(args[0]);
    console.log('Rejected.');
    break;
  }
  case 'send': {
    const result = await sendApproved({ dryRun: args.includes('--dry-run') });
    console.log(`Sent: ${result.sent} · Skipped: ${result.skipped}`);
    break;
  }
  default:
    console.log('Commands: draft [N] [priority] · list [status] · show <id> · approve <id>|all · reject <id> · send [--dry-run]');
}
