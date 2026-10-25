import QRCode from 'qrcode';
import { documentTitle, isValidGstin, STATES } from '@/lib/shared/gst';
import { toPaise } from '@/lib/shared/money';
import { addDays, isValidDate, parseHhmm, todayIst } from '@/lib/shared/time';
import { BLOCK_KINDS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAY_METHODS, type Role, type SlotRef } from '@/lib/shared/types';
import { normalizeIndianMobile } from '@/lib/shared/whatsapp';
import { audit, recentAudit, verifyAudit } from './audit';
import { endSessions, requireUser, userRow, type SessionUser } from './auth';
import { bookingById, createBooking, setStatus, slotsLabel, slotsOf, sweepExpired, type BookingRow } from './bookings';
import { all, db, get, run, tx } from './db';
import { csv } from './csv';
import { gstReport, summary, thresholdWatch } from './finance';
import { allowFields, bool, HttpError, int, oneOf, readJsonBody, str } from './http';
import { cancelInvoice, issueInvoice, listInvoices, type InvoiceItem } from './invoices';
import { readMedia, saveDataUrl } from './media';
import { generatePassword, hashPassword, passwordProblem, verifyPassword } from './password';
import { confirmPaidBooking, paidTotal, paymentsForBooking, recordPayment, rejectPayment, verifyPayment, type PaymentRow } from './payments';
import { buildDay } from './schedule';
import { appUrl, DEFAULTS, getSettings, integrations, saveSettings, type SettingsGroup } from './settings';
import { encrypt, randomToken } from './secrets';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp';
import { deskConfirmLink } from './whatsapp';
import { enforce } from './rateLimit';

/**
 * Every staff API call goes through this one table. A route lists the roles it allows; there is no
 * default, so a route can't be left open by forgetting a check. ADMIN routes carry money or settings;
 * BOTH routes are what a coach may see and do.
 */
const ADMIN: readonly Role[] = ['admin'];
const BOTH: readonly Role[] = ['admin', 'coach'];

interface Ctx {
  req: Request;
  user: SessionUser;
  params: Record<string, string>;
  query: URLSearchParams;
  body: () => Promise<Record<string, unknown>>;
}

type Handler = (c: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  roles: readonly Role[];
  h: Handler;
  allowMustChange?: boolean;
  bodyLimit?: number;
}

const routes: Route[] = [];
function route(method: Route['method'], path: string, roles: readonly Role[], h: Handler, opts: Partial<Route> = {}) {
  routes.push({ method, path, roles, h, ...opts });
}

function idParam(c: Ctx, name = 'id'): number {
  const n = Number(c.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Not found.');
  return n;
}

function range(c: Ctx, defDays = 30): { from: string; to: string } {
  const to = c.query.get('to') || todayIst();
  const from = c.query.get('from') || addDays(to, -defDays);
  if (!isValidDate(from) || !isValidDate(to) || from > to) throw new HttpError(400, 'Invalid date range.');
  return { from, to };
}

function money(v: unknown, field: string, { allowZero = false } = {}): number {
  const p = toPaise(v);
  if (p === null || (!allowZero && p <= 0)) throw new HttpError(400, `${field}: enter an amount in rupees.`);
  return p;
}

function daysMask(v: unknown): string {
  if (typeof v !== 'string' || !/^[0-6]{1,7}$/.test(v)) throw new HttpError(400, 'Pick at least one day.');
  return [...new Set(v.split(''))].sort().join('');
}

function time(v: unknown, field: string): number {
  const t = parseHhmm(v);
  if (t === null) throw new HttpError(400, `${field}: use HH:MM.`);
  return t;
}

/* ---------------- account ---------------- */

route('POST', 'password', BOTH, async (c) => {
  const b = await c.body();
  allowFields(b, ['current', 'next']);
  enforce(`pw:${c.user.id}`, 10, 15 * 60_000);
  const u = userRow(c.user.id)!;
  if (!(await verifyPassword(str(b.current, 'Current password', 200), u.password_hash))) throw new HttpError(400, 'Current password is wrong.');
  const next = str(b.next, 'New password', 200);
  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, problem);
  run('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?', await hashPassword(next), u.id);
  endSessions(u.id);
  audit(c.user.username, 'user.password_change', 'user', u.username);
  return { signedOut: true };
}, { allowMustChange: true });

