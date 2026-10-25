import { rupees } from '@/lib/shared/money';
import { fmtDate } from '@/lib/shared/time';
import { slotsLabel, slotsOf, sweepExpired, type BookingRow } from './bookings';
import { get } from './db';
import { razorpayOn, upiLink } from './payments';
import { payStateOf, playerBookedLink } from './whatsapp';
import { ensureFirstAdmin } from './auth';
import { getSettings, integrations } from './settings';
import type { PublicConfig } from '@/lib/shared/types';
import { todayIst } from '@/lib/shared/time';
import { safeHttpsUrl } from '@/lib/shared/url';

let started = false;
/** One-time start-up work on the first request. */
export async function startup() {
  if (started) return;
  started = true;
  await ensureFirstAdmin();
  const { seedDefaults } = await import('./seed');
  seedDefaults();
}

export function publicConfig(): PublicConfig {
  const a = getSettings('business');
  const b = getSettings('booking');
  const g = getSettings('gst');
  return {
    business: { name: a.name, tagline: a.tagline, city: a.city, phone: a.phone, whatsapp: a.whatsapp, address: a.address, mapUrl: safeHttpsUrl(a.mapUrl) ?? '', email: a.email, instagram: a.instagram },
    booking: { daysAhead: b.daysAhead, maxSlots: b.maxSlots, holdMinutes: b.holdMinutes, slotMinutes: b.slotMinutes },
    gst: { mode: g.mode, ratePct: g.ratePct, pricesIncludeGst: g.pricesIncludeGst },
    pay: { upi: b.upiEnabled && Boolean(a.upiVpa), razorpay: razorpayOn() },
    today: todayIst(),
  };
}

export type PublicBooking = ReturnType<typeof publicBooking>;

/** What the player's own booking page shows (reached only through its unguessable link). */
export function publicBooking(b: BookingRow) {
  sweepExpired();
  const fresh = get<BookingRow>('SELECT * FROM bookings WHERE id = ?', b.id) ?? b;
  const a = getSettings('business');
  const bk = getSettings('booking');
  const slots = slotsOf(fresh);
  const pending = get<{ reference: string; method: string }>("SELECT reference, method FROM payments WHERE booking_id = ? AND status = 'pending' AND reference <> '' ORDER BY id DESC LIMIT 1", fresh.id);
  const invoice = fresh.status === 'confirmed' ? get<{ token: string; number: string }>("SELECT token, number FROM invoices WHERE booking_id = ? AND status = 'issued' ORDER BY id DESC LIMIT 1", fresh.id) : undefined;
  return {
    ref: fresh.ref,
    token: fresh.token,
    status: fresh.status,
    date: fresh.date,
    dateLabel: fmtDate(fresh.date),
    name: fresh.name,
    phoneLast4: fresh.phone.slice(-4),
    slots: slots.map((s) => ({ space: s.spaceName, start: s.start, end: s.end, price: s.price })),
    slotsLabel: slotsLabel(slots),
    base: fresh.base_paise,
    amount: fresh.amount_paise,
    amountLabel: rupees(fresh.amount_paise),
    holdExpiresAt: fresh.status === 'held' ? fresh.hold_expires_at : null,
    cancelReason: fresh.cancel_reason,
    pendingReference: pending?.reference ?? null,
    // Online holds, and phone bookings with money still due, can be paid from this page.
    upi: ['held', 'expired', 'reserved'].includes(fresh.status) ? (bk.upiEnabled ? upiLink(fresh.amount_paise, fresh.ref) : null) : null,
    upiVpa: bk.upiEnabled ? a.upiVpa : '',
    upiPayee: a.upiPayee || a.name,
    razorpay: razorpayOn() && (fresh.status === 'held' || fresh.status === 'reserved'),
    payState: payStateOf(fresh).payState,
    phoneBooking: fresh.source === 'desk',
    // After an online booking is paid: one tap opens the player's WhatsApp with "I'm booked" to the manager.
    tellManager: fresh.source === 'online' ? playerBookedLink(fresh) : null,
    toldManager: Boolean(fresh.wa_opened_at),
    invoice: invoice ? { token: invoice.token, number: invoice.number } : null,
    business: { name: a.name, phone: a.phone, whatsapp: a.whatsapp, mapUrl: safeHttpsUrl(a.mapUrl) ?? '', address: a.address },
  };
}
