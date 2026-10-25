'use client';

import { Copy, Download, Plus, ShieldAlert, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { STATES } from '@/lib/shared/gst';
import { can, PERMISSIONS, ROLE_LABEL, ROLES, type Permission, type Role } from '@/lib/shared/rbac';
import { fmtStamp } from '@/lib/shared/time';
import { InstagramIcon } from '@/components/ui/BrandIcons';
import { Field, inputCls } from '@/components/ui/Field';
import { Btn, Card, Segmented, Spinner, staff, useAction, useStaff, useToast } from './ui';

type Sub = 'business' | 'payments' | 'gst' | 'instagram' | 'team' | 'security';

interface S {
  business: Record<string, string>;
  booking: { upiEnabled: boolean; razorpayEnabled: boolean };
  gst: { mode: string; gstin: string; legalName: string; ratePct: number; sac: string; pricesIncludeGst: boolean; invoicePrefix: string; thresholdPaise: number; terms: string };
  integrations: { razorpay: boolean; razorpayWebhook: boolean; whatsappApi: boolean };
}

export function SettingsTab() {
  const [sub, setSub] = useState<Sub>('business');
  const { data, loading, reload } = useStaff<S>('settings');
  return (
    <div className="space-y-4">
      <Segmented value={sub} onChange={setSub} options={[
        { value: 'business', label: 'Business' }, { value: 'payments', label: 'Payments & WhatsApp' }, { value: 'gst', label: 'GST & bills' },
        { value: 'instagram', label: 'Instagram & links' }, { value: 'team', label: 'Team' }, { value: 'security', label: 'Audit & backup' },
      ]} />
      {loading && !data ? <Spinner /> : data && (
        <>
          {sub === 'business' && <BusinessForm a={data.business} reload={reload} />}
          {sub === 'payments' && <Payments s={data} reload={reload} />}
          {sub === 'gst' && <GstForm g={data.gst} reload={reload} />}
          {sub === 'instagram' && <InstagramKit handle={data.business.instagram} />}
          {sub === 'team' && <Team />}
          {sub === 'security' && <AuditBackup />}
        </>
      )}
    </div>
  );
}

function BusinessForm({ a, reload }: { a: Record<string, string>; reload: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState(a);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const fields: [string, string, string?][] = [
    ['name', 'Business name'], ['tagline', 'Tagline'], ['address', 'Address'], ['city', 'City'], ['pincode', 'PIN code'],
    ['phone', 'Phone (shown on site & invoices)'], ['whatsapp', 'WhatsApp number (receives player confirmations)', '10-digit mobile'], ['email', 'Email'],
    ['mapUrl', 'Google Maps link', 'https://maps.app.goo.gl/…'], ['instagram', 'Instagram username', 'yourbusiness'], ['messageNote', 'Last line of WhatsApp confirmations', 'e.g. arrival instructions'],
  ];
  return (
    <Card title="Business profile">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => staff('settings/business', 'PUT', f), 'Saved')) reload(); }}>
        <div className="grid sm:grid-cols-2 gap-3">
          {fields.map(([k, label, ph]) => <Field key={k} label={label}><input className={inputCls} value={f[k] ?? ''} onChange={set(k)} placeholder={ph} /></Field>)}
          <Field label="State"><select className={inputCls} value={f.stateCode} onChange={set('stateCode')}><option value="">Choose state…</option>{Object.entries(STATES).map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></Field>
        </div>
        <Btn tone="lime" busy={busy} className="w-full">Save profile</Btn>
      </form>
    </Card>
  );
}

