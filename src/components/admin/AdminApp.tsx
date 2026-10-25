'use client';

import { Banknote, CalendarDays, ClipboardList, Info, KeyRound, LayoutDashboard, Loader2, LogOut, Menu, PiggyBank, Settings, ShieldCheck } from 'lucide-react';
import { can, ROLE_LABEL, type Permission } from '@/lib/shared/rbac';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { LogoMark } from '@/components/ui/BrandIcons';
import { Field, inputCls } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { AboutTab } from './AboutTab';
import { AccountCard } from './AccountCard';
import { BookingsTab } from './BookingsTab';
import { CashTab } from './CashTab';
import { MoneyTab } from './MoneyTab';
import { ScheduleTab } from './ScheduleTab';
import { SettingsTab } from './SettingsTab';
import { TodayTab } from './TodayTab';
import { MeContext, ToastHost, useMe, type Me } from './ui';

type Tab = 'today' | 'bookings' | 'money' | 'cash' | 'schedule' | 'about' | 'settings' | 'account';

/** Each section shows only for roles with its permission (src/lib/shared/rbac.ts). */
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard; perm: Permission; hideWith?: Permission }[] = [
  { key: 'today', label: 'Today', icon: LayoutDashboard, perm: 'bookings.view' },
  { key: 'bookings', label: 'Bookings', icon: ClipboardList, perm: 'bookings.view' },
  { key: 'money', label: 'Money', icon: PiggyBank, perm: 'money' },
  // The admin sees cash inside Money; managers get it as their own section.
  { key: 'cash', label: 'Cash', icon: Banknote, perm: 'cash.collect', hideWith: 'money' },
  { key: 'schedule', label: 'Spaces', icon: CalendarDays, perm: 'schedule.manage' },
  { key: 'about', label: 'About page', icon: Info, perm: 'about.manage' },
  { key: 'settings', label: 'Settings', icon: Settings, perm: 'settings' },
  { key: 'account', label: 'My account', icon: KeyRound, perm: 'account' },
];

