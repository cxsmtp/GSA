import crypto from 'node:crypto';
import { payable } from '@/lib/shared/gst';
import { fmtDate, fmtTime } from '@/lib/shared/time';
import type { BookedSlot, BookingStatus, SlotRef } from '@/lib/shared/types';
import type { Guardian, Health } from '@/lib/shared/participant';
import { audit } from './audit';
import { all, get, isUniqueViolation, run, tx } from './db';
import { HttpError } from './http';
import { activeSpaces, buildDay, inBookingWindow } from './schedule';
import { getSettings } from './settings';
import { randomToken } from './secrets';

/**
 * Bookings. A booking holds its spaces through booking_slots rows (UNIQUE per space, date and
 * start), so two people can never hold the same slot: the second insert fails inside the same
 * transaction and that person is told the slot was just taken.
 *
 *   held       online, waiting for payment; released automatically after holdMinutes
 *   submitted  payment details given (UPI reference, or cash noted by the manager): waits for the admin
 *   reserved   made at the desk, payment to be collected at the venue (never expires)
 *   confirmed  paid and verified: invoice issued, WhatsApp confirmation sent
 *   cancelled / expired: spaces released
 */

export interface BookingRow {
  id: number;
  ref: string;
  token: string;
  date: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  status: BookingStatus;
  source: string;
  channel: string;
  slots_json: string;
  base_paise: number;
  amount_paise: number;
  hold_expires_at: number | null;
  confirm_code: string;
  wa_opened_at: string | null;
  wa_sent_at: string | null;
  note: string;
  health_json: string;
  is_minor: number;
  guardian_name: string;
  guardian_phone: string;
  guardian_relation: string;
  guardian_consent_at: string | null;
  cancel_reason: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const LIVE: BookingStatus[] = ['held', 'reserved', 'submitted', 'confirmed'];

export function slotsOf(b: Pick<BookingRow, 'slots_json'>): BookedSlot[] {
  try {
    return JSON.parse(b.slots_json) as BookedSlot[];
  } catch {
    return [];
  }
}

/** "Space 1 · 6:00 AM–8:00 AM, Space 2 · 7:00 PM–8:00 PM": consecutive slots on a space merge. */
export function slotsLabel(slots: BookedSlot[]): string {
  const bySpace = new Map<string, BookedSlot[]>();
  for (const s of [...slots].sort((a, b) => a.spaceId - b.spaceId || a.start - b.start)) {
    bySpace.set(s.spaceName, [...(bySpace.get(s.spaceName) || []), s]);
  }
  const parts: string[] = [];
  for (const [space, list] of bySpace) {
    const ranges: [number, number][] = [];
    for (const s of list) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === s.start) last[1] = s.end;
      else ranges.push([s.start, s.end]);
    }
    parts.push(`${space} · ${ranges.map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)}`).join(', ')}`);
  }
  return parts.join('; ');
}

/** The stored health answer (null for bookings made before the question existed). */
export function healthOf(b: Pick<BookingRow, 'health_json'>): Health | null {
  if (!b.health_json) return null;
  try {
    return JSON.parse(b.health_json) as Health;
  } catch {
    return null;
  }
}

export function bookingFacts(b: BookingRow) {
  return { ref: b.ref, name: b.name, dateLabel: fmtDate(b.date), slots: slotsLabel(slotsOf(b)) };
}

/** Release online holds whose time ran out. Cheap; called before reading or taking slots. */
export function sweepExpired(now = Date.now()) {
  const stale = all<{ id: number }>("SELECT id FROM bookings WHERE status = 'held' AND hold_expires_at < ?", now);
  if (!stale.length) return;
  tx(() => {
    for (const { id } of stale) {
      run('DELETE FROM booking_slots WHERE booking_id = ?', id);
      run("UPDATE bookings SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'held'", new Date(now).toISOString(), id);
    }
  });
}

function newRef(): string {
  // GSA-7K3QX9: no 0/O/1/I to misread over the phone.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(6);
  return `GSA-${Array.from(bytes, (x) => alphabet[x % alphabet.length]).join('')}`;
}

export interface NewBooking {
  date: string;
  slots: SlotRef[];
  name: string;
  phone: string;
  email?: string;
  gstin?: string;
  note?: string;
  source: 'online' | 'desk';
  /** Where an online player came from: 'instagram', 'whatsapp', 'google', 'qr' or 'web'. */
  channel?: string;
  status: 'held' | 'reserved';
  actor: string;
  /** Desk bookings may take past slots of today (walk-ins already playing) and ignore the window. */
  staff?: boolean;
  /** From parseParticipant: always given for new bookings. */
  health: Health;
  minor: boolean;
  guardian: Guardian | null;
}

export function createBooking(input: NewBooking, now = Date.now()): BookingRow {
  const b = getSettings('booking');
  if (!input.slots.length) throw new HttpError(400, 'Pick at least one slot.');
  if (input.slots.length > (input.staff ? 40 : b.maxSlots)) throw new HttpError(400, `You can book up to ${b.maxSlots} slots at a time.`);
  if (!input.staff && !inBookingWindow(input.date, now)) throw new HttpError(400, `Bookings open ${b.daysAhead} days ahead. Please pick another date.`);
  const seen = new Set<string>();
  for (const s of input.slots) {
    const k = `${s.spaceId}:${s.start}`;
    if (seen.has(k)) throw new HttpError(400, 'The same slot was picked twice.');
    seen.add(k);
  }

  sweepExpired(now);
  return tx(() => {
    const grid = buildDay(input.date, { now });
    const spaces = new Map(activeSpaces().map((c) => [c.id, c.name]));
    const picked: BookedSlot[] = input.slots.map((s) => {
      const cell = grid.spaces.find((c) => c.id === s.spaceId)?.cells.find((x) => x.start === s.start);
      if (!cell) throw new HttpError(400, 'That slot does not exist. Please refresh.');
      const okState = cell.state === 'free' || (input.staff && cell.state === 'past');
      if (!okState) throw new HttpError(409, `${spaces.get(s.spaceId)} at ${fmtTime(s.start)} was just taken. Please pick another slot.`, {}, { code: 'slot_taken' });
      return { spaceId: s.spaceId, spaceName: spaces.get(s.spaceId) || `Space ${s.spaceId}`, start: cell.start, end: cell.end, price: cell.price };
    });
    picked.sort((a, b2) => a.start - b2.start || a.spaceId - b2.spaceId);
    const base = picked.reduce((n, s) => n + s.price, 0);
    const amount = payable(base, getSettings('gst'));
    const stamp = new Date(now).toISOString();
    const code = String(crypto.randomInt(1000, 10000));
    let id = 0;
    let ref = '';
    for (let attempt = 0; attempt < 5 && !id; attempt++) {
      ref = newRef();
      try {
        id = run(
          `INSERT INTO bookings (ref, token, date, name, phone, email, gstin, status, source, channel, slots_json, base_paise, amount_paise, hold_expires_at, confirm_code, note, created_by, created_at, updated_at,
             health_json, is_minor, guardian_name, guardian_phone, guardian_relation, guardian_consent_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ref, randomToken(16), input.date, input.name, input.phone, input.email || '', input.gstin || '', input.status, input.source, input.channel || (input.source === 'desk' ? 'desk' : 'web'),
          JSON.stringify(picked), base, amount, input.status === 'held' ? now + b.holdMinutes * 60_000 : null, code, input.note || '', input.actor, stamp, stamp,
          JSON.stringify(input.health), input.minor ? 1 : 0, input.guardian?.name ?? '', input.guardian?.phone ?? '', input.guardian?.relation ?? '', input.minor ? stamp : null,
        ).lastId;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!id) throw new HttpError(500, 'Could not create the booking. Please try again.');
    try {
      for (const s of picked) {
        run('INSERT INTO booking_slots (booking_id, space_id, date, start_min, end_min, price_paise) VALUES (?,?,?,?,?,?)', id, s.spaceId, input.date, s.start, s.end, s.price);
      }
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'One of your slots was just taken. Please pick again.', {}, { code: 'slot_taken' });
      throw err;
    }
    // Health answers stay out of the audit log; only that a guardian consented is recorded.
    audit(input.actor, 'booking.create', 'booking', ref, { date: input.date, slots: picked.length, amount, status: input.status, source: input.source, minor: input.minor, guardianConsent: input.minor });
    return bookingById(id)!;
  });
}

