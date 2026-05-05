/**
 * WhatsApp Cloud API — send booking confirmation messages
 */
import 'dotenv/config';

const BASE_URL = 'https://graph.facebook.com/v18.0';

export async function sendWhatsApp(phoneNumber, message) {
  const accountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumber || !accountId || !phoneId || !token) {
    console.warn('[WhatsApp] Missing config — skipping message');
    return;
  }

  const res = await fetch(`${BASE_URL}/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneNumber.replace(/\D/g, ''), // strip non-digits
      type: 'text',
      text: { body: message },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[WhatsApp] ❌ Failed to send: ${err}`);
    return;
  }

  const data = await res.json();
  console.log(`[WhatsApp] ✅ Message sent to ${phoneNumber} — wamid: ${data.messages?.[0]?.id}`);
  return data;
}
