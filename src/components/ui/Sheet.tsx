'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

/** A bottom sheet on phones, a centred dialog on wider screens. Escape and the backdrop close it. */
export function Sheet({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div ref={ref} tabIndex={-1} className={`relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-night border border-line shadow-2xl rise outline-none`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 pt-4 pb-3 bg-night/95 backdrop-blur border-b border-line/60">
          <div className="mx-auto absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-panel-2" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
