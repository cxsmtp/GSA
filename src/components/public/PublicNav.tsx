'use client';

import { CalendarDays, Info, Ticket } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Three pages, one thumb-reach tab bar on phones; a top bar on desktop. */
const TABS = [
  { href: '/', label: 'Book', icon: CalendarDays },
  { href: '/my', label: 'My bookings', icon: Ticket },
  { href: '/about', label: 'About', icon: Info },
];

export function PublicNav() {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href) || (href === '/my' && path.startsWith('/pay')));
  return (
    <nav aria-label="Main" className="fixed bottom-0 inset-x-0 z-40 sm:static sm:z-auto">
      <div className="glass sm:bg-transparent sm:border-0 sm:backdrop-blur-none mx-auto max-w-md sm:max-w-none flex sm:gap-1 justify-around sm:justify-end px-2 pt-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))] sm:p-0 rounded-t-3xl sm:rounded-none">
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-col sm:flex-row items-center gap-0.5 sm:gap-2 px-4 py-1.5 sm:py-2 rounded-2xl text-[11px] sm:text-sm font-semibold transition ${active(href) ? 'text-lime sm:bg-lime/10' : 'text-muted hover:text-text'}`}
            aria-current={active(href) ? 'page' : undefined}
          >
            <Icon className="w-5 h-5 sm:w-4 sm:h-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
