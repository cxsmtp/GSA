'use client';

import { Banknote, Camera, Check, Landmark, X } from 'lucide-react';
import { useState } from 'react';
import { rupees } from '@/lib/shared/money';
import { fmtDate, fmtStamp, todayIst } from '@/lib/shared/time';
import { Field, inputCls } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Badge, Btn, Card, Empty, fileToDataUrl, Spinner, staff, Stat, useAction, useStaff } from './ui';

interface Collection { id: number; date: string; direction: string; amount_paise: number; collected_by: string | null; custodian: string | null; created_at: string; ref: string | null; name: string | null; note: string }
interface Balance { custodian: string; name: string; collected: number; refunded: number; deposited: number; pending: number; onHand: number; lastCollectedAt: string | null }
interface Deposit { id: number; custodian: string; amount_paise: number; method: 'bank' | 'handover'; reference: string; note: string; slip_media: string | null; status: string; date: string; created_at: string; decided_by: string | null; decision_note: string }

type CashData =
  | { view: 'admin'; balances: Balance[]; deposits: Deposit[]; collections: Collection[] }
  | { view: 'custodian'; balance: Balance | null; deposits: Deposit[]; collections: Collection[] }
  | { view: 'collector'; custodian: string; custodianName: string; collections: Collection[]; total: number };

/**
 * Cash custody. Junior coach: what they took, and whose name it is on. Head coach: cash on their name
 * (theirs and their juniors'), and recording a deposit. Admin (inside Money): every custodian's
 * balance and the deposits to confirm.
 */
export function CashTab() {
  const { data, loading, reload } = useStaff<CashData>('cash');
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  if (data.view === 'collector') return <CollectorView d={data} />;
  if (data.view === 'custodian') return <CustodianView d={data} reload={reload} />;
  return <AdminView d={data} reload={reload} />;
}

function CollectionList({ rows, showCustodian = false }: { rows: Collection[]; showCustodian?: boolean }) {
  if (!rows.length) return <Empty>No cash in the last 30 days.</Empty>;
  return (
    <ul className="divide-y divide-line/60">
      {rows.map((r) => (
        <li key={r.id} className="py-2.5 flex items-center gap-3 text-sm">
          <Banknote className={`w-4 h-4 shrink-0 ${r.direction === 'refund' ? 'text-pink' : 'text-ok'}`} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{r.name ?? 'Cash'} {r.ref && <span className="font-mono text-xs text-muted">{r.ref}</span>}</div>
            <div className="text-[11px] text-muted">{fmtStamp(r.created_at)} · taken by {r.collected_by}{showCustodian && r.custodian !== r.collected_by ? ` · on ${r.custodian}'s name` : ''}</div>
          </div>
          <span className={`font-semibold ${r.direction === 'refund' ? 'text-pink' : ''}`}>{r.direction === 'refund' ? '−' : ''}{rupees(r.amount_paise)}</span>
        </li>
      ))}
    </ul>
  );
}

function DepositList({ rows, decide }: { rows: Deposit[]; decide?: (d: Deposit) => React.ReactNode }) {
  if (!rows.length) return <Empty>No deposits yet.</Empty>;
  return (
    <ul className="space-y-2">
      {rows.map((d) => (
        <li key={d.id} className="rounded-2xl border border-line p-3 text-sm space-y-2">
          <div className="flex items-center gap-3">
            {d.method === 'bank' ? <Landmark className="w-5 h-5 text-cyan" /> : <Banknote className="w-5 h-5 text-lime" />}
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{rupees(d.amount_paise)} · {d.method === 'bank' ? 'Bank deposit' : 'Handed to admin'}</div>
              <div className="text-[11px] text-muted">{fmtDate(d.date)} · {d.custodian}{d.reference ? ` · ${d.reference}` : ''}{d.note ? ` · ${d.note}` : ''}</div>
              {d.decision_note && <div className="text-[11px] text-bad">{d.decision_note}</div>}
            </div>
            {d.slip_media && <a href={`/api/staff/cash/slip/${d.id}`} target="_blank" rel="noopener" className="text-xs text-cyan font-semibold">Slip</a>}
            <Badge s={d.status === 'confirmed' ? 'verified' : d.status} />
          </div>
          {decide && d.status === 'pending' && decide(d)}
        </li>
      ))}
    </ul>
  );
}

function CollectorView({ d }: { d: Extract<CashData, { view: 'collector' }> }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Cash you took (30 days)" value={rupees(d.total)} tone="text-amber" />
        <Stat label="On the name of" value={d.custodianName} tone="text-lime" />
      </div>
      <p className="text-sm text-soft">Cash you take is recorded as collected by you and is the responsibility of <b>{d.custodianName}</b>. Hand it over to them the same day; they deposit it.</p>
      <Card title="Cash you took">
        <CollectionList rows={d.collections} />
      </Card>
    </div>
  );
}

