import crypto from 'node:crypto';
import { todayIst } from '@/lib/shared/time';
import type { PayMethod } from '@/lib/shared/types';
import { audit } from './audit';
import { bookingById, extendHold, reclaimSlots, setStatus, sweepExpired, type BookingRow } from './bookings';
import { all, get, isUniqueViolation, run, tx } from './db';
import { HttpError } from './http';
import { invoiceForBooking } from './invoices';
import { logEvent } from './log';
import { getSettings, integrations } from './settings';
import { safeEqual } from './secrets';
import { sendAutomaticConfirmation } from './whatsapp';

/**
 * Collecting money.
 *
 * Direct UPI (free, no gateway): the pay page opens the player's UPI app (Google Pay, PhonePe, Paytm,
 * BHIM…) with the academy's UPI ID and the exact amount filled in, or shows the same as a QR code to
 * scan. The player then types the 12-digit UPI reference (UTR); the admin checks it against the
 * bank app and taps Verify. A UTR can be used for one booking only.
 *
 * Razorpay (optional, automatic): with RAZORPAY_KEY_ID/SECRET set, "Pay instantly" opens Razorpay
 * Checkout (UPI intent to the installed apps, QR, cards). The booking confirms only on Razorpay's
 * word: a valid signature and the payment fetched back from Razorpay with the right amount, or the
 * signed webhook. Both paths are idempotent: a payment confirms a booking once.
 */

export interface PaymentRow {
  id: number;
  direction: 'in' | 'refund';
  booking_id: number | null;
  invoice_id: number | null;
  category: string;
  method: PayMethod;
  amount_paise: number;
  reference: string;
  status: 'pending' | 'verified' | 'rejected';
  date: string;
  note: string;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  created_by: string | null;
  created_at: string;
  verified_by: string | null;
  verified_at: string | null;
}

export function upiLink(amountPaise: number, ref: string): string | null {
  const a = getSettings('academy');
  if (!a.upiVpa) return null;
  const p = new URLSearchParams({
    pa: a.upiVpa,
    pn: (a.upiPayee || a.name).slice(0, 50),
    am: (amountPaise / 100).toFixed(2),
    cu: 'INR',
    tn: `${ref} court booking`.slice(0, 50),
  });
  return `upi://pay?${p.toString().replace(/\+/g, '%20')}`;
}

export const UTR_RE = /^[0-9]{12}$/;