export function AdminApp() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      const r = await api<{ user: Me | null }>('/api/auth/me');
      setMe(r.user);
    } catch {
      setMe(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (me === undefined) return <div className="min-h-dvh grid place-items-center"><Loader2 className="w-7 h-7 animate-spin text-muted" /></div>;
  if (!me) return <Login onDone={load} />;
  return (
    <ToastHost>
      <MeContext.Provider value={me}>{me.mustChange ? <FirstPassword onDone={() => setMe(null)} /> : <Shell onSignOut={() => setMe(null)} />}</MeContext.Provider>
    </ToastHost>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, code: code || undefined }), credentials: 'same-origin' });
      const data = await res.json();
      if (data.needCode) setNeedCode(true);
      else if (!res.ok || !data.ok) setErr(data.message || 'Could not sign in.');
      else onDone();
    } catch {
      setErr('No connection.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rise space-y-4 rounded-3xl border border-line bg-panel/80 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-2xl bg-gradient-to-br from-violet to-cyan"><LogoMark className="w-7 h-7 text-ink" /></span>
          <div>
            <h1 className="font-display font-bold">Staff sign-in</h1>
            <p className="text-xs text-muted">Admin & manager</p>
          </div>
        </div>
        <Field label="Username" htmlFor="u"><input id="u" className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required /></Field>
        <Field label="Password" htmlFor="p"><input id="p" type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
        {needCode && (
          <Field label="6-digit code from your authenticator app" htmlFor="c">
            <input id="c" className={`${inputCls} font-mono tracking-[0.4em] text-center`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus required />
          </Field>
        )}
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button disabled={busy} className="btn-lime w-full rounded-2xl py-3.5 font-bold flex items-center justify-center gap-2">{busy && <Loader2 className="w-5 h-5 animate-spin" />} Sign in</button>
        <p className="text-[11px] text-muted flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Protected: repeated wrong passwords pause sign-in.</p>
      </form>
    </main>
  );
}

function FirstPassword({ onDone }: { onDone: () => void }) {
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-sm rise space-y-3">
        <h1 className="font-display text-xl font-bold">Choose your own password</h1>
        <p className="text-sm text-soft">You signed in with a one-time password. Pick a new one (10+ characters) to continue; you will sign in again with it.</p>
        <AccountCard passwordOnly onSignedOut={onDone} />
      </div>
    </main>
  );
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('today');
  const [more, setMore] = useState(false);
  const tabs = TABS.filter((t) => can(me.role, t.perm) && !(t.hideWith && can(me.role, t.hideWith)));
  const allowed = (t: Tab) => tabs.some((x) => x.key === t);
  const primary = tabs.slice(0, 4);
  const rest = tabs.slice(4);

  useEffect(() => {
    const h = location.hash.slice(1) as Tab;
    if (tabs.some((t) => t.key === h)) setTab(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    setMore(false);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo({ top: 0 });
  };
  const signOut = async () => {
    await api('/api/auth/logout', { body: {} }).catch(() => {});
    onSignOut();
  };

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 border-r border-line bg-night/60 p-4 gap-1 sticky top-0 h-dvh">
        <div className="flex items-center gap-2 px-2 pb-5">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-violet to-cyan"><LogoMark className="w-6 h-6 text-ink" /></span>
          <div className="min-w-0"><div className="font-display text-sm font-bold">GSA Desk</div><div className="text-[11px] text-muted truncate">{me.name} · {ROLE_LABEL[me.role]}</div></div>
        </div>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => go(t.key)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${tab === t.key ? 'bg-lime text-ink' : 'text-soft hover:bg-panel-2'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
        <button onClick={signOut} className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted hover:text-bad"><LogOut className="w-4 h-4" /> Sign out</button>
        <div className="px-3 text-[10px] text-muted">v{process.env.NEXT_PUBLIC_APP_VERSION}</div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="lg:hidden sticky top-0 z-30 glass border-x-0 border-t-0 flex items-center gap-2 px-4 h-14">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-violet to-cyan"><LogoMark className="w-5 h-5 text-ink" /></span>
          <span className="font-display text-sm font-bold">{TABS.find((t) => t.key === tab)?.label}</span>
          <span className="ml-auto text-[11px] text-muted">{me.name} · {ROLE_LABEL[me.role]}</span>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-5 pb-32 lg:pb-10">
          {tab === 'today' && <TodayTab go={go} />}
          {tab === 'bookings' && <BookingsTab />}
          {tab === 'money' && allowed('money') && <MoneyTab />}
          {tab === 'cash' && allowed('cash') && <CashTab />}
          {tab === 'schedule' && allowed('schedule') && <ScheduleTab />}
          {tab === 'about' && allowed('about') && <AboutTab />}
          {tab === 'settings' && allowed('settings') && <SettingsTab />}
          {tab === 'account' && <AccountCard onSignedOut={onSignOut} />}
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass rounded-t-3xl flex justify-around px-1 pt-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))]" aria-label="Sections">
        {primary.map((t) => (
          <button key={t.key} onClick={() => go(t.key)} aria-current={tab === t.key ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 text-[11px] font-semibold ${tab === t.key ? 'text-lime' : 'text-muted'}`}>
            <t.icon className="w-5 h-5" /> {t.label}
          </button>
        ))}
        <button onClick={() => setMore(true)} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 text-[11px] font-semibold ${rest.some((t) => t.key === tab) ? 'text-lime' : 'text-muted'}`}>
          <Menu className="w-5 h-5" /> More
        </button>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="space-y-1">
          {rest.map((t) => (
            <button key={t.key} onClick={() => go(t.key)} className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-semibold hover:bg-panel-2">
              <t.icon className="w-5 h-5 text-cyan" /> {t.label}
            </button>
          ))}
          <button onClick={signOut} className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-semibold text-bad hover:bg-bad/10"><LogOut className="w-5 h-5" /> Sign out</button>
          <p className="pt-2 text-center text-[11px] text-muted">Version {process.env.NEXT_PUBLIC_APP_VERSION}</p>
        </div>
      </Sheet>
    </div>
  );
}

