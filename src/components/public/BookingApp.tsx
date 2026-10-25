'use client';

import { Check, ChevronRight, Loader2, Moon, ShieldCheck, Sun, Sunrise, Sunset, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, detectChannel, rememberBooking } from '@/lib/client/api';
import { rupees } from '@/lib/shared/money';
import { addDays, dayName, fmtDate, fmtTime, fmtTimeShort } from '@/lib/shared/time';
import type { Cell, DayGrid, PublicConfig } from '@/lib/shared/types';
import { WhatsAppIcon } from '@/components/ui/BrandIcons';
import { Field, inputCls } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';

type Sel = { spaceId: number; spaceName: string; start: number; end: number; price: number };

const PERIODS = [
  { key: 'morning', label: 'Morning', icon: Sunrise, from: 0, to: 12 * 60 },
  { key: 'afternoon', label: 'Afternoon', icon: Sun, from: 12 * 60, to: 17 * 60 },
  { key: 'evening', label: 'Evening', icon: Sunset, from: 17 * 60, to: 20 * 60 },
  { key: 'night', label: 'Night', icon: Moon, from: 20 * 60, to: 24 * 60 },
];

export function BookingApp({ config }: { config: PublicConfig }) {
  const router = useRouter();
  const [date, setDate] = useState(config.today);
  const [grid, setGrid] = useState<DayGrid | null>(null);
  const [strip, setStrip] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Sel[]>([]);
  const [sheet, setSheet] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => Array.from({ length: config.booking.daysAhead + 1 }, (_, i) => addDays(config.today, i)), [config]);

  const load = useCallback(async (d: string, withStrip = false) => {
    try {
      const r = await api<{ grid: DayGrid; strip?: Record<string, number> }>(`/api/public/day?date=${d}${withStrip ? '&strip=1' : ''}`);
      setGrid(r.grid);
      if (r.strip) setStrip(r.strip);
      setError('');
      // Drop picks that someone else just took.
      setSel((s) => s.filter((x) => r.grid.date !== d || r.grid.spaces.find((c) => c.id === x.spaceId)?.cells.find((c) => c.start === x.start)?.state === 'free'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load spaces.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    detectChannel();
    const d = new URLSearchParams(location.search).get('date');
    if (d && days.includes(d)) setDate(d);
  }, [days]);

  useEffect(() => {
    setLoading(true);
    void load(date, true);
    const t = setInterval(() => void load(date), 30_000);
    const onFocus = () => void load(date, true);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [date, load]);

  const pickDate = (d: string) => {
    if (d === date) return;
    setSel([]);
    setDate(d);
  };

  const toggle = (spaceId: number, spaceName: string, c: Cell) => {
    if (c.state !== 'free') return;
    setSel((s) => {
      const has = s.some((x) => x.spaceId === spaceId && x.start === c.start);
      if (has) return s.filter((x) => !(x.spaceId === spaceId && x.start === c.start));
      if (s.length >= config.booking.maxSlots) {
        setError(`You can book up to ${config.booking.maxSlots} slots at a time.`);
        return s;
      }
      setError('');
      if ('vibrate' in navigator) navigator.vibrate?.(8);
      return [...s, { spaceId, spaceName, start: c.start, end: c.end, price: c.price }];
    });
  };

  const base = sel.reduce((n, s) => n + s.price, 0);
  const total = config.gst.mode === 'regular' && !config.gst.pricesIncludeGst ? base + Math.round((base * config.gst.ratePct) / 100) : base;
  const freeToday = grid ? grid.spaces.reduce((n, c) => n + c.cells.filter((x) => x.state === 'free').length, 0) : 0;
  // Rows already over on every space are hidden (today's early morning), so the open slots come first.
  const starts = (grid?.spaces[0]?.cells.map((c) => c.start) ?? []).filter((s) => grid!.spaces.some((c) => c.cells.find((x) => x.start === s)?.state !== 'past'));

  return (
    <div className="mx-auto max-w-5xl px-4 pb-44 sm:pb-32">
      {/* Hero */}
      <section className="pt-6 sm:pt-10 rise">
        <p className="inline-flex items-center gap-2 rounded-full border border-lime/30 bg-lime/10 px-3 py-1 text-xs font-semibold text-lime">
          <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-lime pulse" /><span className="w-2 h-2 rounded-full bg-lime" /></span>
          {loading ? 'Checking live availability…' : grid?.open ? `${freeToday} slots open ${date === config.today ? 'today' : 'on ' + fmtDate(date, { year: false })}` : 'Closed on this day'}
        </p>
        <h1 className="font-display mt-4 text-[2.1rem] leading-[1.05] sm:text-6xl font-extrabold tracking-tight">
          Book your <span className="text-gradient">slot.</span>
          <br />
          <span className="text-soft text-2xl sm:text-4xl font-bold">{config.business.tagline}</span>
        </h1>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-soft">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-panel/80 border border-line px-3 py-1.5"><Zap className="w-3.5 h-3.5 text-lime" /> Pay instantly with any UPI app</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-panel/80 border border-line px-3 py-1.5"><WhatsAppIcon className="w-3.5 h-3.5 text-ok" /> Confirmation on WhatsApp</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-panel/80 border border-line px-3 py-1.5"><ShieldCheck className="w-3.5 h-3.5 text-cyan" /> GST invoice</span>
        </div>
      </section>

      {/* Date strip */}
      <section className="mt-7" aria-label="Pick a date">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-sm font-semibold text-soft">Pick a day</h2>
          <label className="text-xs text-cyan font-semibold cursor-pointer">
            Calendar
            <input
              type="date"
              className="sr-only"
              min={days[0]}
              max={days[days.length - 1]}
              value={date}
              onChange={(e) => days.includes(e.target.value) && pickDate(e.target.value)}
              aria-label="Pick a date from the calendar"
            />
          </label>
        </div>
        <div ref={stripRef} className="no-scrollbar -mx-4 px-4 flex gap-2 overflow-x-auto snap-x pb-1">
          {days.map((d) => {
            const on = d === date;
            const free = strip[d];
            return (
              <button
                key={d}
                onClick={() => pickDate(d)}
                aria-pressed={on}
                className={`snap-start shrink-0 w-[4.4rem] rounded-2xl border px-2 py-2.5 text-center transition ${on ? 'border-lime bg-lime text-ink shadow-[0_8px_30px_-8px] shadow-lime/70' : 'border-line bg-panel/70 hover:border-cyan/60'}`}
              >
                <div className={`text-[11px] font-semibold uppercase ${on ? 'text-ink/70' : 'text-muted'}`}>{d === config.today ? 'Today' : dayName(d)}</div>
                <div className="font-display text-xl font-bold leading-tight">{Number(d.slice(8))}</div>
                <div className={`text-[10px] font-semibold ${on ? 'text-ink/70' : free === 0 ? 'text-bad' : 'text-ok'}`}>{free === undefined ? '·' : free === 0 ? 'Full' : `${free} free`}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Legend */}
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted" aria-hidden="true">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-panel-2 border border-cyan/40" /> Open</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-lime" /> Your pick</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-pink/30" /> Booked</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-violet/40" /> Training / event</span>
      </div>

      {/* Grid */}
      <section className="mt-3" aria-label={`Spaces on ${fmtDate(date)}`} aria-busy={loading}>
        {loading && !grid ? (
          <div className="grid place-items-center py-20 text-muted"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !grid || !grid.open || !grid.spaces.length ? (
          <div className="rounded-3xl border border-line bg-panel/60 p-8 text-center text-soft">The spaces are closed on {fmtDate(date)}. Please pick another day.</div>
        ) : (
          <div className="space-y-5">
            {PERIODS.map((p) => {
              const rows = starts.filter((s) => s >= p.from && s < p.to);
              if (!rows.length) return null;
              const Icon = p.icon;
              return (
                <div key={p.key} className="rounded-3xl border border-line bg-panel/50 space-lines overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line/70 bg-night/40">
                    <Icon className="w-4 h-4 text-amber" aria-hidden="true" />
                    <h3 className="font-display text-xs font-semibold tracking-wide uppercase">{p.label}</h3>
                  </div>
                  <div className="overflow-x-auto no-scrollbar">
                    <table className="w-full border-separate border-spacing-1.5 min-w-max">
                      <thead>
                        <tr>
                          <th className="w-16 text-left text-[10px] font-semibold text-muted px-1 sticky left-0 bg-panel/90 backdrop-blur z-10" scope="col">Time</th>
                          {grid.spaces.map((c) => (
                            <th key={c.id} scope="col" className="text-[11px] font-semibold text-soft px-1 min-w-[5.6rem]">
                              {c.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((start) => (
                          <tr key={start}>
                            <th scope="row" className="text-left text-xs font-semibold text-soft whitespace-nowrap px-1 sticky left-0 bg-panel/90 backdrop-blur z-10">{fmtTimeShort(start)}</th>
                            {grid.spaces.map((c) => {
                              const cell = c.cells.find((x) => x.start === start)!;
                              const picked = sel.some((x) => x.spaceId === c.id && x.start === start);
                              return (
                                <td key={c.id} className="p-0">
                                  <SlotButton cell={cell} picked={picked} space={c.name} onClick={() => toggle(c.id, c.name, cell)} />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      </section>

      {/* Selection bar */}
      {sel.length > 0 && (
        <div className="fixed inset-x-0 bottom-[4.4rem] sm:bottom-4 z-40 px-3 rise">
          <div className="mx-auto max-w-xl glass rounded-3xl p-3 pl-5 flex items-center gap-3 shadow-2xl shadow-black/60">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted">{sel.length} slot{sel.length > 1 ? 's' : ''} · {fmtDate(date, { year: false })}</div>
              <div className="font-display text-xl font-bold">{rupees(total)}</div>
            </div>
            <button onClick={() => setSheet(true)} className="btn-lime rounded-2xl px-5 py-3.5 font-bold flex items-center gap-1.5">
              Continue <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <DetailsSheet
        open={sheet}
        onClose={() => setSheet(false)}
        config={config}
        date={date}
        sel={sel}
        total={total}
        base={base}
        onTaken={() => {
          setSheet(false);
          void load(date, true);
        }}
        onDone={(token, ref) => {
          rememberBooking({ token, ref, date, at: Date.now() });
          router.push(`/pay/${token}`);
        }}
      />
    </div>
  );
}

function SlotButton({ cell, picked, space, onClick }: { cell: Cell; picked: boolean; space: string; onClick: () => void }) {
  const label = `${space}, ${fmtTime(cell.start)} to ${fmtTime(cell.end)}`;
  if (picked)
    return (
      <button onClick={onClick} aria-pressed="true" aria-label={`${label}, selected. Tap to remove.`} className="w-full h-12 rounded-xl bg-lime text-ink font-bold text-sm flex items-center justify-center gap-1 shadow-[0_6px_20px_-6px] shadow-lime/80">
        <Check className="w-4 h-4" strokeWidth={3} /> {rupees(cell.price)}
      </button>
    );
  if (cell.state === 'free')
    return (
      <button onClick={onClick} aria-pressed="false" aria-label={`${label}, ${rupees(cell.price)}, open`} className="w-full h-12 rounded-xl bg-panel-2 border border-cyan/25 text-sm font-semibold text-text hover:border-lime hover:text-lime active:scale-95 transition">
        {rupees(cell.price)}
      </button>
    );
  const text = cell.state === 'blocked' ? (cell.kind === 'training' ? 'Training' : cell.kind === 'event' ? 'Event' : cell.kind === 'maintenance' ? 'Closed' : 'Reserved') : cell.state === 'past' ? '—' : 'Booked';
  const cls = cell.state === 'blocked' ? 'bg-violet/20 text-violet/90 border-violet/20' : cell.state === 'past' ? 'bg-transparent text-muted/40 border-line/40' : 'bg-pink/15 text-pink/80 border-pink/15';
  return (
    <div aria-label={`${label}, ${text}`} role="img" className={`w-full h-12 rounded-xl border text-[11px] font-semibold flex items-center justify-center ${cls}`}>
      {text}
    </div>
  );
}

function DetailsSheet({
  open, onClose, config, date, sel, total, base, onDone, onTaken,
}: {
  open: boolean; onClose: () => void; config: PublicConfig; date: string; sel: Sel[]; total: number; base: number;
  onDone: (token: string, ref: string) => void; onTaken: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstOn, setGstOn] = useState(false);
  const [gstin, setGstin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('gsa_player') || '{}');
      if (saved.name) setName(saved.name);
      if (saved.phone) setPhone(saved.phone);
      if (saved.email) setEmail(saved.email);
    } catch {
      // ignore
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const digits = phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) return setErr('Enter your 10-digit WhatsApp number.');
    setBusy(true);
    try {
      const r = await api<{ token: string; ref: string }>('/api/public/bookings', {
        body: { date, slots: sel.map((s) => ({ spaceId: s.spaceId, start: s.start })), name, phone: digits, email: email || undefined, gstin: gstOn && gstin ? gstin : undefined, channel: detectChannel(), website: hp.current?.value || undefined },
      });
      try {
        localStorage.setItem('gsa_player', JSON.stringify({ name, phone: digits, email }));
      } catch {
        // ignore
      }
      onDone(r.token, r.ref);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.data.code === 'slot_taken') {
        setErr(e2.message);
        setTimeout(onTaken, 1800);
      } else setErr(e2 instanceof Error ? e2.message : 'Could not book.');
      setBusy(false);
    }
  };

  const sorted = [...sel].sort((a, b) => a.start - b.start || a.spaceId - b.spaceId);
  return (
    <Sheet open={open} onClose={onClose} title="Your details">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-2xl border border-line bg-panel p-4">
          <div className="text-xs text-muted">{fmtDate(date)}</div>
          <ul className="mt-2 space-y-1.5">
            {sorted.map((s) => (
              <li key={`${s.spaceId}:${s.start}`} className="flex justify-between text-sm">
                <span>{s.spaceName} · {fmtTime(s.start)}–{fmtTime(s.end)}</span>
                <span className="text-soft">{rupees(s.price)}</span>
              </li>
            ))}
          </ul>
          {total !== base && <div className="mt-2 flex justify-between text-xs text-muted"><span>GST {config.gst.ratePct}%</span><span>{rupees(total - base)}</span></div>}
          <div className="mt-3 pt-3 border-t border-line flex justify-between font-display font-bold"><span>Total</span><span className="text-lime">{rupees(total)}</span></div>
        </div>

        <Field label="Your name" htmlFor="bk-name">
          <input id="bk-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" placeholder="Full name" />
        </Field>
        <Field label="WhatsApp number" htmlFor="bk-phone" hint="Your confirmation and invoice come here on WhatsApp.">
          <div className="flex rounded-2xl bg-panel border border-line focus-within:border-cyan focus-within:ring-2 focus-within:ring-cyan/30">
            <span className="pl-4 pr-2 grid place-items-center text-soft font-semibold">+91</span>
            <input id="bk-phone" className="flex-1 min-w-0 bg-transparent py-3 pr-4 focus:outline-none" value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="numeric" autoComplete="tel-national" placeholder="98XXXXXXXX" maxLength={14} />
          </div>
        </Field>
        <Field label="Email (optional)" htmlFor="bk-email">
          <input id="bk-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} autoComplete="email" placeholder="you@example.com" />
        </Field>
        <label className="flex items-center gap-3 text-sm text-soft">
          <input type="checkbox" checked={gstOn} onChange={(e) => setGstOn(e.target.checked)} className="w-5 h-5 accent-lime" /> I need a GST invoice for my business
        </label>
        {gstOn && (
          <Field label="Business GSTIN" htmlFor="bk-gstin">
            <input id="bk-gstin" className={`${inputCls} uppercase`} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="08ABCDE1234F1Z5" />
          </Field>
        )}
        <input ref={hp} name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button type="submit" disabled={busy} className="btn-lime w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null} Hold my space & pay {rupees(total)}
        </button>
        <p className="text-center text-xs text-muted">Your slots are held for {config.booking.holdMinutes} minutes while you pay.</p>
      </form>
    </Sheet>
  );
}