route('POST', 'totp/setup', BOTH, async (c) => {
  const secret = newTotpSecret();
  const uri = otpauthUri(secret, c.user.username, getSettings('academy').name);
  return { secret, qr: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
});

route('POST', 'totp/enable', BOTH, async (c) => {
  const b = await c.body();
  allowFields(b, ['secret', 'code']);
  const secret = str(b.secret, 'secret', 64);
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new HttpError(400, 'Start again.');
  if (!verifyTotp(secret, str(b.code, 'Code', 10))) throw new HttpError(400, 'That code is not right. Check the time on your phone and try the newest code.');
  run('UPDATE users SET totp_secret = ? WHERE id = ?', encrypt(secret), c.user.id);
  audit(c.user.username, 'user.totp_on', 'user', c.user.username);
  return {};
});

route('POST', 'totp/disable', BOTH, async (c) => {
  const b = await c.body();
  allowFields(b, ['password']);
  const u = userRow(c.user.id)!;
  if (!(await verifyPassword(str(b.password, 'Password', 200), u.password_hash))) throw new HttpError(400, 'Password is wrong.');
  run('UPDATE users SET totp_secret = NULL WHERE id = ?', u.id);
  audit(c.user.username, 'user.totp_off', 'user', u.username);
  return {};
});

/* ---------------- today & timetable ---------------- */

function bookingListItem(b: BookingRow, admin: boolean) {
  return {
    id: b.id, ref: b.ref, date: b.date, name: b.name, phone: b.phone, status: b.status, source: b.source, channel: b.channel,
    slots: slotsLabel(slotsOf(b)), count: slotsOf(b).length, amount: b.amount_paise, createdAt: b.created_at,
    paid: admin ? paidTotal(b.id) : undefined, note: b.note, waSent: Boolean(b.wa_sent_at), waOpened: Boolean(b.wa_opened_at),
  };
}

route('GET', 'dashboard', BOTH, (c) => {
  sweepExpired();
  const today = todayIst();
  const admin = c.user.role === 'admin';
  const todays = all<BookingRow>("SELECT * FROM bookings WHERE date = ? AND status IN ('reserved','submitted','confirmed','held') ORDER BY id", today);
  const firstStart = (b: BookingRow) => Math.min(...slotsOf(b).map((s) => s.start));
  const pendingPayments = admin ? all<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE status='pending' AND direction='in' AND (method <> 'razorpay' OR reference <> '')")[0].n : undefined;
  const collectedToday = admin ? get<{ n: number | null }>("SELECT SUM(CASE direction WHEN 'in' THEN amount_paise ELSE -amount_paise END) AS n FROM payments WHERE status='verified' AND date = ?", today)?.n ?? 0 : undefined;
  const upcoming = get<{ n: number }>("SELECT COUNT(*) AS n FROM bookings WHERE date > ? AND status IN ('reserved','submitted','confirmed')", today)!.n;
  const grid = buildDay(today, { staff: true });
  const cells = grid.courts.flatMap((x) => x.cells);
  return {
    today,
    bookings: todays.sort((a, b) => firstStart(a) - firstStart(b)).map((b) => bookingListItem(b, admin)),
    occupancy: cells.length ? Math.round((cells.filter((x) => x.state === 'booked').length / cells.length) * 100) : 0,
    pendingPayments,
    collectedToday,
    upcoming,
    threshold: admin ? thresholdWatch() : undefined,
    integrations: admin ? integrations() : undefined,
  };
});

route('GET', 'day', BOTH, (c) => {
  const date = c.query.get('date') || todayIst();
  if (!isValidDate(date)) throw new HttpError(400, 'Invalid date.');
  sweepExpired();
  return { grid: buildDay(date, { staff: true }) };
});

/* ---------------- bookings ---------------- */

route('GET', 'bookings', BOTH, (c) => {
  sweepExpired();
  const admin = c.user.role === 'admin';
  const q = (c.query.get('q') || '').trim();
  const status = c.query.get('status') || 'live';
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q) {
    const digits = q.replace(/\D/g, '');
    where.push('(ref LIKE ? OR name LIKE ?' + (digits.length >= 4 ? ' OR phone LIKE ?' : '') + ')');
    params.push(`%${q.toUpperCase()}%`, `%${q}%`);
    if (digits.length >= 4) params.push(`%${digits}%`);
  } else {
    const { from, to } = range(c, 0);
    where.push('date BETWEEN ? AND ?');
    params.push(from, c.query.get('to') ? to : addDays(from, 30));
  }
  if (status === 'live') where.push("status IN ('held','reserved','submitted','confirmed')");
  else if (status !== 'all') {
    where.push('status = ?');
    params.push(oneOf(status, 'status', ['held', 'reserved', 'submitted', 'confirmed', 'cancelled', 'expired']));
  }
  const rows = all<BookingRow>(`SELECT * FROM bookings WHERE ${where.join(' AND ')} ORDER BY date, id LIMIT 300`, ...params);
  return { bookings: rows.map((b) => bookingListItem(b, admin)) };
});

route('GET', 'bookings/:id', BOTH, (c) => {
  const b = bookingById(idParam(c));
  if (!b) throw new HttpError(404, 'Booking not found.');
  const admin = c.user.role === 'admin';
  const invoice = get<{ id: number; number: string; token: string; status: string }>('SELECT id, number, token, status FROM invoices WHERE booking_id = ? ORDER BY id DESC LIMIT 1', b.id);
  return {
    booking: { ...bookingListItem(b, admin), email: b.email, gstin: b.gstin, token: b.token, cancelReason: b.cancel_reason, slotList: slotsOf(b), createdBy: b.created_by, holdExpiresAt: b.hold_expires_at, code: b.confirm_code },
    payments: admin ? paymentsForBooking(b.id) : paymentsForBooking(b.id).map((p) => ({ id: p.id, method: p.method, status: p.status, direction: p.direction, created_at: p.created_at })),
    invoice: admin ? invoice ?? null : null,
    waLink: b.status === 'confirmed' ? deskConfirmLink(b, appUrl(c.req)) : null,
    payLink: `${appUrl(c.req)}/pay/${b.token}`,
  };
});

