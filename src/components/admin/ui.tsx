'use client';

import { Loader2 } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { can, type Permission, type Role } from '@/lib/shared/rbac';

export interface Me {
  id: number;
  username: string;
  name: string;
  role: Role;
  mustChange: boolean;
  totp: boolean;
}

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;
/** Does the signed-in user have this permission? (The server checks again on every call.) */
export const useCan = () => {
  const me = useMe();
  return (perm: Permission) => can(me.role, perm);
};

/** Load a staff API path; returns data, error, loading and a reload. */
export function useStaff<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path));
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(`/api/staff/${path}`));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function staff<T = Record<string, unknown>>(path: string, method: string, body?: unknown) {
  return api<T>(`/api/staff/${path}`, { method, body: body ?? (method === 'GET' ? undefined : {}) });
}

/* ---------- toasts ---------- */
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ msg: string; tone: 'ok' | 'bad'; id: number } | null>(null);
  const show = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now();
    setT({ msg, tone, id });
    setTimeout(() => setT((cur) => (cur?.id === id ? null : cur)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div role="status" className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] rise rounded-2xl px-4 py-3 text-sm font-semibold shadow-2xl ${t.tone === 'ok' ? 'bg-ok text-ink' : 'bg-bad text-white'}`}>
          {t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/** Run an action with a busy flag and a toast for the result. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (ok) toast(ok);
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Failed.', 'bad');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

/* ---------- building blocks ---------- */
export function Card({ title, action, children, className = '' }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-line bg-panel/70 p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          {title && <h2 className="font-display text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = 'text-text', sub }: { label: string; value: React.ReactNode; tone?: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-night/60 p-3.5">
      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</div>
      <div className={`font-display text-xl sm:text-2xl font-bold mt-1 ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function Btn({ children, tone = 'ghost', busy, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'lime' | 'ghost' | 'bad' | 'ok'; busy?: boolean }) {
  const cls = {
    lime: 'btn-lime',
    ghost: 'border border-line bg-panel-2 hover:border-cyan text-text',
    bad: 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
    ok: 'bg-ok text-ink hover:brightness-110',
  }[tone];
  return (
    <button {...rest} disabled={busy || rest.disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${cls} ${className}`}>
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

const STATUS_STYLE: Record<string, string> = {
  held: 'bg-amber/15 text-amber',
  reserved: 'bg-cyan/15 text-cyan',
  submitted: 'bg-violet/20 text-[#b39dff]',
  confirmed: 'bg-ok/15 text-ok',
  cancelled: 'bg-bad/15 text-bad',
  expired: 'bg-line text-muted',
  pending: 'bg-amber/15 text-amber',
  verified: 'bg-ok/15 text-ok',
  rejected: 'bg-bad/15 text-bad',
  issued: 'bg-ok/15 text-ok',
};
const STATUS_LABEL: Record<string, string> = { held: 'Awaiting payment', submitted: 'Verify payment', reserved: 'Payment due' };

export function Badge({ s }: { s: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold capitalize whitespace-nowrap ${STATUS_STYLE[s] || 'bg-line text-soft'}`}>{STATUS_LABEL[s] || s}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>;
}

export function Spinner() {
  return (
    <div className="grid place-items-center py-10 text-muted">
      <Loader2 className="w-6 h-6 animate-spin" />
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-2xl bg-night/70 border border-line p-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={value === o.value} className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${value === o.value ? 'bg-lime text-ink' : 'text-soft hover:text-text'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Shrink a photo in the browser before upload (max 1600 px, JPEG): fast on mobile data. PDFs pass as they are. */
export async function fileToDataUrl(file: File, maxSide = 1600): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
  if (!file.type.startsWith('image/')) return raw;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not read the photo.'));
    img.src = raw;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
