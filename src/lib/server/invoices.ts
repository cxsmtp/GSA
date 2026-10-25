import { documentKind, splitTax, STATES } from '@/lib/shared/gst';
import { financialYear, fmtDate, todayIst } from '@/lib/shared/time';
import { audit } from './audit';
import { bookingById, slotsLabel, slotsOf } from './bookings';
import { all, get, run, tx } from './db';
import { HttpError } from './http';
import { randomToken } from './secrets';
import { getSettings } from './settings';

/**
 * The bill book. Numbers run consecutively per Indian financial year (April–March) as
 * PREFIX/YY-YY/NNNN, at most 16 characters as Rule 46 of the CGST Rules requires, and are never
 * reused: a wrong invoice is cancelled (kept, marked) and a new one issued. Each invoice keeps a
 * copy of the seller's details as they were that day, so later settings changes never alter it.
 */

export interface InvoiceItem {
  description: string;
  sac: string;
  qty: number;
  /** Line total in paise, as charged (inclusive or exclusive of GST per the setting at issue). */
  amount: number;
}

export interface InvoiceRow {
  id: number;
  number: string;
  fy: string;
  seq: number;
  kind: 'tax_invoice' | 'bill_of_supply' | 'receipt';
  date: string;
  token: string;
  booking_id: number | null;
  customer_name: string;
  customer_phone: string;
  customer_gstin: string;
  customer_address: string;
  place_of_supply: string;
  items_json: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  seller_json: string;
  status: 'issued' | 'cancelled';
  cancel_reason: string;
  created_by: string | null;
  created_at: string;
}

export interface Seller {
  name: string;
  legalName: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  phone: string;
  email: string;
  gstin: string;
  mode: 'none' | 'regular' | 'composition';
  ratePct: number;
  pricesIncludeGst: boolean;
  terms: string;
}

function sellerNow(): Seller {
  const a = getSettings('business');
  const g = getSettings('gst');
  return {
    name: a.name, legalName: g.legalName || a.name, address: a.address, city: a.city, state: a.state, stateCode: a.stateCode,
    pincode: a.pincode, phone: a.phone, email: a.email, gstin: g.mode === 'none' ? '' : g.gstin, mode: g.mode, ratePct: g.ratePct,
    pricesIncludeGst: g.pricesIncludeGst, terms: g.terms,
  };
}

export function invoiceNumber(prefix: string, fy: string, seq: number): string {
  const n = `${prefix}/${fy.slice(2)}/${String(seq).padStart(4, '0')}`;
  if (n.length > 16) throw new HttpError(400, 'Invoice prefix is too long: the invoice number must be 16 characters or fewer.');
  return n;
}

export interface IssueInput {
  date?: string;
  bookingId?: number | null;
  customerName: string;
  customerPhone?: string;
  customerGstin?: string;
  customerAddress?: string;
  placeOfSupply?: string;
  items: InvoiceItem[];
  actor: string;
}

export function issueInvoice(input: IssueInput): InvoiceRow {
  const g = getSettings('gst');
  const seller = sellerNow();
  if (g.mode === 'regular' && !g.gstin) throw new HttpError(400, 'Add the business GSTIN in Settings → GST before issuing tax invoices.');
  if (g.mode === 'regular' && !seller.stateCode) throw new HttpError(400, 'Choose the business state in Settings → Business before issuing tax invoices.');
  const date = input.date || todayIst();
  const fy = financialYear(date);
  const pos = input.placeOfSupply && STATES[input.placeOfSupply] ? input.placeOfSupply : seller.stateCode;
  const inter = pos !== seller.stateCode;
  const totals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
  for (const item of input.items) {
    const t = splitTax(item.amount, g, inter);
    totals.taxable += t.taxable;
    totals.cgst += t.cgst;
    totals.sgst += t.sgst;
    totals.igst += t.igst;
    totals.total += t.total;
  }
  return tx(() => {
    const seq = (get<{ n: number | null }>('SELECT MAX(seq) AS n FROM invoices WHERE fy = ?', fy)?.n ?? 0) + 1;
    const number = invoiceNumber(g.invoicePrefix, fy, seq);
    const id = run(
      `INSERT INTO invoices (number, fy, seq, kind, date, token, booking_id, customer_name, customer_phone, customer_gstin, customer_address, place_of_supply, items_json,
        taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, seller_json, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, fy, seq, documentKind(g.mode), date, randomToken(16), input.bookingId ?? null, input.customerName, input.customerPhone || '',
      (input.customerGstin || '').toUpperCase(), input.customerAddress || '', pos, JSON.stringify(input.items), totals.taxable, totals.cgst, totals.sgst,
      totals.igst, totals.total, JSON.stringify(seller), input.actor, new Date().toISOString(),
    ).lastId;
    audit(input.actor, 'invoice.issue', 'invoice', number, { total: totals.total, booking: input.bookingId ?? null });
    return get<InvoiceRow>('SELECT * FROM invoices WHERE id = ?', id)!;
  });
}

/** The invoice for a confirmed booking (made once; asking again returns the same one). */
export function invoiceForBooking(bookingId: number, actor: string): InvoiceRow {
  const existing = get<InvoiceRow>("SELECT * FROM invoices WHERE booking_id = ? AND status = 'issued' ORDER BY id DESC LIMIT 1", bookingId);
  if (existing) return existing;
  const b = bookingById(bookingId);
  if (!b) throw new HttpError(404, 'Booking not found.');
  const g = getSettings('gst');
  const slots = slotsOf(b);
  return issueInvoice({
    bookingId,
    customerName: b.name,
    customerPhone: b.phone,
    customerGstin: b.gstin,
    items: [{ description: `Booking — ${fmtDate(b.date)} — ${slotsLabel(slots)} (Ref ${b.ref})`, sac: g.sac, qty: slots.length, amount: b.base_paise }],
    actor,
  });
}

export function cancelInvoice(id: number, reason: string, actor: string) {
  const inv = get<InvoiceRow>('SELECT * FROM invoices WHERE id = ?', id);
  if (!inv) throw new HttpError(404, 'Invoice not found.');
  if (inv.status === 'cancelled') return;
  run("UPDATE invoices SET status = 'cancelled', cancel_reason = ? WHERE id = ?", reason, id);
  audit(actor, 'invoice.cancel', 'invoice', inv.number, { reason });
}

export function invoiceByToken(token: string): InvoiceRow | undefined {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return undefined;
  return get<InvoiceRow>('SELECT * FROM invoices WHERE token = ?', token);
}

export function listInvoices(from: string, to: string): InvoiceRow[] {
  return all<InvoiceRow>('SELECT * FROM invoices WHERE date BETWEEN ? AND ? ORDER BY fy DESC, seq DESC', from, to);
}
