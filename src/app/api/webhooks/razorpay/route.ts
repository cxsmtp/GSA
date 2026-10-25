import { handleRouteError, json, readRawBody } from '@/lib/server/http';
import { logEvent } from '@/lib/server/log';
import { settleRazorpay, webhookSignatureOk } from '@/lib/server/payments';

export const dynamic = 'force-dynamic';

/**
 * Razorpay webhook (Dashboard → Webhooks → https://YOUR-DOMAIN/api/webhooks/razorpay, events
 * payment.captured and order.paid, secret = RAZORPAY_WEBHOOK_SECRET). Confirms bookings even when the
 * player closed the page before returning. Signed over the raw body; anything unsigned is ignored.
 */
export async function POST(req: Request) {
  try {
    const raw = await readRawBody(req, 64 * 1024);
    if (!webhookSignatureOk(raw, req.headers.get('x-razorpay-signature') || '')) return json({ ok: false }, 401);
    const evt = JSON.parse(raw.toString('utf8')) as { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } } } };
    const p = evt.payload?.payment?.entity;
    if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && p?.id && p.order_id) {
      await settleRazorpay(p.order_id, p.id, 'webhook');
      logEvent('info', 'razorpay_webhook', { event: evt.event });
    }
    return json({ ok: true });
  } catch (err) {
    return handleRouteError(err, 'webhooks/razorpay');
  }
}
