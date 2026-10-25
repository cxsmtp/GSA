'use client';

import { CalendarDays, Check, CheckCircle2, Copy, ExternalLink, FileText, Loader2, MapPin, QrCode, ShieldCheck, Smartphone, TriangleAlert, Zap } from 'lucide-react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { api, inAppBrowser, platform, rememberBooking } from '@/lib/client/api';
import { rupees } from '@/lib/shared/money';
import { fmtTime } from '@/lib/shared/time';
import type { PublicBooking } from '@/lib/server/publicView';
import { WhatsAppIcon } from '@/components/ui/BrandIcons';
import { inputCls } from '@/components/ui/Field';

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

/** UPI apps: Android opens the exact app by package; iPhone by each app's own link scheme. */
const APPS = [
  { key: 'gpay', name: 'Google Pay', pkg: 'com.google.android.apps.nbu.paisa.user', ios: 'gpay://upi/', color: 'from-[#4285F4] to-[#34A853]' },
  { key: 'phonepe', name: 'PhonePe', pkg: 'com.phonepe.app', ios: 'phonepe://', color: 'from-[#5f259f] to-[#7c3aed]' },
  { key: 'paytm', name: 'Paytm', pkg: 'net.one97.paytm', ios: 'paytmmp://', color: 'from-[#00b9f1] to-[#002e6e]' },
  { key: 'bhim', name: 'BHIM', pkg: 'in.org.npci.upiapp', ios: 'bhim://', color: 'from-[#f37021] to-[#0a7f3f]' },
];

function appLink(upi: string, app: (typeof APPS)[number], os: 'android' | 'ios' | 'desktop'): string {
  const query = upi.slice('upi://pay?'.length);
  if (os === 'android') return `intent://pay?${query}#Intent;scheme=upi;package=${app.pkg};end`;
  if (os === 'ios') return `${app.ios}pay?${query}`;
  return upi;
}

export function PayApp({ initial }: { initial: PublicBooking }) {
  const [b, setB] = useState(initial);
  const [os, setOs] = useState<'android' | 'ios' | 'desktop'>('android');
  const [inApp, setInApp] = useState<'instagram' | 'facebook' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setOs(platform());
    setInApp(inAppBrowser());
    rememberBooking({ token: initial.token, ref: initial.ref, date: initial.date, at: Date.now() });
  }, [initial]);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ booking: PublicBooking }>(`/api/public/bookings/${b.token}`);
      setB(r.booking);
    } catch {
      // keep showing what we have
    }
  }, [b.token]);

  useEffect(() => {
    if (b.status !== 'held' && b.status !== 'submitted') return;
    const t = setInterval(() => void refresh(), b.status === 'held' ? 6000 : 10000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [b.status, refresh]);

  const left = b.holdExpiresAt ? Math.max(0, b.holdExpiresAt - now) : 0;
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);

  return (
    <div className="mx-auto max-w-xl px-4 pt-6 pb-36 space-y-4">
      <StatusHero b={b} timer={b.status === 'held' ? `${mm}:${String(ss).padStart(2, '0')}` : ''} />
      <Summary b={b} />

      {(b.status === 'held' || b.status === 'expired' || b.status === 'reserved') && (
        <>
          {inApp && b.upi && <InAppNotice which={inApp} os={os} />}
          {b.razorpay && <RazorpayButton b={b} onDone={setB} />}
          {b.upi && <UpiPanel b={b} os={os} />}
          {!b.upi && !b.razorpay && (
            <div className="rounded-3xl border border-amber/40 bg-amber/10 p-4 text-sm">Online payment isn&apos;t set up yet. Please pay at the desk or call {b.academy.phone || 'us'}; your slots are held for now.</div>
          )}
          {b.upi && <UtrForm b={b} onDone={setB} />}
        </>
      )}

      {!b.phoneBooking && (b.status === 'submitted' || b.status === 'confirmed' || b.status === 'held') && b.whatsappConfirm && <WhatsAppBlock b={b} />}

      {['confirmed', 'reserved', 'submitted'].includes(b.status) && <ConfirmedActions b={b} />}

      {(b.status === 'expired' || b.status === 'cancelled') && (
        <Link href="/" className="btn-lime block text-center rounded-2xl py-4 font-bold">Book again</Link>
      )}
    </div>
  );
}

