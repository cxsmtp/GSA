import { createBooking } from '@/lib/server/bookings';
import { get } from '@/lib/server/db';
import { allowFields, handleRouteError, HttpError, json, readJsonBody, str } from '@/lib/server/http';
import { startup } from '@/lib/server/publicView';
import { parseParticipant } from '@/lib/server/participant';
import { enforce, enforceIp } from '@/lib/server/rateLimit';
import { isValidGstin } from '@/lib/shared/gst';
import { isValidDate } from '@/lib/shared/time';
import { CHANNELS, type SlotRef } from '@/lib/shared/types';
import { normalizeIndianMobile } from '@/lib/shared/whatsapp';

export const dynamic = 'force-dynamic';

/** Create an online booking: holds the spaces for a few minutes while the player pays. */
export async function POST(req: Request) {
  try {
    await startup();
    enforceIp(req, 'book', 12, 60 * 60_000, 'Too many bookings from this connection. Please call us to book.');
    enforce('global:book', 400, 60 * 60_000, 'Booking is very busy right now. Please try again in a few minutes.');
    const body = await readJsonBody(req);
    allowFields(body, ['date', 'slots', 'name', 'phone', 'email', 'gstin', 'channel', 'website', 'health', 'minor', 'guardian']);
    // Honeypot: a hidden field people never fill; bots do.
    if (body.website) throw new HttpError(400, 'Could not book.');
    const date = body.date;
    if (!isValidDate(date)) throw new HttpError(400, 'Pick a date.');
    if (!Array.isArray(body.slots) || body.slots.length > 40) throw new HttpError(400, 'Pick your slots.');
    const slots: SlotRef[] = body.slots.map((s: unknown) => {
      const o = s as Record<string, unknown>;
      if (!o || !Number.isInteger(o.spaceId) || !Number.isInteger(o.start)) throw new HttpError(400, 'Invalid slot.');
      return { spaceId: o.spaceId as number, start: o.start as number };
    });
    const name = str(body.name, 'Name', 80);
    if (name.length < 2) throw new HttpError(400, 'Please enter your name.');
    const phone = normalizeIndianMobile(body.phone);
    if (!phone) throw new HttpError(400, 'Enter a valid 10-digit Indian WhatsApp number.');
    const email = str(body.email, 'Email', 120, { required: false });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'That email does not look right.');
    const gstin = str(body.gstin, 'GSTIN', 15, { required: false }).toUpperCase();
    if (gstin && !isValidGstin(gstin)) throw new HttpError(400, 'That GSTIN is not valid. Leave it empty if you do not need a business invoice.');
    const channel = typeof body.channel === 'string' && (CHANNELS as readonly string[]).includes(body.channel) ? body.channel : 'web';
    enforce(`book-phone:${phone}`, 6, 60 * 60_000, 'Too many bookings for this number. Please call us.');
    const open = get<{ n: number }>(`SELECT COUNT(*) AS n FROM bookings WHERE phone = ? AND status = 'held'`, phone)!.n;
    if (open >= 2) throw new HttpError(429, 'You already have bookings waiting for payment. Please finish or let them expire first.');
    const b = createBooking({ date, slots, name, phone, email, gstin, source: 'online', status: 'held', channel, actor: 'player', ...parseParticipant(body) });
    return json({ ok: true, token: b.token, ref: b.ref });
  } catch (err) {
    return handleRouteError(err, 'public/bookings');
  }
}
