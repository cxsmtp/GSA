import { NextResponse } from 'next/server';
import { login, setSessionCookie } from '@/lib/server/auth';
import { allowFields, assertSameOrigin, handleRouteError, readJsonBody, str } from '@/lib/server/http';
import { startup } from '@/lib/server/publicView';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    await startup();
    assertSameOrigin(req);
    const body = await readJsonBody(req, 4096);
    allowFields(body, ['username', 'password', 'code']);
    const r = await login(req, str(body.username, 'Username', 60), str(body.password, 'Password', 200), str(body.code, 'Code', 10, { required: false }));
    if ('needCode' in r) return NextResponse.json({ ok: false, needCode: true, message: 'Enter the 6-digit code from your authenticator app.' }, { headers: { 'Cache-Control': 'no-store' } });
    const res = NextResponse.json({ ok: true, user: r.user }, { headers: { 'Cache-Control': 'no-store' } });
    setSessionCookie(res, r.token);
    return res;
  } catch (err) {
    return handleRouteError(err, 'auth/login');
  }
}
