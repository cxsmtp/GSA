import crypto from 'node:crypto';

/** scrypt password hashing, stored as scrypt$N$r$p$salt$hash (from the buh project). */
const N = 16384;
const R = 8;
const P = 1;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 32, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

let dummy: Promise<string> | null = null;
/** Checked against when the username is unknown, so timing doesn't reveal which usernames exist. */
export function dummyHash(): Promise<string> {
  if (!dummy) dummy = hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummy;
}

export function generatePassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'Use at most 200 characters.';
  if (new Set(pw).size < 5) return 'Use at least 5 different characters.';
  if (/^(password|qwerty|123456)/i.test(pw)) return 'That password is too easy to guess.';
  return null;
}
