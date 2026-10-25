import type { Cell, SpaceDay, DayGrid } from '@/lib/shared/types';
import { addDays, minutesNowIst, todayIst, weekday } from '@/lib/shared/time';
import { all } from './db';
import { getSettings } from './settings';

/**
 * The space timetable for one day: every slot of every active space with its state and price,
 * built from the opening hours, the admin's blocks (training batches, maintenance, events) and the
 * bookings that hold a space. Staff see who holds each slot; the public sees only free/taken.
 */

export interface SpaceRow {
  id: number;
  name: string;
  note: string;
  sort: number;
  active: number;
}

export interface PriceRule {
  id: number;
  name: string;
  space_id: number | null;
  days: string;
  start_min: number;
  end_min: number;
  price_paise: number;
  priority: number;
  active: number;
}

export interface BlockRow {
  id: number;
  space_id: number | null;
  date_from: string;
  date_to: string;
  days: string;
  start_min: number;
  end_min: number;
  kind: string;
  reason: string;
}

export function activeSpaces(): SpaceRow[] {
  return all<SpaceRow>('SELECT * FROM spaces WHERE active = 1 ORDER BY sort, id');
}

export function priceRules(): PriceRule[] {
  return all<PriceRule>('SELECT * FROM price_rules WHERE active = 1 ORDER BY priority DESC, id');
}

/** The price of one slot: the highest-priority matching rule, or the base price. */
export function slotPrice(rules: PriceRule[], spaceId: number, date: string, start: number, base: number): number {
  const day = String(weekday(date));
  for (const r of rules) {
    if (r.space_id !== null && r.space_id !== spaceId) continue;
    if (!r.days.includes(day)) continue;
    if (start >= r.start_min && start < r.end_min) return r.price_paise;
  }
  return base;
}

/** Slot start times for a date (empty when closed). */
export function slotStarts(date: string): number[] {
  const b = getSettings('booking');
  const h = b.hours[weekday(date)] ?? b.hours[0];
  if (!h || h.closed) return [];
  const out: number[] = [];
  for (let t = h.open; t + b.slotMinutes <= h.close; t += b.slotMinutes) out.push(t);
  return out;
}

export function blocksOn(date: string): BlockRow[] {
  const day = String(weekday(date));
  return all<BlockRow>('SELECT * FROM blocks WHERE date_from <= ? AND date_to >= ?', date, date).filter((b) => b.days.includes(day));
}

interface HeldSlot {
  space_id: number;
  start_min: number;
  end_min: number;
  booking_id: number;
  status: string;
  name: string;
  ref: string;
  source: string;
}

/** Is this date bookable by the public right now? */
export function inBookingWindow(date: string, now = Date.now()): boolean {
  const today = todayIst(now);
  return date >= today && date <= addDays(today, getSettings('booking').daysAhead);
}

export function buildDay(date: string, { staff = false, now = Date.now() }: { staff?: boolean; now?: number } = {}): DayGrid {
  const b = getSettings('booking');
  const spaces = activeSpaces();
  const starts = slotStarts(date);
  const rules = priceRules();
  const blocks = blocksOn(date);
  const held = all<HeldSlot>(
    `SELECT s.space_id, s.start_min, s.end_min, s.booking_id, k.status, k.name, k.ref, k.source
       FROM booking_slots s JOIN bookings k ON k.id = s.booking_id WHERE s.date = ?`,
    date,
  );
  const heldMap = new Map(held.map((h) => [`${h.space_id}:${h.start_min}`, h]));
  const today = todayIst(now);
  const cutoff = date < today ? Infinity : date === today ? minutesNowIst(now) + b.minLeadMinutes : -Infinity;

  const out: SpaceDay[] = spaces.map((c) => ({
    id: c.id,
    name: c.name,
    note: c.note,
    cells: starts.map((start): Cell => {
      const end = start + b.slotMinutes;
      const price = slotPrice(rules, c.id, date, start, b.basePricePaise);
      const h = heldMap.get(`${c.id}:${start}`);
      if (h) {
        const state = h.status === 'held' ? 'held' : 'booked';
        return staff
          ? { start, end, state, price, label: `${h.name} · ${h.ref}`, bookingId: h.booking_id, kind: h.status }
          : { start, end, state: 'booked', price };
      }
      const blk = blocks.find((x) => (x.space_id === null || x.space_id === c.id) && start < x.end_min && end > x.start_min);
      if (blk) return staff ? { start, end, state: 'blocked', price, label: blk.reason || blk.kind, kind: blk.kind } : { start, end, state: 'blocked', price, kind: blk.kind };
      if (start < cutoff) return { start, end, state: 'past', price };
      return { start, end, state: 'free', price };
    }),
  }));
  return { date, open: starts.length > 0, slotMinutes: b.slotMinutes, spaces: out };
}

/** Free-slot counts for the date strip (public). */
export function freeCounts(from: string, days: number, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    out[d] = buildDay(d, { now }).spaces.reduce((n, c) => n + c.cells.filter((x) => x.state === 'free').length, 0);
  }
  return out;
}
