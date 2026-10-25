/** One JSON line per event. Phone numbers and anything that looks like a secret are masked. */
const SECRET_KEY = /pass|secret|token|key|otp|code|cookie|authorization/i;

function clean(value: unknown, keyName = ''): unknown {
  if (SECRET_KEY.test(keyName)) return '[redacted]';
  if (typeof value === 'string') return value.replace(/\b(?:91)?([6-9]\d{5})(\d{4})\b/g, '••••••$2').slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => clean(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([k, v]) => [k, clean(v, k)]));
  }
  return value;
}

export function logEvent(level: 'info' | 'warn' | 'error', event: string, detail: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(clean(detail) as object) });
  if (level === 'error') console.error(line);
  else console.log(line);
}