function StatusHero({ b, timer }: { b: PublicBooking; timer: string }) {
  const map = {
    held: { title: 'Pay to confirm', sub: 'Your court is held for you', tone: 'text-lime', icon: Zap },
    submitted: { title: b.phoneBooking ? 'Court booked' : 'Payment received', sub: b.phoneBooking ? 'Payment received — being verified' : 'We are verifying it — confirmation comes on WhatsApp', tone: 'text-cyan', icon: b.phoneBooking ? CheckCircle2 : Loader2 },
    reserved: { title: 'Court booked', sub: 'Payment due — pay at the venue, or right here now', tone: 'text-cyan', icon: CalendarDays },
    confirmed: { title: "You're on court!", sub: 'Booking confirmed', tone: 'text-ok', icon: CheckCircle2 },
    expired: { title: 'Hold expired', sub: 'Already paid? Enter your UPI reference below and we will restore it', tone: 'text-amber', icon: TriangleAlert },
    cancelled: { title: 'Cancelled', sub: b.cancelReason || 'This booking was cancelled', tone: 'text-bad', icon: TriangleAlert },
  } as const;
  const s = map[b.status];
  const Icon = s.icon;
  return (
    <section className="rise relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-panel to-night p-5">
      {b.status === 'confirmed' && <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-ok/20 blur-2xl" aria-hidden="true" />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`flex items-center gap-2 ${s.tone}`}>
            <Icon className={`w-5 h-5 ${b.status === 'submitted' && !b.phoneBooking ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-wider">{b.ref}</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold mt-2">{s.title}</h1>
          <p className="text-sm text-soft mt-1">{s.sub}</p>
        </div>
        {timer && (
          <div className="shrink-0 text-center rounded-2xl border border-lime/40 bg-lime/10 px-3 py-2" aria-live="polite">
            <div className="font-display text-xl font-bold text-lime tabular-nums">{timer}</div>
            <div className="text-[10px] text-muted uppercase">left</div>
          </div>
        )}
      </div>
    </section>
  );
}

function Summary({ b }: { b: PublicBooking }) {
  return (
    <section className="rounded-3xl border border-line bg-panel/70 p-5">
      <div className="text-sm text-soft">{b.dateLabel}</div>
      <ul className="mt-2 space-y-1.5">
        {b.slots.map((s) => (
          <li key={`${s.court}${s.start}`} className="flex justify-between text-sm">
            <span className="font-medium">{s.court} · {fmtTime(s.start)}–{fmtTime(s.end)}</span>
            <span className="text-soft">{rupees(s.price)}</span>
          </li>
        ))}
      </ul>
      {b.amount !== b.base && <div className="mt-2 flex justify-between text-xs text-muted"><span>GST</span><span>{rupees(b.amount - b.base)}</span></div>}
      <div className="mt-3 pt-3 border-t border-line flex items-end justify-between">
        <span className="text-sm text-soft">{b.name}</span>
        <span className="font-display text-2xl font-extrabold">{b.amountLabel}</span>
      </div>
      {b.status !== 'cancelled' && b.status !== 'expired' && (
        <div className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold text-center ${b.payState === 'paid' ? 'bg-ok/15 text-ok' : b.payState === 'verifying' ? 'bg-violet/20 text-[#b39dff]' : 'bg-amber/15 text-amber'}`}>
          {b.payState === 'paid' ? 'Paid ✓' : b.payState === 'verifying' ? 'Paid · being verified' : `Payment due: ${b.amountLabel}`}
        </div>
      )}
    </section>
  );
}

function InAppNotice({ which, os }: { which: 'instagram' | 'facebook'; os: string }) {
  const url = typeof location !== 'undefined' ? location.href : '';
  const chrome = os === 'android' && url ? `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end` : '';
  return (
    <div className="rounded-3xl border border-pink/40 bg-pink/10 p-4 text-sm space-y-2">
      <p className="font-semibold">You&apos;re in {which === 'instagram' ? 'Instagram' : 'Facebook'}&apos;s browser</p>
      <p className="text-soft">If your UPI app doesn&apos;t open, {os === 'ios' ? 'tap ••• at the top right → “Open in external browser”' : 'open this page in Chrome'}, or scan the QR / copy the UPI ID below. Your booking is saved either way.</p>
      {chrome && <a href={chrome} className="inline-flex items-center gap-1.5 font-semibold text-pink"><ExternalLink className="w-4 h-4" /> Open in Chrome</a>}
    </div>
  );
}

