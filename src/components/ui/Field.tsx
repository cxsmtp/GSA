export const inputCls =
  'w-full rounded-2xl bg-panel border border-line px-4 py-3 text-text placeholder:text-muted/70 focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/30 transition';

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label className="block space-y-1.5" htmlFor={htmlFor}>
      <span className="text-sm font-medium text-soft">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}