/** The player says they paid by UPI: record the reference for the admin to verify. */
export function submitUtr(b: BookingRow, utrRaw: string, now = Date.now()): PaymentRow {
  const utr = utrRaw.replace(/\s/g, '');
  if (!UTR_RE.test(utr)) throw new HttpError(400, 'Enter the 12-digit UPI reference number (UTR) from your payment app.');
  sweepExpired(now);
  const fresh = bookingById(b.id)!;
  if (fresh.status === 'confirmed') throw new HttpError(409, 'This booking is already confirmed.');
  if (fresh.status === 'cancelled') throw new HttpError(409, 'This booking was cancelled. Please make a new booking.');
  if (fresh.status === 'submitted') {
    const pending = get<PaymentRow>("SELECT * FROM payments WHERE booking_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1", b.id);
    if (pending) return pending;
  }
  // Paid just after the hold ran out: take the courts back if they are still free.
  if (fresh.status === 'expired') reclaimSlots(fresh);
  return tx(() => {
    let id: number;
    try {
      id = run(
        `INSERT INTO payments (booking_id, category, method, amount_paise, reference, status, date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        b.id, 'court', 'upi', fresh.amount_paise, utr, 'pending', todayIst(now), 'player', new Date(now).toISOString(),
      ).lastId;
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'This UPI reference was already used for another booking. Please check the number.');
      throw err;
    }
    setStatus(b.id, 'submitted');
    audit('player', 'payment.submit_utr', 'booking', fresh.ref, { payment: id, amount: fresh.amount_paise });
    return get<PaymentRow>('SELECT * FROM payments WHERE id = ?', id)!;
  });
}

/**
 * Paid and checked: confirm the booking, issue its invoice, send the WhatsApp confirmation.
 * Safe to call twice.
 */
export async function confirmPaidBooking(bookingId: number, actor: string): Promise<BookingRow> {
  const b = bookingById(bookingId);
  if (!b) throw new HttpError(404, 'Booking not found.');
  if (b.status !== 'confirmed') {
    if (b.status === 'expired' || b.status === 'cancelled') reclaimSlots(b);
    tx(() => {
      setStatus(b.id, 'confirmed');
      invoiceForBooking(b.id, actor);
      audit(actor, 'booking.confirm', 'booking', b.ref, { amount: b.amount_paise });
    });
  }
  const done = bookingById(bookingId)!;
  if (!done.wa_sent_at) void sendAutomaticConfirmation(done).catch(() => {});
  return done;
}

export async function verifyPayment(paymentId: number, actor: string) {
  const p = get<PaymentRow>('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!p) throw new HttpError(404, 'Payment not found.');
  if (p.status === 'rejected') throw new HttpError(409, 'This payment was rejected.');
  if (p.status !== 'verified') {
    run("UPDATE payments SET status = 'verified', verified_by = ?, verified_at = ? WHERE id = ?", actor, new Date().toISOString(), p.id);
    audit(actor, 'payment.verify', 'payment', p.id, { amount: p.amount_paise, method: p.method, reference: p.reference });
  }
  if (p.booking_id && p.direction === 'in') {
    const b = bookingById(p.booking_id)!;
    const paid = paidTotal(b.id);
    if (paid >= b.amount_paise) await confirmPaidBooking(b.id, actor);
    else if (b.status === 'held') setStatus(b.id, 'submitted');
  }
}

export function rejectPayment(paymentId: number, reason: string, actor: string, { cancelBooking = true } = {}) {
  const p = get<PaymentRow>('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!p) throw new HttpError(404, 'Payment not found.');
  if (p.status === 'verified') throw new HttpError(409, 'A verified payment cannot be rejected. Record a refund instead.');
  tx(() => {
    run("UPDATE payments SET status = 'rejected', note = ?, verified_by = ?, verified_at = ? WHERE id = ?", reason, actor, new Date().toISOString(), p.id);
    if (p.booking_id && cancelBooking) {
      const b = bookingById(p.booking_id)!;
      if (b.status === 'submitted' || b.status === 'held') setStatus(b.id, 'cancelled', { cancelReason: `Payment not received: ${reason}` });
    }
    audit(actor, 'payment.reject', 'payment', p.id, { reason });
  });
}

export function paidTotal(bookingId: number): number {
  return (
    get<{ n: number | null }>("SELECT SUM(CASE direction WHEN 'in' THEN amount_paise ELSE -amount_paise END) AS n FROM payments WHERE booking_id = ? AND status = 'verified'", bookingId)?.n ?? 0
  );
}

export interface RecordInput {
  bookingId?: number | null;
  invoiceId?: number | null;
  direction: 'in' | 'refund';
  category: string;
  method: PayMethod;
  amount: number;
  reference: string;
  date: string;
  note: string;
  verified: boolean;
  actor: string;
  /** Cash only: who took it, and who answers for it until it is deposited (src/lib/server/cash.ts). */
  collectedBy?: string;
  custodian?: string;
}

export function recordPayment(i: RecordInput): PaymentRow {
  if (i.amount <= 0) throw new HttpError(400, 'Amount must be more than zero.');
  try {
    const id = run(
      `INSERT INTO payments (direction, booking_id, invoice_id, category, method, amount_paise, reference, status, date, note, created_by, created_at, verified_by, verified_at, collected_by, custodian)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      i.direction, i.bookingId ?? null, i.invoiceId ?? null, i.category, i.method, i.amount, i.reference, i.verified ? 'verified' : 'pending', i.date, i.note, i.actor,
      new Date().toISOString(), i.verified ? i.actor : null, i.verified ? new Date().toISOString() : null,
      i.method === 'cash' ? (i.collectedBy ?? i.actor) : null, i.method === 'cash' ? (i.custodian ?? i.actor) : null,
    ).lastId;
    audit(i.actor, i.direction === 'refund' ? 'payment.refund' : 'payment.record', 'payment', id, { amount: i.amount, method: i.method, booking: i.bookingId ?? null, verified: i.verified, ...(i.method === 'cash' ? { custodian: i.custodian ?? i.actor } : {}) });
    return get<PaymentRow>('SELECT * FROM payments WHERE id = ?', id)!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'A payment with this reference is already recorded.');
    throw err;
  }
}

export function paymentsForBooking(bookingId: number): PaymentRow[] {
  return all<PaymentRow>('SELECT * FROM payments WHERE booking_id = ? ORDER BY id', bookingId);
}

/* ---------------- Razorpay ---------------- */

function rzAuth(): string {
  return `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

async function rz<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    ...init,
    headers: { Authorization: rzAuth(), 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    logEvent('warn', 'razorpay_error', { path, status: res.status });
    throw new HttpError(502, 'The payment gateway did not answer. Please try UPI instead, or try again.');
  }
  return (await res.json()) as T;
}

export function razorpayOn(): boolean {
  return integrations().razorpay && getSettings('booking').razorpayEnabled;
}

export async function razorpayOrder(b: BookingRow): Promise<{ orderId: string; keyId: string; amount: number }> {
  if (!razorpayOn()) throw new HttpError(404, 'Online gateway is not set up.');
  if (b.status !== 'held' && b.status !== 'reserved') throw new HttpError(409, b.status === 'expired' ? 'Your hold ran out. Please book again.' : 'This booking is not waiting for payment.');
  const existing = get<PaymentRow>("SELECT * FROM payments WHERE booking_id = ? AND method = 'razorpay' AND status = 'pending' AND gateway_order_id IS NOT NULL ORDER BY id DESC LIMIT 1", b.id);
  extendHold(b.id, 10);
  if (existing && existing.amount_paise === b.amount_paise) return { orderId: existing.gateway_order_id!, keyId: process.env.RAZORPAY_KEY_ID!, amount: b.amount_paise };
  const order = await rz<{ id: string; amount: number }>('orders', {
    method: 'POST',
    body: JSON.stringify({ amount: b.amount_paise, currency: 'INR', receipt: b.ref, notes: { booking: b.ref } }),
  });
  if (order.amount !== b.amount_paise) throw new HttpError(502, 'The gateway returned a different amount. Please try again.');
  run(
    `INSERT INTO payments (booking_id, category, method, amount_paise, reference, status, date, gateway_order_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    b.id, 'court', 'razorpay', b.amount_paise, '', 'pending', todayIst(), order.id, 'player', new Date().toISOString(),
  );
  return { orderId: order.id, keyId: process.env.RAZORPAY_KEY_ID!, amount: b.amount_paise };
}

export function razorpaySignatureOk(orderId: string, paymentId: string, signature: string): boolean {
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

/** A Razorpay payment we have checked ourselves: mark it and confirm the booking. */
export async function settleRazorpay(orderId: string, paymentId: string, via: 'checkout' | 'webhook'): Promise<BookingRow | null> {
  const p = get<PaymentRow>('SELECT * FROM payments WHERE gateway_order_id = ? ORDER BY id DESC LIMIT 1', orderId);
  if (!p || !p.booking_id) return null;
  if (p.status !== 'verified') {
    const pay = await rz<{ id: string; order_id: string; amount: number; status: string; currency: string }>(`payments/${encodeURIComponent(paymentId)}`);
    if (pay.order_id !== orderId || pay.amount !== p.amount_paise || pay.currency !== 'INR') throw new HttpError(400, 'Payment does not match this booking.');
    if (pay.status === 'authorized') await rz(`payments/${encodeURIComponent(paymentId)}/capture`, { method: 'POST', body: JSON.stringify({ amount: pay.amount, currency: 'INR' }) });
    else if (pay.status !== 'captured') throw new HttpError(402, 'The payment has not completed yet.');
    const changed = run(
      "UPDATE payments SET status = 'verified', reference = ?, gateway_payment_id = ?, verified_by = ?, verified_at = ? WHERE id = ? AND status <> 'verified'",
      paymentId, paymentId, `razorpay:${via}`, new Date().toISOString(), p.id,
    ).changes;
    if (changed) audit(`razorpay:${via}`, 'payment.verify', 'payment', p.id, { amount: p.amount_paise, paymentId });
  }
  try {
    return await confirmPaidBooking(p.booking_id, `razorpay:${via}`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      // Paid, but the courts went to someone else after the hold ran out: flag for a refund.
      run("UPDATE bookings SET note = TRIM(note || ' ⚠ Paid after hold expired and slots were taken: refund due.') WHERE id = ?", p.booking_id);
      audit('system', 'booking.refund_due', 'booking', p.booking_id, { orderId });
      return bookingById(p.booking_id) ?? null;
    }
    throw err;
  }
}

export function webhookSignatureOk(raw: Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  return safeEqual(crypto.createHmac('sha256', secret).update(raw).digest('hex'), signature);
}