route('POST', 'bookings', BOTH, async (c) => {
  const body = await c.body();
  allowFields(body, ['date', 'slots', 'name', 'phone', 'email', 'gstin', 'note', 'pay']);
  const date = body.date;
  if (!isValidDate(date)) throw new HttpError(400, 'Pick a date.');
  if (!Array.isArray(body.slots)) throw new HttpError(400, 'Pick slots.');
  const slots: SlotRef[] = body.slots.map((s: unknown) => {
    const o = s as Record<string, unknown>;
    return { courtId: int(o?.courtId, 'court', 1, 1e6), start: int(o?.start, 'start', 0, 1440) };
  });
  const phone = normalizeIndianMobile(body.phone);
  if (!phone) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');
  const gstin = str(body.gstin, 'GSTIN', 15, { required: false }).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new HttpError(400, 'That GSTIN is not valid.');
  const b = createBooking({
    date, slots, name: str(body.name, 'Name', 80), phone, email: str(body.email, 'Email', 120, { required: false }), gstin,
    note: str(body.note, 'Note', 300, { required: false }), source: 'desk', status: 'reserved', actor: c.user.username, staff: true,
  });
  // Paid at the desk now. The admin's word verifies it; a coach's note waits for the admin.
  if (body.pay && typeof body.pay === 'object') {
    const p = body.pay as Record<string, unknown>;
    const method = oneOf(p.method, 'Payment method', c.user.role === 'admin' ? PAY_METHODS.filter((m) => m !== 'razorpay') : (['cash', 'upi'] as const));
    recordPayment({
      bookingId: b.id, direction: 'in', category: 'court', method, amount: b.amount_paise, reference: str(p.reference, 'Reference', 40, { required: false }),
      date: todayIst(), note: 'At the desk', verified: c.user.role === 'admin', actor: c.user.username,
    });
    if (c.user.role === 'admin') await confirmPaidBooking(b.id, c.user.username);
    else setStatus(b.id, 'submitted');
  }
  return { id: b.id, ref: b.ref };
});

route('POST', 'bookings/:id/collected', BOTH, async (c) => {
  const b = bookingById(idParam(c));
  if (!b) throw new HttpError(404, 'Booking not found.');
  if (!['held', 'reserved', 'submitted', 'expired'].includes(b.status)) throw new HttpError(409, 'This booking is not waiting for payment.');
  const body = await c.body();
  allowFields(body, ['method', 'reference']);
  const admin = c.user.role === 'admin';
  const method = oneOf(body.method, 'Payment method', admin ? PAY_METHODS.filter((m) => m !== 'razorpay') : (['cash', 'upi'] as const));
  const due = b.amount_paise - paidTotal(b.id);
  recordPayment({ bookingId: b.id, direction: 'in', category: 'court', method, amount: Math.max(due, 1), reference: str(body.reference, 'Reference', 40, { required: false }), date: todayIst(), note: admin ? 'Collected by admin' : `Collected by coach ${c.user.name}`, verified: admin, actor: c.user.username });
  if (admin) await confirmPaidBooking(b.id, c.user.username);
  else if (b.status !== 'submitted') setStatus(b.id, 'submitted');
  return {};
});

route('POST', 'bookings/:id/cancel', BOTH, async (c) => {
  const b = bookingById(idParam(c));
  if (!b) throw new HttpError(404, 'Booking not found.');
  const body = await c.body();
  allowFields(body, ['reason', 'refund']);
  const reason = str(body.reason, 'Reason', 200);
  const admin = c.user.role === 'admin';
  if (b.status === 'cancelled' || b.status === 'expired') return {};
  const paid = paidTotal(b.id);
  if (!admin && (b.status === 'confirmed' || paid > 0)) throw new HttpError(403, 'A paid booking can only be cancelled by the admin (refund).');
  tx(() => {
    if (admin && body.refund && typeof body.refund === 'object') {
      const r = body.refund as Record<string, unknown>;
      const amount = money(r.amount, 'Refund');
      if (amount > paid) throw new HttpError(400, 'Refund is more than was paid.');
      recordPayment({ bookingId: b.id, direction: 'refund', category: 'court', method: oneOf(r.method, 'Refund method', PAY_METHODS), amount, reference: str(r.reference, 'Reference', 40, { required: false }), date: todayIst(), note: reason, verified: true, actor: c.user.username });
      const inv = get<{ id: number }>("SELECT id FROM invoices WHERE booking_id = ? AND status = 'issued'", b.id);
      if (inv && amount === paid) cancelInvoice(inv.id, `Booking cancelled and refunded: ${reason}`, c.user.username);
    }
    for (const p of all<PaymentRow>("SELECT * FROM payments WHERE booking_id = ? AND status = 'pending'", b.id)) {
      run("UPDATE payments SET status = 'rejected', note = ? WHERE id = ?", 'Booking cancelled', p.id);
    }
    setStatus(b.id, 'cancelled', { cancelReason: reason });
    audit(c.user.username, 'booking.cancel', 'booking', b.ref, { reason });
  });
  return {};
});

route('POST', 'bookings/:id/wa-sent', BOTH, (c) => {
  run('UPDATE bookings SET wa_sent_at = COALESCE(wa_sent_at, ?) WHERE id = ?', new Date().toISOString(), idParam(c));
  return {};
});

route('PATCH', 'bookings/:id', BOTH, async (c) => {
  const b = bookingById(idParam(c));
  if (!b) throw new HttpError(404, 'Booking not found.');
  const body = await c.body();
  allowFields(body, ['note', 'name', 'email']);
  run('UPDATE bookings SET note = ?, name = ?, email = ?, updated_at = ? WHERE id = ?', str(body.note ?? b.note, 'Note', 300, { required: false }), str(body.name ?? b.name, 'Name', 80), str(body.email ?? b.email, 'Email', 120, { required: false }), new Date().toISOString(), b.id);
  audit(c.user.username, 'booking.edit', 'booking', b.ref);
  return {};
});

/* ---------------- courts, prices, blocks ---------------- */

route('GET', 'courts', BOTH, () => ({
  courts: all('SELECT * FROM courts ORDER BY sort, id'),
  rules: all('SELECT * FROM price_rules ORDER BY priority DESC, id'),
  booking: getSettings('booking'),
}));

