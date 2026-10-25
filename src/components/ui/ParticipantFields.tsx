'use client';

import { GUARDIAN_RELATIONS, HEALTH_NONE, HEALTH_OPTIONS } from '@/lib/shared/participant';
import { Field, inputCls } from './Field';

export interface ParticipantState {
  conditions: string[];
  note: string;
  minor: boolean | null;
  guardianName: string;
  guardianPhone: string;
  guardianRelation: string;
  consent: boolean;
}

export const EMPTY_PARTICIPANT: ParticipantState = { conditions: [], note: '', minor: null, guardianName: '', guardianPhone: '', guardianRelation: '', consent: false };

/** The request body fields (the server checks them again). */
export function participantBody(p: ParticipantState) {
  return {
    health: { conditions: p.conditions, note: p.note || undefined },
    minor: p.minor,
    guardian: p.minor ? { name: p.guardianName, phone: p.guardianPhone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''), relation: p.guardianRelation, consent: p.consent } : undefined,
  };
}

/** What is still missing, in plain words; null when complete. */
export function participantProblem(p: ParticipantState): string | null {
  if (!p.conditions.length) return 'Please answer the health question (choose “None” if nothing applies).';
  if (p.conditions.includes('Other') && !p.note.trim()) return 'Please describe the other health condition.';
  if (p.minor === null) return 'Please say whether the player is under 18.';
  if (p.minor) {
    if (p.guardianName.trim().length < 2) return 'Enter the parent / guardian’s full name.';
    if (!/^[6-9]\d{9}$/.test(p.guardianPhone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''))) return 'Enter the parent / guardian’s 10-digit mobile.';
    if (!p.guardianRelation) return 'Choose the guardian’s relationship to the player.';
    if (!p.consent) return 'The parent / guardian must give consent.';
  }
  return null;
}

/**
 * Health (multi-select, "None" exclusive) and under 18 → guardian details with consent. Used by the
 * player's booking form and the staff phone-booking form, so both ask exactly the same.
 */
export function ParticipantFields({ value, onChange, staff = false }: { value: ParticipantState; onChange: (v: ParticipantState) => void; staff?: boolean }) {
  const set = (patch: Partial<ParticipantState>) => onChange({ ...value, ...patch });
  const toggle = (c: string) => {
    if (c === HEALTH_NONE) return set({ conditions: value.conditions.includes(HEALTH_NONE) ? [] : [HEALTH_NONE], note: '' });
    const rest = value.conditions.filter((x) => x !== HEALTH_NONE);
    set({ conditions: rest.includes(c) ? rest.filter((x) => x !== c) : [...rest, c] });
  };
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-xs font-semibold transition ${on ? 'bg-lime text-ink border-lime' : 'border-line text-soft hover:border-cyan'}`;
  const hasCondition = value.conditions.some((c) => c !== HEALTH_NONE);
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-soft">{staff ? 'Ask: any health condition we should know about?' : 'Any health condition we should know about?'} <span className="text-bad">*</span></legend>
        <p className="text-[11px] text-muted">Only for your safety on court; seen by staff, never shared. Choose “None” if you prefer not to say.</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={value.conditions.includes(HEALTH_NONE)} onClick={() => toggle(HEALTH_NONE)} className={chip(value.conditions.includes(HEALTH_NONE))}>{HEALTH_NONE}</button>
          {HEALTH_OPTIONS.map((c) => (
            <button type="button" key={c} aria-pressed={value.conditions.includes(c)} onClick={() => toggle(c)} className={chip(value.conditions.includes(c))}>{c}</button>
          ))}
        </div>
        {hasCondition && (
          <input className={inputCls} value={value.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} placeholder={value.conditions.includes('Other') ? 'Please describe (required)' : 'Anything staff should do (optional), e.g. carries an inhaler'} aria-label="Health details" />
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-soft">Is the player under 18? <span className="text-bad">*</span></legend>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={value.minor === false} onClick={() => set({ minor: false })} className={`rounded-xl py-2.5 text-sm font-bold border ${value.minor === false ? 'bg-lime text-ink border-lime' : 'border-line text-soft'}`}>No, 18 or older</button>
          <button type="button" aria-pressed={value.minor === true} onClick={() => set({ minor: true })} className={`rounded-xl py-2.5 text-sm font-bold border ${value.minor === true ? 'bg-amber text-ink border-amber' : 'border-line text-soft'}`}>Yes, under 18</button>
        </div>
        {value.minor && (
          <div className="rounded-2xl border border-amber/40 bg-amber/[0.07] p-3 space-y-3">
            <p className="text-xs text-amber font-semibold">Parent / guardian details are required for players under 18.</p>
            <Field label="Parent / guardian full name *">
              <input className={inputCls} value={value.guardianName} onChange={(e) => set({ guardianName: e.target.value })} maxLength={80} autoComplete="off" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Guardian mobile *">
                <input className={inputCls} value={value.guardianPhone} onChange={(e) => set({ guardianPhone: e.target.value })} inputMode="numeric" maxLength={14} placeholder="98XXXXXXXX" />
              </Field>
              <Field label="Relationship *">
                <select className={inputCls} value={value.guardianRelation} onChange={(e) => set({ guardianRelation: e.target.value })}>
                  <option value="">Choose…</option>
                  {GUARDIAN_RELATIONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
            </div>
            <label className="flex items-start gap-3 text-xs text-soft">
              <input type="checkbox" checked={value.consent} onChange={(e) => set({ consent: e.target.checked })} className="mt-0.5 w-5 h-5 accent-lime shrink-0" />
              {staff ? 'The parent / guardian confirmed by phone that they consent to this booking and are responsible for the player.' : 'I am the parent / guardian (or have their permission), I consent to this booking and I am responsible for the player.'}
            </label>
          </div>
        )}
      </fieldset>
    </div>
  );
}
