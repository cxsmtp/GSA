import { BookingApp } from '@/components/public/BookingApp';
import { MobileNav, SiteHeader } from '@/components/public/SiteHeader';
import { publicConfig, startup } from '@/lib/server/publicView';

export const dynamic = 'force-dynamic';

export default async function Home() {
  await startup();
  return (
    <>
      <SiteHeader />
      <main>
        <BookingApp config={publicConfig()} />
      </main>
      <MobileNav />
    </>
  );
}
