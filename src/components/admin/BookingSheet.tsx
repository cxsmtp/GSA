'use client';

import { Copy, ExternalLink, FileText, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { rupees } from '@/lib/shared/money';
import { fmtDate, fmtStamp } from '@/lib/shared/time';
import { prettyMobile } from '@/lib/shared/whatsapp';
import { WhatsAppIcon } from '@/components/ui/BrandIcons';
import { inputCls } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Badge, Btn, Spinner, staff, useAction, useCan, useToast } from './ui';

interface Detail {
  booking: {
    id: number; ref: string; date: string; name: string; phone: string; status: string; source: string; channel: string; slots: string; amount: number; paid?: number; payState: string; due: number; minor: boolean; healthFlag: boolean; health: string | null; guardian: { name: string; phone: string; relation: string; consentAt: string | null } | null;
    note: string; email: string; gstin: string; token: string; cancelReason: string; createdBy: string | null; createdAt: string; waSent: boolean; waOpened: boolean; code: string;
  };
  payments: { id: number; method: string; status: string; direction: string; amount_paise?: number; reference?: string; created_at: string; created_by?: string }[];
  invoice: { id: number; number: string; token: string; status: string } | null;
  waLink: string | null;
  payLink: string;
}

/** Everything about one booking, with the actions the signed-in role may take. */
export function BookingSheet({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const allowedTo = useCan();
  const toast = useToast();
  const { busy, run } = useAction();
  const [d, setD] = useState<Detail | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState('');
  const [refundMethod, setRefundMethod] = useState('upi');
  const admin = allowedTo('money');

  const load = async (bid: number) => {
    setD(null);
    const r = await run(() => staff<Detail>(`bookings/${bid}`, 'GET'));
    if (r) setD(r);
  };
  useEffect(() => {
    if (id) void load(id);
    setCancelling(false);
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    const r = await run(fn, ok);
    if (r && id) {
      await load(id);
      onChanged();
    }
  };

  const b = d?.booking;
  return (
    <Sheet open={id !== null} onClose={onClose} title={b ? b.ref : 'Booking'}>
      {!d || !b ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-lg font-bold">{b.name}</div>
              <a href={`tel:+${b.phone}`} className="text-sm text-cyan inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {prettyMobile(b.phone)}</a>
            </div>
            <Badge s={b.status} />
          </div>
          {(b.guardian || b.health) && (
            <div className={`rounded-2xl border p-3 text-sm space-y-1.5 ${b.healthFlag || b.guardian ? 'border-amber/50 bg-amber/10' : 'border-line bg-night/60'}`}>
              {b.guardian && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-amber">Under 18</div>
                  <div>Guardian: <b>{b.guardian.name}</b> ({b.guardian.relation}) · <a href={`tel:+${b.guardian.phone}`} className="text-cyan">{prettyMobile(b.guardian.phone)}</a></div>
                  {b.guardian.consentAt && <div className="text-[11px] text-muted">Consent given {fmtStamp(b.guardian.consentAt)}</div>}
                </div>
              )}
              {b.health && (
                <div><span className={`text-xs font-bold uppercase tracking-wider ${b.healthFlag ? 'text-amber' : 'text-muted'}`}>Health</span> <span className={b.healthFlag ? 'font-semibold' : 'text-soft'}>{b.health}</span></div>
              )}
            </div>
          )}
          <div className="rounded-2xl bg-night/60 border border-line p-3 text-sm space-y-1">
            <div className="font-semibold">{fmtDate(b.date)}</div>
            <div className="text-soft">{b.slots}</div>
            <div className="flex justify-between pt-1"><span className="text-muted">Amount</span><span className="font-bold">{rupees(b.amount)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Payment</span><span className={`font-bold ${b.payState === 'paid' ? 'text-ok' : b.payState === 'verifying' ? 'text-[#b39dff]' : 'text-amber'}`}>{b.payState === 'paid' ? 'Paid ✓' : b.payState === 'verifying' ? 'Paid · being verified' : `Due ${rupees(b.due)}`}</span></div>
            <div className="flex justify-between text-xs text-muted pt-1"><span>{b.source === 'desk' ? `Desk · ${b.createdBy}` : `Online · via ${b.channel}`}</span><span>{fmtStamp(b.createdAt)}</span></div>
            {b.gstin && <div className="text-xs text-muted">GSTIN {b.gstin}</div>}
            {b.note && <div className="text-xs text-amber">{b.note}</div>}
            {b.cancelReason && <div className="text-xs text-bad">Cancelled: {b.cancelReason}</div>}
            {b.source === 'online' && b.waOpened && <div className="text-xs text-ok">Player sent the manager a WhatsApp</div>}
          </div>

          {d.payments.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted uppercase">Payments</div>
              {d.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-sm rounded-xl border border-line px-3 py-2">
                  <span className="capitalize">{p.direction === 'refund' ? 'Refund · ' : ''}{p.method}{p.reference ? <span className="font-mono text-xs text-muted"> {p.reference}</span> : null}</span>
                  <span className="flex items-center gap-2">{p.amount_paise !== undefined && rupees(p.amount_paise)} <Badge s={p.status} /></span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {allowedTo('bookings.notify') && d.waLink && b.waSent && <p className="col-span-2 text-center text-xs text-ok">✓ Confirmation sent on WhatsApp</p>}
            {allowedTo('bookings.notify') && d.waLink && (
              <a href={d.waLink} target="_blank" rel="noopener noreferrer" onClick={() => void staff(`bookings/${b.id}/wa-sent`, 'POST').then(() => { if (id) void load(id); onChanged(); })} className="col-span-2 flex items-center justify-center gap-2 rounded-xl py-3 font-bold bg-[#25D366] text-ink">
                <WhatsAppIcon className="w-5 h-5" /> {b.waSent ? 'Send WhatsApp confirmation again' : `Send confirmation on WhatsApp${b.payState === 'due' ? ' (with amount due)' : ''}`}
              </a>
            )}
            {allowedTo('cash.collect') && ['held', 'reserved', 'expired'].includes(b.status) && b.payState === 'due' && (
              <>
                <Btn tone="ok" busy={busy} onClick={() => act(() => staff(`bookings/${b.id}/collected`, 'POST', { method: 'cash' }), 'Cash received — booking paid')}>Cash received</Btn>
                <Btn busy={busy} onClick={() => act(() => staff(`bookings/${b.id}/collected`, 'POST', { method: 'upi' }), admin ? 'UPI received — booking paid' : 'Noted — admin will check the bank')}>UPI at desk</Btn>
              </>
            )}
            {d.invoice && (
              <a href={`/invoice/${d.invoice.token}`} target="_blank" rel="noopener" className="flex items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-sm font-semibold"><FileText className="w-4 h-4" /> {d.invoice.number}</a>
            )}
            <button onClick={() => navigator.clipboard.writeText(d.payLink).then(() => toast('Player link copied'))} className="flex items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-sm font-semibold"><Copy className="w-4 h-4" /> Player link</button>
            <a href={d.payLink} target="_blank" rel="noopener" className="flex items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-sm font-semibold"><ExternalLink className="w-4 h-4" /> Open</a>
          </div>

          {allowedTo('bookings.cancel') && !['cancelled', 'expired'].includes(b.status) && (admin || (b.payState === 'due' && b.status !== 'confirmed')) && (
            <div className="pt-2 border-t border-line">
              {!cancelling ? (
                <Btn tone="bad" onClick={() => setCancelling(true)} className="w-full">Cancel booking</Btn>
              ) : (
                <div className="space-y-2">
                  <input className={inputCls} placeholder="Reason (shown to the player)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
                  {admin && (b.paid ?? 0) > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <input className={inputCls} placeholder={`Refund ₹ (max ${(b.paid ?? 0) / 100})`} value={refund} onChange={(e) => setRefund(e.target.value)} inputMode="decimal" />
                      <select className={inputCls} value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                        {['upi', 'cash', 'bank', 'razorpay', 'card'].map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                  )}
                  <Btn tone="bad" busy={busy} disabled={!reason.trim()} className="w-full" onClick={() => act(() => staff(`bookings/${b.id}/cancel`, 'POST', { reason, refund: refund ? { amount: refund, method: refundMethod } : undefined }), 'Booking cancelled; spaces released')}>
                    Confirm cancel{refund ? ` & refund ₹${refund}` : ''}
                  </Btn>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
