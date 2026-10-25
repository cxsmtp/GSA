import type { MetadataRoute } from 'next';
import { getSettings } from '@/lib/server/settings';

export const dynamic = 'force-dynamic';

/** Installable: "Add to Home screen" gives a full-screen app icon that opens straight to booking. */
export default function manifest(): MetadataRoute.Manifest {
  const a = getSettings('business');
  return {
    name: a.name,
    short_name: a.name.split(' ').slice(0, 2).join(' '),
    description: 'Book online, pay by UPI, get WhatsApp confirmation.',
    start_url: '/?src=app',
    display: 'standalone',
    background_color: '#06070d',
    theme_color: '#06070d',
    orientation: 'portrait',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
    shortcuts: [{ name: 'Book a space', url: '/?src=app' }, { name: 'About us', url: '/about' }],
  };
}