function RazorpayButton({ b, onDone }: { b: PublicBooking; onDone: (b: PublicBooking) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://checkout.razorpay.com/v1/checkout.js';
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('Could not load the payment window. Please use UPI below.'));
          document.head.appendChild(s);
        });
      }
      const r = await api<{ order: { orderId: string; keyId: string; amount: number } }>(`/api/public/bookings/${b.token}`, { body: { action: 'rz_order' } });
      const rz = new window.Razorpay!({
        key: r.order.keyId,
        order_id: r.order.orderId,
        amount: r.order.amount,
        currency: 'INR',
        name: b.academy.name,
        description: `Court booking ${b.ref}`,
        prefill: { name: b.name },
        theme: { color: '#7c4dff' },
        config: { display: { preferences: { show_default_blocks: true } } },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            const done = await api<{ booking: PublicBooking }>(`/api/public/bookings/${b.token}`, { body: { action: 'rz_paid', orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature } });
            onDone(done.booking);
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'Verification failed; we will confirm automatically.');
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rz.on('payment.failed', () => setErr('Payment failed. Please try again or pay by UPI below.'));
      rz.open();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start payment.');
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2">
      <button onClick={go} disabled={busy} className="btn-lime w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />} Pay {b.amountLabel} instantly
      </button>
      <p className="text-center text-xs text-muted flex items-center justify-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> UPI apps, QR or card · auto-confirmed</p>
      {err && <p role="alert" className="text-sm text-bad text-center">{err}</p>}
    </section>
  );
}

function UpiPanel({ b, os }: { b: PublicBooking; os: 'android' | 'ios' | 'desktop' }) {
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (b.upi) QRCode.toDataURL(b.upi, { margin: 1, width: 560, color: { dark: '#06070d', light: '#ffffff' } }).then(setQr).catch(() => {});
  }, [b.upi]);
  useEffect(() => setShowQr(os === 'desktop'), [os]);
  if (!b.upi) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b.upiVpa);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };
  return (
    <section className="rounded-3xl border border-line bg-panel/70 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold">{b.razorpay ? 'Or pay with UPI directly' : 'Pay with UPI'}</h2>
        <span className="text-[11px] text-muted">0% fee</span>
      </div>
      {os !== 'desktop' && (
        <>
          <a href={b.upi} className="flex items-center justify-center gap-2 w-full rounded-2xl py-4 font-bold bg-gradient-to-r from-violet to-cyan text-ink">
            <Smartphone className="w-5 h-5" /> Open UPI app · {b.amountLabel}
          </a>
          <div className="grid grid-cols-4 gap-2">
            {APPS.map((app) => (
              <a key={app.key} href={appLink(b.upi!, app, os)} className="group flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-night/60 py-3 hover:border-cyan">
                <span className={`w-9 h-9 rounded-xl bg-gradient-to-br ${app.color} grid place-items-center text-white text-xs font-black`}>{app.name[0]}</span>
                <span className="text-[11px] text-soft font-semibold">{app.name}</span>
              </a>
            ))}
          </div>
          <button onClick={() => setShowQr((v) => !v)} className="w-full flex items-center justify-center gap-2 text-sm text-cyan font-semibold py-1">
            <QrCode className="w-4 h-4" /> {showQr ? 'Hide QR code' : 'Show QR to scan from another phone'}
          </button>
        </>
      )}
      {showQr && qr && (
        <div className="mx-auto w-full max-w-[17rem] rounded-3xl bg-white p-3 shadow-[0_0_60px_-10px] shadow-cyan/50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`UPI QR code to pay ${b.amountLabel} to ${b.upiPayee}`} className="w-full h-auto" />
          <p className="text-center text-[11px] text-slate-600 font-semibold pt-1">Scan with any UPI app · {b.amountLabel}</p>
        </div>
      )}
      <div className="flex items-center gap-2 rounded-2xl bg-night/70 border border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-muted">UPI ID · {b.upiPayee}</div>
          <div className="font-mono text-sm truncate">{b.upiVpa}</div>
        </div>
        <button onClick={copy} className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-cyan px-2 py-1.5 rounded-xl hover:bg-panel-2">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </section>
  );
}

