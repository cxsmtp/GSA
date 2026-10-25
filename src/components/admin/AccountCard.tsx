'use client';

import { useState } from 'react';
import { Field, inputCls } from '@/components/ui/Field';
import { Btn, Card, staff, useAction, useMe } from './ui';

/** Change password and turn on 2-step sign-in (authenticator app). For every staff user. */
export function AccountCard({ passwordOnly = false, onSignedOut }: { passwordOnly?: boolean; onSignedOut: () => void }) {
  const me = useMe();
  const { busy, run } = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [totpOn, setTotpOn] = useState(me.totp);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return void run(async () => { throw new Error('The two new passwords differ.'); });
    const r = await run(() => staff('password', 'POST', { current, next }), 'Password changed. Please sign in again.');
    if (r) setTimeout(onSignedOut, 900);
  };

  return (
    <div className="space-y-4">
      <Card title="Password">
        <form onSubmit={change} className="space-y-3">
          <Field label="Current password"><input type="password" className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></Field>
          <Field label="New password" hint="At least 10 characters. A short sentence works well."><input type="password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={10} /></Field>
          <Field label="New password again"><input type="password" className={inputCls} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required /></Field>
          <Btn tone="lime" busy={busy} className="w-full">Change password</Btn>
        </form>
      </Card>
      {!passwordOnly && (
        <Card title="2-step sign-in">
          {totpOn ? (
            <div className="space-y-3">
              <p className="text-sm text-ok">On: signing in also needs the 6-digit code from your authenticator app.</p>
              <input type="password" className={inputCls} placeholder="Your password to turn it off" value={pw} onChange={(e) => setPw(e.target.value)} />
              <Btn tone="bad" busy={busy} onClick={async () => (await run(() => staff('totp/disable', 'POST', { password: pw }), '2-step sign-in turned off')) && setTotpOn(false)}>Turn off</Btn>
            </div>
          ) : setup ? (
            <div className="space-y-3">
              <p className="text-sm text-soft">Scan with Google Authenticator / Microsoft Authenticator, then type the 6-digit code it shows.</p>
              <div className="mx-auto w-48 rounded-2xl bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qr }} />
              <p className="text-center font-mono text-xs text-muted break-all">{setup.secret}</p>
              <input className={`${inputCls} text-center font-mono tracking-[0.4em]`} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
              <Btn tone="lime" busy={busy} className="w-full" onClick={async () => (await run(() => staff('totp/enable', 'POST', { secret: setup.secret, code }), '2-step sign-in is on')) && (setTotpOn(true), setSetup(null))}>Turn on</Btn>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-soft">Recommended for the admin: even with your password, nobody can sign in without your phone.</p>
              <Btn tone="ghost" busy={busy} onClick={async () => { const r = await run(() => staff<{ secret: string; qr: string }>('totp/setup', 'POST')); if (r) setSetup(r); }}>Set up</Btn>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
