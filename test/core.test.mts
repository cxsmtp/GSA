import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-test-'));
(process.env as Record<string, string>).NODE_ENV = 'test';

const { isValidGstin, splitTax, payable } = await import('../src/lib/shared/gst.ts');
const { amountInWords, toPaise } = await import('../src/lib/shared/money.ts');
const { financialYear, addDays, todayIst } = await import('../src/lib/shared/time.ts');
const { normalizeIndianMobile } = await import('../src/lib/shared/whatsapp.ts');
const { seedDefaults } = await import('../src/lib/server/seed.ts');
const { createBooking, sweepExpired, bookingById } = await import('../src/lib/server/bookings.ts');
const { submitUtr, verifyPayment, razorpaySignatureOk, webhookSignatureOk } = await import('../src/lib/server/payments.ts');
const { invoiceNumber, issueInvoice } = await import('../src/lib/server/invoices.ts');
const { saveSettings, getSettings } = await import('../src/lib/server/settings.ts');
const { all, get } = await import('../src/lib/server/db.ts');
const { verifyAudit } = await import('../src/lib/server/audit.ts');
const { totpAt, verifyTotp, newTotpSecret } = await import('../src/lib/server/totp.ts');
const { csv } = await import('../src/lib/server/csv.ts');
const { _routes } = await import('../src/lib/server/staffApi.ts');

const tomorrow = addDays(todayIst(), 1);
const base = { date: tomorrow, name: 'Test Player', phone: '919829011111', source: 'online' as const, status: 'held' as const, actor: 'player' };

before(() => seedDefaults());

describe('GST & money', () => {
  test('inclusive 18% splits into CGST + SGST that add up', () => {
    const t = splitTax(100000, { mode: 'regular', ratePct: 18, pricesIncludeGst: true });
    assert.equal(t.taxable + t.cgst + t.sgst, 100000);
    assert.equal(t.taxable, 84746);
  });
  test('exclusive adds tax; inter-state is IGST', () => {
    const t = splitTax(10000, { mode: 'regular', ratePct: 18, pricesIncludeGst: false }, true);
    assert.deepEqual(t, { taxable: 10000, cgst: 0, sgst: 0, igst: 1800, total: 11800 });
    assert.equal(payable(10000, { mode: 'none', ratePct: 18, pricesIncludeGst: false }), 10000);
  });
  test('GSTIN checksum', () => {
    assert.ok(isValidGstin('27AAPFU0939F1ZV'));
    assert.ok(!isValidGstin('27AAPFU0939F1ZX'));
  });
  test('Indian words and parsing', () => {
    assert.equal(amountInWords(1_50_000_50), 'Rupees One Lakh Fifty Thousand and Fifty Paise Only');
    assert.equal(toPaise('1,234.5'), 123450);
    assert.equal(toPaise('-5'), null);
  });
  test('financial year and invoice number length', () => {
    assert.equal(financialYear('2026-03-31'), '2025-26');
    assert.equal(financialYear('2026-04-01'), '2026-27');
    assert.equal(invoiceNumber('GSA', '2026-27', 7), 'GSA/26-27/0007');
    assert.throws(() => invoiceNumber('TOOLONG', '2026-27', 1));
  });
  test('Indian mobiles', () => {
    assert.equal(normalizeIndianMobile('+91 98290 12345'), '919829012345');
    assert.equal(normalizeIndianMobile('09829012345'), '919829012345');
    assert.equal(normalizeIndianMobile('1234567890'), null);
  });
});

describe('bookings', () => {
  test('server prices the slots and nobody can double book', () => {
    const b = createBooking({ ...base, slots: [{ courtId: 1, start: 18 * 60 }] });
    assert.equal(b.status, 'held');
    assert.ok(b.amount_paise > 0);
    assert.throws(() => createBooking({ ...base, phone: '919829022222', slots: [{ courtId: 1, start: 18 * 60 }] }), /just taken/);
  });
  test('an expired hold frees the court', () => {
    const now = Date.now();
    const b = createBooking({ ...base, slots: [{ courtId: 2, start: 7 * 60 }] }, now);
    sweepExpired(now + 60 * 60_000);
    assert.equal(bookingById(b.id)!.status, 'expired');
    const again = createBooking({ ...base, slots: [{ courtId: 2, start: 7 * 60 }] }, now + 61 * 60_000);
    assert.equal(again.status, 'held');
  });
  test('a slot outside opening hours is refused', () => {
    assert.throws(() => createBooking({ ...base, slots: [{ courtId: 1, start: 2 * 60 }] }), /does not exist/);
  });
  test('UPI reference → verify → confirmed with one invoice; a UTR works once', async () => {
    const b = createBooking({ ...base, slots: [{ courtId: 1, start: 9 * 60 }] });
    const p = submitUtr(b, '412345678901');
    assert.equal(bookingById(b.id)!.status, 'submitted');
    const other = createBooking({ ...base, phone: '919829033333', slots: [{ courtId: 1, start: 10 * 60 }] });
    assert.throws(() => submitUtr(other, '412345678901'), /already used/);
    await verifyPayment(p.id, 'admin');
    await verifyPayment(p.id, 'admin');
    assert.equal(bookingById(b.id)!.status, 'confirmed');
    assert.equal(all('SELECT * FROM invoices WHERE booking_id = ?', b.id).length, 1);
  });
  test('invoice numbers run on without gaps', () => {
    saveSettings('gst', { ...getSettings('gst'), mode: 'regular', gstin: '08AAPFU0939F1ZV' }, 'test');
    const a = issueInvoice({ customerName: 'A', items: [{ description: 'Coaching', sac: '999293', qty: 1, amount: 118000 }], actor: 't' });
    const b = issueInvoice({ customerName: 'B', items: [{ description: 'Coaching', sac: '999293', qty: 1, amount: 118000 }], actor: 't' });
    assert.equal(b.seq, a.seq + 1);
    assert.equal(a.kind, 'tax_invoice');
    assert.equal(a.cgst_paise + a.sgst_paise, 18000);
  });
});

