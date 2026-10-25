import type { GstSettings } from '@/lib/shared/gst';
import { get, run } from './db';

/** Settings live in the database as one JSON document per group, merged over safe defaults. */

export interface AcademySettings {
  name: string;
  tagline: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  phone: string;
  whatsapp: string;
  email: string;
  mapUrl: string;
  instagram: string;
  upiVpa: string;
  upiPayee: string;
}

export interface DayHours {
  open: number;
  close: number;
  closed: boolean;
}

export interface BookingSettings {
  /** Index 0 = Sunday. */
  hours: DayHours[];
  slotMinutes: number;
  daysAhead: number;
  holdMinutes: number;
  minLeadMinutes: number;
  basePricePaise: number;
  maxSlots: number;
  upiEnabled: boolean;
  razorpayEnabled: boolean;
}

export interface AboutSettings {
  headline: string;
  story: string;
  highlights: string[];
}

const DEFAULT_HOURS: DayHours = { open: 5 * 60, close: 23 * 60, closed: false };

export const DEFAULTS = {
  academy: {
    name: 'GSA Badminton Arena',
    tagline: 'Book. Smash. Repeat.',
    address: '',
    city: 'Jodhpur',
    state: 'Rajasthan',
    stateCode: '08',
    pincode: '',
    phone: '',
    whatsapp: '',
    email: '',
    mapUrl: '',
    instagram: '',
    upiVpa: '',
    upiPayee: '',
  } satisfies AcademySettings,
  booking: {
    hours: Array.from({ length: 7 }, () => ({ ...DEFAULT_HOURS })),
    slotMinutes: 60,
    daysAhead: 14,
    holdMinutes: 10,
    minLeadMinutes: 0,
    basePricePaise: 40000,
    maxSlots: 6,
    upiEnabled: true,
    razorpayEnabled: true,
  } satisfies BookingSettings,
  gst: {
    mode: 'none',
    gstin: '',
    legalName: '',
    ratePct: 18,
    sac: '999652',
    pricesIncludeGst: true,
    invoicePrefix: 'GSA',
    thresholdPaise: 20_00_000_00,
    terms: 'Bookings are non-transferable. Cancellations as per academy policy.',
  } satisfies GstSettings,
  about: {
    headline: 'Where Jodhpur plays badminton',
    story: 'World-class wooden courts, bright anti-glare lighting and coaching for every level — from first rally to state championships.',
    highlights: ['Synthetic & wooden courts', 'Certified coaches', 'Open 5 AM – 11 PM'],
  } satisfies AboutSettings,
};

export type SettingsGroup = keyof typeof DEFAULTS;
type Shape = { academy: AcademySettings; booking: BookingSettings; gst: GstSettings; about: AboutSettings };

const cache = new Map<string, unknown>();

export function getSettings<K extends SettingsGroup>(group: K): Shape[K] {
  if (cache.has(group)) return cache.get(group) as Shape[K];
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', group);
  let stored: Record<string, unknown> = {};
  try {
    stored = row ? JSON.parse(row.value) : {};
  } catch {
    stored = {};
  }
  const merged = { ...DEFAULTS[group], ...stored } as Shape[K];
  cache.set(group, merged);
  return merged;
}

export function saveSettings<K extends SettingsGroup>(group: K, value: Shape[K], by: string) {
  run(
    'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    group,
    JSON.stringify(value),
    new Date().toISOString(),
    by,
  );
  cache.delete(group);
}

export function _clearSettingsCache() {
  cache.clear();
}

/** Integrations are configured through environment variables only: secrets never sit in the database. */
export function integrations() {
  return {
    razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    razorpayWebhook: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    whatsappApi: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  };
}

export function appUrl(req?: Request): string {
  const env = process.env.APP_URL?.replace(/\/+$/, '');
  if (env) return env;
  if (!req) return '';
  const u = new URL(req.url);
  return `${u.protocol}//${req.headers.get('host') || u.host}`;
}
