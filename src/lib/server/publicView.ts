import { rupees } from '@/lib/shared/money';
import { playerConfirmMessage, waMeLink } from '@/lib/shared/whatsapp';
import { fmtDate } from '@/lib/shared/time';
import { slotsLabel, slotsOf, sweepExpired, type BookingRow } from './bookings';
import { get } from './db';
import { razorpayOn, upiLink } from './payments';
import { ensureFirstAdmin } from './auth';
import { getSettings, integrations } from './settings';
import type { PublicConfig } from '@/lib/shared/types';
import { todayIst } from '@/lib/shared/time';

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
  const a = getSettings('academy');
  const b = getSettings('booking');
  const g = getSettings('gst');
  return {
    academy: { name: a.name, tagline: a.tagline, city: a.city, phone: a.phone, whatsapp: a.whatsapp, address: a.address, mapUrl: a.mapUrl, email: a.email, instagram: a.instagram },
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
  const a = getSettings('academy');
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
    slots: slots.map((s) => ({ court: s.courtName, start: s.start, end: s.end, price: s.price })),
    slotsLabel: slotsLabel(slots),
    base: fresh.base_paise,
    amount: fresh.amount_paise,
    amountLabel: rupees(fresh.amount_paise),
    holdExpiresAt: fresh.status === 'held' ? fresh.hold_expires_at : null,
    cancelReason: fresh.cancel_reason,
    pendingReference: pending?.reference ?? null,
    upi: fresh.status === 'held' || fresh.status === 'expired' ? (bk.upiEnabled ? upiLink(fresh.amount_paise, fresh.ref) : null) : null,
    upiVpa: bk.upiEnabled ? a.upiVpa : '',
    upiPayee: a.upiPayee || a.name,
    razorpay: razorpayOn() && fresh.status === 'held',
    whatsappConfirm: waMeLink(a.whatsapp, playerConfirmMessage(fresh.ref, fresh.confirm_code)),
    waAuto: integrations().whatsappApi,
    invoice: invoice ? { token: invoice.token, number: invoice.number } : null,
    academy: { name: a.name, phone: a.phone, whatsapp: a.whatsapp, mapUrl: a.mapUrl, address: a.address },
  };
}
