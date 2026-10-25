import { all, get, run } from './db';
import { hmac } from './secrets';

/**
 * Tamper-evident audit log (idea from the buh project): every money, booking and access change is
 * a row whose MAC covers the previous row's MAC and its own content. Editing, deleting or
 * reordering any row breaks the chain, and Settings → Audit log says so.
 */
export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
  mac: string;
}

function body(r: Omit<AuditRow, 'id' | 'mac'>, prev: string): string {
  return [prev, r.at, r.actor, r.action, r.entity, r.entity_id, r.detail].join('\n');
}

export function audit(actor: string, action: string, entity = '', entityId: string | number = '', detail: Record<string, unknown> = {}) {
  const prev = get<{ mac: string }>('SELECT mac FROM audit ORDER BY id DESC LIMIT 1')?.mac ?? 'genesis';
  const row = { at: new Date().toISOString(), actor, action, entity, entity_id: String(entityId), detail: JSON.stringify(detail).slice(0, 4000) };
  run('INSERT INTO audit (at, actor, action, entity, entity_id, detail, mac) VALUES (?,?,?,?,?,?,?)', row.at, row.actor, row.action, row.entity, row.entity_id, row.detail, hmac('audit', body(row, prev)));
}

export function verifyAudit(): { ok: boolean; count: number; brokenAt?: number } {
  const rows = all<AuditRow>('SELECT * FROM audit ORDER BY id');
  let prev = 'genesis';
  for (const r of rows) {
    if (hmac('audit', body(r, prev)) !== r.mac) return { ok: false, count: rows.length, brokenAt: r.id };
    prev = r.mac;
  }
  return { ok: true, count: rows.length };
}

export function recentAudit(limit = 200, before?: number): AuditRow[] {
  return before
    ? all<AuditRow>('SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT ?', before, limit)
    : all<AuditRow>('SELECT * FROM audit ORDER BY id DESC LIMIT ?', limit);
}
