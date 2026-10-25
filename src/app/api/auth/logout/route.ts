import { NextResponse } from 'next/server';
import { cookieName, logout } from '@/lib/server/auth';
import { assertSameOrigin, handleRouteError } from '@/lib/server/http';

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await logout();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(cookieName(), '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'strict', secure: cookieName().startsWith('__Host-') });
    return res;
  } catch (err) {
    return handleRouteError(err, 'auth/logout');
  }
}
