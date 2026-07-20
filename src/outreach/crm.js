/**
 * Renewably CRM (Supabase) client for the outreach engine.
 * Talks to the CRM project's REST API with the service key — server-only.
 *
 * Env:
 *  CRM_SUPABASE_URL       https://<crm-project>.supabase.co
 *  CRM_SERVICE_ROLE_KEY   CRM service_role key (server-only)
 */

const url = process.env.CRM_SUPABASE_URL;
const key = process.env.CRM_SERVICE_ROLE_KEY;

export function crmConfigured() {
  return Boolean(url && key);
}

async function rest(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=representation',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`CRM ${method} ${path} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Priority-ordered decision-maker contacts not yet drafted for this campaign. */
export async function pickContacts({ campaign, limit = 20, priority = 'A' }) {
  const drafted = await rest(
    `outreach_messages?select=contact_id&campaign=eq.${encodeURIComponent(campaign)}`
  );
  const excluded = new Set((drafted || []).map((r) => r.contact_id).filter(Boolean));

  const rows = await rest(
    `contacts?select=id,name,email,company_id,companies!inner(name,counties,priority,installs_per_year)` +
      `&email=not.is.null` +
      `&companies.priority=eq.${encodeURIComponent(priority)}` +
      `&order=created_at.asc&limit=${limit + excluded.size}`
  );

  return (rows || [])
    .filter((r) => r.email && r.email.trim() && !excluded.has(r.id))
    .slice(0, limit);
}

export async function insertDraft(row) {
  const [inserted] = await rest('outreach_messages', { method: 'POST', body: row });
  return inserted;
}

export async function listMessages(status, campaign) {
  return rest(
    `outreach_messages?select=id,subject,status,campaign,created_at,contact_id,contacts(name,email,companies(name))` +
      `&campaign=eq.${encodeURIComponent(campaign)}` +
      (status ? `&status=eq.${encodeURIComponent(status)}` : '') +
      `&order=created_at.asc`
  );
}

export async function getMessage(id) {
  const rows = await rest(
    `outreach_messages?select=*,contacts(name,email,companies(name))&id=eq.${id}`
  );
  return rows?.[0] ?? null;
}

export async function setStatus(id, status, extra = {}) {
  const rows = await rest(`outreach_messages?id=eq.${id}`, {
    method: 'PATCH',
    body: { status, ...extra },
  });
  return rows?.[0] ?? null;
}

export async function touchContact(contactId) {
  await rest(`contacts?id=eq.${contactId}`, {
    method: 'PATCH',
    body: { last_contact_at: new Date().toISOString() },
  });
}

/** Sent today for the daily cap. */
export async function sentTodayCount(campaign) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await rest(
    `outreach_messages?select=id&campaign=eq.${encodeURIComponent(campaign)}` +
      `&status=eq.sent&created_at=gte.${today}`
  );
  return rows?.length ?? 0;
}
