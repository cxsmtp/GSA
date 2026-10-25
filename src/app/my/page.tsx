import type { Metadata } from 'next';
import { MyBookings } from '@/components/public/MyBookings';
import { MobileNav, SiteHeader } from '@/components/public/SiteHeader';

export const metadata: Metadata = { title: 'My bookings', robots: { index: false } };

export default function MyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 pt-6 pb-32">
        <MyBookings />
      </main>
      <MobileNav />
    </>
  );
}
