import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getSettings } from '@/lib/server/settings';
import { RegisterSW } from '@/components/RegisterSW';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const a = getSettings('academy');
  const description = `Book a badminton court at ${a.name}, ${a.city}. Live availability from 5 AM to 11 PM, instant UPI payment and WhatsApp confirmation.`;
  return {
    metadataBase: process.env.APP_URL ? new URL(process.env.APP_URL) : undefined,
    title: { default: `${a.name} · Book a court`, template: `%s · ${a.name}` },
    description,
    applicationName: a.name,
    appleWebApp: { capable: true, title: a.name, statusBarStyle: 'black-translucent' },
    // Rich previews when the booking link is shared on Instagram, WhatsApp and Facebook.
    openGraph: { type: 'website', title: `${a.name} — Book your court`, description, siteName: a.name },
    twitter: { card: 'summary_large_image', title: `${a.name} — Book your court`, description },
    icons: { icon: '/icon.svg' },
  };
}

export const viewport: Viewport = {
  themeColor: '#06070d',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="antialiased">
        <div className="aurora" aria-hidden="true" />
        <div className="relative z-10">{children}</div>
        <RegisterSW />
      </body>
    </html>
  );
}
