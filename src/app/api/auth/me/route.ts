import { currentUser } from '@/lib/server/auth';
import { handleRouteError, json } from '@/lib/server/http';
import { startup } from '@/lib/server/publicView';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await startup();
    return json({ ok: true, user: await currentUser() });
  } catch (err) {
    return handleRouteError(err, 'auth/me');
  }
}
