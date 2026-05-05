/**
 * Gmail API — poll and send emails via Google Service Account
 */
import { google } from 'googleapis';
import 'dotenv/config';

function getGmailClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      client_email: process.env.GMAIL_CLIENT_EMAIL,
      private_key: process.env.GMAIL_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
  });
  return google.gmail({ version: 'v1', auth });
}

export async function pollEmail() {
  const gmail = getGmailClient();
  const user = process.env.GMAIL_USER_EMAIL;

  const res = await gmail.users.messages.list({
    userId: user,
    q: process.env.INBOUND_EMAIL_FILTER || 'is:unread',
    maxResults: 10,
  });

  const messages = res.data.messages || [];

  const emails = await Promise.all(
    messages.map(async (msg) => {
      const m = await gmail.users.messages.get({ userId: user, id: msg.id });
      const headers = m.data.payload.headers;
      const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

      // Parse body
      let body = '';
      if (m.data.payload.body?.data) {
        body = Buffer.from(m.data.payload.body.data, 'base64').toString('utf8');
      } else if (m.data.payload.parts) {
        for (const part of m.data.payload.parts) {
          if (part.body?.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf8');
            break;
          }
        }
      }

      return {
        id: m.data.id,
        from: getHeader('From'),
        subject: getHeader('Subject'),
        body,
        threadId: m.data.threadId,
      };
    })
  );

  return emails;
}

export async function sendEmail(to, subject, body) {
  const gmail = getGmailClient();
  const user = process.env.GMAIL_USER_EMAIL;

  const encoded = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  await gmail.users.messages.send({
    userId: user,
    requestBody: { raw: encoded },
  });
}

export async function markAsRead(emailId) {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: process.env.GMAIL_USER_EMAIL,
    id: emailId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
}
