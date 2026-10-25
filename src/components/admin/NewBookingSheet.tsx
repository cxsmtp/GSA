'use client';

import { useState } from 'react';
import { rupees } from '@/lib/shared/money';
import { fmtDate, fmtTime } from '@/lib/shared/time';
import { Field, inputCls } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import type { Pick } from './StaffGrid';
import { Btn, staff, useAction, useMe } from './ui';

/** A walk-in or phone booking made at the desk. Paid now, or "pay at venue" (reserved). */
export function NewBookingSheet({ open, onClose, date, picks, onDone }: { open: boolean; onClose: () => void; date: string; picks: Pick[]; onDone: () => void }) {
  const me = useMe();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [pay, setPay] = useState<'later' | 'cash' | 'upi' | 'card'>('cash');
  const [reference, setReference] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(
      () => staff('bookings', 'POST', { date, slots: picks.map((p) => ({ courtId: p.courtId, start: p.start })), name, phone, note: note || undefined, pay: pay === 'later' ? undefined : { method: pay, reference: reference || undefined } }),
      pay === 'later' ? 'Reserved — collect at the venue' : me.role === 'admin' ? 'Booked and paid' : 'Booked — payment sent to admin to verify',
    );
    if (r) {
      setName('');
      setPhone('');
      setNote('');
      setReference('');
      onDone();
    }
  };
  const total = picks.reduce((n, p) => n + p.price, 0);
  const methods = me.role === 'admin' ? (['cash', 'upi', 'card', 'later'] as const) : (['cash', 'upi', 'later'] as const);
  return (
    <Sheet open={open} onClose={onClose} title="Desk booking">
      <form onSubmit={submit} className="space-y-3">
        <div className="rounded-2xl bg-night/60 border border-line p-3 text-sm">
          <div className="text-muted text-xs">{fmtDate(date)}</div>
          {picks.map((p) => <div key={`${p.courtId}${p.start}`}>{p.courtName} · {fmtTime(p.start)}–{fmtTime(p.end)}</div>)}
          <div className="mt-1 font-bold">{rupees(total)} <span className="text-xs text-muted font-normal">(before GST if prices exclude GST)</span></div>
        </div>
        <Field label="Player name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></Field>
        <Field label="WhatsApp number"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="numeric" placeholder="10-digit mobile" /></Field>
        <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
        <div>
          <div className="text-sm font-medium text-soft mb-1.5">Payment</div>
          <div className="grid grid-cols-4 gap-1.5">
            {methods.map((m) => (
              <button type="button" key={m} onClick={() => setPay(m)} aria-pressed={pay === m} className={`rounded-xl py-2.5 text-xs font-bold capitalize border ${pay === m ? 'bg-lime text-ink border-lime' : 'border-line text-soft'}`}>{m === 'later' ? 'At venue' : m}</button>
            ))}
          </div>
        </div>
        {(pay === 'upi' || pay === 'card') && <Field label="Reference (UTR / last 4)"><input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} /></Field>}
        {me.role === 'coach' && pay !== 'later' && <p className="text-xs text-muted">The admin verifies the money you collected; the booking holds the court meanwhile.</p>}
        <Btn tone="lime" busy={busy} className="w-full py-3.5">Book {picks.length} slot{picks.length > 1 ? 's' : ''}</Btn>
      </form>
    </Sheet>
  );
}
