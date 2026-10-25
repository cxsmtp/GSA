/**
 * Asked on every booking (online and phone):
 *  - health conditions the staff should know about; "None" is always an option, so nobody has to share
 *  - whether the player is under 18; if so, a parent or guardian's name, mobile, relationship and
 *    consent are mandatory (checked on the server, not only in the form)
 */
export const HEALTH_OPTIONS = [
  'Asthma / breathing',
  'Heart condition',
  'Diabetes',
  'Epilepsy / seizures',
  'High / low blood pressure',
  'Recent injury or surgery',
  'Joint or back problem',
  'Pregnancy',
  'Severe allergy',
  'Other',
] as const;

export const HEALTH_NONE = 'None';

export const GUARDIAN_RELATIONS = ['Mother', 'Father', 'Legal guardian', 'Other family'] as const;

export interface Health {
  conditions: string[];
  note: string;
}

export interface Guardian {
  name: string;
  phone: string;
  relation: string;
}

/** "None", or the conditions with any note: one line for staff screens and WhatsApp. */
export function healthLabel(h: Health | null): string {
  if (!h) return 'Not asked';
  if (!h.conditions.length) return HEALTH_NONE;
  return `${h.conditions.join(', ')}${h.note ? ` — ${h.note}` : ''}`;
}
