import { bookingByToken } from '@/lib/server/bookings';
import { run } from '@/lib/server/db';
import { allowFields, handleRouteError, HttpError, json, readJsonBody, str } from '@/lib/server/http';
import { razorpayOrder, razorpaySignatureOk, settleRazorpay, submitUtr } from '@/lib/server/payments';
import { publicBooking, startup } from '@/lib/server/publicView';
import { enforce, enforceIp } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

async function load(ctx: Ctx) {
  const { token } = await ctx.params;
  const b = bookingByToken(token);
  if (!b) throw new HttpError(404, 'Booking not found.');
  return b;
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    await startup();
    enforceIp(req, 'booking-view', 120, 60_000);
    return json({ ok: true, booking: publicBooking(await load(ctx)) });
  } catch (err) {
    return handleRouteError(err, 'public/booking');
  }
}

/** Player actions on their booking: { action: 'utr' | 'wa_opened' | 'rz_order' | 'rz_paid', … } */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await startup();
    enforceIp(req, 'booking-act', 30, 10 * 60_000);
    const b = await load(ctx);
    const body = await readJsonBody(req);
    allowFields(body, ['action', 'utr', 'orderId', 'paymentId', 'signature']);
    switch (body.action) {
      case 'utr': {
        enforce(`utr:${b.id}`, 6, 60 * 60_000, 'Too many tries. Please call us.');
        await submitUtr(b, str(body.utr, 'UPI reference', 40));
        break;
      }
      case 'wa_opened':
        run('UPDATE bookings SET wa_opened_at = COALESCE(wa_opened_at, ?) WHERE id = ?', new Date().toISOString(), b.id);
        break;
      case 'rz_order':
        return json({ ok: true, order: await razorpayOrder(b) });
      case 'rz_paid': {
        const orderId = str(body.orderId, 'orderId', 60);
        const paymentId = str(body.paymentId, 'paymentId', 60);
        const signature = str(body.signature, 'signature', 128);
        if (!razorpaySignatureOk(orderId, paymentId, signature)) throw new HttpError(400, 'Payment could not be verified. If money was taken, it will be confirmed automatically or refunded.');
        await settleRazorpay(orderId, paymentId, 'checkout');
        break;
      }
      default:
        throw new HttpError(400, 'Unknown action.');
    }
    return json({ ok: true, booking: publicBooking(bookingByToken(b.token)!) });
  } catch (err) {
    return handleRouteError(err, 'public/booking-action');
  }
}
