import type { NextConfig } from 'next';
import pkg from './package.json';

/**
 * Security headers on every response (pattern from the buh project). Scripts only from this site
 * (Next.js needs inline bootstrap scripts) and Razorpay Checkout, which is only loaded on the pay
 * page when the gateway is on. No framing, no plugins, no <base> hijack, forms only to this site.
 */
const isDev = process.env.NODE_ENV === 'development';
const RZ = { script: 'https://checkout.razorpay.com', frame: 'https://api.razorpay.com https://checkout.razorpay.com', connect: 'https://api.razorpay.com https://lumberjack.razorpay.com' };

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${RZ.script}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''} ${RZ.connect}`,
  `frame-src 'self' ${RZ.frame}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  // Shown in the staff app, so "which build is this?" has one answer.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com"), usb=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
      {
        source: '/api/((?!media/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/pay/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }, { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, max-age=0, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }],
      },
    ];
  },
};

export default nextConfig;