route('POST', 'courts', ADMIN, async (c) => {
  const b = await c.body();
  allowFields(b, ['name', 'note']);
  const sort = (get<{ n: number | null }>('SELECT MAX(sort) AS n FROM courts')?.n ?? 0) + 1;
  const id = run('INSERT INTO courts (name, note, sort) VALUES (?,?,?)', str(b.name, 'Name', 40), str(b.note, 'Note', 80, { required: false }), sort).lastId;
  audit(c.user.username, 'court.add', 'court', id);
  return { id };
});

route('PATCH', 'courts/:id', ADMIN, async (c) => {
  const id = idParam(c);
  const b = await c.body();
  allowFields(b, ['name', 'note', 'active', 'sort']);
  const cur = get<{ name: string; note: string; active: number; sort: number }>('SELECT * FROM courts WHERE id = ?', id);
  if (!cur) throw new HttpError(404, 'Court not found.');
  run('UPDATE courts SET name = ?, note = ?, active = ?, sort = ? WHERE id = ?', b.name !== undefined ? str(b.name, 'Name', 40) : cur.name, b.note !== undefined ? str(b.note, 'Note', 80, { required: false }) : cur.note, b.active !== undefined ? (bool(b.active, 'active') ? 1 : 0) : cur.active, b.sort !== undefined ? int(b.sort, 'sort', 0, 999) : cur.sort, id);
  audit(c.user.username, 'court.edit', 'court', id, b);
  return {};
});

route('POST', 'rules', ADMIN, async (c) => {
  const b = await c.body();
  allowFields(b, ['name', 'courtId', 'days', 'start', 'end', 'price', 'priority']);
  const start = time(b.start, 'From');
  const end = time(b.end, 'To');
  if (end <= start) throw new HttpError(400, '"To" must be after "From".');
  const id = run('INSERT INTO price_rules (name, court_id, days, start_min, end_min, price_paise, priority) VALUES (?,?,?,?,?,?,?)', str(b.name, 'Name', 40), b.courtId ? int(b.courtId, 'court', 1, 1e6) : null, daysMask(b.days), start, end, money(b.price, 'Price'), b.priority !== undefined ? int(b.priority, 'Priority', 0, 100) : 10).lastId;
  audit(c.user.username, 'price.add', 'price_rule', id, b);
  return { id };
});

route('DELETE', 'rules/:id', ADMIN, (c) => {
  run('DELETE FROM price_rules WHERE id = ?', idParam(c));
  audit(c.user.username, 'price.delete', 'price_rule', idParam(c));
  return {};
});

route('GET', 'blocks', BOTH, (c) => {
  const from = c.query.get('from') || todayIst();
  return { blocks: all('SELECT b.*, c.name AS court_name FROM blocks b LEFT JOIN courts c ON c.id = b.court_id WHERE date_to >= ? ORDER BY date_from, start_min', from) };
});

route('POST', 'blocks', BOTH, async (c) => {
  const b = await c.body();
  allowFields(b, ['courtId', 'from', 'to', 'days', 'start', 'end', 'kind', 'reason']);
  if (!isValidDate(b.from) || !isValidDate(b.to) || b.to < b.from) throw new HttpError(400, 'Pick the dates.');
  const start = time(b.start, 'From');
  const end = time(b.end, 'To');
  if (end <= start) throw new HttpError(400, '"To" must be after "From".');
  const courtId = b.courtId ? int(b.courtId, 'court', 1, 1e6) : null;
  const days = daysMask(b.days ?? '0123456');
  const id = run('INSERT INTO blocks (court_id, date_from, date_to, days, start_min, end_min, kind, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', courtId, b.from, b.to, days, start, end, oneOf(b.kind ?? 'other', 'kind', BLOCK_KINDS), str(b.reason, 'Reason', 80, { required: false }), c.user.username, new Date().toISOString()).lastId;
  audit(c.user.username, 'block.add', 'block', id, b);
  // Bookings already holding slots inside the new block are kept: tell the staff which.
  const clashes = all<{ ref: string; date: string }>(
    `SELECT DISTINCT k.ref, k.date FROM booking_slots s JOIN bookings k ON k.id = s.booking_id WHERE s.date BETWEEN ? AND ? AND s.start_min < ? AND s.end_min > ? ${courtId ? 'AND s.court_id = ?' : ''}`,
    ...([b.from, b.to, end, start, ...(courtId ? [courtId] : [])] as (string | number)[]),
  ).filter((x) => days.includes(String(new Date(`${x.date}T00:00:00Z`).getUTCDay())));
  return { id, clashes: clashes.map((x) => x.ref) };
});

route('DELETE', 'blocks/:id', BOTH, (c) => {
  run('DELETE FROM blocks WHERE id = ?', idParam(c));
  audit(c.user.username, 'block.delete', 'block', idParam(c));
  return {};
});

/* ---------------- About page ---------------- */

route('GET', 'people', BOTH, () => ({ people: all('SELECT * FROM people ORDER BY sort, id'), about: getSettings('about') }));

function personFields(b: Record<string, unknown>, user: SessionUser) {
  return {
    name: str(b.name, 'Name', 80),
    role: str(b.role, 'Role', 80, { required: false }),
    bio: str(b.bio, 'Bio', 1500, { required: false }),
    highlights: str(b.highlights, 'Highlights', 1000, { required: false }),
    photo: b.photo ? saveDataUrl(b.photo, 'public', user.username) : undefined,
    visible: b.visible === undefined ? 1 : bool(b.visible, 'visible') ? 1 : 0,
    sort: b.sort === undefined ? 0 : int(b.sort, 'sort', 0, 999),
  };
}

