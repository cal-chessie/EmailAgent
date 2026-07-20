/**
 * The cohort-one outreach email. Cal-editable — keep it short, honest and
 * personal. The demo IS the reply: answering this email puts the prospect
 * into the booking agent's inbox, and it books them into Cal's calendar
 * on autopilot. That loop is the product being sold.
 *
 * Available fields: {name} {firstName} {company} {county} {installsPerYear}
 */

export const CAMPAIGN = 'cohort-one';

export function renderSubject(fields) {
  return fill('The agent that sent this can work for {company}', fields);
}

export function renderBody(fields) {
  return fill(
    `Hi {firstName},

I run Renewably — we build AI agents for Irish solar installers.

Here's the honest pitch: this email was queued, personalised and sent by my
own outreach agent. If you reply, a second agent will read your answer,
qualify it, and book you straight into my calendar — no back-and-forth.
That whole loop, working for {company} instead of me, is what I sell.

It handles inbound enquiries, qualifies leads by bill size, books surveys,
and confirms by WhatsApp — while your crew is on the roof.

Reply with anything (even "go on then") and you'll see it work.

Cal
Renewably — AI workforce for solar installers
renewably.ie`,
    fields
  );
}

function fill(tpl, fields = {}) {
  const name = (fields.name || '').trim();
  const merged = {
    name: name || 'there',
    firstName: (name.split(/\s+/)[0] || 'there'),
    company: fields.company || 'your company',
    county: fields.county || '',
    installsPerYear: fields.installsPerYear ?? '',
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(merged[k] ?? ''));
}
