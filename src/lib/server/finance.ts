import { all, get } from './db';
import { financialYearRange, todayIst } from '@/lib/shared/time';
import { getSettings } from './settings';

/** Money overview for the admin: income (verified payments less refunds), expenses, profit, GST. */

export interface MonthRow {
  month: string;
  income: number;
  refunds: number;
  expenses: number;
  net: number;
  bookings: number;
}

export function summary(from: string, to: string) {
  const inc = all<{ month: string; income: number; refunds: number }>(
    `SELECT substr(date,1,7) AS month,
            SUM(CASE WHEN direction='in' THEN amount_paise ELSE 0 END) AS income,
            SUM(CASE WHEN direction='refund' THEN amount_paise ELSE 0 END) AS refunds
       FROM payments WHERE status='verified' AND date BETWEEN ? AND ? GROUP BY month`, from, to);
  const exp = all<{ month: string; expenses: number }>(
    `SELECT substr(date,1,7) AS month, SUM(amount_paise) AS expenses FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY month`, from, to);
  const bk = all<{ month: string; n: number }>(
    `SELECT substr(date,1,7) AS month, COUNT(*) AS n FROM bookings WHERE status='confirmed' AND date BETWEEN ? AND ? GROUP BY month`, from, to);
  const months = new Map<string, MonthRow>();
  const row = (m: string) => {
    if (!months.has(m)) months.set(m, { month: m, income: 0, refunds: 0, expenses: 0, net: 0, bookings: 0 });
    return months.get(m)!;
  };
  for (const r of inc) Object.assign(row(r.month), { income: r.income, refunds: r.refunds });
  for (const r of exp) row(r.month).expenses = r.expenses;
  for (const r of bk) row(r.month).bookings = r.n;
  const list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of list) m.net = m.income - m.refunds - m.expenses;
  const totals = list.reduce((t, m) => ({ income: t.income + m.income, refunds: t.refunds + m.refunds, expenses: t.expenses + m.expenses, net: t.net + m.net, bookings: t.bookings + m.bookings }), { income: 0, refunds: 0, expenses: 0, net: 0, bookings: 0 });
  const byMethod = all<{ method: string; amount: number }>(
    `SELECT method, SUM(amount_paise) AS amount FROM payments WHERE status='verified' AND direction='in' AND date BETWEEN ? AND ? GROUP BY method ORDER BY amount DESC`, from, to);
  const byCategory = all<{ category: string; amount: number }>(
    `SELECT category, SUM(amount_paise) AS amount FROM payments WHERE status='verified' AND direction='in' AND date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`, from, to);
  const expenseByCategory = all<{ category: string; amount: number }>(
    `SELECT category, SUM(amount_paise) AS amount FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`, from, to);
  const byChannel = all<{ channel: string; n: number; amount: number }>(
    `SELECT channel, COUNT(*) AS n, SUM(amount_paise) AS amount FROM bookings WHERE status='confirmed' AND date BETWEEN ? AND ? GROUP BY channel ORDER BY n DESC`, from, to);
  // To check: UPI not yet ticked off against the bank, and anything still pending.
  const pending = get<{ n: number; amount: number | null }>(
    "SELECT COUNT(*) AS n, SUM(amount_paise) AS amount FROM payments WHERE direction='in' AND ((status='pending' AND (method <> 'razorpay' OR reference <> '')) OR (status='verified' AND method='upi' AND reconciled_at IS NULL))",
  )!;
  return { months: list, totals, byMethod, byCategory, expenseByCategory, byChannel, pending: { n: pending.n, amount: pending.amount ?? 0 } };
}

/** Output GST (from issued invoices) and input GST (from expenses) per month: what the CA needs for GSTR-1 / 3B. */
export function gstReport(from: string, to: string) {
  const out = all<{ month: string; invoices: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }>(
    `SELECT substr(date,1,7) AS month, COUNT(*) AS invoices, SUM(taxable_paise) AS taxable, SUM(cgst_paise) AS cgst, SUM(sgst_paise) AS sgst, SUM(igst_paise) AS igst, SUM(total_paise) AS total
       FROM invoices WHERE status='issued' AND date BETWEEN ? AND ? GROUP BY month ORDER BY month`, from, to);
  const input = all<{ month: string; gst: number }>(
    `SELECT substr(date,1,7) AS month, SUM(gst_paise) AS gst FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY month`, from, to);
  const b2b = all<{ month: string; n: number }>(
    `SELECT substr(date,1,7) AS month, COUNT(*) AS n FROM invoices WHERE status='issued' AND customer_gstin <> '' AND date BETWEEN ? AND ? GROUP BY month`, from, to);
  return { out, input, b2b };
}

/** Turnover this financial year against the GST registration threshold (when not registered). */
export function thresholdWatch(today = todayIst()) {
  const g = getSettings('gst');
  const { from, to } = financialYearRange(today);
  const turnover = get<{ n: number | null }>(
    "SELECT SUM(CASE WHEN direction='in' THEN amount_paise ELSE -amount_paise END) AS n FROM payments WHERE status='verified' AND date BETWEEN ? AND ?", from, to)?.n ?? 0;
  return { turnover, threshold: g.thresholdPaise, pct: g.thresholdPaise ? Math.round((turnover / g.thresholdPaise) * 100) : 0, registered: g.mode !== 'none', fy: `${from.slice(0, 4)}-${to.slice(2, 4)}` };
}
