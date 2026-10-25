import { NextResponse } from 'next/server';
import { logEvent } from './log';

/**
 * An error whose message is safe to show. Anything else reaching handleRouteError is logged and
 * answered with a generic message, so stack traces and internals never leak (from the buh project).
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers: Record<string, string> = {},
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function handleRouteError(err: unknown, route: string) {
  if (err instanceof HttpError) return json({ ok: false, ...err.details, message: err.message }, err.status, err.headers);
  logEvent('error', 'route_error', { route, error: err instanceof Error ? `${err.message}\n${err.stack?.split('\n').slice(1, 4).join('\n')}` : String(err) });
  return json({ ok: false, message: 'Something went wrong. Please try again.' }, 500);
}

async function readCapped(req: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers.get('content-length') || '0');
  if (declared > maxBytes) throw new HttpError(413, 'Request is too large.');
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A JSON object body, size-capped, refused before any handler sees it when malformed. */
export async function readJsonBody(req: Request, maxBytes = 16 * 1024): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) throw new HttpError(415, 'Expected JSON.');
  const raw = await readCapped(req, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'Request must be a JSON object.');
  return parsed as Record<string, unknown>;
}

/** Raw bytes, for checking a webhook's signature over exactly what was sent. */
export function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  return readCapped(req, maxBytes);
}

/**
 * The caller's address for rate limits, or null when unknown. Forwarded headers count only behind
 * our own proxy (TRUST_PROXY=1), because without one anybody can set them.
 */
export function clientIp(req: Request): string | null {
  if (process.env.TRUST_PROXY === '1') {
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim();
    const hops = (req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return null;
}

/** CSRF guard for state-changing requests (with SameSite=Strict cookies). */
export function assertSameOrigin(req: Request): void {
  const allowed = new Set<string>();
  const host = req.headers.get('host');
  if (host) allowed.add(host.toLowerCase());
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).host.toLowerCase());
    } catch {
      // ignore a malformed APP_URL
    }
  }
  const source = req.headers.get('origin') ?? req.headers.get('referer');
  if (source) {
    let h = '';
    try {
      h = source === 'null' ? '' : new URL(source).host.toLowerCase();
    } catch {
      // treated as foreign
    }
    if (!h || !allowed.has(h)) throw new HttpError(403, 'Cross-site request refused.');
    return;
  }
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Cross-site request refused.');
}

/** Refuse fields not on the list: a typo or a probe gets a clear 400, not silence. */
export function allowFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(body).find((k) => !allowed.includes(k));
  if (extra) throw new HttpError(400, `Unexpected field: ${extra.slice(0, 40)}.`);
}

export function str(value: unknown, field: string, max: number, { required = true } = {}): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`);
  const t = value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (t.length > max) throw new HttpError(400, `${field} is too long (max ${max}).`);
  if (required && !t) throw new HttpError(400, `${field} is required.`);
  return t;
}

export function int(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}.`);
  return n;
}

export function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${field} must be true or false.`);
  return value;
}

export function oneOf<T extends string>(value: unknown, field: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new HttpError(400, `${field} must be one of: ${options.join(', ')}.`);
  return value as T;
}
