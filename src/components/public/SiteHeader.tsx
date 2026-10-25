import Link from 'next/link';
import { getSettings } from '@/lib/server/settings';
import { InstagramIcon, LogoMark, WhatsAppIcon } from '@/components/ui/BrandIcons';
import { PublicNav } from './PublicNav';

export function SiteHeader() {
  const a = getSettings('business');
  return (
    <header className="sticky top-0 z-30 glass border-x-0 border-t-0">
      <div className="mx-auto max-w-5xl flex items-center gap-3 px-4 h-14">
        <Link href="/" className="flex items-center gap-2 min-w-0">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-violet to-cyan p-[1.5px]">
            <span className="grid place-items-center w-full h-full rounded-[10px] bg-ink text-text">
              <LogoMark className="w-6 h-6" />
            </span>
          </span>
          <span className="font-display font-bold text-sm sm:text-base truncate">{a.name}</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <div className="hidden sm:block"><PublicNav /></div>
          {a.instagram && (
            <a href={`https://instagram.com/${a.instagram}`} target="_blank" rel="noopener noreferrer" className="p-2 rounded-full text-soft hover:text-pink" aria-label="Instagram">
              <InstagramIcon />
            </a>
          )}
          {a.whatsapp && (
            <a href={`https://wa.me/${a.whatsapp}`} target="_blank" rel="noopener noreferrer" className="p-2 rounded-full text-soft hover:text-ok" aria-label="WhatsApp us">
              <WhatsAppIcon />
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

export function MobileNav() {
  return (
    <div className="sm:hidden">
      <PublicNav />
    </div>
  );
}
