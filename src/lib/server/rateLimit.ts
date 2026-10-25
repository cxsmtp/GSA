import { clientIp, HttpError } from './http';

/**
 * In-memory sliding-window limits (one process), with a cap on tracked keys so a flood of distinct
 * keys can't exhaust memory. From the buh project, trimmed.
 */
const MAX_KEYS = 50_000;
const buckets = new Map<string, number[]>();

export function hit(key: string, max: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const since = now - windowMs;
  const hits = (buckets.get(key) || []).filter((t) => t > since);
  buckets.delete(key);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) {
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (buckets.size <= MAX_KEYS * 0.9) break;
    }
  }
  return { ok: true, retryAfterSec: 0 };
}

export function count(key: string, windowMs: number, now = Date.now()): number {
  return (buckets.get(key) || []).filter((t) => t > now - windowMs).length;
}

export function reset(key: string) {
  buckets.delete(key);
}

export function enforce(key: string, max: number, windowMs: number, message = 'Too many tries. Please wait a little and try again.') {
  const r = hit(key, max, windowMs);
  if (!r.ok) throw new HttpError(429, message, { 'Retry-After': String(r.retryAfterSec) });
}

/** Per-address limit; skipped when the address is unknown so it never becomes one shared bucket. */
export function enforceIp(req: Request, scope: string, max: number, windowMs: number, message?: string) {
  const ip = clientIp(req);
  if (ip) enforce(`${scope}:${ip}`, max, windowMs, message);
}

export function _clearLimits() {
  buckets.clear();
}