function UtrForm({ b, onDone }: { b: PublicBooking; onDone: (b: PublicBooking) => void }) {
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ booking: PublicBooking }>(`/api/public/bookings/${b.token}`, { body: { action: 'utr', utr } });
      onDone(r.booking);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="rounded-3xl border border-lime/30 bg-lime/[0.06] p-5 space-y-3">
      <h2 className="font-display text-base font-bold">Paid? Enter the UPI reference</h2>
      <p className="text-xs text-soft">The 12-digit number in your UPI app after paying — Google Pay: “UPI transaction ID”, PhonePe: “UTR”, Paytm: “UPI Ref No.”</p>
      <input className={`${inputCls} font-mono tracking-widest text-center text-lg`} inputMode="numeric" value={utr} onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="123456789012" aria-label="12-digit UPI reference number" required pattern="\d{12}" />
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <button disabled={busy || utr.length !== 12} className="btn-lime w-full rounded-2xl py-3.5 font-bold flex items-center justify-center gap-2">
        {busy && <Loader2 className="w-5 h-5 animate-spin" />} I&apos;ve paid — confirm my booking
      </button>
    </form>
  );
}

function WhatsAppBlock({ b }: { b: PublicBooking }) {
  const tap = () => void api(`/api/public/bookings/${b.token}`, { body: { action: 'wa_opened' } }).catch(() => {});
  if (b.status === 'confirmed' && b.waAuto) {
    return <p className="flex items-center justify-center gap-2 rounded-2xl border border-ok/30 bg-ok/10 py-3 text-sm font-semibold text-ok"><WhatsAppIcon className="w-4 h-4" /> Confirmation sent to your WhatsApp ••{b.phoneLast4}</p>;
  }
  return (
    <section className="rounded-3xl border border-ok/30 bg-ok/[0.07] p-5 space-y-3">
      <h2 className="font-display text-base font-bold flex items-center gap-2"><WhatsAppIcon className="w-5 h-5 text-ok" /> {b.status === 'confirmed' ? 'Get it on WhatsApp' : 'Confirm on WhatsApp'}</h2>
      <p className="text-xs text-soft">
        {b.status === 'confirmed'
          ? 'Tap to message us — we reply with your confirmation and invoice link on WhatsApp.'
          : 'Tap and press Send. It tells us this number is yours, and we send your confirmation back on WhatsApp the moment payment is verified.'}
      </p>
      <a href={b.whatsappConfirm!} onClick={tap} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full rounded-2xl py-3.5 font-bold bg-[#25D366] text-ink">
        <WhatsAppIcon className="w-5 h-5" /> Open WhatsApp
      </a>
    </section>
  );
}

function ConfirmedActions({ b }: { b: PublicBooking }) {
  const first = b.slots[0];
  const stamp = (min: number) => `${b.date.replace(/-/g, '')}T${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;
  const gcal = first
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Badminton · ${b.academy.name}`)}&dates=${stamp(Math.min(...b.slots.map((s) => s.start)))}/${stamp(Math.max(...b.slots.map((s) => s.end)))}&ctz=Asia/Kolkata&details=${encodeURIComponent(`${b.ref}: ${b.slotsLabel}`)}&location=${encodeURIComponent(b.academy.address)}`
    : '';
  return (
    <section className="grid grid-cols-2 gap-2">
      {b.invoice && (
        <a href={`/invoice/${b.invoice.token}`} target="_blank" rel="noopener" className="col-span-2 flex items-center justify-center gap-2 rounded-2xl border border-line bg-panel py-3.5 font-semibold">
          <FileText className="w-5 h-5 text-cyan" /> Invoice {b.invoice.number}
        </a>
      )}
      {gcal && (
        <a href={gcal} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-panel py-3 text-sm font-semibold">
          <CalendarDays className="w-4 h-4 text-lime" /> Add to calendar
        </a>
      )}
      {b.academy.mapUrl && (
        <a href={b.academy.mapUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-panel py-3 text-sm font-semibold">
          <MapPin className="w-4 h-4 text-pink" /> Directions
        </a>
      )}
    </section>
  );
}
