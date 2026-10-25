'use client';

import { Download, Search } from 'lucide-react';
import { useState } from 'react';
import { rupees } from '@/lib/shared/money';
import { addDays, fmtDate, todayIst } from '@/lib/shared/time';
import { maskMobile } from '@/lib/shared/whatsapp';
import { inputCls } from '@/components/ui/Field';
import { BookingSheet } from './BookingSheet';
import { Badge, Empty, Segmented, Spinner, useCan, useStaff } from './ui';

type Row = { id: number; ref: string; date: string; name: string; phone: string; status: string; slots: string; amount: number; paid?: number; channel: string; source: string; payState: string; due: number; waSent: boolean; minor: boolean; healthFlag: boolean };

export function BookingsTab() {
  const allowedTo = useCan();
  const [status, setStatus] = useState('live');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState(todayIst());
  const [openId, setOpenId] = useState<number | null>(null);
  const path = query ? `bookings?q=${encodeURIComponent(query)}&status=all` : `bookings?status=${status}&from=${from}&to=${addDays(from, 30)}`;
  const { data, loading, reload } = useStaff<{ bookings: Row[] }>(path);
  const byDate = new Map<string, Row[]>();
  for (const b of data?.bookings ?? []) byDate.set(b.date, [...(byDate.get(b.date) || []), b]);

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} pl-10`} placeholder="Name, phone or GSA-ref" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setQuery(''); }} />
        </div>
      </form>
      {!query && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={status} onChange={setStatus} options={[{ value: 'live', label: 'Active' }, { value: 'submitted', label: 'To verify' }, { value: 'reserved', label: 'Payment due' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'all', label: 'All' }]} />
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="rounded-xl bg-panel border border-line px-3 py-1.5 text-sm" aria-label="From date" />
          {allowedTo('money') && <a href={`/api/staff/export/bookings?from=${from}&to=${addDays(from, 30)}`} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-cyan"><Download className="w-4 h-4" /> CSV</a>}
        </div>
      )}
      {loading && !data ? (
        <Spinner />
      ) : !data?.bookings.length ? (
        <Empty>No bookings here.</Empty>
      ) : (
        [...byDate].map(([date, rows]) => (
          <section key={date}>
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5 mt-3">{fmtDate(date)}</h3>
            <ul className="space-y-1.5">
              {rows.map((b) => (
                <li key={b.id}>
                  <button onClick={() => setOpenId(b.id)} className="w-full rounded-2xl border border-line bg-panel/70 px-4 py-3 text-left hover:border-cyan">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold truncate">{b.name}{b.minor && <span className="ml-1.5 rounded bg-amber/20 px-1 text-[10px] font-bold text-amber">U18</span>}{b.healthFlag && <span className="ml-1 rounded bg-pink/20 px-1 text-[10px] font-bold text-pink" title="Health condition noted">⚕</span>}</span>
                      <Badge s={b.status} />
                    </div>
                    <div className="text-xs text-soft mt-0.5 truncate">{b.slots}</div>
                    <div className="flex justify-between text-[11px] text-muted mt-1">
                      <span className="font-mono">{b.ref} · {maskMobile(b.phone)}{b.channel === 'instagram' ? ' · Instagram' : ''}</span>
                      <span>
                        {b.waSent ? '✓ WhatsApp · ' : ''}
                        {['cancelled', 'expired'].includes(b.status) ? rupees(b.amount) : b.payState === 'paid' ? <span className="text-ok">Paid {rupees(b.amount)}</span> : b.payState === 'verifying' ? <span className="text-[#b39dff]">Paid · verifying</span> : <span className="text-amber">Due {rupees(b.due)}</span>}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <BookingSheet id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}
