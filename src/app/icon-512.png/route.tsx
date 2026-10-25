import { ImageResponse } from 'next/og';

/** PNG app icon for Android's install prompt. */
export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#06070d' }}>
        <div style={{ width: 400, height: 400, borderRadius: 200, background: 'linear-gradient(135deg,#7c4dff,#00e5ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 240, fontWeight: 900, color: '#c6ff00' }}>G</div>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
