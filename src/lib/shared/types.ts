export type { Role } from './rbac';
export type BookingStatus = 'held' | 'reserved' | 'submitted' | 'confirmed' | 'cancelled' | 'expired';
export type PayMethod = 'upi' | 'razorpay' | 'cash' | 'card' | 'bank' | 'other';
export const PAY_METHODS: readonly PayMethod[] = ['upi', 'razorpay', 'cash', 'card', 'bank', 'other'];
export const INCOME_CATEGORIES = ['court', 'coaching', 'membership', 'tournament', 'shop', 'sponsorship', 'other'] as const;
export const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Salaries', 'Coach fees', 'Shuttles & equipment', 'Maintenance', 'Cleaning', 'Marketing', 'Water', 'Internet & phone', 'Software', 'Taxes & fees', 'Other'] as const;
export const BLOCK_KINDS = ['coaching', 'maintenance', 'event', 'other'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface SlotRef {
  courtId: number;
  start: number;
}

export interface BookedSlot {
  courtId: number;
  courtName: string;
  start: number;
  end: number;
  price: number;
}

export type CellState = 'free' | 'booked' | 'held' | 'blocked' | 'past' | 'closed';

export interface Cell {
  start: number;
  end: number;
  state: CellState;
  price: number;
  /** Staff only: who/what holds it. */
  label?: string;
  bookingId?: number;
  kind?: string;
}

export interface CourtDay {
  id: number;
  name: string;
  note: string;
  cells: Cell[];
}

export interface DayGrid {
  date: string;
  open: boolean;
  slotMinutes: number;
  courts: CourtDay[];
}

export interface PublicConfig {
  academy: { name: string; tagline: string; city: string; phone: string; whatsapp: string; address: string; mapUrl: string; email: string; instagram: string };
  booking: { daysAhead: number; maxSlots: number; holdMinutes: number; slotMinutes: number };
  gst: { mode: 'none' | 'regular' | 'composition'; ratePct: number; pricesIncludeGst: boolean };
  pay: { upi: boolean; razorpay: boolean };
  today: string;
}

export const CHANNELS = ['instagram', 'whatsapp', 'google', 'facebook', 'qr', 'web'] as const;
export type Channel = (typeof CHANNELS)[number];
