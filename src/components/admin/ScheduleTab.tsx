'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { rupees } from '@/lib/shared/money';
import { addDays, fmtDate, fmtTime, hhmm, todayIst } from '@/lib/shared/time';
import { BLOCK_KINDS } from '@/lib/shared/types';
import { Field, inputCls } from '@/components/ui/Field';
import { Btn, Card, Empty, Segmented, Spinner, staff, useAction, useMe, useStaff } from './ui';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Court { id: number; name: string; note: string; active: number; sort: number }
interface Rule { id: number; name: string; court_id: number | null; days: string; start_min: number; end_min: number; price_paise: number; priority: number }
interface Booking { hours: { open: number; close: number; closed: boolean }[]; slotMinutes: number; basePricePaise: number; daysAhead: number; holdMinutes: number; maxSlots: number; minLeadMinutes: number }
interface Block { id: number; court_id: number | null; court_name: string | null; date_from: string; date_to: string; days: string; start_min: number; end_min: number; kind: string; reason: string }

export function ScheduleTab() {
  const me = useMe();
  const [sub, setSub] = useState<'blocks' | 'courts' | 'hours'>('blocks');
  const courts = useStaff<{ courts: Court[]; rules: Rule[]; booking: Booking }>('courts');
  return (
    <div className="space-y-4">
      {me.role === 'admin' && <Segmented value={sub} onChange={setSub} options={[{ value: 'blocks', label: 'Blocks & batches' }, { value: 'courts', label: 'Courts & prices' }, { value: 'hours', label: 'Hours & rules' }]} />}
      {courts.loading && !courts.data ? <Spinner /> : courts.data && (
        <>
          {sub === 'blocks' && <Blocks courts={courts.data.courts} />}
          {sub === 'courts' && me.role === 'admin' && <CourtsPrices data={courts.data} reload={courts.reload} />}
          {sub === 'hours' && me.role === 'admin' && <Hours booking={courts.data.booking} reload={courts.reload} />}
        </>
      )}
    </div>
  );
}

function DayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {DAY.map((d, i) => {
        const on = value.includes(String(i));
        return (
          <button type="button" key={d} aria-pressed={on} onClick={() => onChange(on ? value.replace(String(i), '') : [...value + i].sort().join(''))} className={`flex-1 rounded-lg py-2 text-[11px] font-bold ${on ? 'bg-cyan text-ink' : 'bg-night border border-line text-muted'}`}>{d}</button>
        );
      })}
    </div>
  );
}