function CustodianView({ d, reload }: { d: Extract<CashData, { view: 'custodian' }>; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const b = d.balance;
  const free = b ? b.onHand - b.pending : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Cash on your name" value={rupees(b?.onHand ?? 0)} tone="text-amber" />
        <Stat label="Awaiting admin" value={rupees(b?.pending ?? 0)} tone="text-cyan" sub="deposits not yet confirmed" />
        <Stat label="Collected (all time)" value={rupees(b?.collected ?? 0)} />
        <Stat label="Deposited" value={rupees(b?.deposited ?? 0)} tone="text-ok" />
      </div>
      <p className="text-sm text-soft">All cash taken by you and the junior coaches who report to you is on your name until you deposit it in the academy bank account or hand it to the admin, and the admin confirms.</p>
      <Btn tone="lime" className="w-full py-3.5" disabled={free <= 0} onClick={() => setOpen(true)}><Landmark className="w-4 h-4" /> Record a deposit{free > 0 ? ` (up to ${rupees(free)})` : ''}</Btn>
      <Card title="Deposits"><DepositList rows={d.deposits} /></Card>
      <Card title="Cash collected (30 days)"><CollectionList rows={d.collections} showCustodian /></Card>
      <DepositSheet open={open} max={free} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />
    </div>
  );
}

function DepositSheet({ open, max, onClose, onDone }: { open: boolean; max: number; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ amount: '', method: 'bank', reference: '', note: '', date: todayIst() });
  const [slip, setSlip] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Record a cash deposit">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => staff('cash/deposits', 'POST', { ...f, slip: slip || undefined }), 'Deposit recorded — the admin will confirm')) {
          setF({ ...f, amount: '', reference: '', note: '' });
          setSlip(null);
          onDone();
        }
      }}>
        <div className="grid grid-cols-2 gap-2">
          {(['bank', 'handover'] as const).map((m) => (
            <button type="button" key={m} onClick={() => setF({ ...f, method: m })} aria-pressed={f.method === m} className={`rounded-xl py-3 text-sm font-bold border ${f.method === m ? 'bg-lime text-ink border-lime' : 'border-line text-soft'}`}>{m === 'bank' ? 'Bank deposit' : 'Hand to admin'}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Amount ₹ (max ${(max / 100).toFixed(0)})`}><input className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" required /></Field>
          <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        {f.method === 'bank' && <Field label="Deposit slip / transaction no."><input className={inputCls} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={60} /></Field>}
        <Field label="Note"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} /></Field>
        <label className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-4 text-sm font-semibold text-cyan cursor-pointer">
          <Camera className="w-5 h-5" /> {slip ? 'Slip attached ✓' : 'Photo of deposit slip (optional)'}
          <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setSlip(await fileToDataUrl(file)); }} />
        </label>
        <Btn tone="lime" busy={busy} className="w-full py-3.5">Record deposit</Btn>
      </form>
    </Sheet>
  );
}

function AdminView({ d, reload }: { d: Extract<CashData, { view: 'admin' }>; reload: () => void }) {
  const { busy, run } = useAction();
  const [rejectFor, setRejectFor] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const pending = d.deposits.filter((x) => x.status === 'pending');
  return (
    <div className="space-y-4">
      <Card title="Cash on each person's name">
        {!d.balances.length ? <Empty>No cash collected yet.</Empty> : (
          <ul className="space-y-2">
            {d.balances.map((b) => (
              <li key={b.custodian} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{b.name} <span className="text-xs text-muted">@{b.custodian}</span></div>
                  <div className="text-[11px] text-muted">Collected {rupees(b.collected)}{b.refunded ? ` · refunded ${rupees(b.refunded)}` : ''} · deposited {rupees(b.deposited)}{b.pending ? ` · ${rupees(b.pending)} awaiting you` : ''}</div>
                </div>
                <div className={`font-display text-lg font-bold ${b.onHand > 0 ? 'text-amber' : 'text-ok'}`}>{rupees(b.onHand)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Deposits to confirm${pending.length ? ` (${pending.length})` : ''}`}>
        <DepositList
          rows={d.deposits}
          decide={(x) =>
            rejectFor === x.id ? (
              <div className="flex gap-2">
                <input className={inputCls} placeholder="Why? (e.g. not in bank statement)" value={why} onChange={(e) => setWhy(e.target.value)} />
                <Btn tone="bad" busy={busy} disabled={!why.trim()} onClick={async () => { if (await run(() => staff(`cash/deposits/${x.id}/reject`, 'POST', { note: why }), 'Rejected — stays on their name')) { setRejectFor(null); setWhy(''); reload(); } }}>Reject</Btn>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Btn tone="bad" onClick={() => setRejectFor(x.id)}><X className="w-4 h-4" /> Not received</Btn>
                <Btn tone="ok" busy={busy} onClick={async () => { if (await run(() => staff(`cash/deposits/${x.id}/confirm`, 'POST'), 'Confirmed — off their name')) reload(); }}><Check className="w-4 h-4" /> Received</Btn>
              </div>
            )
          }
        />
      </Card>
      <Card title="Cash collected (30 days)"><CollectionList rows={d.collections} showCustodian /></Card>
    </div>
  );
}
