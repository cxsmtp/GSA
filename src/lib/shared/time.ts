/**
 * Time in Jodhpur. India has one time zone (IST, UTC+05:30) and no daylight saving, so a fixed
 * offset is exact. Dates are 'YYYY-MM-DD' strings in IST; a slot's time is minutes since midnight.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in IST. */
export function todayIst(now = Date.now()): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since midnight IST right now. */
export function minutesNowIst(now = Date.now()): number {
  const d = new Date(now + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** "5:00 AM", "11:30 PM". */
export function fmtTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

/** "5 AM" style short label for grids. */
export function fmtTimeShort(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

/** "HH:MM" for inputs. */
export function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function parseHhmm(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59 || (h === 24 && mm > 0)) return null;
  return h * 60 + mm;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayName(date: string): string {
  return DAYS[weekday(date)];
}

/** "Sat, 25 Oct 2026". */
export function fmtDate(date: string, { year = true }: { year?: boolean } = {}): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${dayName(date)}, ${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`;
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Indian financial year of a date: '2026-27' for any date from 1 Apr 2026 to 31 Mar 2027. */
export function financialYear(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** First and last date of the financial year containing `date`. */
export function financialYearRange(date: string): { from: string; to: string } {
  const start = Number(financialYear(date).slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** ISO timestamp → "25 Oct, 6:42 PM" in IST. */
export function fmtStamp(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + IST_OFFSET_MS);
  const date = d.toISOString().slice(0, 10);
  return `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}, ${fmtTime(d.getUTCHours() * 60 + d.getUTCMinutes())}`;
}
