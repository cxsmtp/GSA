import { handleRouteError, json } from '@/lib/server/http';
import { publicConfig, startup } from '@/lib/server/publicView';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await startup();
    return json({ ok: true, config: publicConfig() });
  } catch (err) {
    return handleRouteError(err, 'public/config');
  }
}