function Blocks({ courts }: { courts: Court[] }) {
  const { data, loading, reload } = useStaff<{ blocks: Block[] }>('blocks');
  const { busy, run } = useAction();
  const [f, setF] = useState({ courtId: '', from: todayIst(), to: todayIst(), days: '0123456', start: '06:00', end: '08:00', kind: 'coaching', reason: 'Coaching batch' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <Card title="Block courts (coaching batches, tournaments, maintenance)">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => staff<{ clashes: string[] }>('blocks', 'POST', { ...f, courtId: f.courtId ? Number(f.courtId) : undefined }), 'Blocked — not bookable online');
          if (r) {
            if (r.clashes.length) alert(`These existing bookings overlap and were kept: ${r.clashes.join(', ')}. Contact the players if needed.`);
            void reload();
          }
        }}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Court"><select className={inputCls} value={f.courtId} onChange={set('courtId')}><option value="">All courts</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Type"><select className={inputCls} value={f.kind} onChange={set('kind')}>{BLOCK_KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
            <Field label="From date"><input type="date" className={inputCls} value={f.from} onChange={set('from')} /></Field>
            <Field label="To date"><input type="date" className={inputCls} value={f.to} onChange={set('to')} /></Field>
            <Field label="From time"><input type="time" className={inputCls} value={f.start} onChange={set('start')} step={1800} /></Field>
            <Field label="To time"><input type="time" className={inputCls} value={f.end} onChange={set('end')} step={1800} /></Field>
          </div>
          <DayPicker value={f.days} onChange={(days) => setF({ ...f, days })} />
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Label (e.g. Juniors batch)" value={f.reason} onChange={set('reason')} maxLength={80} />
            <Btn tone="lime" busy={busy}><Plus className="w-4 h-4" /> Block</Btn>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" className="text-cyan" onClick={() => setF({ ...f, to: addDays(f.from, 90), days: '123456' })}>Repeat Mon–Sat for 3 months</button>
            <button type="button" className="text-cyan" onClick={() => setF({ ...f, to: f.from, days: '0123456' })}>Just this day</button>
          </div>
        </form>
      </Card>
      {loading && !data ? <Spinner /> : !data?.blocks.length ? <Empty>No blocks. Every slot in opening hours is bookable.</Empty> : (
        <ul className="space-y-1.5">
          {data.blocks.map((b) => (
            <li key={b.id} className="flex items-center gap-3 rounded-2xl border border-line bg-panel/70 px-4 py-3">
              <span className="w-2 h-10 rounded-full bg-violet" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{b.reason || b.kind} <span className="text-xs text-muted capitalize">· {b.kind}</span></div>
                <div className="text-xs text-soft">{b.court_name || 'All courts'} · {fmtTime(b.start_min)}–{fmtTime(b.end_min)}</div>
                <div className="text-[11px] text-muted">{b.date_from === b.date_to ? fmtDate(b.date_from) : `${fmtDate(b.date_from, { year: false })} → ${fmtDate(b.date_to, { year: false })}`}{b.days !== '0123456' ? ` · ${b.days.split('').map((d) => DAY[Number(d)]).join(' ')}` : ''}</div>
              </div>
              <button onClick={async () => { if (confirm('Remove this block? Slots become bookable.') && (await run(() => staff(`blocks/${b.id}`, 'DELETE'), 'Block removed'))) void reload(); }} className="text-muted hover:text-bad" aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CourtsPrices({ data, reload }: { data: { courts: Court[]; rules: Rule[]; booking: Booking }; reload: () => void }) {
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [base, setBase] = useState(String(data.booking.basePricePaise / 100));
  const [r, setR] = useState({ name: 'Evening peak', courtId: '', days: '12345', start: '17:00', end: '23:00', price: '500', priority: '10' });
  const setRf = (k: keyof typeof r) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setR({ ...r, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <Card title="Courts">
        <ul className="space-y-2">
          {data.courts.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-2xl border border-line px-3 py-2">
              <input className="flex-1 min-w-0 bg-transparent font-semibold focus:outline-none" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && run(() => staff(`courts/${c.id}`, 'PATCH', { name: e.target.value }), 'Saved').then(reload)} aria-label="Court name" />
              <input className="flex-1 min-w-0 bg-transparent text-xs text-muted focus:outline-none" defaultValue={c.note} placeholder="Surface / note" onBlur={(e) => e.target.value !== c.note && run(() => staff(`courts/${c.id}`, 'PATCH', { note: e.target.value }), 'Saved').then(reload)} aria-label="Note" />
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-lime w-4 h-4" checked={c.active === 1} onChange={(e) => run(() => staff(`courts/${c.id}`, 'PATCH', { active: e.target.checked }), e.target.checked ? 'Court open for booking' : 'Court hidden').then(reload)} /> Open</label>
            </li>
          ))}
        </ul>
        <form className="flex gap-2 mt-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => staff('courts', 'POST', { name }), 'Court added')) { setName(''); reload(); } }}>
          <input className={inputCls} placeholder="New court name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Btn tone="lime" busy={busy}><Plus className="w-4 h-4" /></Btn>
        </form>
      </Card>
      <Card title="Base price per slot">
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); await run(() => staff('settings/booking', 'PUT', { basePricePaise: Math.round(Number(base) * 100) }), 'Base price saved'); reload(); }}>
          <input className={inputCls} value={base} onChange={(e) => setBase(e.target.value)} inputMode="decimal" aria-label="Base price in rupees" />
          <Btn tone="lime" busy={busy}>Save</Btn>
        </form>
        <p className="text-[11px] text-muted mt-2">Used whenever no rule below matches. Per {data.booking.slotMinutes}-minute slot.</p>
      </Card>
      <Card title="Price rules (peak hours, weekends, special courts)">
        <ul className="space-y-1.5 mb-3">
          {data.rules.map((x) => (
            <li key={x.id} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{x.name} · <span className="text-lime">{rupees(x.price_paise)}</span></div>
                <div className="text-xs text-muted">{x.days.split('').map((d) => DAY[Number(d)]).join(' ')} · {fmtTime(x.start_min)}–{fmtTime(x.end_min)} · {x.court_id ? data.courts.find((c) => c.id === x.court_id)?.name : 'all courts'} · priority {x.priority}</div>
              </div>
              <button onClick={async () => { if (await run(() => staff(`rules/${x.id}`, 'DELETE'), 'Rule removed')) reload(); }} className="text-muted hover:text-bad" aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
        <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => staff('rules', 'POST', { ...r, courtId: r.courtId ? Number(r.courtId) : undefined, priority: Number(r.priority) }), 'Rule added')) reload(); }}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <input className={inputCls} value={r.name} onChange={setRf('name')} placeholder="Name" required />
            <select className={inputCls} value={r.courtId} onChange={setRf('courtId')}><option value="">All courts</option>{data.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input className={inputCls} value={r.price} onChange={setRf('price')} placeholder="₹ per slot" inputMode="decimal" required />
            <input type="time" className={inputCls} value={r.start} onChange={setRf('start')} aria-label="From" />
            <input type="time" className={inputCls} value={r.end} onChange={setRf('end')} aria-label="To" />
            <input className={inputCls} value={r.priority} onChange={setRf('priority')} placeholder="Priority" inputMode="numeric" aria-label="Priority (higher wins)" />
          </div>
          <DayPicker value={r.days} onChange={(days) => setR({ ...r, days })} />
          <Btn tone="lime" busy={busy} className="w-full"><Plus className="w-4 h-4" /> Add rule</Btn>
        </form>
        <p className="text-[11px] text-muted mt-2">When several rules match a slot, the highest priority wins.</p>
      </Card>
    </div>
  );
}

function Hours({ booking, reload }: { booking: Booking; reload: () => void }) {
  const { busy, run } = useAction();
  const [hours, setHours] = useState(booking.hours.map((h) => ({ open: hhmm(h.open), close: hhmm(h.close), closed: h.closed })));
  const [f, setF] = useState({ slotMinutes: String(booking.slotMinutes), daysAhead: String(booking.daysAhead), holdMinutes: String(booking.holdMinutes), maxSlots: String(booking.maxSlots), minLeadMinutes: String(booking.minLeadMinutes) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <Card title="Opening hours">
        <div className="space-y-2">
          {hours.map((h, i) => (
            <div key={i} className="grid grid-cols-[3rem_1fr_1fr_auto] items-center gap-2">
              <span className="text-sm font-semibold">{DAY[i]}</span>
              <input type="time" className={inputCls} value={h.open} disabled={h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))} aria-label={`${DAY[i]} opens`} />
              <input type="time" className={inputCls} value={h.close} disabled={h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))} aria-label={`${DAY[i]} closes`} />
              <label className="text-xs flex items-center gap-1"><input type="checkbox" className="accent-bad w-4 h-4" checked={h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, closed: e.target.checked } : x)))} /> Closed</label>
            </div>
          ))}
          <button type="button" className="text-xs text-cyan" onClick={() => setHours(hours.map(() => ({ ...hours[1] })))}>Copy Monday to every day</button>
        </div>
      </Card>
      <Card title="Booking rules">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Slot length"><select className={inputCls} value={f.slotMinutes} onChange={set('slotMinutes')}>{['30', '45', '60', '90', '120'].map((m) => <option key={m} value={m}>{m} min</option>)}</select></Field>
          <Field label="Book how many days ahead"><input className={inputCls} value={f.daysAhead} onChange={set('daysAhead')} inputMode="numeric" /></Field>
          <Field label="Hold while paying (min)"><input className={inputCls} value={f.holdMinutes} onChange={set('holdMinutes')} inputMode="numeric" /></Field>
          <Field label="Max slots per booking"><input className={inputCls} value={f.maxSlots} onChange={set('maxSlots')} inputMode="numeric" /></Field>
          <Field label="Book at least (min) before start"><input className={inputCls} value={f.minLeadMinutes} onChange={set('minLeadMinutes')} inputMode="numeric" /></Field>
        </div>
      </Card>
      <Btn tone="lime" busy={busy} className="w-full py-3.5" onClick={async () => {
        if (await run(() => staff('settings/booking', 'PUT', { hours, slotMinutes: Number(f.slotMinutes), daysAhead: Number(f.daysAhead), holdMinutes: Number(f.holdMinutes), maxSlots: Number(f.maxSlots), minLeadMinutes: Number(f.minLeadMinutes) }), 'Hours & rules saved')) reload();
      }}>Save hours & rules</Btn>
      <p className="text-[11px] text-muted">Changing the slot length doesn&apos;t move existing bookings; check the timetable for overlaps.</p>
    </div>
  );
}
