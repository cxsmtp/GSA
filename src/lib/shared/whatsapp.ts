/**
 * WhatsApp without an API: a wa.me link opens the person's own WhatsApp with the message already
 * typed; they only tap Send. The player tells the manager "I'm booked"; the manager sends phone
 * bookings their confirmation.
 */

/** Indian mobile → "91XXXXXXXXXX"; null when not a valid 10-digit Indian mobile. */
export function normalizeIndianMobile(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let d = String(input).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return null;
  return `91${d}`;
}

/** "+91 98290 12345". */
export function prettyMobile(msisdn: string): string {
  const d = msisdn.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return `+${d}`;
}

/** Last four digits, for staff screens and logs where the full number isn't needed. */
export function maskMobile(msisdn: string): string {
  const d = msisdn.replace(/\D/g, '');
  return d.length >= 4 ? `••••• ${d.slice(-4)}` : '•••';
}

export function waMeLink(number: string, message: string): string | null {
  const digits = (number || '').replace(/\D/g, '');
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export interface BookingMessageFacts {
  ref: string;
  name: string;
  dateLabel: string;
  slots: string;
  amount: string;
  business: string;
  link?: string;
}

/** What the player sends the manager once booked and paid. */
export function playerBookedMessage(f: BookingMessageFacts, paidBy: string): string {
  return [
    `Hi! I'm booked ✅`,
    ``,
    `Name: ${f.name}`,
    `Ref: ${f.ref}`,
    `Date: ${f.dateLabel}`,
    `Where & when: ${f.slots}`,
    `Paid: ${f.amount}${paidBy ? ` (${paidBy})` : ''}`,
  ].join('\n');
}

/**
 * Where the money stands for a booking, as the player should read it:
 *   paid       verified in full
 *   verifying  paid (cash noted by the manager, or a UPI reference given) and being checked by the admin
 *   due        nothing received yet (phone bookings: pay at the venue or online with the link)
 */
export type PayState = 'paid' | 'verifying' | 'due';

/** What the business sends to the player: confirmed or not, always with the payment position. */
export function bookingConfirmedMessage(f: BookingMessageFacts & { payState?: PayState; due?: string; note?: string }): string {
  const first = f.name.trim().split(/\s+/)[0] || '';
  const state = f.payState ?? 'paid';
  const payLine =
    state === 'paid' ? `Payment: ${f.amount} received ✓` : state === 'verifying' ? `Payment: ${f.amount} received, being verified` : `Payment due: ${f.due ?? f.amount} (pay at the venue, or online with the link below)`;
  return [
    `✅ Booked${first ? `, ${first}` : ''}!`,
    ``,
    `${f.business}`,
    `Ref: ${f.ref}`,
    `Date: ${f.dateLabel}`,
    `Where & when: ${f.slots}`,
    `Total: ${f.amount}`,
    payLine,
    ...(f.link ? [``, `${state === 'due' ? 'Your booking & payment' : 'Your booking & receipt'}: ${f.link}`] : []),
    ...(f.note ? [``, f.note] : []),
  ].join('\n');
}
