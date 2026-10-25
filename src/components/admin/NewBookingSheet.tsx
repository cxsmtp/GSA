'use client';

import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { WhatsAppIcon } from '@/components/ui/BrandIcons';
import { rupees } from '@/lib/shared/money';
import { fmtDate, fmtTime } from '@/lib/shared/time';
import { prettyMobile } from '@/lib/shared/whatsapp';
import { Field, inputCls } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import type { Pick } from './StaffGrid';
import { Btn, staff, useAction, useCan } from './ui';

/** A walk-in or phone booking made at the desk. Paid now, or "pay at venue" (reserved). */
export function NewBookingSheet({ open, onClose, date, picks, onDone }: { open: boolean; onClose: () => void; date: string; picks: Pick[]; onDone: () => void }) {
  const allowedTo = useCan();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [pay, setPay] = useState<'later' | 'cash' | 'upi' | 'card'>('cash');
  const [reference, setReference] = useState('');
  const [done, setDone] = useState<{ id: number; ref: string; waLink: string | null; payState: string; due: number; amount: number; name: string; phone: string } | null>(null);
  const close = () => {
    if (done) onDone();
    setDone(null);
    onClose();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(
      () => staff<{ id: number; ref: string; waLink: string | null; payState: string; due: number; amount: number }>('bookings', 'POST', { date, slots: picks.map((p) => ({ courtId: p.courtId, start: p.start })), name, phone, note: note || undefined, pay: pay === 'later' ? undefined : { method: pay, reference: reference || undefined } }),
      pay === 'later' ? 'Booked — payment due' : pay === 'cash' || allowedTo('money') ? 'Booked and paid' : 'Booked — admin will check the UPI in the bank',
    );
    if (r) {
      setDone({ ...r, name, phone });
      setName('');
      setPhone('');
      setNote('');
      setReference('');
    }
  };
  const total = picks.reduce((n, p) => n + p.price, 0);
  const methods = allowedTo('money') ? (['cash', 'upi', 'card', 'later'] as const) : (['cash', 'upi', 'later'] as const);
  if (done) {
    return (
      <Sheet open={open} onClose={close} title="Booked">
        <div className="space-y-4 text-center">
          <CheckCircle2 className="w-12 h-12 mx-auto text-ok" />
          <div>
            <div className="font-display text-lg font-bold">{done.ref}</div>
            <div className="text-sm text-soft">{done.name} · {prettyMobile(`91${done.phone.replace(/\D/g, '').slice(-10)}`)}</div>
          </div>
          <div className={`rounded-xl px-3 py-2 text-sm font-semibold ${done.payState === 'paid' ? 'bg-ok/15 text-ok' : done.payState === 'verifying' ? 'bg-violet/20 text-[#b39dff]' : 'bg-amber/15 text-amber'}`}>
            {done.payState === 'paid' ? `Paid ${rupees(done.amount)} ✓` : done.payState === 'verifying' ? `Paid ${rupees(done.amount)} · admin will verify` : `Payment due: ${rupees(done.due)}`}
          </div>
          {done.waLink && (
            <a
              href={done.waLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void staff(`bookings/${done.id}/wa-sent`, 'POST')}
              className="flex items-center justify-center gap-2 w-full rounded-2xl py-4 font-bold bg-[#25D366] text-ink"
            >
              <WhatsAppIcon className="w-5 h-5" /> Send confirmation on WhatsApp
            </a>
          )}
          <p className="text-xs text-muted">The message has the booking, {done.payState === 'due' ? 'the amount due and a link to pay online' : 'the payment and a link to the booking'}. It opens your WhatsApp with everything typed — just tap Send.</p>
          <Btn className="w-full" onClick={close}>Done</Btn>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} title="Phone / desk booking">
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
          <div className="text-sm font-medium text-soft mb-1.5">Payment <span className="text-xs text-muted font-normal">(Due = they pay later, at the venue or online)</span></div>
          <div className="grid grid-cols-4 gap-1.5">
            {methods.map((m) => (
              <button type="button" key={m} onClick={() => setPay(m)} aria-pressed={pay === m} className={`rounded-xl py-2.5 text-xs font-bold capitalize border ${pay === m ? 'bg-lime text-ink border-lime' : 'border-line text-soft'}`}>{m === 'later' ? 'Due' : m}</button>
            ))}
          </div>
        </div>
        {(pay === 'upi' || pay === 'card') && <Field label="Reference (UTR / last 4)"><input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} /></Field>}
        {pay === 'cash' && !allowedTo('money') && <p className="text-xs text-muted">Cash is recorded as taken by you and goes on {allowedTo('cash.custody') ? 'your name' : 'your head coach’s name'} until it is deposited.</p>}
        {pay === 'upi' && !allowedTo('money') && <p className="text-xs text-muted">UPI paid at the desk: the admin checks it reached the bank.</p>}
        <Btn tone="lime" busy={busy} className="w-full py-3.5">Book {picks.length} slot{picks.length > 1 ? 's' : ''}</Btn>
      </form>
    </Sheet>
  );
}
