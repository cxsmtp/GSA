import { invoiceHtml, INVOICE_CSP } from '@/lib/server/invoiceHtml';
import { invoiceByToken } from '@/lib/server/invoices';
import { enforceIp } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';

/** An invoice, through its own unguessable link (sent to the player; opened by the admin). */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    enforceIp(req, 'invoice', 60, 60_000);
  } catch {
    return new Response('Too many requests', { status: 429 });
  }
  const inv = invoiceByToken((await ctx.params).token);
  if (!inv) return new Response('Not found', { status: 404 });
  return new Response(invoiceHtml(inv), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': INVOICE_CSP, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' },
  });
}
