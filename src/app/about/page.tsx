import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, MapPin, Phone, Sparkles, Trophy } from 'lucide-react';
import { MobileNav, SiteHeader } from '@/components/public/SiteHeader';
import { InstagramIcon, WhatsAppIcon } from '@/components/ui/BrandIcons';
import { all } from '@/lib/server/db';
import { startup } from '@/lib/server/publicView';
import { getSettings } from '@/lib/server/settings';
import { fmtTime } from '@/lib/shared/time';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'About us' };

interface Person { id: number; name: string; role: string; bio: string; highlights: string; photo_media: string | null }

/** About us: the academy's story, coaches and key people (added by the admin or coach in the admin app). */
export default async function AboutPage() {
  await startup();
  const a = getSettings('academy');
  const about = getSettings('about');
  const b = getSettings('booking');
  const people = all<Person>('SELECT id, name, role, bio, highlights, photo_media FROM people WHERE visible = 1 ORDER BY sort, id');
  const open = b.hours.find((h) => !h.closed);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-32 space-y-12">
        <section className="rise">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan">About {a.name}</p>
          <h1 className="font-display mt-3 text-4xl sm:text-6xl font-extrabold leading-[1.05]">{about.headline}</h1>
          {about.story && <p className="mt-5 max-w-2xl text-soft text-lg leading-relaxed whitespace-pre-line">{about.story}</p>}
          {about.highlights.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2">
              {about.highlights.map((h) => (
                <li key={h} className="inline-flex items-center gap-1.5 rounded-full border border-lime/30 bg-lime/10 px-3.5 py-1.5 text-sm font-semibold text-lime">
                  <Sparkles className="w-4 h-4" /> {h}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="team">
          <h2 id="team" className="font-display text-2xl font-bold">Coaches &amp; <span className="text-gradient">team</span></h2>
          {people.length === 0 ? (
            <p className="mt-4 rounded-3xl border border-dashed border-line p-8 text-center text-muted">Our coaches will be introduced here soon.</p>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {people.map((p, i) => (
                <article key={p.id} className="rise group relative overflow-hidden rounded-3xl border border-line bg-panel/70" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="aspect-[4/3] bg-gradient-to-br from-violet/40 via-panel-2 to-cyan/30 relative">
                    {p.photo_media ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/media/${p.photo_media}`} alt={p.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center font-display text-6xl font-black text-text/20">{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-panel to-transparent" />
                  </div>
                  <div className="p-5 -mt-10 relative">
                    <p className="text-xs font-bold uppercase tracking-wider text-lime">{p.role}</p>
                    <h3 className="font-display text-xl font-bold mt-1">{p.name}</h3>
                    {p.bio && <p className="mt-2 text-sm text-soft leading-relaxed whitespace-pre-line">{p.bio}</p>}
                    {p.highlights && (
                      <ul className="mt-3 space-y-1">
                        {p.highlights.split('\n').filter(Boolean).map((h) => (
                          <li key={h} className="flex gap-2 text-sm"><Trophy className="w-4 h-4 text-amber shrink-0 mt-0.5" /> {h}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-3xl border border-line bg-panel/70 p-5">
            <Clock className="w-5 h-5 text-lime" />
            <h3 className="mt-2 font-semibold">Open daily</h3>
            <p className="text-sm text-soft">{open ? `${fmtTime(open.open)} – ${fmtTime(open.close)}` : 'Closed'}</p>
          </div>
          <div className="rounded-3xl border border-line bg-panel/70 p-5">
            <MapPin className="w-5 h-5 text-pink" />
            <h3 className="mt-2 font-semibold">Find us</h3>
            <p className="text-sm text-soft">{[a.address, a.city].filter(Boolean).join(', ')}</p>
            {a.mapUrl && <a href={a.mapUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-semibold text-cyan">Open in Maps →</a>}
          </div>
          <div className="rounded-3xl border border-line bg-panel/70 p-5 space-y-2">
            <Phone className="w-5 h-5 text-cyan" />
            <h3 className="font-semibold">Talk to us</h3>
            {a.phone && <a href={`tel:${a.phone}`} className="block text-sm text-soft">{a.phone}</a>}
            <div className="flex flex-wrap gap-2">
              {a.whatsapp && <a href={`https://wa.me/${a.whatsapp}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/15 text-[#25D366] px-3 py-1.5 text-sm font-semibold"><WhatsAppIcon className="w-4 h-4" /> WhatsApp</a>}
              {a.instagram && <a href={`https://ig.me/m/${a.instagram}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-pink/15 text-pink px-3 py-1.5 text-sm font-semibold"><InstagramIcon className="w-4 h-4" /> DM us</a>}
            </div>
          </div>
        </section>

        <div className="text-center">
          <Link href="/" className="btn-lime inline-block rounded-2xl px-8 py-4 font-bold">Book a court</Link>
        </div>
      </main>
      <MobileNav />
    </>
  );
}
