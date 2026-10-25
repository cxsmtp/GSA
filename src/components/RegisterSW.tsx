'use client';

import { useEffect } from 'react';

/** Registers the small service worker that makes the portal installable and opens offline gracefully. */
export function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