route('POST', 'people', BOTH, async (c) => {
  const b = await c.body();
  allowFields(b, ['name', 'role', 'bio', 'highlights', 'photo', 'visible', 'sort']);
  const f = personFields(b, c.user);
  const id = run('INSERT INTO people (name, role, bio, highlights, photo_media, visible, sort) VALUES (?,?,?,?,?,?,?)', f.name, f.role, f.bio, f.highlights, f.photo ?? null, f.visible, f.sort).lastId;
  audit(c.user.username, 'people.add', 'person', id, { name: f.name });
  return { id };
}, { bodyLimit: 6 * 1024 * 1024 });

route('PATCH', 'people/:id', BOTH, async (c) => {
  const id = idParam(c);
  const b = await c.body();
  allowFields(b, ['name', 'role', 'bio', 'highlights', 'photo', 'visible', 'sort', 'removePhoto']);
  const f = personFields(b, c.user);
  run('UPDATE people SET name = ?, role = ?, bio = ?, highlights = ?, visible = ?, sort = ? WHERE id = ?', f.name, f.role, f.bio, f.highlights, f.visible, f.sort, id);
  if (f.photo) run('UPDATE people SET photo_media = ? WHERE id = ?', f.photo, id);
  else if (b.removePhoto === true) run('UPDATE people SET photo_media = NULL WHERE id = ?', id);
  audit(c.user.username, 'people.edit', 'person', id, { name: f.name });
  return {};
}, { bodyLimit: 6 * 1024 * 1024 });

route('DELETE', 'people/:id', BOTH, (c) => {
  run('DELETE FROM people WHERE id = ?', idParam(c));
  audit(c.user.username, 'people.delete', 'person', idParam(c));
  return {};
});

route('PUT', 'about', BOTH, async (c) => {
  const b = await c.body();
  allowFields(b, ['headline', 'story', 'highlights']);
  const highlights = Array.isArray(b.highlights) ? b.highlights.slice(0, 8).map((h, i) => str(h, `Highlight ${i + 1}`, 60)).filter(Boolean) : [];
  saveSettings('about', { headline: str(b.headline, 'Headline', 100), story: str(b.story, 'Story', 3000, { required: false }), highlights }, c.user.username);
  audit(c.user.username, 'settings.about', 'settings', 'about');
  return {};
});

/* ---------------- money (admin only) ---------------- */

route('GET', 'payments', ADMIN, (c) => {
  const status = c.query.get('status') || 'all';
  if (status === 'pending') {
    return {
      payments: all(`SELECT p.*, b.ref, b.name, b.phone, b.date AS booking_date, b.slots_json FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id
                     WHERE p.status = 'pending' AND p.direction = 'in' AND (p.method <> 'razorpay' OR p.reference <> '') ORDER BY p.id`),
    };
  }
  const { from, to } = range(c);
  return { payments: all('SELECT p.*, b.ref, b.name FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE p.date BETWEEN ? AND ? AND NOT (p.method = \'razorpay\' AND p.status = \'pending\') ORDER BY p.id DESC LIMIT 1000', from, to) };
});

route('POST', 'payments/:id/verify', ADMIN, async (c) => {
  await verifyPayment(idParam(c), c.user.username);
  const p = get<PaymentRow>('SELECT * FROM payments WHERE id = ?', idParam(c))!;
  const b = p.booking_id ? bookingById(p.booking_id) : undefined;
  return { waLink: b && b.status === 'confirmed' ? deskConfirmLink(b, appUrl(c.req)) : null, waAuto: integrations().whatsappApi };
});

route('POST', 'payments/:id/reject', ADMIN, async (c) => {
  const b = await c.body();
  allowFields(b, ['reason', 'keepBooking']);
  rejectPayment(idParam(c), str(b.reason, 'Reason', 200), c.user.username, { cancelBooking: b.keepBooking !== true });
  return {};
});

route('POST', 'payments', ADMIN, async (c) => {
  const b = await c.body();
  allowFields(b, ['direction', 'category', 'method', 'amount', 'reference', 'date', 'note']);
  const date = b.date ?? todayIst();
  if (!isValidDate(date)) throw new HttpError(400, 'Invalid date.');
  const p = recordPayment({
    direction: oneOf(b.direction ?? 'in', 'direction', ['in', 'refund'] as const), category: oneOf(b.category ?? 'other', 'Category', INCOME_CATEGORIES),
    method: oneOf(b.method, 'Method', PAY_METHODS), amount: money(b.amount, 'Amount'), reference: str(b.reference, 'Reference', 40, { required: false }),
    date, note: str(b.note, 'Note', 200, { required: false }), verified: true, actor: c.user.username,
  });
  return { id: p.id };
});

route('GET', 'invoices', ADMIN, (c) => {
  const { from, to } = range(c, 90);
  return { invoices: listInvoices(from, to).map(({ seller_json: _s, items_json, ...r }) => ({ ...r, items: JSON.parse(items_json) })) };
});

