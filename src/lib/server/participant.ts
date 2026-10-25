import { GUARDIAN_RELATIONS, HEALTH_NONE, HEALTH_OPTIONS, type Guardian, type Health } from '@/lib/shared/participant';
import { normalizeIndianMobile } from '@/lib/shared/whatsapp';
import { HttpError, str } from './http';

/**
 * The health and under-18 answers from a booking request, checked on the server. Both questions must be
 * answered; "None" is a valid answer to the first. An under-18 booking without a guardian's name,
 * valid mobile, relationship and consent is refused.
 */
export function parseParticipant(body: Record<string, unknown>): { health: Health; minor: boolean; guardian: Guardian | null } {
  const h = body.health as Record<string, unknown> | undefined;
  if (!h || typeof h !== 'object' || !Array.isArray(h.conditions) || !h.conditions.length) {
    throw new HttpError(400, 'Please answer the health question (choose “None” if nothing applies).');
  }
  const picked = [...new Set(h.conditions.map((c) => (typeof c === 'string' ? c : '')))];
  if (picked.some((c) => c !== HEALTH_NONE && !(HEALTH_OPTIONS as readonly string[]).includes(c))) throw new HttpError(400, 'Unknown health option.');
  if (picked.includes(HEALTH_NONE) && picked.length > 1) throw new HttpError(400, '“None” cannot be combined with other health conditions.');
  const conditions = picked.filter((c) => c !== HEALTH_NONE);
  const note = str(h.note, 'Health note', 300, { required: false });
  if (conditions.includes('Other') && !note) throw new HttpError(400, 'Please describe the other health condition.');
  const health: Health = { conditions, note: conditions.length ? note : '' };

  if (typeof body.minor !== 'boolean') throw new HttpError(400, 'Please say whether the player is under 18.');
  if (!body.minor) return { health, minor: false, guardian: null };
  const g = body.guardian as Record<string, unknown> | undefined;
  if (!g || typeof g !== 'object') throw new HttpError(400, 'Parent / guardian details are required for players under 18.');
  const name = str(g.name, 'Guardian name', 80);
  if (name.length < 2) throw new HttpError(400, 'Enter the parent / guardian’s full name.');
  const phone = normalizeIndianMobile(g.phone);
  if (!phone) throw new HttpError(400, 'Enter the parent / guardian’s 10-digit mobile number.');
  const relation = str(g.relation, 'Relationship', 30);
  if (!(GUARDIAN_RELATIONS as readonly string[]).includes(relation)) throw new HttpError(400, 'Choose the guardian’s relationship to the player.');
  if (g.consent !== true) throw new HttpError(400, 'The parent / guardian must give consent for a player under 18.');
  return { health, minor: true, guardian: { name, phone, relation } };
}
