import fs from 'node:fs';
import { cookies } from 'next/headers';
import { can, ROLE_LABEL, type Permission, type Role } from '@/lib/shared/rbac';
import { audit } from './audit';
import { dataFile } from './dataDir';
import { get, run } from './db';
import { assertSameOrigin, clientIp, HttpError } from './http';
import { logEvent } from './log';
import { dummyHash, generatePassword, hashPassword, verifyPassword } from './password';
import { count, enforce, hit } from './rateLimit';
import { decrypt, randomToken, sha256 } from './secrets';
import { verifyTotp } from './totp';

/**
 * Staff sign-in. Roles and what each may do are in src/lib/shared/rbac.ts (admin, head coach, junior
 * coach); every staff route names a permission and requireUser checks it on the server.
 *
 * Sessions: a random 256-bit token in an HttpOnly, Secure, SameSite=Strict cookie (__Host- prefix in
 * production); the database keeps only its hash. 12 h idle / 7 days at most; signing out, a password
 * change or deactivating a user ends sessions at once.
 *
 * Wrong passwords: 5 in 15 min from one address, or 20 in an hour for one username, pause sign-in
 * for that username; during a pause the password isn't even checked.
 */

export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  mustChange: boolean;
  totp: boolean;
}

interface UserRow {
  id: number;
  username: string;
  name: string;
  role: Role;
  password_hash: string;
  must_change: number;
  totp_secret: string | null;
  active: number;
  session_gen: number;
}

const IDLE_MS = 12 * 60 * 60 * 1000;
const MAX_MS = 7 * 24 * 60 * 60 * 1000;

export function cookieName(): string {
  return process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1' ? '__Host-gsa_session' : 'gsa_session';
}

/** First start: an admin account with a one-time password (ADMIN_INITIAL_PASSWORD, or a random one shown once). */
export async function ensureFirstAdmin() {
  if (get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n > 0) return;
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD || generatePassword();
  const hash = await hashPassword(password);
  if (get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n > 0) return;
  run("INSERT INTO users (username, name, role, password_hash, must_change, created_at) VALUES (?,?,'admin',?,1,?)", username, 'Admin', hash, new Date().toISOString());
  if (!process.env.ADMIN_INITIAL_PASSWORD) {
    const note = `First sign-in for GSA portal\nUsername: ${username}\nOne-time password: ${password}\nYou will choose your own password after signing in. Delete this file afterwards.\n`;
    try {
      fs.writeFileSync(dataFile('FIRST_LOGIN.txt'), note, { mode: 0o600 });
    } catch {
      // the log line below still has it
    }
    console.log(`\n==== GSA admin first sign-in ====\nUsername: ${username}\nOne-time password: ${password}\n(also saved in DATA_DIR/FIRST_LOGIN.txt)\n=================================\n`);
  }
  audit('system', 'user.first_admin', 'user', username);
}

function toSession(u: UserRow): SessionUser {
  return { id: u.id, username: u.username, name: u.name, role: u.role, mustChange: u.must_change === 1, totp: Boolean(u.totp_secret) };
}

export async function login(req: Request, usernameRaw: string, password: string, code: string): Promise<{ token: string; user: SessionUser } | { needCode: true }> {
  const username = usernameRaw.trim().toLowerCase().slice(0, 60);
  const ip = clientIp(req) || 'unknown';
  enforce(`login-ip:${ip}`, 30, 15 * 60_000, 'Too many sign-in attempts from here. Please wait 15 minutes.');
  const pausedIp = count(`login-fail:${username}:${ip}`, 15 * 60_000) >= 5;
  const pausedUser = count(`login-fail:${username}`, 60 * 60_000) >= 20;
  if (pausedIp || pausedUser) throw new HttpError(429, 'Sign-in for this user is paused for a while after several wrong passwords.');

  const u = get<UserRow>('SELECT * FROM users WHERE username = ? AND active = 1', username);
  const ok = await verifyPassword(password, u?.password_hash || (await dummyHash()));
  if (!u || !ok) {
    hit(`login-fail:${username}:${ip}`, 1000, 15 * 60_000);
    hit(`login-fail:${username}`, 1000, 60 * 60_000);
    audit('anonymous', 'auth.login_failed', 'user', username, { ip });
    throw new HttpError(401, 'Wrong username or password.');
  }
  if (u.totp_secret) {
    if (!code) return { needCode: true };
    const secret = decrypt(u.totp_secret);
    if (!secret || !verifyTotp(secret, code)) {
      hit(`login-fail:${username}:${ip}`, 1000, 15 * 60_000);
      hit(`login-fail:${username}`, 1000, 60 * 60_000);
      audit('anonymous', 'auth.code_failed', 'user', username, { ip });
      throw new HttpError(401, 'That 6-digit code is not right. Use the latest code from your authenticator app.');
    }
  }
  const token = randomToken(32);
  const now = Date.now();
  run('INSERT INTO sessions (id_hash, user_id, gen, created_at, last_seen_at, ip, ua) VALUES (?,?,?,?,?,?,?)', sha256(token), u.id, u.session_gen, now, now, ip, (req.headers.get('user-agent') || '').slice(0, 200));
  run('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), u.id);
  run('DELETE FROM sessions WHERE last_seen_at < ?', now - MAX_MS);
  audit(u.username, 'auth.login', 'user', u.username, { ip });
  logEvent('info', 'login', { user: u.username, role: u.role });
  return { token, user: toSession(u) };
}

export function setSessionCookie(res: { cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => void } }, token: string) {
  res.cookies.set(cookieName(), token, {
    httpOnly: true,
    secure: cookieName().startsWith('__Host-'),
    sameSite: 'strict',
    path: '/',
    maxAge: MAX_MS / 1000,
  });
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(cookieName())?.value;
  if (!token || token.length > 100) return null;
  const s = get<{ user_id: number; gen: number; created_at: number; last_seen_at: number }>('SELECT * FROM sessions WHERE id_hash = ?', sha256(token));
  if (!s) return null;
  const now = Date.now();
  if (now - s.last_seen_at > IDLE_MS || now - s.created_at > MAX_MS) {
    run('DELETE FROM sessions WHERE id_hash = ?', sha256(token));
    return null;
  }
  const u = get<UserRow>('SELECT * FROM users WHERE id = ? AND active = 1', s.user_id);
  if (!u || u.session_gen !== s.gen) return null;
  if (now - s.last_seen_at > 60_000) run('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', now, sha256(token));
  return toSession(u);
}

export async function logout() {
  const token = (await cookies()).get(cookieName())?.value;
  if (token) run('DELETE FROM sessions WHERE id_hash = ?', sha256(token));
}

/** End every session of a user (password change, deactivation). */
export function endSessions(userId: number) {
  run('UPDATE users SET session_gen = session_gen + 1 WHERE id = ?', userId);
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

/** The gate for every staff API call. Deny by default: a route must name the permission it needs. */
export async function requireUser(req: Request, perm: Permission, { allowMustChange = false } = {}): Promise<SessionUser> {
  if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Please sign in.');
  if (!can(user.role, perm)) throw new HttpError(403, `Not allowed for a ${ROLE_LABEL[user.role] ?? 'staff'} account.`);
  if (user.mustChange && !allowMustChange) throw new HttpError(403, 'Choose your own password first.', {}, { code: 'must_change' });
  return user;
}

export function userRow(id: number): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}
