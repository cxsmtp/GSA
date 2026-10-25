import { readMedia } from '@/lib/server/media';

/** Public photos (the About page). Private files (bills) are never served here. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const m = readMedia(id, 'public');
  if (!m) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(m.body), {
    headers: { 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" },
  });
}
