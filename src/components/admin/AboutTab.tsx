'use client';

import { Camera, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Field, inputCls } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Btn, Card, Empty, fileToDataUrl, Spinner, staff, useAction, useStaff } from './ui';

interface Person { id: number; name: string; role: string; bio: string; highlights: string; photo_media: string | null; sort: number; visible: number }
interface About { headline: string; story: string; highlights: string[] }

/** The public About page: story, highlights, coaches and key people. Admin and coach can edit. */
export function AboutTab() {
  const { data, loading, reload } = useStaff<{ people: Person[]; about: About }>('people');
  const [edit, setEdit] = useState<Person | 'new' | null>(null);
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <AboutText about={data.about} />
      <Card title="Coaches & key people" action={<Btn tone="lime" onClick={() => setEdit('new')}><Plus className="w-4 h-4" /> Add</Btn>}>
        {data.people.length === 0 ? <Empty>Add your head coach, coaches, owners and staff.</Empty> : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.people.map((p) => (
              <li key={p.id}>
                <button onClick={() => setEdit(p)} className="w-full flex items-center gap-3 rounded-2xl border border-line p-3 text-left hover:border-cyan">
                  {p.photo_media ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${p.photo_media}`} alt="" className="w-14 h-14 rounded-2xl object-cover" />
                  ) : <span className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet to-cyan grid place-items-center font-display font-bold text-ink">{p.name[0]}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-soft truncate">{p.role}</div>
                  </div>
                  {p.visible ? <Eye className="w-4 h-4 text-ok" /> : <EyeOff className="w-4 h-4 text-muted" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        <a href="/about" target="_blank" rel="noopener" className="mt-3 inline-block text-xs text-cyan font-semibold">View About page →</a>
      </Card>
      <PersonSheet person={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void reload(); }} />
    </div>
  );
}

function AboutText({ about }: { about: About }) {
  const { busy, run } = useAction();
  const [headline, setHeadline] = useState(about.headline);
  const [story, setStory] = useState(about.story);
  const [hl, setHl] = useState(about.highlights.join('\n'));
  return (
    <Card title="Academy story">
      <div className="space-y-3">
        <Field label="Headline"><input className={inputCls} value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={100} /></Field>
        <Field label="Story"><textarea className={`${inputCls} min-h-28`} value={story} onChange={(e) => setStory(e.target.value)} maxLength={3000} /></Field>
        <Field label="Highlights (one per line)"><textarea className={`${inputCls} min-h-20`} value={hl} onChange={(e) => setHl(e.target.value)} /></Field>
        <Btn tone="lime" busy={busy} onClick={() => run(() => staff('about', 'PUT', { headline, story, highlights: hl.split('\n').map((x) => x.trim()).filter(Boolean) }), 'About page saved')}>Save</Btn>
      </div>
    </Card>
  );
}

function PersonSheet({ person, onClose, onDone }: { person: Person | 'new' | null; onClose: () => void; onDone: () => void }) {
  const p = person && person !== 'new' ? person : null;
  return (
    <Sheet open={person !== null} onClose={onClose} title={p ? `Edit ${p.name}` : 'Add a person'}>
      {person !== null && <PersonForm key={p?.id ?? 'new'} p={p} onDone={onDone} />}
    </Sheet>
  );
}

function PersonForm({ p, onDone }: { p: Person | null; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: p?.name ?? '', role: p?.role ?? 'Head Coach', bio: p?.bio ?? '', highlights: p?.highlights ?? '', sort: String(p?.sort ?? 0), visible: p ? p.visible === 1 : true });
  const [photo, setPhoto] = useState<string | null>(null);
  const set = (k: 'name' | 'role' | 'bio' | 'highlights' | 'sort') => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, sort: Number(f.sort) || 0, photo: photo || undefined };
    if (await run(() => (p ? staff(`people/${p.id}`, 'PATCH', body) : staff('people', 'POST', body)), 'Saved')) onDone();
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <label className="flex items-center gap-3 cursor-pointer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo || p?.photo_media ? <img src={photo || `/api/media/${p!.photo_media}`} alt="" className="w-20 h-20 rounded-2xl object-cover" /> : <span className="w-20 h-20 rounded-2xl border border-dashed border-line grid place-items-center"><Camera className="w-6 h-6 text-muted" /></span>}
        <span className="text-sm font-semibold text-cyan">{photo || p?.photo_media ? 'Change photo' : 'Add photo'}</span>
        <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setPhoto(await fileToDataUrl(file, 1200)); }} />
      </label>
      <Field label="Name"><input className={inputCls} value={f.name} onChange={set('name')} required maxLength={80} /></Field>
      <Field label="Role"><input className={inputCls} value={f.role} onChange={set('role')} maxLength={80} placeholder="Head Coach, Founder, Manager…" /></Field>
      <Field label="About them"><textarea className={`${inputCls} min-h-24`} value={f.bio} onChange={set('bio')} maxLength={1500} /></Field>
      <Field label="Achievements (one per line)"><textarea className={`${inputCls} min-h-20`} value={f.highlights} onChange={set('highlights')} maxLength={1000} placeholder={'State champion 2019\nBWF Level 1 coach'} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order"><input className={inputCls} value={f.sort} onChange={set('sort')} inputMode="numeric" /></Field>
        <label className="flex items-center gap-2 text-sm mt-7"><input type="checkbox" className="accent-lime w-5 h-5" checked={f.visible} onChange={(e) => setF({ ...f, visible: e.target.checked })} /> Show on site</label>
      </div>
      <div className="flex gap-2">
        {p && <Btn type="button" tone="bad" busy={busy} onClick={async () => { if (confirm(`Remove ${p.name}?`) && (await run(() => staff(`people/${p.id}`, 'DELETE'), 'Removed'))) onDone(); }}><Trash2 className="w-4 h-4" /></Btn>}
        <Btn tone="lime" busy={busy} className="flex-1 py-3">Save</Btn>
      </div>
    </form>
  );
}
