'use client';

import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { rupees } from '@/lib/shared/money';
import { fmtDate } from '@/lib/shared/time';
import { BookingSheet } from './BookingSheet';
import { StaffGrid } from './StaffGrid';
import { Badge, Card, Spinner, Stat, useMe, useStaff } from './ui';
import { can } from '@/lib/shared/rbac';

interface Dash {
  today: string;
  bookings: { id: number; ref: string; name: string; status: string; slots: string; amount: number; paid?: number }[];
  occupancy: number;
  pendingPayments?: number;
  collectedToday?: number;
  upcoming: number;
  threshold?: { turnover: number; threshold: number; pct: number; registered: boolean; fy: string };
  integrations?: { razorpay: boolean; whatsappApi: boolean; razorpayWebhook: boolean };
  cashOnName?: number;
  cashTakenToday?: number;
  pendingDeposits?: number;
}

export function TodayTab({ go }: { go: (t: 'money' | 'bookings' | 'cash') => void }) {
  const me = useMe();
  const { data, loading, reload } = useStaff<Dash>('dashboard');
  const [openId, setOpenId] = useState<number | null>(null);
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const admin = can(me.role, 'money');
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted">{fmtDate(data.today)}</p>
        <h1 className="font-display text-2xl font-extrabold">Hi {me.name.split(' ')[0]} <span className="text-gradient">👋</span></h1>
      </div>

      {admin && (data.pendingPayments ?? 0) > 0 && (
        <button onClick={() => go('money')} className="w-full flex items-center gap-3 rounded-3xl border border-violet/50 bg-violet/15 p-4 text-left pulse">
          <span className="grid place-items-center w-10 h-10 rounded-2xl bg-violet text-white font-display font-bold">{data.pendingPayments}</span>
          <span className="flex-1"><b>Payments to verify</b><br /><span className="text-xs text-soft">Check the UPI reference in your bank app, then tap Verify</span></span>
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Today" value={data.bookings.length} sub="bookings" />
        <Stat label="Occupancy" value={`${data.occupancy}%`} tone="text-cyan" />
        <Stat label="Upcoming" value={data.upcoming} sub="future bookings" />
        {admin ? (
          <Stat label="Collected today" value={rupees(data.collectedToday ?? 0)} tone="text-lime" />
        ) : data.cashOnName !== undefined ? (
          <button onClick={() => go('cash')} className="text-left"><Stat label="Cash on your name" value={rupees(data.cashOnName)} tone="text-amber" sub="tap to deposit" /></button>
        ) : (
          <button onClick={() => go('cash')} className="text-left"><Stat label="Cash you took today" value={rupees(data.cashTakenToday ?? 0)} tone="text-amber" sub="hand it to your manager" /></button>
        )}
      </div>

      {admin && (data.pendingDeposits ?? 0) > 0 && (
        <button onClick={() => go('money')} className="w-full flex items-center gap-3 rounded-3xl border border-amber/50 bg-amber/10 p-4 text-left">
          <span className="grid place-items-center w-10 h-10 rounded-2xl bg-amber text-ink font-display font-bold">{data.pendingDeposits}</span>
          <span className="flex-1"><b>Cash deposits to confirm</b><br /><span className="text-xs text-soft">Money → Cash: check the bank or the cash handed to you</span></span>
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {admin && data.threshold && !data.threshold.registered && data.threshold.pct >= 70 && (
        <div className="flex gap-3 rounded-2xl border border-amber/40 bg-amber/10 p-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber shrink-0" />
          <span>FY {data.threshold.fy} receipts are {rupees(data.threshold.turnover)} — {data.threshold.pct}% of the GST registration limit ({rupees(data.threshold.threshold)}). Talk to your CA about registering.</span>
        </div>
      )}
      {admin && data.integrations && !data.integrations.whatsappApi && (
        <p className="text-[11px] text-muted">WhatsApp confirmations are sent with one tap from each booking (free). Automatic sending can be switched on in Settings.</p>
      )}

      <Card title="Today's bookings" action={<button onClick={() => go('bookings')} className="text-xs text-cyan font-semibold">All bookings</button>}>
        {data.bookings.length === 0 ? (
          <p className="text-sm text-muted">No bookings yet today.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {data.bookings.map((b) => (
              <li key={b.id}>
                <button onClick={() => setOpenId(b.id)} className="w-full flex items-center gap-3 py-2.5 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{b.name} <span className="text-xs text-muted font-mono">{b.ref}</span></div>
                    <div className="text-xs text-soft truncate">{b.slots}</div>
                  </div>
                  <Badge s={b.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Timetable">
        <StaffGrid onChanged={reload} />
      </Card>
      <BookingSheet id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}
