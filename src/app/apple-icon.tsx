import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** iPhone home-screen icon (iOS needs a PNG). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#7c4dff,#00e5ff)' }}>
        <div style={{ width: 150, height: 150, borderRadius: 34, background: '#06070d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 90, fontWeight: 900, color: '#c6ff00' }}>G</div>
      </div>
    ),
    size,
  );
}
