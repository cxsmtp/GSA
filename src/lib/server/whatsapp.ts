import { rupees } from '@/lib/shared/money';
import { bookingConfirmedMessage, waMeLink } from '@/lib/shared/whatsapp';
import { bookingFacts, type BookingRow } from './bookings';
import { run } from './db';
import { logEvent } from './log';
import { appUrl, getSettings, integrations } from './settings';

/**
 * Booking confirmations on WhatsApp.
 *
 * Free (default, from the buh project): the desk taps "Send on WhatsApp" and their WhatsApp opens
 * with the confirmation to the player's number already typed. No API, no cost.
 *
 * Automatic (optional): with WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID (Meta WhatsApp Cloud API)
 * the server sends an approved template the moment a booking is confirmed. The template
 * (WHATSAPP_TEMPLATE, default "booking_confirmed") takes five body values in this order:
 * {{1}} name, {{2}} booking ref, {{3}} date, {{4}} court & time, {{5}} amount paid.
 */

export function confirmationText(b: BookingRow, base = ''): string {
  const a = getSettings('academy');
  return bookingConfirmedMessage({ ...bookingFacts(b), amount: rupees(b.amount_paise), academy: a.name, link: base ? `${base}/pay/${b.token}` : undefined });
}

/** The desk's one-tap link to send the confirmation from their own WhatsApp. */
export function deskConfirmLink(b: BookingRow, base = ''): string | null {
  return waMeLink(b.phone, confirmationText(b, base));
}

export async function sendAutomaticConfirmation(b: BookingRow): Promise<'sent' | 'off' | 'failed'> {
  if (!integrations().whatsappApi) return 'off';
  const facts = bookingFacts(b);
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID!)}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: b.phone,
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE || 'booking_confirmed',
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
      components: [
        {
          type: 'body',
          parameters: [b.name.split(/\s+/)[0] || b.name, b.ref, facts.dateLabel, facts.slots, rupees(b.amount_paise)].map((text) => ({ type: 'text', text: text.slice(0, 200) })),
        },
      ],
    },
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const ok = res.ok;
    const detail = ok ? '' : (await res.text().catch(() => '')).slice(0, 300);
    run('INSERT INTO notifications (booking_id, channel, status, detail, created_at) VALUES (?,?,?,?,?)', b.id, 'whatsapp_api', ok ? 'sent' : 'failed', detail, new Date().toISOString());
    if (ok) run('UPDATE bookings SET wa_sent_at = ? WHERE id = ?', new Date().toISOString(), b.id);
    else logEvent('warn', 'whatsapp_send_failed', { status: res.status, ref: b.ref });
    return ok ? 'sent' : 'failed';
  } catch (err) {
    run('INSERT INTO notifications (booking_id, channel, status, detail, created_at) VALUES (?,?,?,?,?)', b.id, 'whatsapp_api', 'failed', err instanceof Error ? err.message.slice(0, 300) : 'error', new Date().toISOString());
    return 'failed';
  }
}

export { appUrl };
