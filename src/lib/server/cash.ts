import { can, type Role } from '@/lib/shared/rbac';
import { todayIst } from '@/lib/shared/time';
import { audit } from './audit';
import { all, get, run } from './db';
import { HttpError } from './http';
import type { SessionUser } from './auth';

/**
 * Cash custody. Every cash payment records who physically took it (collected_by) and who answers for
 * it (custodian): a head coach (or admin) holds cash on their own name; a junior coach's cash goes on
 * the name of the head coach they report to. The custodian deposits it (bank, or handed to the admin)
 * and the admin confirms. "Cash on name" = cash collected − cash refunds paid out − confirmed deposits.
 */

interface StaffRow {
  id: number;
  username: string;
  name: string;
  role: Role;
  active: number;
  reports_to: number | null;
}

/** Who answers for cash this user takes. */
export function custodianFor(user: Pick<SessionUser, 'id' | 'username' | 'role'>): string {
  if (can(user.role, 'cash.custody')) return user.username;
  const me = get<StaffRow>('SELECT * FROM users WHERE id = ?', user.id);
  if (me?.reports_to) {
    const lead = get<StaffRow>('SELECT * FROM users WHERE id = ? AND active = 1', me.reports_to);
    if (lead && can(lead.role, 'cash.custody')) return lead.username;
  }
  // No head coach set for this junior: the first active head coach, else the first admin.
  const fallback =
    get<StaffRow>("SELECT * FROM users WHERE role = 'coach' AND active = 1 ORDER BY id LIMIT 1") ??
    get<StaffRow>("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1");
  if (!fallback) throw new HttpError(409, 'No head coach or admin is active to hold this cash.');
  return fallback.username;
}

export interface CustodyBalance {
  custodian: string;
  name: string;
  collected: number;
  refunded: number;
  deposited: number;
  pending: number;
  onHand: number;
  lastCollectedAt: string | null;
}

export function balances(onlyFor?: string): CustodyBalance[] {
  const names = new Map(all<{ username: string; name: string }>('SELECT username, name FROM users').map((u) => [u.username, u.name]));
  const rows = all<{ custodian: string; collected: number; refunded: number; last: string | null }>(
    `SELECT custodian,
            SUM(CASE WHEN direction = 'in' THEN amount_paise ELSE 0 END) AS collected,
            SUM(CASE WHEN direction = 'refund' THEN amount_paise ELSE 0 END) AS refunded,
            MAX(CASE WHEN direction = 'in' THEN created_at END) AS last
       FROM payments WHERE method = 'cash' AND status = 'verified' AND custodian IS NOT NULL GROUP BY custodian`,
  );
  const dep = new Map(
    all<{ custodian: string; confirmed: number; pending: number }>(
      `SELECT custodian, SUM(CASE WHEN status = 'confirmed' THEN amount_paise ELSE 0 END) AS confirmed,
              SUM(CASE WHEN status = 'pending' THEN amount_paise ELSE 0 END) AS pending
         FROM cash_deposits GROUP BY custodian`,
    ).map((d) => [d.custodian, d]),
  );
  const keys = new Set([...rows.map((r) => r.custodian), ...dep.keys()]);
  return [...keys]
    .filter((k) => !onlyFor || k === onlyFor)
    .map((k) => {
      const r = rows.find((x) => x.custodian === k);
      const d = dep.get(k);
      const collected = r?.collected ?? 0;
      const refunded = r?.refunded ?? 0;
      const deposited = d?.confirmed ?? 0;
      return { custodian: k, name: names.get(k) ?? k, collected, refunded, deposited, pending: d?.pending ?? 0, onHand: collected - refunded - deposited, lastCollectedAt: r?.last ?? null };
    })
    .sort((a, b) => b.onHand - a.onHand);
}

export interface CashRow {
  id: number;
  date: string;
  direction: string;
  amount_paise: number;
  collected_by: string | null;
  custodian: string | null;
  created_at: string;
  ref: string | null;
  name: string | null;
  note: string;
}

/** Cash movements, for one custodian, one collector, or (admin) everyone. */
export function cashCollections({ custodian, collector, from, to }: { custodian?: string; collector?: string; from: string; to: string }): CashRow[] {
  const where = ["p.method = 'cash'", "p.status = 'verified'", 'p.date BETWEEN ? AND ?'];
  const params: string[] = [from, to];
  if (custodian) {
    where.push('p.custodian = ?');
    params.push(custodian);
  }
  if (collector) {
    where.push('p.collected_by = ?');
    params.push(collector);
  }
  return all<CashRow>(
    `SELECT p.id, p.date, p.direction, p.amount_paise, p.collected_by, p.custodian, p.created_at, p.note, b.ref, b.name
       FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 500`,
    ...params,
  );
}

export interface DepositRow {
  id: number;
  custodian: string;
  amount_paise: number;
  method: 'bank' | 'handover';
  reference: string;
  note: string;
  slip_media: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  date: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
}

export function deposits(custodian?: string): DepositRow[] {
  return custodian
    ? all<DepositRow>('SELECT * FROM cash_deposits WHERE custodian = ? ORDER BY id DESC LIMIT 200', custodian)
    : all<DepositRow>('SELECT * FROM cash_deposits ORDER BY id DESC LIMIT 300');
}

export function createDeposit(user: SessionUser, i: { amount: number; method: 'bank' | 'handover'; reference: string; note: string; slip: string | null; date?: string }): number {
  const mine = balances(user.username)[0];
  const available = (mine?.onHand ?? 0) - (mine?.pending ?? 0);
  if (i.amount > available) throw new HttpError(400, `That is more than the cash on your name not yet deposited (₹${(available / 100).toFixed(2)}).`);
  // The admin's own deposits need nobody else to confirm them.
  const self = can(user.role, 'money');
  const id = run(
    `INSERT INTO cash_deposits (custodian, amount_paise, method, reference, note, slip_media, status, date, created_at, decided_by, decided_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    user.username, i.amount, i.method, i.reference, i.note, i.slip, self ? 'confirmed' : 'pending', i.date || todayIst(), new Date().toISOString(),
    self ? user.username : null, self ? new Date().toISOString() : null,
  ).lastId;
  audit(user.username, 'cash.deposit', 'cash_deposit', id, { amount: i.amount, method: i.method, reference: i.reference });
  return id;
}

export function decideDeposit(id: number, decision: 'confirmed' | 'rejected', note: string, actor: string) {
  const d = get<DepositRow>('SELECT * FROM cash_deposits WHERE id = ?', id);
  if (!d) throw new HttpError(404, 'Deposit not found.');
  if (d.status !== 'pending') throw new HttpError(409, `This deposit was already ${d.status}.`);
  run('UPDATE cash_deposits SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?', decision, actor, new Date().toISOString(), note, id);
  audit(actor, `cash.deposit_${decision}`, 'cash_deposit', id, { amount: d.amount_paise, custodian: d.custodian, note });
}
