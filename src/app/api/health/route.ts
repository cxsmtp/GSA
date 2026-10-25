import { get } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    get('SELECT 1');
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