route('POST', 'invoices', ADMIN, async (c) => {
  const b = await c.body();
  allowFields(b, ['date', 'customerName', 'customerPhone', 'customerGstin', 'customerAddress', 'placeOfSupply', 'items', 'paid']);
  const date = b.date ?? todayIst();
  if (!isValidDate(date)) throw new HttpError(400, 'Invalid date.');
  const gstin = str(b.customerGstin, 'Customer GSTIN', 15, { required: false }).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new HttpError(400, 'Customer GSTIN is not valid.');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20) throw new HttpError(400, 'Add at least one line.');
  const g = getSettings('gst');
  const items: InvoiceItem[] = b.items.map((it: unknown, i: number) => {
    const o = (it || {}) as Record<string, unknown>;
    return { description: str(o.description, `Line ${i + 1}`, 200), sac: str(o.sac, 'SAC', 8, { required: false }) || g.sac, qty: o.qty === undefined ? 1 : int(o.qty, 'Qty', 1, 9999), amount: money(o.amount, `Line ${i + 1} amount`) };
  });
  const pos = b.placeOfSupply ? oneOf(b.placeOfSupply, 'Place of supply', Object.keys(STATES)) : undefined;
  const inv = issueInvoice({ date, customerName: str(b.customerName, 'Customer name', 100), customerPhone: str(b.customerPhone, 'Phone', 20, { required: false }), customerGstin: gstin, customerAddress: str(b.customerAddress, 'Address', 300, { required: false }), placeOfSupply: pos, items, actor: c.user.username });
  if (b.paid && typeof b.paid === 'object') {
    const p = b.paid as Record<string, unknown>;
    recordPayment({ invoiceId: inv.id, direction: 'in', category: oneOf(p.category ?? 'other', 'Category', INCOME_CATEGORIES), method: oneOf(p.method, 'Method', PAY_METHODS), amount: inv.total_paise, reference: str(p.reference, 'Reference', 40, { required: false }), date, note: `Invoice ${inv.number}`, verified: true, actor: c.user.username });
  }
  return { id: inv.id, number: inv.number, token: inv.token, title: documentTitle(g.mode) };
});

route('POST', 'invoices/:id/cancel', ADMIN, async (c) => {
  const b = await c.body();
  allowFields(b, ['reason']);
  cancelInvoice(idParam(c), str(b.reason, 'Reason', 200), c.user.username);
  return {};
});

route('GET', 'expenses', ADMIN, (c) => {
  const { from, to } = range(c, 90);
  return { expenses: all('SELECT * FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date DESC, id DESC', from, to), categories: EXPENSE_CATEGORIES };
});

function expenseFields(b: Record<string, unknown>) {
  const date = b.date ?? todayIst();
  if (!isValidDate(date)) throw new HttpError(400, 'Invalid date.');
  const amount = money(b.amount, 'Amount');
  const gst = b.gst === undefined || b.gst === '' ? 0 : money(b.gst, 'GST', { allowZero: true });
  if (gst >= amount) throw new HttpError(400, 'GST must be less than the bill amount.');
  return {
    date, category: oneOf(b.category, 'Category', EXPENSE_CATEGORIES), vendor: str(b.vendor, 'Paid to', 80, { required: false }),
    description: str(b.description, 'Description', 300, { required: false }), amount, gst, method: oneOf(b.method ?? 'upi', 'Method', PAY_METHODS),
    reference: str(b.reference, 'Reference', 40, { required: false }),
  };
}

route('POST', 'expenses', ADMIN, async (c) => {
  const b = await c.body();
  allowFields(b, ['date', 'category', 'vendor', 'description', 'amount', 'gst', 'method', 'reference', 'bill']);
  const f = expenseFields(b);
  const bill = b.bill ? saveDataUrl(b.bill, 'private', c.user.username, { allowPdf: true }) : null;
  const id = run('INSERT INTO expenses (date, category, vendor, description, amount_paise, gst_paise, method, reference, bill_media, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', f.date, f.category, f.vendor, f.description, f.amount, f.gst, f.method, f.reference, bill, c.user.username, new Date().toISOString()).lastId;
  audit(c.user.username, 'expense.add', 'expense', id, { amount: f.amount, category: f.category });
  return { id };
}, { bodyLimit: 6 * 1024 * 1024 });

route('DELETE', 'expenses/:id', ADMIN, (c) => {
  const id = idParam(c);
  run('UPDATE expenses SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', new Date().toISOString(), id);
  audit(c.user.username, 'expense.delete', 'expense', id);
  return {};
});

route('GET', 'finance', ADMIN, (c) => {
  const { from, to } = range(c, 180);
  return { summary: summary(from, to), gst: gstReport(from, to), threshold: thresholdWatch(), from, to };
});

/* ---------------- settings, users, audit (admin only) ---------------- */

route('GET', 'settings', ADMIN, () => ({
  academy: getSettings('academy'), booking: getSettings('booking'), gst: getSettings('gst'), integrations: integrations(),
}));

