import { rupees } from '@/lib/shared/money';
import { bookingConfirmedMessage, playerBookedMessage, prettyMobile, waMeLink, type PayState } from '@/lib/shared/whatsapp';
import { healthLabel } from '@/lib/shared/participant';
import { bookingFacts, healthOf, type BookingRow } from './bookings';
import { get, run } from './db';
import { getSettings } from './settings';

/**
 * WhatsApp, phone-native: no API, no cost. Every message is a wa.me link that opens the sender's own
 * WhatsApp with the text already typed; they only tap Send.
 *  - Player → manager: "I'm booked" with the ref, date, slots and UPI reference (playerBookedLink).
 *  - Manager → player: the booking with its payment position, for phone bookings (deskConfirmLink).
 */

/**
 * Paid, being verified, or due — and how much is still due. Shown to admin and manager alike. Money the
 * manager noted at the desk, or a UPI reference the player typed, counts as "being verified" until the admin
 * checks it (an unfinished Razorpay checkout does not count).
 */
export function payStateOf(b: BookingRow): { payState: PayState; due: number } {
  const r = get<{ verified: number | null; pending: number | null }>(
    `SELECT SUM(CASE WHEN status = 'verified' THEN (CASE direction WHEN 'in' THEN amount_paise ELSE -amount_paise END) ELSE 0 END) AS verified,
            SUM(CASE WHEN status = 'pending' AND direction = 'in' AND (reference <> '' OR created_by <> 'player') THEN amount_paise ELSE 0 END) AS pending
       FROM payments WHERE booking_id = ?`,
    b.id,
  );
  const verified = r?.verified ?? 0;
  const pending = r?.pending ?? 0;
  if (verified >= b.amount_paise) return { payState: 'paid', due: 0 };
  if (verified + pending >= b.amount_paise) return { payState: 'verifying', due: 0 };
  return { payState: 'due', due: b.amount_paise - verified - pending };
}

export function confirmationText(b: BookingRow, base = ''): string {
  const a = getSettings('business');
  const { payState, due } = payStateOf(b);
  return bookingConfirmedMessage({ ...bookingFacts(b), amount: rupees(b.amount_paise), due: rupees(due), payState, business: a.name, note: a.messageNote, link: base ? `${base}/pay/${b.token}` : undefined });
}

/** The one-tap link (admin or manager) to send the booking confirmation from their own WhatsApp, for any live booking. */
export function deskConfirmLink(b: BookingRow, base = ''): string | null {
  if (!['held', 'reserved', 'submitted', 'confirmed'].includes(b.status)) return null;
  return waMeLink(b.phone, confirmationText(b, base));
}

/** The player's one tap after booking: their WhatsApp opens with "I'm booked …" to the manager's number. */
export function playerBookedLink(b: BookingRow): string | null {
  if (b.status !== 'confirmed') return null;
  const a = getSettings('business');
  const upi = get<{ reference: string; method: string }>("SELECT reference, method FROM payments WHERE booking_id = ? AND status = 'verified' AND direction = 'in' ORDER BY id DESC LIMIT 1", b.id);
  return waMeLink(a.whatsapp, playerBookedMessage({ ...bookingFacts(b), amount: rupees(b.amount_paise), business: a.name }, upi ? `${upi.method.toUpperCase()}${upi.reference ? ` ref ${upi.reference}` : ''}` : '', participantLines(b)));
}

/** Under-18 guardian and health, as lines for the manager. */
export function participantLines(b: BookingRow): string[] {
  const lines: string[] = [];
  if (b.is_minor) lines.push(`Under 18 — guardian: ${b.guardian_name} (${b.guardian_relation}), ${prettyMobile(b.guardian_phone)}`);
  const h = healthOf(b);
  if (h) lines.push(`Health: ${healthLabel(h)}`);
  return lines;
}
