/**
 * Cohort-one outreach — ATTRACTION email carrying the TIME message.
 *
 * THE RULES (Cal, 2026-07-20):
 *  - "You're not selling software. You're selling TIME." The email opens the
 *    time conversation; the full pitch (and the agent reveal) happens ON THE
 *    BOOKED CALL — see COMH/RENEWABLY/PITCH_HALF_TIME_DOUBLE_PROFIT.md.
 *  - Never reveal the product in the email. Attract, don't pitch.
 *  - Sent from AISolar in association with Renewably; renewably.ie is never
 *    the sending domain. Every send is cold outreach: short, plain-text,
 *    capped, opt-out line always.
 *
 * Available fields: {name} {firstName} {company} {county} {installsPerYear}
 */

export const CAMPAIGN = 'cohort-one';

export function renderSubject(fields) {
  return fill('admin hours at {company}', fields);
}

export function renderBody(fields) {
  return fill(
    `Hi {firstName},

Quick question: how many hours a week does {company} lose to paperwork —
quotes, SEAI forms, chasing customers, follow-ups?

Most installers we talk to say 15–20. That's half a week, every week,
that isn't installing.

We build automation that hands most of that time back, so the same team
fits more installs into the same month.

Worth 10 minutes this week? Just reply and we'll find a time.

Cal
AISolar · in association with Renewably

(Not for you? Reply "no thanks" and you won't hear from us again.)`,
    fields
  );
}

function fill(tpl, fields = {}) {
  const name = (fields.name || '').trim();
  const county = (fields.county || '').trim();
  const merged = {
    name: name || 'there',
    firstName: (name.split(/\s+/)[0] || 'there'),
    company: fields.company || 'your company',
    county: county || 'your county',
    installsPerYear: fields.installsPerYear ?? '',
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(merged[k] ?? ''));
}
