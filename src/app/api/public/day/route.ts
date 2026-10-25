import { sweepExpired } from '@/lib/server/bookings';
import { handleRouteError, HttpError, json } from '@/lib/server/http';
import { startup } from '@/lib/server/publicView';
import { enforceIp } from '@/lib/server/rateLimit';
import { buildDay, freeCounts, inBookingWindow } from '@/lib/server/schedule';
import { getSettings } from '@/lib/server/settings';
import { isValidDate, todayIst } from '@/lib/shared/time';

export const dynamic = 'force-dynamic';

/** GET /api/public/day?date=YYYY-MM-DD → the space grid; &strip=1 adds free-slot counts for the date strip. */
export async function GET(req: Request) {
  try {
    await startup();
    enforceIp(req, 'day', 240, 60_000);
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayIst();
    if (!isValidDate(date)) throw new HttpError(400, 'Invalid date.');
    if (!inBookingWindow(date)) throw new HttpError(400, 'That date is not open for booking.');
    sweepExpired();
    const grid = buildDay(date);
    const strip = url.searchParams.get('strip') === '1' ? freeCounts(todayIst(), getSettings('booking').daysAhead + 1) : undefined;
    return json({ ok: true, grid, strip });
  } catch (err) {
    return handleRouteError(err, 'public/day');
  }
}