route('PUT', 'settings/:group', ADMIN, async (c) => {
  const group = oneOf(c.params.group, 'group', ['academy', 'booking', 'gst'] as const) as SettingsGroup;
  const b = await c.body();
  allowFields(b, Object.keys(DEFAULTS[group]));
  const cur = getSettings(group) as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = { ...cur };
  if (group === 'academy') {
    for (const k of Object.keys(DEFAULTS.academy)) if (b[k] !== undefined) next[k] = str(b[k], k, k === 'address' ? 300 : 120, { required: k === 'name' });
    if (next.whatsapp && !normalizeIndianMobile(next.whatsapp)) throw new HttpError(400, 'WhatsApp number: use a 10-digit Indian mobile.');
    if (next.whatsapp) next.whatsapp = normalizeIndianMobile(next.whatsapp);
    if (next.upiVpa && !/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(String(next.upiVpa))) throw new HttpError(400, 'UPI ID looks wrong (example: gsasports@okhdfcbank).');
    if (next.instagram) next.instagram = String(next.instagram).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');
    if (next.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(String(next.instagram))) throw new HttpError(400, 'Instagram: just the username, like gsa.badminton.');
    if (next.mapUrl && !/^https:\/\//.test(String(next.mapUrl))) throw new HttpError(400, 'Map link must start with https://');
    if (!STATES[String(next.stateCode)]) throw new HttpError(400, 'State code is not valid.');
    next.state = STATES[String(next.stateCode)];
  } else if (group === 'booking') {
    if (b.hours !== undefined) {
      if (!Array.isArray(b.hours) || b.hours.length !== 7) throw new HttpError(400, 'Hours for 7 days are needed.');
      next.hours = b.hours.map((h: unknown, i: number) => {
        const o = (h || {}) as Record<string, unknown>;
        const open = time(o.open, `Day ${i} opens`);
        const close = time(o.close, `Day ${i} closes`);
        if (close <= open) throw new HttpError(400, 'Closing time must be after opening time.');
        return { open, close, closed: o.closed === true };
      });
    }
    if (b.slotMinutes !== undefined) next.slotMinutes = oneOf(String(b.slotMinutes), 'Slot length', ['30', '45', '60', '90', '120']) && Number(b.slotMinutes);
    if (b.daysAhead !== undefined) next.daysAhead = int(b.daysAhead, 'Days ahead', 1, 90);
    if (b.holdMinutes !== undefined) next.holdMinutes = int(b.holdMinutes, 'Hold minutes', 3, 60);
    if (b.minLeadMinutes !== undefined) next.minLeadMinutes = int(b.minLeadMinutes, 'Lead time', 0, 1440);
    if (b.basePricePaise !== undefined) next.basePricePaise = int(b.basePricePaise, 'Base price', 0, 1e8);
    if (b.maxSlots !== undefined) next.maxSlots = int(b.maxSlots, 'Max slots', 1, 20);
    if (b.upiEnabled !== undefined) next.upiEnabled = bool(b.upiEnabled, 'UPI');
    if (b.razorpayEnabled !== undefined) next.razorpayEnabled = bool(b.razorpayEnabled, 'Razorpay');
  } else {
    if (b.mode !== undefined) next.mode = oneOf(b.mode, 'GST mode', ['none', 'regular', 'composition'] as const);
    if (b.gstin !== undefined) next.gstin = str(b.gstin, 'GSTIN', 15, { required: false }).toUpperCase();
    if (next.gstin && !isValidGstin(String(next.gstin))) throw new HttpError(400, 'Academy GSTIN is not valid.');
    if (next.mode !== 'none' && !next.gstin) throw new HttpError(400, 'Add the GSTIN to use this GST mode.');
    if (next.gstin && String(next.gstin).slice(0, 2) !== getSettings('academy').stateCode) throw new HttpError(400, 'GSTIN state code does not match the academy state.');
    if (b.legalName !== undefined) next.legalName = str(b.legalName, 'Legal name', 120, { required: false });
    if (b.ratePct !== undefined) next.ratePct = Number(oneOf(String(b.ratePct), 'GST rate', ['0', '5', '12', '18', '28']));
    if (b.sac !== undefined) next.sac = str(b.sac, 'SAC', 8);
    if (!/^\d{4,8}$/.test(String(next.sac))) throw new HttpError(400, 'SAC code is 4–8 digits.');
    if (b.pricesIncludeGst !== undefined) next.pricesIncludeGst = bool(b.pricesIncludeGst, 'Prices include GST');
    if (b.invoicePrefix !== undefined) next.invoicePrefix = str(b.invoicePrefix, 'Prefix', 6).toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(String(next.invoicePrefix))) throw new HttpError(400, 'Prefix: 1–6 letters or digits.');
    if (b.thresholdPaise !== undefined) next.thresholdPaise = int(b.thresholdPaise, 'Threshold', 0, 1e12);
    if (b.terms !== undefined) next.terms = str(b.terms, 'Terms', 500, { required: false });
  }
  saveSettings(group, next as never, c.user.username);
  audit(c.user.username, `settings.${group}`, 'settings', group, b);
  return { [group]: getSettings(group) };
});

route('GET', 'users', ADMIN, () => ({ users: all('SELECT id, username, name, role, active, must_change, totp_secret IS NOT NULL AS totp, last_login_at, created_at FROM users ORDER BY id') }));

