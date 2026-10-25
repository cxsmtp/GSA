import { handleRouteError, json } from '@/lib/server/http';
import { startup } from '@/lib/server/publicView';
import { dispatch } from '@/lib/server/staffApi';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  try {
    await startup();
    const out = await dispatch(req, path);
    if ('response' in out) return out.response;
    return json({ ok: true, ...(out.data as object) });
  } catch (err) {
    return handleRouteError(err, `staff/${path.join('/')}`);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