describe('security', () => {
  test('audit chain is intact, and editing a row breaks it', async () => {
    assert.ok(verifyAudit().ok);
    const { run } = await import('../src/lib/server/db.ts');
    const row = get<{ id: number }>('SELECT id FROM audit ORDER BY id LIMIT 1')!;
    run("UPDATE audit SET detail = '{\"amount\":1}' WHERE id = ?", row.id);
    assert.equal(verifyAudit().ok, false);
  });
  test('every staff route names its roles; money and settings are admin only', () => {
    for (const r of _routes()) {
      assert.ok(r.roles.length > 0, `${r.method} ${r.path}`);
      if (/^(payments|invoices|expenses|finance|export|settings|users|audit|backup|media|rules|courts\/)/.test(r.path) || (r.path === 'courts' && r.method !== 'GET')) {
        assert.deepEqual([...r.roles], ['admin'], `${r.method} ${r.path} must be admin-only`);
      }
    }
  });
  test('Razorpay signatures', async () => {
    process.env.RAZORPAY_KEY_SECRET = 'secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
    const crypto = await import('node:crypto');
    const sig = crypto.createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
    assert.ok(razorpaySignatureOk('order_1', 'pay_1', sig));
    assert.ok(!razorpaySignatureOk('order_1', 'pay_2', sig));
    const body = Buffer.from('{"event":"x"}');
    assert.ok(webhookSignatureOk(body, crypto.createHmac('sha256', 'whsec').update(body).digest('hex')));
    assert.ok(!webhookSignatureOk(body, 'bad'));
  });
  test('TOTP accepts the current code only', () => {
    const s = newTotpSecret();
    const now = Date.now();
    assert.ok(verifyTotp(s, totpAt(s, Math.floor(now / 30000)), now));
    assert.ok(!verifyTotp(s, totpAt(s, Math.floor(now / 30000) + 5), now));
  });
  test('CSV neutralises spreadsheet formulas', () => {
    assert.ok(csv([['=HYPERLINK("x")', '-12.5']]).includes(`"'=HYPERLINK(""x"")",-12.5`));
  });
});

describe('phone bookings by the coach', () => {
  test('WhatsApp confirmation states due → being verified → paid', async () => {
    const { payStateOf, deskConfirmLink } = await import('../src/lib/server/whatsapp.ts');
    const { recordPayment } = await import('../src/lib/server/payments.ts');
    const b = createBooking({ ...base, phone: '919876500000', name: 'Phone Caller', slots: [{ courtId: 2, start: 12 * 60 }], source: 'desk', status: 'reserved', actor: 'coach1', staff: true });
    assert.equal(payStateOf(b).payState, 'due');
    const due = decodeURIComponent(deskConfirmLink(b, 'https://x.in')!);
    assert.match(due, /^https:\/\/wa\.me\/919876500000\?text=/);
    assert.match(due, /Payment due: ₹/);
    assert.match(due, /https:\/\/x\.in\/pay\//);
    const p = recordPayment({ bookingId: b.id, direction: 'in', category: 'court', method: 'cash', amount: b.amount_paise, reference: '', date: b.date, note: '', verified: false, actor: 'coach1' });
    assert.equal(payStateOf(b).payState, 'verifying');
    assert.match(decodeURIComponent(deskConfirmLink(b)!), /received, being verified/);
    await verifyPayment(p.id, 'admin');
    assert.equal(payStateOf(bookingById(b.id)!).payState, 'paid');
    assert.match(decodeURIComponent(deskConfirmLink(bookingById(b.id)!)!), /received ✓/);
  });
});
