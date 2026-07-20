/**
 * Outreach Approval Dashboard — Cal's gate. Shows every draft in full,
 * exactly as it will send. Nothing leaves without a click here (or the CLI).
 *
 *   npm run outreach:dashboard   →  http://localhost:3100/?token=<DASHBOARD_AUTH_TOKEN>
 *
 * Fail-closed: unset or 'changeme' DASHBOARD_AUTH_TOKEN refuses all requests.
 * Requires CRM_SUPABASE_URL + CRM_SERVICE_ROLE_KEY (server-only).
 */
import http from 'http';
import 'dotenv/config';
import { CAMPAIGN } from './template.js';
import * as crm from './crm.js';
import { approve, reject, sendApproved } from './engine.js';

const PORT = parseInt(process.env.OUTREACH_DASHBOARD_PORT || '3100', 10);
const AUTH_TOKEN = process.env.DASHBOARD_AUTH_TOKEN || 'changeme';

function authed(req, url) {
  if (!AUTH_TOKEN || AUTH_TOKEN === 'changeme') return false;
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return url.searchParams.get('token') === AUTH_TOKEN || bearer === AUTH_TOKEN;
}

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function card(m, token) {
  const c = m.contacts || {};
  return `
  <div class="card">
    <div class="meta">
      <b>${esc(c.companies?.name ?? '?')}</b> — ${esc(c.name ?? '?')} &lt;${esc(c.email ?? '?')}&gt;
      <span class="status s-${esc(m.status)}">${esc(m.status)}</span>
    </div>
    <div class="meta sub">From: ${esc(m.send_from)} · Reply-To: ${esc(m.reply_to)} · Campaign: ${esc(m.campaign)}</div>
    <div class="subject">${esc(m.subject)}</div>
    <pre class="body">${esc(m.body)}</pre>
    ${m.status === 'pending_approval' ? `
    <details><summary>✎ Edit before approving</summary>
      <form method="POST" action="/action?token=${token}">
        <input type="hidden" name="id" value="${m.id}">
        <input type="text" name="subject" value="${esc(m.subject)}" class="edit-subject">
        <textarea name="body" rows="14" class="edit-body">${esc(m.body)}</textarea>
        <button name="do" value="save" class="save">💾 Save changes</button>
      </form>
    </details>
    <form method="POST" action="/action?token=${token}">
      <input type="hidden" name="id" value="${m.id}">
      <button name="do" value="approve" class="approve">✓ Approve</button>
      <button name="do" value="reject" class="reject">✕ Reject</button>
    </form>` : ''}
  </div>`;
}

async function page(token) {
  const pending = await crm.listMessages('pending_approval', CAMPAIGN);
  const approved = await crm.listMessages('approved', CAMPAIGN);
  const sent = await crm.listMessages('sent', CAMPAIGN);
  const full = await Promise.all([...pending, ...approved].map((m) => crm.getMessage(m.id)));

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Outreach Approvals — ${esc(CAMPAIGN)}</title>
<style>
body{font-family:-apple-system,sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:32px;max-width:780px;margin:auto}
h1{font-size:20px} .counts{color:#8a8f98;margin-bottom:24px}
.card{background:#171a21;border:1px solid #262b36;border-radius:10px;padding:18px;margin-bottom:18px}
.meta{font-size:14px} .sub{color:#8a8f98;font-size:12px;margin-top:4px}
.subject{font-weight:600;margin:12px 0 6px}
.body{white-space:pre-wrap;font-family:inherit;background:#0f1115;border:1px solid #262b36;border-radius:8px;padding:14px;font-size:14px;line-height:1.55}
.status{float:right;font-size:11px;padding:2px 8px;border-radius:10px;border:1px solid #444}
.s-pending_approval{color:#f5c451;border-color:#f5c451}.s-approved{color:#4ade80;border-color:#4ade80}
button{padding:8px 16px;border-radius:8px;border:0;cursor:pointer;font-weight:600;margin-right:8px}
.approve{background:#16a34a;color:#fff}.reject{background:#3f3f46;color:#ddd}.save{background:#7c3aed;color:#fff;margin-top:8px}
details{margin:10px 0}summary{cursor:pointer;color:#8a8f98;font-size:13px}
.edit-subject,.edit-body{width:100%;box-sizing:border-box;background:#0f1115;color:#e6e6e6;border:1px solid #262b36;border-radius:8px;padding:10px;font-size:14px;font-family:inherit;margin-top:8px}
.sendall{background:#2563eb;color:#fff;padding:10px 18px}
</style></head><body>
<h1>Outreach Approvals · ${esc(CAMPAIGN)}</h1>
<div class="counts">${pending.length} awaiting your approval · ${approved.length} approved (unsent) · ${sent.length} sent</div>
${approved.length ? `<form method="POST" action="/action?token=${token}"><button name="do" value="send" class="sendall">📤 Send ${approved.length} approved now (daily cap applies)</button></form><br>` : ''}
${full.map((m) => card(m, token)).join('') || '<p>No drafts. Create some with: npm run outreach -- draft 5 A</p>'}
</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (!authed(req, url)) { res.writeHead(401); return res.end('Unauthorized — append ?token=<DASHBOARD_AUTH_TOKEN>'); }

  try {
    if (req.method === 'POST' && url.pathname === '/action') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const action = form.get('do');
      if (action === 'approve') await approve(form.get('id'));
      if (action === 'reject') await reject(form.get('id'));
      if (action === 'save') await crm.setStatus(form.get('id'), 'pending_approval', { subject: form.get('subject'), body: form.get('body') });
      if (action === 'send') await sendApproved({});
      res.writeHead(303, { Location: `/?token=${url.searchParams.get('token')}` });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(await page(url.searchParams.get('token')));
  } catch (err) {
    res.writeHead(500); res.end(`Error: ${err.message}`);
  }
});

if (!crm.crmConfigured()) {
  console.error('Set CRM_SUPABASE_URL and CRM_SERVICE_ROLE_KEY first.');
  process.exit(1);
}
server.listen(PORT, '127.0.0.1', () =>
  console.log(`Outreach approvals: http://localhost:${PORT}/?token=<your DASHBOARD_AUTH_TOKEN>`)
);
