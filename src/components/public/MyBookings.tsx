'use client';

import { ChevronRight, Ticket } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { savedBookings, type SavedBooking } from '@/lib/client/api';
import { fmtDate } from '@/lib/shared/time';

/** Bookings made on this phone (kept only on the phone). Each opens its payment / confirmation page. */
export function MyBookings() {
  const [list, setList] = useState<SavedBooking[] | null>(null);
  useEffect(() => setList(savedBookings()), []);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-extrabold">My <span className="text-gradient">bookings</span></h1>
      {list === null ? null : list.length === 0 ? (
        <div className="rounded-3xl border border-line bg-panel/60 p-8 text-center space-y-4">
          <Ticket className="w-10 h-10 mx-auto text-muted" />
          <p className="text-soft">No bookings on this phone yet. Your confirmation link is also on WhatsApp.</p>
          <Link href="/" className="btn-lime inline-block rounded-2xl px-6 py-3 font-bold">Book a space</Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((b) => (
            <li key={b.token}>
              <Link href={`/pay/${b.token}`} className="flex items-center gap-3 rounded-2xl border border-line bg-panel/70 p-4 hover:border-cyan">
                <Ticket className="w-5 h-5 text-lime shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{fmtDate(b.date)}</div>
                  <div className="text-xs text-muted font-mono">{b.ref}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
