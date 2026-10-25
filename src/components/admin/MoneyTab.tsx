'use client';

import { Camera, Check, Download, FileText, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { plain, rupees } from '@/lib/shared/money';
import { STATES } from '@/lib/shared/gst';
import { addDays, fmtDate, fmtStamp, monthLabel, todayIst } from '@/lib/shared/time';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/shared/types';
import { prettyMobile } from '@/lib/shared/whatsapp';
import { WhatsAppIcon } from '@/components/ui/BrandIcons';
import { Field, inputCls } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { CashTab } from './CashTab';
import { Badge, Btn, Card, Empty, fileToDataUrl, Segmented, Spinner, staff, Stat, useAction, useStaff } from './ui';

type Sub = 'verify' | 'cash' | 'overview' | 'bills' | 'expenses' | 'income' | 'gst';

export function MoneyTab() {
  const [sub, setSub] = useState<Sub>('verify');
  return (
    <div className="space-y-4">
      <Segmented value={sub} onChange={setSub} options={[
        { value: 'verify', label: 'Verify' }, { value: 'cash', label: 'Cash' }, { value: 'overview', label: 'Funds' }, { value: 'bills', label: 'Bill book' },
        { value: 'expenses', label: 'Expenses' }, { value: 'income', label: 'Income' }, { value: 'gst', label: 'GST & exports' },
      ]} />
      {sub === 'verify' && <VerifyQueue />}
      {sub === 'cash' && <CashTab />}
      {sub === 'overview' && <Overview />}
      {sub === 'bills' && <BillBook />}
      {sub === 'expenses' && <Expenses />}
      {sub === 'income' && <Income />}
      {sub === 'gst' && <GstExports />}
    </div>
  );
}

/* ---------------- verify ---------------- */

interface Pending { id: number; method: string; amount_paise: number; reference: string; created_at: string; created_by: string; ref: string | null; name: string | null; phone: string | null; booking_date: string | null; note: string }

function VerifyQueue() {
  const { data, loading, reload } = useStaff<{ payments: Pending[] }>('payments?status=pending');
  const { busy, run } = useAction();
  const [wa, setWa] = useState<{ link: string; name: string } | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState('Payment not found in bank statement');
  if (loading && !data) return <Spinner />;
  const list = data?.payments ?? [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Open your bank / UPI business app, find the reference and amount, then Verify. The booking confirms, the invoice is issued and the player gets WhatsApp.</p>
      {wa && (
        <a href={wa.link} target="_blank" rel="noopener noreferrer" onClick={() => setWa(null)} className="flex items-center justify-center gap-2 rounded-2xl py-3.5 font-bold bg-[#25D366] text-ink rise">
          <WhatsAppIcon className="w-5 h-5" /> Send {wa.name} the confirmation
        </a>
      )}
      {list.length === 0 ? (
        <Empty>Nothing to verify. 🎉</Empty>
      ) : (
        list.map((p) => (
          <div key={p.id} className="rounded-3xl border border-line bg-panel/70 p-4 space-y-3">
            <div className="flex justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{p.name ?? 'Other income'} <span className="font-mono text-xs text-muted">{p.ref}</span></div>
                <div className="text-xs text-soft">{p.booking_date ? fmtDate(p.booking_date) : ''}{p.phone ? ` · ${prettyMobile(p.phone)}` : ''}</div>
                <div className="text-[11px] text-muted">{fmtStamp(p.created_at)} · by {p.created_by}{p.note ? ` · ${p.note}` : ''}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display text-xl font-bold text-lime">{rupees(p.amount_paise)}</div>
                <div className="text-xs uppercase text-soft font-semibold">{p.method}</div>
              </div>
            </div>
            {p.reference && <div className="rounded-xl bg-night/70 border border-line px-3 py-2 font-mono text-lg tracking-widest text-center select-all">{p.reference}</div>}
            {rejecting === p.id ? (
              <div className="space-y-2">
                <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
                <div className="grid grid-cols-2 gap-2">
                  <Btn onClick={() => setRejecting(null)}>Back</Btn>
                  <Btn tone="bad" busy={busy} onClick={async () => { if (await run(() => staff(`payments/${p.id}/reject`, 'POST', { reason }), 'Rejected; slots released')) { setRejecting(null); void reload(); } }}>Reject & release</Btn>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Btn tone="bad" onClick={() => setRejecting(p.id)}><X className="w-4 h-4" /> Not received</Btn>
                <Btn tone="ok" busy={busy} onClick={async () => {
                  const r = await run(() => staff<{ waLink: string | null; waAuto: boolean }>(`payments/${p.id}/verify`, 'POST'), 'Verified — booking confirmed');
                  if (r) {
                    if (r.waLink && !r.waAuto) setWa({ link: r.waLink, name: p.name || 'player' });
                    void reload();
                  }
                }}><Check className="w-4 h-4" /> Verify</Btn>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------- overview ---------------- */

interface Summary {
  summary: {
    months: { month: string; income: number; refunds: number; expenses: number; net: number; bookings: number }[];
    totals: { income: number; refunds: number; expenses: number; net: number; bookings: number };
    byMethod: { method: string; amount: number }[];
    byCategory: { category: string; amount: number }[];
    expenseByCategory: { category: string; amount: number }[];
    byChannel: { channel: string; n: number; amount: number }[];
    pending: { n: number; amount: number };
  };
  threshold: { turnover: number; threshold: number; pct: number; registered: boolean; fy: string };
}

function useRange(days: number) {
  const [to, setTo] = useState(todayIst());
  const [from, setFrom] = useState(addDays(todayIst(), -days));
  const picker = (
    <div className="flex items-center gap-2 text-sm">
      <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="flex-1 min-w-0 rounded-xl bg-panel border border-line px-3 py-2" aria-label="From" />
      <span className="text-muted">→</span>
      <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="flex-1 min-w-0 rounded-xl bg-panel border border-line px-3 py-2" aria-label="To" />
    </div>
  );
  return { from, to, picker };
}

function Bars({ rows, colorClass }: { rows: { label: string; amount: number }[]; colorClass: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-xs mb-1"><span className="capitalize text-soft">{r.label}</span><span className="font-semibold">{rupees(r.amount)}</span></div>
          <div className="h-2 rounded-full bg-night"><div className={`h-2 rounded-full ${colorClass}`} style={{ width: `${(r.amount / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Overview() {
  const { from, to, picker } = useRange(180);
  const { data, loading } = useStaff<Summary>(`finance?from=${from}&to=${to}`);
  const s = data?.summary;
  const maxMonth = Math.max(1, ...(s?.months ?? []).map((m) => Math.max(m.income, m.expenses)));
  return (
    <div className="space-y-4">
      {picker}
      {loading && !s ? <Spinner /> : !s ? null : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Collected" value={rupees(s.totals.income - s.totals.refunds)} tone="text-lime" sub={s.totals.refunds ? `after ${rupees(s.totals.refunds)} refunds` : `${s.totals.bookings} bookings`} />
            <Stat label="Expenses" value={rupees(s.totals.expenses)} tone="text-pink" />
            <Stat label="Profit" value={rupees(s.totals.net)} tone={s.totals.net >= 0 ? 'text-ok' : 'text-bad'} />
            <Stat label="To verify" value={rupees(s.pending.amount)} tone="text-amber" sub={`${s.pending.n} payments`} />
          </div>
          <Card title="Month by month">
            {s.months.length === 0 ? <p className="text-sm text-muted">No money moved in this period.</p> : (
              <div className="space-y-3">
                {s.months.map((m) => (
                  <div key={m.month}>
                    <div className="flex justify-between text-xs mb-1"><span className="font-semibold">{monthLabel(m.month)}</span><span className={m.net >= 0 ? 'text-ok' : 'text-bad'}>{rupees(m.net)}</span></div>
                    <div className="h-2.5 rounded-full bg-night mb-1"><div className="h-2.5 rounded-full bg-gradient-to-r from-lime to-cyan" style={{ width: `${((m.income - m.refunds) / maxMonth) * 100}%` }} /></div>
                    <div className="h-2.5 rounded-full bg-night"><div className="h-2.5 rounded-full bg-pink/80" style={{ width: `${(m.expenses / maxMonth) * 100}%` }} /></div>
                  </div>
                ))}
                <div className="flex gap-4 text-[11px] text-muted"><span className="flex items-center gap-1"><i className="w-3 h-2 rounded bg-lime" /> Income</span><span className="flex items-center gap-1"><i className="w-3 h-2 rounded bg-pink" /> Expenses</span></div>
              </div>
            )}
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="By payment method"><Bars rows={s.byMethod.map((x) => ({ label: x.method, amount: x.amount }))} colorClass="bg-cyan" /></Card>
            <Card title="Income by type"><Bars rows={s.byCategory.map((x) => ({ label: x.category, amount: x.amount }))} colorClass="bg-lime" /></Card>
            <Card title="Expenses by category"><Bars rows={s.expenseByCategory.map((x) => ({ label: x.category, amount: x.amount }))} colorClass="bg-pink" /></Card>
            <Card title="Bookings by channel">
              <ul className="space-y-1.5 text-sm">{s.byChannel.map((c) => <li key={c.channel} className="flex justify-between"><span className="capitalize">{c.channel}</span><span className="text-soft">{c.n} · {rupees(c.amount)}</span></li>)}</ul>
            </Card>
          </div>
          {!data!.threshold.registered && (
            <Card title={`GST registration watch · FY ${data!.threshold.fy}`}>
              <div className="h-3 rounded-full bg-night"><div className={`h-3 rounded-full ${data!.threshold.pct >= 90 ? 'bg-bad' : data!.threshold.pct >= 70 ? 'bg-amber' : 'bg-ok'}`} style={{ width: `${Math.min(100, data!.threshold.pct)}%` }} /></div>
              <p className="text-xs text-soft mt-2">{rupees(data!.threshold.turnover)} of {rupees(data!.threshold.threshold)} ({data!.threshold.pct}%). Services in Rajasthan must register for GST above ₹20 lakh a year.</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- bill book ---------------- */

interface Inv { id: number; number: string; kind: string; date: string; token: string; customer_name: string; customer_gstin: string; total_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; status: string; booking_id: number | null }

function BillBook() {
  const { from, to, picker } = useRange(90);
  const { data, loading, reload } = useStaff<{ invoices: Inv[] }>(`invoices?from=${from}&to=${to}`);
  const [open, setOpen] = useState(false);
  const { busy, run } = useAction();
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <div className="flex-1">{picker}</div>
        <Btn tone="lime" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> New</Btn>
      </div>
      <p className="text-xs text-muted">Booking invoices are issued automatically when a booking is confirmed. Use New for coaching fees, memberships, tournaments, equipment.</p>
      {loading && !data ? <Spinner /> : !data?.invoices.length ? <Empty>No invoices in this period.</Empty> : (
        <ul className="space-y-1.5">
          {data.invoices.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded-2xl border border-line bg-panel/70 px-4 py-3">
              <FileText className="w-5 h-5 text-cyan shrink-0" />
              <a href={`/invoice/${i.token}`} target="_blank" rel="noopener" className="min-w-0 flex-1">
                <div className="font-semibold font-mono text-sm">{i.number}</div>
                <div className="text-xs text-soft truncate">{fmtDate(i.date)} · {i.customer_name}{i.customer_gstin ? ` · ${i.customer_gstin}` : ''}</div>
              </a>
              <div className="text-right">
                <div className="font-semibold">{rupees(i.total_paise)}</div>
                {i.status === 'cancelled' ? <Badge s="cancelled" /> : (
                  <button className="text-[11px] text-muted hover:text-bad" disabled={busy} onClick={async () => { const reason = prompt('Why cancel this invoice? (the number is never reused)'); if (reason && (await run(() => staff(`invoices/${i.id}/cancel`, 'POST', { reason }), 'Invoice cancelled'))) void reload(); }}>cancel</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <NewInvoice open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); void reload(); }} />
    </div>
  );
}

function NewInvoice({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [address, setAddress] = useState('');
  const [pos, setPos] = useState('08');
  const [lines, setLines] = useState([{ description: 'Badminton coaching — monthly fee', amount: '', qty: '1' }]);
  const [paid, setPaid] = useState('upi');
  const [category, setCategory] = useState('coaching');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => staff<{ token: string; number: string }>('invoices', 'POST', {
      customerName: name, customerPhone: phone || undefined, customerGstin: gstin || undefined, customerAddress: address || undefined, placeOfSupply: pos,
      items: lines.map((l) => ({ description: l.description, amount: l.amount, qty: Number(l.qty) || 1 })),
      paid: paid === 'unpaid' ? undefined : { method: paid, category },
    }), 'Invoice issued');
    if (r) {
      window.open(`/invoice/${r.token}`, '_blank', 'noopener');
      onDone();
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="New invoice" wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Customer name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Phone"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Customer GSTIN (B2B)"><input className={`${inputCls} uppercase`} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} /></Field>
          <Field label="Place of supply"><select className={inputCls} value={pos} onChange={(e) => setPos(e.target.value)}>{Object.entries(STATES).map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></Field>
        </div>
        <Field label="Address"><input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_4rem_6.5rem_auto] gap-2 items-end">
              <input className={inputCls} placeholder="Description" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} required />
              <input className={inputCls} placeholder="Qty" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} inputMode="numeric" />
              <input className={inputCls} placeholder="₹ amount" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} inputMode="decimal" required />
              <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1} className="p-3 text-muted hover:text-bad disabled:opacity-30" aria-label="Remove line"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" className="text-sm text-cyan font-semibold" onClick={() => setLines([...lines, { description: '', amount: '', qty: '1' }])}>+ Add line</button>
          <p className="text-[11px] text-muted">Amount is the line total, entered the way your GST setting says (including or excluding GST).</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Received by"><select className={inputCls} value={paid} onChange={(e) => setPaid(e.target.value)}>{['upi', 'cash', 'bank', 'card', 'unpaid'].map((m) => <option key={m} value={m}>{m === 'unpaid' ? 'Not paid yet' : m.toUpperCase()}</option>)}</select></Field>
          <Field label="Income type"><select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>{INCOME_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
        <Btn tone="lime" busy={busy} className="w-full py-3.5">Issue invoice</Btn>
      </form>
    </Sheet>
  );
}

/* ---------------- expenses ---------------- */

interface Exp { id: number; date: string; category: string; vendor: string; description: string; amount_paise: number; gst_paise: number; method: string; bill_media: string | null }

function Expenses() {
  const { from, to, picker } = useRange(90);
  const { data, loading, reload } = useStaff<{ expenses: Exp[] }>(`expenses?from=${from}&to=${to}`);
  const [open, setOpen] = useState(false);
  const { run } = useAction();
  const total = (data?.expenses ?? []).reduce((n, e) => n + e.amount_paise, 0);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <div className="flex-1">{picker}</div>
        <Btn tone="lime" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Add</Btn>
      </div>
      <div className="text-sm text-soft">Total: <b className="text-pink">{rupees(total)}</b></div>
      {loading && !data ? <Spinner /> : !data?.expenses.length ? <Empty>No expenses in this period.</Empty> : (
        <ul className="space-y-1.5">
          {data.expenses.map((x) => (
            <li key={x.id} className="flex items-center gap-3 rounded-2xl border border-line bg-panel/70 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{x.category}{x.vendor ? ` · ${x.vendor}` : ''}</div>
                <div className="text-xs text-soft truncate">{fmtDate(x.date)}{x.description ? ` · ${x.description}` : ''}{x.gst_paise ? ` · GST ${rupees(x.gst_paise)}` : ''}</div>
              </div>
              {x.bill_media && <a href={`/api/staff/media/${x.bill_media}`} target="_blank" rel="noopener" className="text-xs text-cyan font-semibold">Bill</a>}
              <div className="font-semibold">{rupees(x.amount_paise)}</div>
              <button onClick={async () => { if (confirm('Remove this expense? (kept in the audit log)') && (await run(() => staff(`expenses/${x.id}`, 'DELETE'), 'Removed'))) void reload(); }} className="text-muted hover:text-bad" aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <ExpenseForm open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); void reload(); }} />
    </div>
  );
}

function ExpenseForm({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ date: todayIst(), category: 'Shuttles & equipment', vendor: '', description: '', amount: '', gst: '', method: 'upi', reference: '' });
  const [bill, setBill] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => staff('expenses', 'POST', { ...f, gst: f.gst || undefined, bill: bill || undefined }), 'Expense saved')) {
      setF({ ...f, vendor: '', description: '', amount: '', gst: '', reference: '' });
      setBill(null);
      onDone();
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add expense">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={set('date')} required /></Field>
          <Field label="Amount ₹"><input className={inputCls} value={f.amount} onChange={set('amount')} inputMode="decimal" required /></Field>
        </div>
        <Field label="Category"><select className={inputCls} value={f.category} onChange={set('category')}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Paid to"><input className={inputCls} value={f.vendor} onChange={set('vendor')} /></Field>
        <Field label="Description"><input className={inputCls} value={f.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GST on bill ₹" hint="For input tax credit"><input className={inputCls} value={f.gst} onChange={set('gst')} inputMode="decimal" /></Field>
          <Field label="Paid by"><select className={inputCls} value={f.method} onChange={set('method')}>{['upi', 'cash', 'bank', 'card', 'other'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        </div>
        <label className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-4 text-sm font-semibold text-cyan cursor-pointer">
          <Camera className="w-5 h-5" /> {bill ? 'Bill attached ✓ (tap to change)' : 'Photo of bill / PDF'}
          <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setBill(await fileToDataUrl(file)); }} />
        </label>
        <Btn tone="lime" busy={busy} className="w-full py-3.5">Save expense</Btn>
      </form>
    </Sheet>
  );
}

/* ---------------- income ---------------- */

interface Pay { id: number; date: string; direction: string; status: string; method: string; category: string; amount_paise: number; reference: string; ref: string | null; name: string | null; note: string }

function Income() {
  const { from, to, picker } = useRange(30);
  const { data, loading, reload } = useStaff<{ payments: Pay[] }>(`payments?from=${from}&to=${to}`);
  const { busy, run } = useAction();
  const [f, setF] = useState({ category: 'coaching', method: 'upi', amount: '', reference: '', note: '', date: todayIst() });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <Card title="Record other income (coaching fees, membership, sponsorship…)">
        <form className="grid grid-cols-2 sm:grid-cols-3 gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => staff('payments', 'POST', f), 'Income recorded')) { setF({ ...f, amount: '', reference: '', note: '' }); void reload(); } }}>
          <select className={inputCls} value={f.category} onChange={set('category')} aria-label="Type">{INCOME_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select className={inputCls} value={f.method} onChange={set('method')} aria-label="Method">{['upi', 'cash', 'bank', 'card', 'other'].map((m) => <option key={m}>{m}</option>)}</select>
          <input className={inputCls} placeholder="₹ amount" value={f.amount} onChange={set('amount')} inputMode="decimal" required />
          <input type="date" className={inputCls} value={f.date} onChange={set('date')} aria-label="Date" />
          <input className={inputCls} placeholder="Reference" value={f.reference} onChange={set('reference')} />
          <input className={inputCls} placeholder="Note (e.g. player name)" value={f.note} onChange={set('note')} />
          <Btn tone="lime" busy={busy} className="col-span-2 sm:col-span-3">Record</Btn>
        </form>
        <p className="text-[11px] text-muted mt-2">Need a bill for it? Use Bill book → New, and pick how it was paid: it records the income too.</p>
      </Card>
      {picker}
      {loading && !data ? <Spinner /> : !data?.payments.length ? <Empty>No payments in this period.</Empty> : (
        <ul className="space-y-1.5">
          {data.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl border border-line bg-panel/70 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate capitalize">{p.direction === 'refund' ? 'Refund · ' : ''}{p.name || p.category}{p.ref ? <span className="font-mono text-xs text-muted"> {p.ref}</span> : ''}</div>
                <div className="text-xs text-soft">{fmtDate(p.date)} · {p.method.toUpperCase()}{p.reference ? ` · ${p.reference}` : ''}</div>
              </div>
              <span className={`font-semibold ${p.direction === 'refund' ? 'text-pink' : ''}`}>{p.direction === 'refund' ? '−' : ''}{rupees(p.amount_paise)}</span>
              <Badge s={p.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- GST & exports ---------------- */

interface Gst { gst: { out: { month: string; invoices: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }[]; input: { month: string; gst: number }[]; b2b: { month: string; n: number }[] } }

function GstExports() {
  const { from, to, picker } = useRange(180);
  const { data, loading } = useStaff<Gst>(`finance?from=${from}&to=${to}`);
  const input = new Map((data?.gst.input ?? []).map((x) => [x.month, x.gst]));
  return (
    <div className="space-y-4">
      {picker}
      <Card title="GST summary (for GSTR-1 / GSTR-3B)">
        {loading && !data ? <Spinner /> : !data?.gst.out.length ? <p className="text-sm text-muted">No invoices in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[34rem]">
              <thead className="text-muted"><tr className="text-left"><th className="py-1.5">Month</th><th>Invoices</th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th><th className="text-right">Input GST</th></tr></thead>
              <tbody>
                {data.gst.out.map((m) => (
                  <tr key={m.month} className="border-t border-line/60">
                    <td className="py-2 font-semibold">{monthLabel(m.month)}</td><td>{m.invoices}</td>
                    <td className="text-right">{plain(m.taxable)}</td><td className="text-right">{plain(m.cgst)}</td><td className="text-right">{plain(m.sgst)}</td><td className="text-right">{plain(m.igst)}</td><td className="text-right text-ok">{plain(input.get(m.month) ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted mt-2">Figures in ₹. Share the CSVs below with your CA for filing.</p>
      </Card>
      <Card title="Download for your CA (Excel-ready CSV)">
        <div className="grid grid-cols-2 gap-2">
          {(['invoices', 'payments', 'expenses', 'bookings'] as const).map((k) => (
            <a key={k} href={`/api/staff/export/${k}?from=${from}&to=${to}`} className="flex items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-semibold capitalize hover:border-cyan"><Download className="w-4 h-4 text-cyan" /> {k}</a>
          ))}
        </div>
      </Card>
    </div>
  );
}
