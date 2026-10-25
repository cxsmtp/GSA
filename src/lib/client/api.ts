'use client';

/** Fetch JSON from our own API: same-origin cookies, readable errors, never throws raw. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method || (init.body !== undefined ? 'POST' : 'GET'),
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'No internet connection. Please check and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.ok === false) throw new ApiError(res.status, String(data.message || 'Something went wrong.'), data);
  return data as T;
}

/** Bookings this phone made, so "My bookings" can find them again (only the private links). */
const KEY = 'gsa_my_bookings';
export interface SavedBooking { token: string; ref: string; date: string; at: number }

export function savedBookings(): SavedBooking[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) || '[]') as SavedBooking[]).filter((b) => b && b.token).slice(0, 20);
  } catch {
    return [];
  }
}

export function rememberBooking(b: SavedBooking) {
  try {
    localStorage.setItem(KEY, JSON.stringify([b, ...savedBookings().filter((x) => x.token !== b.token)].slice(0, 20)));
  } catch {
    // private mode: fine
  }
}

/** Where this visit came from: Instagram (in-app browser or ?src=instagram), WhatsApp, Google, QR poster… */
export function detectChannel(): string {
  try {
    const saved = sessionStorage.getItem('gsa_channel');
    if (saved) return saved;
  } catch {
    // ignore
  }
  const p = new URLSearchParams(location.search);
  const src = (p.get('src') || p.get('utm_source') || '').toLowerCase();
  const ua = navigator.userAgent;
  let ch = 'web';
  if (src.startsWith('ig') || src.includes('insta') || /Instagram/i.test(ua) || /instagram\.com/.test(document.referrer)) ch = 'instagram';
  else if (src.startsWith('wa') || src.includes('whatsapp')) ch = 'whatsapp';
  else if (src.startsWith('fb') || src.includes('facebook') || /FBAN|FBAV/.test(ua)) ch = 'facebook';
  else if (src.includes('google') || /google\./.test(document.referrer)) ch = 'google';
  else if (src === 'qr' || src === 'poster') ch = 'qr';
  try {
    sessionStorage.setItem('gsa_channel', ch);
  } catch {
    // ignore
  }
  return ch;
}

/** Instagram/Facebook in-app browsers often can't open UPI apps: we offer "Open in browser" there. */
export function inAppBrowser(): 'instagram' | 'facebook' | null {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV/.test(ua)) return 'facebook';
  return null;
}

export function platform(): 'android' | 'ios' | 'desktop' {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)) return 'ios';
  return 'desktop';
}
