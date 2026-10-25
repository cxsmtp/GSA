import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PayApp } from '@/components/public/PayApp';
import { MobileNav, SiteHeader } from '@/components/public/SiteHeader';
import { bookingByToken } from '@/lib/server/bookings';
import { publicBooking, startup } from '@/lib/server/publicView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Payment', robots: { index: false } };

/** The payment page: reached only through the booking's private link. */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  await startup();
  const b = bookingByToken((await params).token);
  if (!b) notFound();
  return (
    <>
      <SiteHeader />
      <main>
        <PayApp initial={publicBooking(b)} />
      </main>
      <MobileNav />
    </>
  );
}
