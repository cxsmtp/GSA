import { ImageResponse } from 'next/og';
import { getSettings } from '@/lib/server/settings';

export const dynamic = 'force-dynamic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Book online';

/** The picture shown when the booking link is shared in Instagram DMs/bio, WhatsApp or Facebook. */
export default function OgImage() {
  const a = getSettings('business');
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, background: 'radial-gradient(circle at 20% 30%, #3b2a8a 0%, #06070d 55%)', color: '#f3f5ff' }}>
        <div style={{ fontSize: 34, color: '#00e5ff', letterSpacing: 4, textTransform: 'uppercase' }}>{a.name}</div>
        <div style={{ fontSize: 110, fontWeight: 900, lineHeight: 1, marginTop: 20 }}>BOOK YOUR</div>
        <div style={{ fontSize: 110, fontWeight: 900, lineHeight: 1, color: '#c6ff00' }}>SLOT</div>
        <div style={{ fontSize: 34, color: '#b8bfe0', marginTop: 30 }}>{'Live availability · Pay by UPI · WhatsApp confirmation'}</div>
      </div>
    ),
    size,
  );
}