export function bookingById(id: number): BookingRow | undefined {
  return get<BookingRow>('SELECT * FROM bookings WHERE id = ?', id);
}

export function bookingByToken(token: string): BookingRow | undefined {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return undefined;
  return get<BookingRow>('SELECT * FROM bookings WHERE token = ?', token);
}

/**
 * Take a released booking's spaces back (a payment that arrived after its hold ran out). Throws 409
 * when someone else has a slot by now, leaving the booking as it was.
 */
export function reclaimSlots(b: BookingRow) {
  const has = get<{ n: number }>('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?', b.id)!.n;
  if (has) return;
  tx(() => {
    try {
      for (const s of slotsOf(b)) {
        run('INSERT INTO booking_slots (booking_id, space_id, date, start_min, end_min, price_paise) VALUES (?,?,?,?,?,?)', b.id, s.spaceId, b.date, s.start, s.end, s.price);
      }
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'These slots were booked by someone else after the hold ran out.', {}, { code: 'slot_taken' });
      throw err;
    }
  });
}

export function setStatus(id: number, status: BookingStatus, extra: { cancelReason?: string } = {}) {
  const stamp = new Date().toISOString();
  tx(() => {
    if (status === 'cancelled' || status === 'expired') run('DELETE FROM booking_slots WHERE booking_id = ?', id);
    run('UPDATE bookings SET status = ?, hold_expires_at = CASE WHEN ? = \'held\' THEN hold_expires_at ELSE NULL END, cancel_reason = COALESCE(?, cancel_reason), updated_at = ? WHERE id = ?', status, status, extra.cancelReason ?? null, stamp, id);
  });
}

/** Give an online hold more time (the player opened a payment app). */
export function extendHold(id: number, minutes: number, now = Date.now()) {
  run("UPDATE bookings SET hold_expires_at = MAX(COALESCE(hold_expires_at, 0), ?) WHERE id = ? AND status = 'held'", now + minutes * 60_000, id);
}