function Status({ on, label }: { on: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${on ? 'text-ok' : 'text-muted'}`}>{on ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />} {label}: {on ? 'connected' : 'not set up'}</div>
  );
}

function Payments({ s, reload }: { s: S; reload: () => void }) {
  const { busy, run } = useAction();
  const [vpa, setVpa] = useState(s.business.upiVpa ?? '');
  const [payee, setPayee] = useState(s.business.upiPayee ?? '');
  return (
    <div className="space-y-4">
      <Card title="UPI (direct, 0% fee)">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => staff('settings/business', 'PUT', { upiVpa: vpa, upiPayee: payee }), 'UPI saved')) reload(); }}>
          <Field label="UPI ID" hint="Use a business/merchant UPI ID (from your bank, PhonePe Business, Paytm Business or GPay for Business): personal IDs may be limited by apps."><input className={inputCls} value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="gsasports@okhdfcbank" /></Field>
          <Field label="Name shown in the UPI app"><input className={inputCls} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Business name" /></Field>
          <Btn tone="lime" busy={busy}>Save UPI</Btn>
        </form>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-lime w-5 h-5" checked={s.booking.upiEnabled} onChange={(e) => run(() => staff('settings/booking', 'PUT', { upiEnabled: e.target.checked }), 'Saved').then(reload)} /> Offer UPI / QR on the pay page</label>
      </Card>
      <Card title="Razorpay (automatic confirmation)">
        <Status on={s.integrations.razorpay} label="Keys" />
        <Status on={s.integrations.razorpayWebhook} label="Webhook" />
        <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-lime w-5 h-5" disabled={!s.integrations.razorpay} checked={s.booking.razorpayEnabled} onChange={(e) => run(() => staff('settings/booking', 'PUT', { razorpayEnabled: e.target.checked }), 'Saved').then(reload)} /> Show “Pay instantly”</label>
        <p className="text-[11px] text-muted mt-2">Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on the server (never here — secrets stay out of the database). Webhook URL: <code>/api/webhooks/razorpay</code>, events payment.captured & order.paid.</p>
      </Card>
      <Card title="WhatsApp confirmations">
        <Status on={s.integrations.whatsappApi} label="Automatic (WhatsApp Cloud API)" />
        <p className="text-sm text-soft mt-2">{s.integrations.whatsappApi ? 'Confirmed bookings are messaged automatically from your business number.' : 'Free mode: after you verify a payment, one tap opens your WhatsApp with the confirmation to the player already typed.'}</p>
        <p className="text-[11px] text-muted mt-2">To automate: set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and an approved template (WHATSAPP_TEMPLATE) on the server — see the deployment guide.</p>
      </Card>
    </div>
  );
}

function GstForm({ g, reload }: { g: S['gst']; reload: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ ...g, ratePct: String(g.ratePct), threshold: String(g.thresholdPaise / 100) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="GST & bill book">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => staff('settings/gst', 'PUT', { mode: f.mode, gstin: f.gstin, legalName: f.legalName, ratePct: Number(f.ratePct), sac: f.sac, pricesIncludeGst: f.pricesIncludeGst, invoicePrefix: f.invoicePrefix, thresholdPaise: Math.round(Number(f.threshold) * 100), terms: f.terms }), 'GST settings saved')) reload();
      }}>
        <Field label="GST registration" hint="India uses GST (VAT was replaced in 2017). Not registered → plain receipts. Regular → Tax Invoices with CGST + SGST. Composition → Bills of Supply.">
          <select className={inputCls} value={f.mode} onChange={set('mode')}>
            <option value="none">Not registered (receipts, no GST)</option>
            <option value="regular">Registered — regular (Tax Invoice)</option>
            <option value="composition">Registered — composition (Bill of Supply)</option>
          </select>
        </Field>
        {f.mode !== 'none' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="GSTIN"><input className={`${inputCls} uppercase`} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} placeholder="08XXXXX0000X1Z0" /></Field>
            <Field label="Legal name (as on GST certificate)"><input className={inputCls} value={f.legalName} onChange={set('legalName')} /></Field>
          </div>
        )}
        {f.mode === 'regular' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="GST rate"><select className={inputCls} value={f.ratePct} onChange={set('ratePct')}>{['0', '5', '12', '18', '28'].map((r) => <option key={r} value={r}>{r}%</option>)}</select></Field>
            <Field label="SAC code" hint="Ask your CA for the service code"><input className={inputCls} value={f.sac} onChange={set('sac')} /></Field>
            <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-lime w-5 h-5" checked={f.pricesIncludeGst} onChange={(e) => setF({ ...f, pricesIncludeGst: e.target.checked })} /> Space prices already include GST</label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice prefix" hint="Numbers: PREFIX/26-27/0001"><input className={`${inputCls} uppercase`} value={f.invoicePrefix} onChange={set('invoicePrefix')} maxLength={6} /></Field>
          <Field label="Registration limit ₹" hint="Warns as receipts approach it"><input className={inputCls} value={f.threshold} onChange={set('threshold')} inputMode="numeric" /></Field>
        </div>
        <Field label="Terms printed on bills"><textarea className={`${inputCls} min-h-20`} value={f.terms} onChange={set('terms')} maxLength={500} /></Field>
        <Btn tone="lime" busy={busy} className="w-full">Save</Btn>
        <p className="text-[11px] text-muted">Confirm the rate and SAC with your CA. Invoices keep the details they were issued with.</p>
      </form>
    </Card>
  );
}

function InstagramKit({ handle }: { handle: string }) {
  const toast = useToast();
  const [origin, setOrigin] = useState('');
  const [tomorrow, setTomorrow] = useState('');
  const [poster, setPoster] = useState('');
  useEffect(() => {
    setOrigin(location.origin);
    setTomorrow(new Date(Date.now() + 86400000 + 19800000).toISOString().slice(0, 10));
    QRCode.toDataURL(`${location.origin}/?src=qr`, { width: 900, margin: 2 }).then(setPoster).catch(() => {});
  }, []);
  const links = [
    { label: 'Instagram bio / “Book now” button', url: `${origin}/?src=instagram` },
    { label: 'Instagram Story link sticker', url: `${origin}/?src=ig_story` },
    { label: 'Tomorrow (Story: “Spaces open tomorrow”)', url: `${origin}/?src=ig_story&date=${tomorrow}` },
    { label: 'WhatsApp status / groups', url: `${origin}/?src=whatsapp` },
    { label: 'Google Business profile', url: `${origin}/?src=google` },
  ];
  return (
    <div className="space-y-4">
      <Card title={<span className="flex items-center gap-2"><InstagramIcon className="w-4 h-4 text-pink" /> Bookings from Instagram</span>}>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-soft">
          <li>Instagram → Edit profile → <b>Action buttons</b> → Book now / Reserve → Add link → paste the first link. (Or put it in <b>Links</b> on your bio.)</li>
          <li>In Stories add a <b>Link</b> sticker with the Story link.</li>
          <li>Add your Instagram username in Business so players can DM you, and every booking from Instagram is counted (Money → Funds → Bookings by channel).</li>
          <li>Instagram&apos;s own browser opens the booking page; for payment the page offers UPI app buttons, the QR and “Open in browser” when needed.</li>
        </ol>
        {!handle && <p className="mt-2 text-xs text-amber">Instagram username not set yet (Business tab).</p>}
      </Card>
      <Card title="Share links">
        <ul className="space-y-2">
          {links.map((l) => (
            <li key={l.label} className="rounded-2xl border border-line p-3">
              <div className="text-xs text-muted">{l.label}</div>
              <div className="flex items-center gap-2"><code className="flex-1 truncate text-sm">{l.url}</code><button onClick={() => navigator.clipboard.writeText(l.url).then(() => toast('Copied'))} className="p-1.5 text-cyan" aria-label="Copy"><Copy className="w-4 h-4" /></button></div>
            </li>
          ))}
        </ul>
      </Card>
      {poster && (
        <Card title="QR poster for the counter & spaces">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={poster} alt="QR code to the booking page" className="w-48 mx-auto rounded-2xl bg-white p-2" />
          <a href={poster} download="gsa-booking-qr.png" className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold text-cyan"><Download className="w-4 h-4" /> Download QR (PNG)</a>
        </Card>
      )}
    </div>
  );
}

interface User { id: number; username: string; name: string; role: Role; active: number; must_change: number; totp: number; last_login_at: string | null; reports_to: number | null }

function Team() {
  const { data, loading, reload } = useStaff<{ users: User[] }>('users');
  const { busy, run } = useAction();
  const [f, setF] = useState({ username: '', name: '', role: 'assistant' as Role, reportsTo: '' });
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const users = data?.users ?? [];
  const heads = users.filter((u) => u.active && u.role !== 'assistant');
  const nameOf = (id: number | null) => users.find((u) => u.id === id)?.name;
  return (
    <div className="space-y-4">
      <Card title="Add a user">
        <form className="grid grid-cols-2 gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => staff<{ username: string; password: string }>('users', 'POST', { ...f, reportsTo: f.role === 'assistant' && f.reportsTo ? Number(f.reportsTo) : undefined }), 'User added');
          if (r) { setSecret(r); setF({ username: '', name: '', role: 'assistant', reportsTo: '' }); void reload(); }
        }}>
          <input className={inputCls} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <input className={inputCls} placeholder="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} required autoCapitalize="none" />
          <select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })} aria-label="Role">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          {f.role === 'assistant' ? (
            <select className={inputCls} value={f.reportsTo} onChange={(e) => setF({ ...f, reportsTo: e.target.value })} aria-label="Reports to" required>
              <option value="">Reports to…</option>
              {heads.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role]})</option>)}
            </select>
          ) : <span />}
          <Btn tone="lime" busy={busy} className="col-span-2"><Plus className="w-4 h-4" /> Add {ROLE_LABEL[f.role].toLowerCase()}</Btn>
        </form>
        {secret && (
          <div className="mt-3 rounded-2xl border border-lime/40 bg-lime/10 p-3 text-sm">
            Give <b>{secret.username}</b> this one-time password (shown once): <code className="font-mono text-lime select-all">{secret.password}</code>. They choose their own at first sign-in at <code>/admin</code>.
          </div>
        )}
        <p className="text-[11px] text-muted mt-2">A assistant&apos;s cash goes on the name of the manager they report to.</p>
      </Card>

      {loading && !data ? <Spinner /> : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="rounded-2xl border border-line bg-panel/70 p-3 space-y-2">
              <div>
                <div className="font-semibold">{u.name} <span className="text-xs text-muted">@{u.username}</span></div>
                <div className="text-xs text-soft">{ROLE_LABEL[u.role]}{u.role === 'assistant' ? ` · reports to ${nameOf(u.reports_to) ?? '— not set'}` : ''}{u.totp ? ' · 2-step on' : ''}{u.active ? '' : ' · deactivated'}{u.must_change ? ' · first sign-in pending' : ''}{u.last_login_at ? ` · last in ${fmtStamp(u.last_login_at)}` : ''}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className={`${inputCls} py-2 text-sm`} value={u.role} aria-label="Role" onChange={(e) => run(() => staff(`users/${u.id}`, 'PATCH', { role: e.target.value }), 'Role changed — they sign in again').then(reload)}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                {u.role === 'assistant' && (
                  <select className={`${inputCls} py-2 text-sm`} value={u.reports_to ?? ''} aria-label="Reports to" onChange={(e) => run(() => staff(`users/${u.id}`, 'PATCH', { reportsTo: e.target.value ? Number(e.target.value) : null }), 'Saved').then(reload)}>
                    <option value="">Reports to…</option>
                    {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn busy={busy} onClick={async () => { const r = await run(() => staff<{ password: string }>(`users/${u.id}`, 'PATCH', { resetPassword: true }), 'Password reset'); if (r?.password) setSecret({ username: u.username, password: r.password }); }}>Reset password</Btn>
                {u.totp ? <Btn busy={busy} onClick={() => run(() => staff(`users/${u.id}`, 'PATCH', { resetTotp: true }), '2-step reset').then(reload)}>Reset 2-step</Btn> : null}
                <Btn tone={u.active ? 'bad' : 'ok'} busy={busy} onClick={() => run(() => staff(`users/${u.id}`, 'PATCH', { active: !u.active }), u.active ? 'Deactivated — signed out' : 'Activated').then(reload)}>{u.active ? 'Deactivate' : 'Activate'}</Btn>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Card title="What each role can do">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-muted"><th className="text-left py-1.5 font-semibold">Permission</th>{ROLES.map((r) => <th key={r} className="font-semibold px-1.5">{ROLE_LABEL[r].split(' ')[0]}</th>)}</tr></thead>
            <tbody>
              {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
                <tr key={p} className="border-t border-line/60">
                  <td className="py-2 text-soft">{PERMISSIONS[p]}</td>
                  {ROLES.map((r) => <td key={r} className="text-center">{can(r, p) ? <span className="text-ok">✓</span> : <span className="text-muted/50">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted mt-2">Checked by the server on every action, not just hidden on screen.</p>
      </Card>
    </div>
  );
}

interface AuditRow { id: number; at: string; actor: string; action: string; entity: string; entity_id: string; detail: string }

function AuditBackup() {
  const { data, loading } = useStaff<{ rows: AuditRow[]; check: { ok: boolean; count: number; brokenAt?: number } }>('audit');
  return (
    <div className="space-y-4">
      <Card title="Backup">
        <p className="text-sm text-soft">Download the whole database (bookings, money, invoices, settings) as one file. Keep a copy every week; the server also keeps its data folder in a backed-up volume.</p>
        <a href="/api/staff/backup" download className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:border-cyan"><Download className="w-4 h-4 text-cyan" /> Download backup</a>
      </Card>
      <Card title="Audit log">
        {loading && !data ? <Spinner /> : data && (
          <>
            <p className={`text-sm flex items-center gap-2 ${data.check.ok ? 'text-ok' : 'text-bad'}`}>{data.check.ok ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />} {data.check.ok ? `Intact: ${data.check.count} entries, none edited or removed.` : `Tampering detected at entry ${data.check.brokenAt}.`}</p>
            <ul className="mt-3 divide-y divide-line/60 text-xs">
              {data.rows.map((r) => (
                <li key={r.id} className="py-2 flex gap-3">
                  <span className="text-muted w-28 shrink-0">{fmtStamp(r.at)}</span>
                  <span className="min-w-0"><b>{r.actor}</b> · {r.action} <span className="text-muted">{r.entity} {r.entity_id}</span></span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
