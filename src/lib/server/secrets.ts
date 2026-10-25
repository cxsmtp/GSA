import crypto from 'node:crypto';
import fs from 'node:fs';
import { dataFile } from './dataDir';

/**
 * The server's own key (DATA_DIR/server.key, made on first start, never leaves the server): signs
 * the audit log and encrypts 2-step sign-in secrets at rest. APP_SECRET overrides it when set.
 */
let key: Buffer | null = null;

export function serverKey(): Buffer {
  if (key) return key;
  const env = process.env.APP_SECRET;
  if (env && env.length >= 32) {
    key = crypto.createHash('sha256').update(env).digest();
    return key;
  }
  const file = dataFile('server.key');
  try {
    key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64url');
  } catch {
    const fresh = crypto.randomBytes(32);
    try {
      fs.writeFileSync(file, fresh.toString('base64url'), { mode: 0o600, flag: 'wx' });
      key = fresh;
    } catch {
      key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64url');
    }
  }
  return key;
}

function subKey(purpose: string): Buffer {
  return crypto.createHmac('sha256', serverKey()).update(purpose).digest();
}

export function hmac(purpose: string, data: string): string {
  return crypto.createHmac('sha256', subKey(purpose)).update(data).digest('base64url');
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', subKey('encrypt'), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decrypt(sealed: string): string | null {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', subKey('encrypt'), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** A random URL-safe token: 16 bytes = 128 bits, unguessable. */
export function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
