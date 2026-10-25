import QRCode from 'qrcode';
import { documentTitle, isValidGstin, STATES } from '@/lib/shared/gst';
import { toPaise } from '@/lib/shared/money';
import { addDays, isValidDate, parseHhmm, todayIst } from '@/lib/shared/time';
import { BLOCK_KINDS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAY_METHODS, type SlotRef } from '@/lib/shared/types';
import { can, ROLES, type Permission } from '@/lib/shared/rbac';
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
import { deskConfirmLink, payStateOf } from './whatsapp';
import { balances, cashCollections, createDeposit, custodianFor, decideDeposit, deposits } from './cash';
import { enforce } from './rateLimit';

/**
 * Every staff API call goes through this one table. A route names the permission it needs
 * (src/lib/shared/rbac.ts); there is no default, so a route can't be left open by forgetting a check.
 */

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
  perm: Permission;
  h: Handler;
  allowMustChange?: boolean;
  bodyLimit?: number;
}

const routes: Route[] = [];
function route(method: Route['method'], path: string, perm: Permission, h: Handler, opts: Partial<Route> = {}) {
  routes.push({ method, path, perm, h, ...opts });
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

route('POST', 'password', 'account', async (c) => {
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

route('POST', 'totp/setup', 'account', async (c) => {
  const secret = newTotpSecret();
  const uri = otpauthUri(secret, c.user.username, getSettings('business').name);
  return { secret, qr: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
});

route('POST', 'totp/enable', 'account', async (c) => {
  const b = await c.body();
  allowFields(b, ['secret', 'code']);
  const secret = str(b.secret, 'secret', 64);
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new HttpError(400, 'Start again.');
  if (!verifyTotp(secret, str(b.code, 'Code', 10))) throw new HttpError(400, 'That code is not right. Check the time on your phone and try the newest code.');
  run('UPDATE users SET totp_secret = ? WHERE id = ?', encrypt(secret), c.user.id);
  audit(c.user.username, 'user.totp_on', 'user', c.user.username);
  return {};
});

route('POST', 'totp/disable', 'account', async (c) => {
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
  const { payState, due } = payStateOf(b);
  return {
    payState, due,
    id: b.id, ref: b.ref, date: b.date, name: b.name, phone: b.phone, status: b.status, source: b.source, channel: b.channel,
    slots: slotsLabel(slotsOf(b)), count: slotsOf(b).length, amount: b.amount_paise, createdAt: b.created_at,
    paid: admin ? paidTotal(b.id) : undefined, note: b.note, waSent: Boolean(b.wa_sent_at), waOpened: Boolean(b.wa_opened_at),
  };
}

route('GET', 'dashboard', 'bookings.view', (c) => {
  sweepExpired();
  const today = todayIst();
  const admin = can(c.user.role, 'money');
  const todays = all<BookingRow>("SELECT * FROM bookings WHERE date = ? AND status IN ('reserved','submitted','confirmed','held') ORDER BY id", today);
  const firstStart = (b: BookingRow) => Math.min(...slotsOf(b).map((s) => s.start));
  const pendingPayments = admin ? all<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE status='pending' AND direction='in' AND (method <> 'razorpay' OR reference <> '')")[0].n : undefined;
  const collectedToday = admin ? get<{ n: number | null }>("SELECT SUM(CASE direction WHEN 'in' THEN amount_paise ELSE -amount_paise END) AS n FROM payments WHERE status='verified' AND date = ?", today)?.n ?? 0 : undefined;
  const upcoming = get<{ n: number }>("SELECT COUNT(*) AS n FROM bookings WHERE date > ? AND status IN ('reserved','submitted','confirmed')", today)!.n;
  const grid = buildDay(today, { staff: true });
  const cells = grid.spaces.flatMap((x) => x.cells);
  return {
    today,
    bookings: todays.sort((a, b) => firstStart(a) - firstStart(b)).map((b) => bookingListItem(b, admin)),
    occupancy: cells.length ? Math.round((cells.filter((x) => x.state === 'booked').length / cells.length) * 100) : 0,
    pendingPayments,
    collectedToday,
    upcoming,
    threshold: admin ? thresholdWatch() : undefined,
    cashOnName: can(c.user.role, 'cash.custody') && !admin ? (balances(c.user.username)[0]?.onHand ?? 0) : undefined,
    cashTakenToday: !can(c.user.role, 'cash.custody') ? cashCollections({ collector: c.user.username, from: today, to: today }).reduce((n, r) => n + (r.direction === 'in' ? r.amount_paise : -r.amount_paise), 0) : undefined,
    pendingDeposits: admin ? deposits().filter((d) => d.status === 'pending').length : undefined,
    integrations: admin ? integrations() : undefined,
  };
});

route('GET', 'day', 'bookings.view', (c) => {
  const date = c.query.get('date') || todayIst();
  if (!isValidDate(date)) throw new HttpError(400, 'Invalid date.');
  sweepExpired();
  return { grid: buildDay(date, { staff: true }) };
});

/* ---------------- bookings ---------------- */

route('GET', 'bookings', 'bookings.view', (c) => {
  sweepExpired();
  const admin = can(c.user.role, 'money');
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

route('GET', 'bookings/:id', 'bookings.view', (c) => {
  const b = bookingById(idParam(c));
  if (!b) throw new HttpError(404, 'Booking not found.');
  const admin = can(c.user.role, 'money');
  const invoice = get<{ id: number; number: string; token: string; status: string }>('SELECT id, number, token, status FROM invoices WHERE booking_id = ? ORDER BY id DESC LIMIT 1', b.id);
  return {
    booking: { ...bookingListItem(b, admin), email: b.email, gstin: b.gstin, token: b.token, cancelReason: b.cancel_reason, slotList: slotsOf(b), createdBy: b.created_by, holdExpiresAt: b.hold_expires_at, code: b.confirm_code },
    payments: admin ? paymentsForBooking(b.id) : paymentsForBooking(b.id).map((p) => ({ id: p.id, method: p.method, status: p.status, direction: p.direction, created_at: p.created_at })),
    invoice: admin ? invoice ?? null : null,
    waLink: deskConfirmLink(b, appUrl(c.req)),
    payLink: `${appUrl(c.req)}/pay/${b.token}`,
  };
});

/**
 * Money taken at the desk.
 * Cash: the booking is paid at once and the cash goes on its custodian's name — the manager who
 * collected it, or the manager a assistant reports to (src/lib/server/cash.ts) — until deposited.
 * UPI / card / bank: confirmed at once when the admin takes it; from a manager it waits for the admin to
 * see it in the bank account (Money → Verify).
 */
async function takeDeskPayment(user: SessionUser, b: BookingRow, methodRaw: unknown, reference: string, amount: number) {
  const admin = can(user.role, 'money');
  const method = oneOf(methodRaw, 'Payment method', admin ? PAY_METHODS.filter((m) => m !== 'razorpay') : (['cash', 'upi'] as const));
  if (method === 'cash') {
    const custodian = custodianFor(user);
    recordPayment({
      bookingId: b.id, direction: 'in', category: 'space', method, amount, reference, date: todayIst(),
      note: custodian === user.username ? `Cash taken by ${user.name}` : `Cash taken by ${user.name}, on ${custodian}'s name`,
      verified: true, actor: user.username, collectedBy: user.username, custodian,
    });
    await confirmPaidBooking(b.id, user.username);
    return;
  }
  recordPayment({ bookingId: b.id, direction: 'in', category: 'space', method, amount, reference, date: todayIst(), note: `Taken at the desk by ${user.name}`, verified: admin, actor: user.username });
  if (admin) await confirmPaidBooking(b.id, user.username);
  else if (bookingById(b.id)!.status !== 'submitted') setStatus(b.id, 'submitted');
}

route('POST', 'bookings', 'bookings.create', async (c) => {
  const body = await c.body();
  allowFields(body, ['date', 'slots', 'name', 'phone', 'email', 'gstin', 'note', 'pay']);
  const date = body.date;
  if (!isValidDate(date)) throw new HttpError(400, 'Pick a date.');
  if (!Array.isArray(body.slots)) throw new HttpError(400, 'Pick slots.');
  const slots: SlotRef[] = body.slots.map((s: unknown) => {
    const o = s as Record<string, unknown>;
    return { spaceId: int(o?.spaceId, 'space', 1, 1e6), start: int(o?.start, 'start', 0, 1440) };
  });
  const phone = normalizeIndianMobile(body.phone);
  if (!phone) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');
  const gstin = str(body.gstin, 'GSTIN', 15, { required: false }).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new HttpError(400, 'That GSTIN is not valid.');
  const b = createBooking({
    date, slots, name: str(body.name, 'Name', 80), phone, email: str(body.email, 'Email', 120, { required: false }), gstin,
    note: str(body.note, 'Note', 300, { required: false }), source: 'desk', status: 'reserved', actor: c.user.username, staff: true,
  });
  if (body.pay && typeof body.pay === 'object') {
    const p = body.pay as Record<string, unknown>;
    await takeDeskPayment(c.user, b, p.method, str(p.reference, 'Reference', 40, { required: false }), b.amount_paise);
  }
  const fresh = bookingById(b.id)!;
  return { id: b.id, ref: b.ref, waLink: deskConfirmLink(fresh, appUrl(c.req)), ...payStateOf(fresh), amount: fresh.amount_paise };
});

route('POST', 'bookings/:id/collected', 'cash.collect', async (c) => {
  const b = bookingById(idParam(c));
  if (!b) throw new HttpError(404, 'Booking not found.');
  if (!['held', 'reserved', 'submitted', 'expired'].includes(b.status)) throw new HttpError(409, 'This booking is not waiting for payment.');
  const body = await c.body();
  allowFields(body, ['method', 'reference']);
  const due = b.amount_paise - paidTotal(b.id);
  if (due <= 0) throw new HttpError(409, 'This booking is already paid.');
  await takeDeskPayment(c.user, b, body.method, str(body.reference, 'Reference', 40, { required: false }), due);
  return { waLink: deskConfirmLink(bookingById(b.id)!, appUrl(c.req)) };
});

route('POST', 'bookings/:id/cancel', 'bookings.cancel', async (c) => {
  const b = bookingById(idParam(c));
  if (!b) throw new HttpError(404, 'Booking not found.');
  const body = await c.body();
  allowFields(body, ['reason', 'refund']);
  const reason = str(body.reason, 'Reason', 200);
  const admin = can(c.user.role, 'money');
  if (b.status === 'cancelled' || b.status === 'expired') return {};
  const paid = paidTotal(b.id);
  if (!admin && (b.status === 'confirmed' || paid > 0)) throw new HttpError(403, 'A paid booking can only be cancelled by the admin (refund).');
  tx(() => {
    if (admin && body.refund && typeof body.refund === 'object') {
      const r = body.refund as Record<string, unknown>;
      const amount = money(r.amount, 'Refund');
      if (amount > paid) throw new HttpError(400, 'Refund is more than was paid.');
      const refundMethod = oneOf(r.method, 'Refund method', PAY_METHODS);
      recordPayment({ bookingId: b.id, direction: 'refund', category: 'space', method: refundMethod, amount, custodian: refundMethod === 'cash' ? custodianFor(c.user) : undefined, reference: str(r.reference, 'Reference', 40, { required: false }), date: todayIst(), note: reason, verified: true, actor: c.user.username });
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

route('POST', 'bookings/:id/wa-sent', 'bookings.notify', (c) => {
  run('UPDATE bookings SET wa_sent_at = COALESCE(wa_sent_at, ?) WHERE id = ?', new Date().toISOString(), idParam(c));
  return {};
});

route('PATCH', 'bookings/:id', 'bookings.edit', async (c) => {
  const b = bookingById(idParam(c));
  if (!b) throw new HttpError(404, 'Booking not found.');
  const body = await c.body();
  allowFields(body, ['note', 'name', 'email']);
  run('UPDATE bookings SET note = ?, name = ?, email = ?, updated_at = ? WHERE id = ?', str(body.note ?? b.note, 'Note', 300, { required: false }), str(body.name ?? b.name, 'Name', 80), str(body.email ?? b.email, 'Email', 120, { required: false }), new Date().toISOString(), b.id);
  audit(c.user.username, 'booking.edit', 'booking', b.ref);
  return {};
});

/* ---------------- cash custody ---------------- */

route('GET', 'cash', 'cash.collect', (c) => {
  const { from, to } = range(c, 30);
  const me = c.user;
  if (can(me.role, 'money')) {
    return { view: 'admin', balances: balances(), deposits: deposits(), collections: cashCollections({ from, to }), from, to };
  }
  if (can(me.role, 'cash.custody')) {
    return { view: 'custodian', balance: balances(me.username)[0] ?? null, deposits: deposits(me.username), collections: cashCollections({ custodian: me.username, from, to }), from, to };
  }
  const custodian = custodianFor(me);
  const lead = get<{ name: string }>('SELECT name FROM users WHERE username = ?', custodian);
  const mine = cashCollections({ collector: me.username, from, to });
  return { view: 'collector', custodian, custodianName: lead?.name ?? custodian, collections: mine, total: mine.reduce((n, r) => n + (r.direction === 'in' ? r.amount_paise : -r.amount_paise), 0), from, to };
});

route('POST', 'cash/deposits', 'cash.custody', async (c) => {
  const b = await c.body();
  allowFields(b, ['amount', 'method', 'reference', 'note', 'slip', 'date']);
  const date = b.date ?? todayIst();
  if (!isValidDate(date)) throw new HttpError(400, 'Invalid date.');
  const id = createDeposit(c.user, {
    amount: money(b.amount, 'Amount'), method: oneOf(b.method, 'Deposit type', ['bank', 'handover'] as const),
    reference: str(b.reference, 'Reference', 60, { required: false }), note: str(b.note, 'Note', 200, { required: false }),
    slip: b.slip ? saveDataUrl(b.slip, 'private', c.user.username, { allowPdf: true }) : null, date,
  });
  return { id };
}, { bodyLimit: 6 * 1024 * 1024 });

route('POST', 'cash/deposits/:id/:decision', 'money', async (c) => {
  const b = await c.body();
  allowFields(b, ['note']);
  const decision = oneOf(c.params.decision, 'decision', ['confirm', 'reject'] as const);
  decideDeposit(idParam(c), decision === 'confirm' ? 'confirmed' : 'rejected', str(b.note, 'Note', 200, { required: decision === 'reject' }), c.user.username);
  return {};
});

route('GET', 'cash/slip/:id', 'cash.custody', (c) => {
  const d = get<{ custodian: string; slip_media: string | null }>('SELECT custodian, slip_media FROM cash_deposits WHERE id = ?', idParam(c));
  if (!d?.slip_media || (!can(c.user.role, 'money') && d.custodian !== c.user.username)) throw new HttpError(404, 'File not found.');
  const m = readMedia(d.slip_media, 'private')!;
  return new Response(new Uint8Array(m.body), { headers: { 'Content-Type': m.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox" } });
});

/* ---------------- spaces, prices, blocks ---------------- */

route('GET', 'spaces', 'bookings.view', () => ({
  spaces: all('SELECT * FROM spaces ORDER BY sort, id'),
  rules: all('SELECT * FROM price_rules ORDER BY priority DESC, id'),
  booking: getSettings('booking'),
}));

route('POST', 'spaces', 'settings', async (c) => {
  const b = await c.body();
  allowFields(b, ['name', 'note']);
  const sort = (get<{ n: number | null }>('SELECT MAX(sort) AS n FROM spaces')?.n ?? 0) + 1;
  const id = run('INSERT INTO spaces (name, note, sort) VALUES (?,?,?)', str(b.name, 'Name', 40), str(b.note, 'Note', 80, { required: false }), sort).lastId;
  audit(c.user.username, 'space.add', 'space', id);
  return { id };
});

route('PATCH', 'spaces/:id', 'settings', async (c) => {
  const id = idParam(c);
  const b = await c.body();
  allowFields(b, ['name', 'note', 'active', 'sort']);
  const cur = get<{ name: string; note: string; active: number; sort: number }>('SELECT * FROM spaces WHERE id = ?', id);
  if (!cur) throw new HttpError(404, 'Space not found.');
  run('UPDATE spaces SET name = ?, note = ?, active = ?, sort = ? WHERE id = ?', b.name !== undefined ? str(b.name, 'Name', 40) : cur.name, b.note !== undefined ? str(b.note, 'Note', 80, { required: false }) : cur.note, b.active !== undefined ? (bool(b.active, 'active') ? 1 : 0) : cur.active, b.sort !== undefined ? int(b.sort, 'sort', 0, 999) : cur.sort, id);
  audit(c.user.username, 'space.edit', 'space', id, b);
  return {};
});

route('POST', 'rules', 'settings', async (c) => {
  const b = await c.body();
  allowFields(b, ['name', 'spaceId', 'days', 'start', 'end', 'price', 'priority']);
  const start = time(b.start, 'From');
  const end = time(b.end, 'To');
  if (end <= start) throw new HttpError(400, '"To" must be after "From".');
  const id = run('INSERT INTO price_rules (name, space_id, days, start_min, end_min, price_paise, priority) VALUES (?,?,?,?,?,?,?)', str(b.name, 'Name', 40), b.spaceId ? int(b.spaceId, 'space', 1, 1e6) : null, daysMask(b.days), start, end, money(b.price, 'Price'), b.priority !== undefined ? int(b.priority, 'Priority', 0, 100) : 10).lastId;
  audit(c.user.username, 'price.add', 'price_rule', id, b);
  return { id };
});

route('DELETE', 'rules/:id', 'settings', (c) => {
  run('DELETE FROM price_rules WHERE id = ?', idParam(c));
  audit(c.user.username, 'price.delete', 'price_rule', idParam(c));
  return {};
});

route('GET', 'blocks', 'bookings.view', (c) => {
  const from = c.query.get('from') || todayIst();
  return { blocks: all('SELECT b.*, c.name AS space_name FROM blocks b LEFT JOIN spaces c ON c.id = b.space_id WHERE date_to >= ? ORDER BY date_from, start_min', from) };
});

route('POST', 'blocks', 'schedule.manage', async (c) => {
  const b = await c.body();
  allowFields(b, ['spaceId', 'from', 'to', 'days', 'start', 'end', 'kind', 'reason']);
  if (!isValidDate(b.from) || !isValidDate(b.to) || b.to < b.from) throw new HttpError(400, 'Pick the dates.');
  const start = time(b.start, 'From');
  const end = time(b.end, 'To');
  if (end <= start) throw new HttpError(400, '"To" must be after "From".');
  const spaceId = b.spaceId ? int(b.spaceId, 'space', 1, 1e6) : null;
  const days = daysMask(b.days ?? '0123456');
  const id = run('INSERT INTO blocks (space_id, date_from, date_to, days, start_min, end_min, kind, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', spaceId, b.from, b.to, days, start, end, oneOf(b.kind ?? 'other', 'kind', BLOCK_KINDS), str(b.reason, 'Reason', 80, { required: false }), c.user.username, new Date().toISOString()).lastId;
  audit(c.user.username, 'block.add', 'block', id, b);
  // Bookings already holding slots inside the new block are kept: tell the staff which.
  const clashes = all<{ ref: string; date: string }>(
    `SELECT DISTINCT k.ref, k.date FROM booking_slots s JOIN bookings k ON k.id = s.booking_id WHERE s.date BETWEEN ? AND ? AND s.start_min < ? AND s.end_min > ? ${spaceId ? 'AND s.space_id = ?' : ''}`,
    ...([b.from, b.to, end, start, ...(spaceId ? [spaceId] : [])] as (string | number)[]),
  ).filter((x) => days.includes(String(new Date(`${x.date}T00:00:00Z`).getUTCDay())));
  return { id, clashes: clashes.map((x) => x.ref) };
});

route('DELETE', 'blocks/:id', 'schedule.manage', (c) => {
  run('DELETE FROM blocks WHERE id = ?', idParam(c));
  audit(c.user.username, 'block.delete', 'block', idParam(c));
  return {};
});

/* ---------------- About page ---------------- */

route('GET', 'people', 'about.manage', () => ({ people: all('SELECT * FROM people ORDER BY sort, id'), about: getSettings('about') }));

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

route('POST', 'people', 'about.manage', async (c) => {
  const b = await c.body();
  allowFields(b, ['name', 'role', 'bio', 'highlights', 'photo', 'visible', 'sort']);
  const f = personFields(b, c.user);
  const id = run('INSERT INTO people (name, role, bio, highlights, photo_media, visible, sort) VALUES (?,?,?,?,?,?,?)', f.name, f.role, f.bio, f.highlights, f.photo ?? null, f.visible, f.sort).lastId;
  audit(c.user.username, 'people.add', 'person', id, { name: f.name });
  return { id };
}, { bodyLimit: 6 * 1024 * 1024 });

route('PATCH', 'people/:id', 'about.manage', async (c) => {
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

route('DELETE', 'people/:id', 'about.manage', (c) => {
  run('DELETE FROM people WHERE id = ?', idParam(c));
  audit(c.user.username, 'people.delete', 'person', idParam(c));
  return {};
});

route('PUT', 'about', 'about.manage', async (c) => {
  const b = await c.body();
  allowFields(b, ['headline', 'story', 'highlights']);
  const highlights = Array.isArray(b.highlights) ? b.highlights.slice(0, 8).map((h, i) => str(h, `Highlight ${i + 1}`, 60)).filter(Boolean) : [];
  saveSettings('about', { headline: str(b.headline, 'Headline', 100), story: str(b.story, 'Story', 3000, { required: false }), highlights }, c.user.username);
  audit(c.user.username, 'settings.about', 'settings', 'about');
  return {};
});

/* ---------------- money (admin only) ---------------- */

route('GET', 'payments', 'money', (c) => {
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

route('POST', 'payments/:id/verify', 'money', async (c) => {
  await verifyPayment(idParam(c), c.user.username);
  const p = get<PaymentRow>('SELECT * FROM payments WHERE id = ?', idParam(c))!;
  const b = p.booking_id ? bookingById(p.booking_id) : undefined;
  return { waLink: b && b.status === 'confirmed' ? deskConfirmLink(b, appUrl(c.req)) : null, waAuto: integrations().whatsappApi };
});

route('POST', 'payments/:id/reject', 'money', async (c) => {
  const b = await c.body();
  allowFields(b, ['reason', 'keepBooking']);
  rejectPayment(idParam(c), str(b.reason, 'Reason', 200), c.user.username, { cancelBooking: b.keepBooking !== true });
  return {};
});

route('POST', 'payments', 'money', async (c) => {
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

route('GET', 'invoices', 'money', (c) => {
  const { from, to } = range(c, 90);
  return { invoices: listInvoices(from, to).map(({ seller_json: _s, items_json, ...r }) => ({ ...r, items: JSON.parse(items_json) })) };
});

route('POST', 'invoices', 'money', async (c) => {
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

route('POST', 'invoices/:id/cancel', 'money', async (c) => {
  const b = await c.body();
  allowFields(b, ['reason']);
  cancelInvoice(idParam(c), str(b.reason, 'Reason', 200), c.user.username);
  return {};
});

route('GET', 'expenses', 'money', (c) => {
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

route('POST', 'expenses', 'money', async (c) => {
  const b = await c.body();
  allowFields(b, ['date', 'category', 'vendor', 'description', 'amount', 'gst', 'method', 'reference', 'bill']);
  const f = expenseFields(b);
  const bill = b.bill ? saveDataUrl(b.bill, 'private', c.user.username, { allowPdf: true }) : null;
  const id = run('INSERT INTO expenses (date, category, vendor, description, amount_paise, gst_paise, method, reference, bill_media, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', f.date, f.category, f.vendor, f.description, f.amount, f.gst, f.method, f.reference, bill, c.user.username, new Date().toISOString()).lastId;
  audit(c.user.username, 'expense.add', 'expense', id, { amount: f.amount, category: f.category });
  return { id };
}, { bodyLimit: 6 * 1024 * 1024 });

route('DELETE', 'expenses/:id', 'money', (c) => {
  const id = idParam(c);
  run('UPDATE expenses SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', new Date().toISOString(), id);
  audit(c.user.username, 'expense.delete', 'expense', id);
  return {};
});

route('GET', 'finance', 'money', (c) => {
  const { from, to } = range(c, 180);
  return { summary: summary(from, to), gst: gstReport(from, to), threshold: thresholdWatch(), from, to };
});

/* ---------------- settings, users, audit (admin only) ---------------- */

route('GET', 'settings', 'settings', () => ({
  business: getSettings('business'), booking: getSettings('booking'), gst: getSettings('gst'), integrations: integrations(),
}));

route('PUT', 'settings/:group', 'settings', async (c) => {
  const group = oneOf(c.params.group, 'group', ['business', 'booking', 'gst'] as const) as SettingsGroup;
  const b = await c.body();
  allowFields(b, Object.keys(DEFAULTS[group]));
  const cur = getSettings(group) as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = { ...cur };
  if (group === 'business') {
    for (const k of Object.keys(DEFAULTS.business)) if (b[k] !== undefined) next[k] = str(b[k], k, k === 'address' ? 300 : 120, { required: k === 'name' });
    if (next.whatsapp && !normalizeIndianMobile(next.whatsapp)) throw new HttpError(400, 'WhatsApp number: use a 10-digit Indian mobile.');
    if (next.whatsapp) next.whatsapp = normalizeIndianMobile(next.whatsapp);
    if (next.upiVpa && !/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(String(next.upiVpa))) throw new HttpError(400, 'UPI ID looks wrong (example: name@okhdfcbank).');
    if (next.instagram) next.instagram = String(next.instagram).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');
    if (next.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(String(next.instagram))) throw new HttpError(400, 'Instagram: just the username, like yourbusiness.');
    if (next.mapUrl && !/^https:\/\//.test(String(next.mapUrl))) throw new HttpError(400, 'Map link must start with https://');
    if (next.stateCode && !STATES[String(next.stateCode)]) throw new HttpError(400, 'State code is not valid.');
    next.state = next.stateCode ? STATES[String(next.stateCode)] : '';
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
    if (next.gstin && !isValidGstin(String(next.gstin))) throw new HttpError(400, 'Business GSTIN is not valid.');
    if (next.mode !== 'none' && !next.gstin) throw new HttpError(400, 'Add the GSTIN to use this GST mode.');
    if (next.gstin && String(next.gstin).slice(0, 2) !== getSettings('business').stateCode) throw new HttpError(400, 'GSTIN state code does not match the business state.');
    if (b.legalName !== undefined) next.legalName = str(b.legalName, 'Legal name', 120, { required: false });
    if (b.ratePct !== undefined) next.ratePct = Number(oneOf(String(b.ratePct), 'GST rate', ['0', '5', '12', '18', '28']));
    if (b.sac !== undefined) next.sac = str(b.sac, 'SAC', 8);
    if (next.mode === 'regular' && !/^\d{4,8}$/.test(String(next.sac))) throw new HttpError(400, 'SAC code is 4–8 digits (ask your CA).');
    if (next.mode !== 'none' && !getSettings('business').stateCode) throw new HttpError(400, 'Choose the business state in Settings → Business first.');
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

/** A manager's id for a assistant's "reports to" (null = not set). */
function managerId(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const id = int(v, 'Reports to', 1, 1e9);
  if (!get("SELECT 1 FROM users WHERE id = ? AND role IN ('manager','admin') AND active = 1", id)) throw new HttpError(400, 'Pick an active manager.');
  return id;
}

route('GET', 'users', 'team', () => ({ users: all('SELECT id, username, name, role, active, must_change, totp_secret IS NOT NULL AS totp, last_login_at, created_at, reports_to FROM users ORDER BY id') }));

route('POST', 'users', 'team', async (c) => {
  const b = await c.body();
  allowFields(b, ['username', 'name', 'role', 'reportsTo']);
  const username = str(b.username, 'Username', 30).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new HttpError(400, 'Username: 3–30 letters, digits, dot, dash.');
  if (get('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'That username is taken.');
  const password = generatePassword();
  const role = oneOf(b.role ?? 'assistant', 'Role', ROLES);
  run('INSERT INTO users (username, name, role, password_hash, must_change, created_at, reports_to) VALUES (?,?,?,?,1,?,?)', username, str(b.name, 'Name', 60), role, await hashPassword(password), new Date().toISOString(), role === 'assistant' ? managerId(b.reportsTo) : null);
  audit(c.user.username, 'user.add', 'user', username, { role: b.role });
  return { username, password };
});

route('PATCH', 'users/:id', 'team', async (c) => {
  const id = idParam(c);
  const b = await c.body();
  allowFields(b, ['name', 'role', 'active', 'resetPassword', 'resetTotp', 'reportsTo']);
  const u = userRow(id);
  if (!u) throw new HttpError(404, 'User not found.');
  if (id === c.user.id && (b.active === false || (b.role !== undefined && b.role !== 'admin'))) throw new HttpError(400, 'You cannot demote or deactivate yourself.');
  if (u.role === 'manager' && (b.active === false || (b.role !== undefined && b.role !== 'manager'))) {
    const held = balances(u.username)[0];
    if (held && held.onHand > 0) throw new HttpError(409, `${u.name} still has ₹${(held.onHand / 100).toFixed(2)} cash on their name. Confirm their deposit first.`);
  }
  let password: string | undefined;
  if (b.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', str(b.name, 'Name', 60), id);
  if (b.role !== undefined) run('UPDATE users SET role = ? WHERE id = ?', oneOf(b.role, 'Role', ROLES), id);
  if (b.reportsTo !== undefined) run('UPDATE users SET reports_to = ? WHERE id = ?', managerId(b.reportsTo), id);
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

route('GET', 'audit', 'settings', (c) => {
  const before = c.query.get('before') ? Number(c.query.get('before')) : undefined;
  return { rows: recentAudit(200, before), check: verifyAudit() };
});

/* ---------------- files & exports (admin only) ---------------- */

route('GET', 'media/:id', 'money', (c) => {
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

route('GET', 'export/:kind', 'money', (c) => {
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

route('GET', 'backup', 'settings', async (c) => {
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
  const user = await requireUser(req, found.r.perm, { allowMustChange: found.r.allowMustChange });
  const ctx: Ctx = { req, user, params: found.params, query: new URL(req.url).searchParams, body: () => readJsonBody(req, found!.r.bodyLimit ?? 32 * 1024) };
  const out = await found.r.h(ctx);
  if (out instanceof Response) return { response: out };
  return { data: out };
}

/** For tests: every route and the permission it needs. */
export function _routes() {
  return routes.map((r) => ({ method: r.method, path: r.path, perm: r.perm }));
}