route('POST', 'users', ADMIN, async (c) => {
  const b = await c.body();
  allowFields(b, ['username', 'name', 'role']);
  const username = str(b.username, 'Username', 30).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new HttpError(400, 'Username: 3–30 letters, digits, dot, dash.');
  if (get('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'That username is taken.');
  const password = generatePassword();
  run('INSERT INTO users (username, name, role, password_hash, must_change, created_at) VALUES (?,?,?,?,1,?)', username, str(b.name, 'Name', 60), oneOf(b.role ?? 'coach', 'Role', ['admin', 'coach'] as const), await hashPassword(password), new Date().toISOString());
  audit(c.user.username, 'user.add', 'user', username, { role: b.role });
  return { username, password };
});

route('PATCH', 'users/:id', ADMIN, async (c) => {
  const id = idParam(c);
  const b = await c.body();
  allowFields(b, ['name', 'role', 'active', 'resetPassword', 'resetTotp']);
  const u = userRow(id);
  if (!u) throw new HttpError(404, 'User not found.');
  if (id === c.user.id && (b.active === false || b.role === 'coach')) throw new HttpError(400, 'You cannot demote or deactivate yourself.');
  let password: string | undefined;
  if (b.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', str(b.name, 'Name', 60), id);
  if (b.role !== undefined) run('UPDATE users SET role = ? WHERE id = ?', oneOf(b.role, 'Role', ['admin', 'coach'] as const), id);
  if (b.active !== undefined) run('UPDATE users SET active = ? WHERE id = ?', bool(b.active, 'active') ? 1 : 0, id);
  if (b.resetTotp === true) run('UPDATE users SET totp_secret = NULL WHERE id = ?', id);
  if (b.resetPassword === true) {
    password = generatePassword();
    run('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?', await hashPassword(password), id);
  }
  if (b.active === false || b.role !== undefined || b.resetPassword === true) endSessions(id);
  audit(c.user.username, 'user.edit', 'user', u.username, { ...b, resetPassword: b.resetPassword === true });
  return { password };
});

route('GET', 'audit', ADMIN, (c) => {
  const before = c.query.get('before') ? Number(c.query.get('before')) : undefined;
  return { rows: recentAudit(200, before), check: verifyAudit() };
});

/* ---------------- files & exports (admin only) ---------------- */

route('GET', 'media/:id', ADMIN, (c) => {
  const m = readMedia(c.params.id, 'any');
  if (!m) throw new HttpError(404, 'File not found.');
  return new Response(new Uint8Array(m.body), {
    headers: {
      'Content-Type': m.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; frame-ancestors 'self'; sandbox",
      ...(m.mime === 'application/pdf' ? { 'Content-Disposition': `attachment; filename="bill-${c.params.id.slice(0, 6)}.pdf"` } : {}),
    },
  });
});

route('GET', 'export/:kind', ADMIN, (c) => {
  const { from, to } = range(c, 365);
  const kind = oneOf(c.params.kind, 'export', ['bookings', 'payments', 'invoices', 'expenses'] as const);
  const p = (n: number) => (n / 100).toFixed(2);
  let rows: (string | number)[][] = [];
  if (kind === 'bookings') {
    rows = [['Ref', 'Date', 'Name', 'Phone', 'Status', 'Source', 'Channel', 'Slots', 'Amount', 'Created']];
    for (const b of all<BookingRow>('SELECT * FROM bookings WHERE date BETWEEN ? AND ? ORDER BY date, id', from, to)) rows.push([b.ref, b.date, b.name, b.phone, b.status, b.source, b.channel, slotsLabel(slotsOf(b)), p(b.amount_paise), b.created_at]);
  } else if (kind === 'payments') {
    rows = [['ID', 'Date', 'Direction', 'Status', 'Method', 'Category', 'Amount', 'Reference', 'Booking', 'Note', 'Verified by']];
    for (const r of all<PaymentRow & { ref: string | null }>('SELECT p.*, b.ref FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE p.date BETWEEN ? AND ? ORDER BY p.id', from, to)) rows.push([r.id, r.date, r.direction, r.status, r.method, r.category, p(r.amount_paise), r.reference, r.ref || '', r.note, r.verified_by || '']);
  } else if (kind === 'invoices') {
    rows = [['Number', 'Type', 'Date', 'Status', 'Customer', 'Customer GSTIN', 'Place of supply', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total']];
    for (const r of listInvoices(from, to).reverse()) rows.push([r.number, documentTitle(r.kind === 'tax_invoice' ? 'regular' : r.kind === 'bill_of_supply' ? 'composition' : 'none'), r.date, r.status, r.customer_name, r.customer_gstin, `${r.place_of_supply}-${STATES[r.place_of_supply] || ''}`, p(r.taxable_paise), p(r.cgst_paise), p(r.sgst_paise), p(r.igst_paise), p(r.total_paise)]);
  } else {
    rows = [['Date', 'Category', 'Paid to', 'Description', 'Amount', 'GST (input)', 'Method', 'Reference', 'Bill attached']];
    for (const r of all<Record<string, string | number | null>>('SELECT * FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date, id', from, to)) rows.push([r.date as string, r.category as string, r.vendor as string, r.description as string, p(r.amount_paise as number), p(r.gst_paise as number), r.method as string, r.reference as string, r.bill_media ? 'yes' : 'no']);
  }
  audit(c.user.username, 'export', 'export', kind, { from, to });
  return new Response(csv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="gsa-${kind}-${from}-to-${to}.csv"`, 'Cache-Control': 'no-store' } });
});

route('GET', 'backup', ADMIN, async (c) => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(os.tmpdir(), `gsa-backup-${randomToken(8)}.db`);
  db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const body = fs.readFileSync(file);
  fs.unlinkSync(file);
  audit(c.user.username, 'backup.download', 'backup', '');
  return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'application/vnd.sqlite3', 'Content-Disposition': `attachment; filename="gsa-backup-${todayIst()}.db"`, 'Cache-Control': 'no-store' } });
});

/* ---------------- dispatch ---------------- */

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export async function dispatch(req: Request, segments: string[]): Promise<{ response: Response } | { data: unknown }> {
  const path = segments.join('/');
  const method = req.method as Route['method'];
  let found: { r: Route; params: Record<string, string> } | null = null;
  for (const r of routes) {
    if (r.method !== method) continue;
    const params = match(r.path, path);
    if (params) {
      found = { r, params };
      break;
    }
  }
  if (!found) throw new HttpError(404, 'Not found.');
  const user = await requireUser(req, found.r.roles, { allowMustChange: found.r.allowMustChange });
  const ctx: Ctx = { req, user, params: found.params, query: new URL(req.url).searchParams, body: () => readJsonBody(req, found!.r.bodyLimit ?? 32 * 1024) };
  const out = await found.r.h(ctx);
  if (out instanceof Response) return { response: out };
  return { data: out };
}

/** For tests: every route and the roles it allows. */
export function _routes() {
  return routes.map((r) => ({ method: r.method, path: r.path, roles: r.roles }));
}
