'use client';

import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { rupees } from '@/lib/shared/money';
import { addDays, fmtDate, fmtTimeShort, todayIst } from '@/lib/shared/time';
import type { DayGrid } from '@/lib/shared/types';
import { Btn, Spinner, useStaff } from './ui';
import { NewBookingSheet } from './NewBookingSheet';
import { BookingSheet } from './BookingSheet';

export type Pick = { spaceId: number; spaceName: string; start: number; end: number; price: number };

/** The desk's live timetable: who is on which space, tap free slots to book a walk-in, tap a booking to manage it. */
export function StaffGrid({ onChanged }: { onChanged?: () => void }) {
  const [date, setDate] = useState(todayIst());
  const { data, loading, reload } = useStaff<{ grid: DayGrid }>(`day?date=${date}`);
  const [sel, setSel] = useState<Pick[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => setSel([]), [date]);

  const grid = data?.grid;
  const starts = grid?.spaces[0]?.cells.map((c) => c.start) ?? [];
  const changed = () => {
    setSel([]);
    void reload();
    onChanged?.();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className="p-2 rounded-xl border border-line" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><ChevronLeft className="w-4 h-4" /></button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="flex-1 rounded-xl bg-panel border border-line px-3 py-2 text-sm" aria-label="Date" />
        <button className="p-2 rounded-xl border border-line" onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="text-xs text-muted">{fmtDate(date)} · tap free slots for a phone or walk-in booking</div>
      {loading && !grid ? (
        <Spinner />
      ) : !grid?.open ? (
        <p className="text-sm text-muted">Closed.</p>
      ) : (
        <div className="overflow-x-auto no-scrollbar rounded-2xl border border-line bg-night/50">
          <table className="w-full border-separate border-spacing-1 min-w-max text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-night z-10 w-14" />
                {grid.spaces.map((c) => <th key={c.id} className="px-1 py-1 font-semibold text-soft min-w-[7.5rem]">{c.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {starts.map((s) => (
                <tr key={s}>
                  <th className="sticky left-0 bg-night z-10 text-left pl-1 font-semibold text-soft whitespace-nowrap">{fmtTimeShort(s)}</th>
                  {grid.spaces.map((c) => {
                    const cell = c.cells.find((x) => x.start === s)!;
                    const picked = sel.some((x) => x.spaceId === c.id && x.start === s);
                    if (cell.bookingId) {
                      const tone = cell.kind === 'confirmed' ? 'bg-ok/15 border-ok/30 text-ok' : cell.kind === 'held' ? 'bg-amber/10 border-amber/30 text-amber' : cell.kind === 'submitted' ? 'bg-violet/20 border-violet/40 text-[#b39dff]' : 'bg-cyan/10 border-cyan/30 text-cyan';
                      return (
                        <td key={c.id}>
                          <button onClick={() => setOpenId(cell.bookingId!)} className={`w-full h-11 rounded-lg border px-2 text-left truncate font-semibold ${tone}`} title={cell.label}>{cell.label?.split(' · ')[0]}</button>
                        </td>
                      );
                    }
                    if (cell.state === 'blocked') return <td key={c.id}><div className="h-11 rounded-lg bg-violet/15 border border-violet/20 text-[#b39dff] grid place-items-center px-1 truncate">{cell.label}</div></td>;
                    const canPick = cell.state === 'free' || (cell.state === 'past' && date === todayIst());
                    if (!canPick) return <td key={c.id}><div className="h-11 rounded-lg border border-line/40" /></td>;
                    return (
                      <td key={c.id}>
                        <button
                          onClick={() => setSel((x) => (picked ? x.filter((y) => !(y.spaceId === c.id && y.start === s)) : [...x, { spaceId: c.id, spaceName: c.name, start: s, end: cell.end, price: cell.price }]))}
                          className={`w-full h-11 rounded-lg border font-semibold ${picked ? 'bg-lime text-ink border-lime' : 'bg-panel-2 border-line text-muted hover:border-lime hover:text-lime'} ${cell.state === 'past' && !picked ? 'opacity-50' : ''}`}
                        >
                          {picked ? <Check className="w-4 h-4 mx-auto" /> : rupees(cell.price)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel.length > 0 && (
        <div className="sticky bottom-24 lg:bottom-4 z-20 glass rounded-2xl p-3 flex items-center gap-3">
          <span className="text-sm flex-1">{sel.length} slot{sel.length > 1 ? 's' : ''} · {rupees(sel.reduce((n, x) => n + x.price, 0))}</span>
          <Btn onClick={() => setSel([])}>Clear</Btn>
          <Btn tone="lime" onClick={() => setNewOpen(true)}>Book</Btn>
        </div>
      )}
      <NewBookingSheet open={newOpen} onClose={() => setNewOpen(false)} date={date} picks={sel} onDone={() => { setNewOpen(false); changed(); }} />
      <BookingSheet id={openId} onClose={() => setOpenId(null)} onChanged={changed} />
    </div>
  );
}
