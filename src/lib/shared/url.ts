/** A link from settings, only if it is a well-formed https URL (never javascript:, data: or http:). */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}
