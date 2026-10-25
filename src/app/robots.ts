import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: ['/', '/about'], disallow: ['/admin', '/pay/', '/invoice/', '/api/'] }] };
}
