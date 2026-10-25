import { DatabaseSync } from 'node:sqlite';
import { dataFile } from './dataDir';

/**
 * One SQLite database (DATA_DIR/gsa.db) through Node's built-in driver: nothing native to compile,
 * so it runs on managed Node.js hosting as is.
 *
 * Schema changes are new numbered entries at the end of MIGRATIONS; never edit one that has shipped.
 * Money is whole paise (integers). Dates are IST 'YYYY-MM-DD'; slot times are minutes since midnight.
 * Double booking is impossible by construction: booking_slots has UNIQUE(space_id, date, start_min),
 * and a slot row exists only while its booking holds the space.
 */

const MIGRATIONS: string[] = [
  // 1: everything
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','manager')),
    password_hash TEXT NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 1,
    totp_secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    session_gen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    gen INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ip TEXT,
    ua TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE spaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE price_rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    space_id INTEGER REFERENCES spaces(id),
    days TEXT NOT NULL DEFAULT '0123456',
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL,
    price_paise INTEGER NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE blocks (
    id INTEGER PRIMARY KEY,
    space_id INTEGER REFERENCES spaces(id),
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    days TEXT NOT NULL DEFAULT '0123456',
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX blocks_range ON blocks(date_from, date_to);

  CREATE TABLE bookings (
    id INTEGER PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    gstin TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('held','reserved','submitted','confirmed','cancelled','expired')),
    source TEXT NOT NULL DEFAULT 'online',
    channel TEXT NOT NULL DEFAULT 'web',
    slots_json TEXT NOT NULL,
    base_paise INTEGER NOT NULL,
    amount_paise INTEGER NOT NULL,
    hold_expires_at INTEGER,
    confirm_code TEXT NOT NULL,
    wa_opened_at TEXT,
    wa_sent_at TEXT,
    note TEXT NOT NULL DEFAULT '',
    cancel_reason TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX bookings_date ON bookings(date);
  CREATE INDEX bookings_status ON bookings(status);
  CREATE INDEX bookings_phone ON bookings(phone);

  CREATE TABLE booking_slots (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    space_id INTEGER NOT NULL REFERENCES spaces(id),
    date TEXT NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL,
    price_paise INTEGER NOT NULL,
    UNIQUE (space_id, date, start_min)
  );
  CREATE INDEX booking_slots_date ON booking_slots(date);
  CREATE INDEX booking_slots_booking ON booking_slots(booking_id);

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    fy TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('tax_invoice','bill_of_supply','receipt')),
    date TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    booking_id INTEGER REFERENCES bookings(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_gstin TEXT NOT NULL DEFAULT '',
    customer_address TEXT NOT NULL DEFAULT '',
    place_of_supply TEXT NOT NULL,
    items_json TEXT NOT NULL,
    taxable_paise INTEGER NOT NULL,
    cgst_paise INTEGER NOT NULL DEFAULT 0,
    sgst_paise INTEGER NOT NULL DEFAULT 0,
    igst_paise INTEGER NOT NULL DEFAULT 0,
    total_paise INTEGER NOT NULL,
    seller_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled')),
    cancel_reason TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (fy, seq)
  );
  CREATE INDEX invoices_date ON invoices(date);

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    direction TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','refund')),
    booking_id INTEGER REFERENCES bookings(id),
    invoice_id INTEGER REFERENCES invoices(id),
    category TEXT NOT NULL DEFAULT 'space',
    method TEXT NOT NULL CHECK (method IN ('upi','razorpay','cash','card','bank','other')),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    reference TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('pending','verified','rejected')),
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    gateway_order_id TEXT,
    gateway_payment_id TEXT UNIQUE,
    created_by TEXT,
    created_at TEXT NOT NULL,
    verified_by TEXT,
    verified_at TEXT
  );
  CREATE INDEX payments_date ON payments(date);
  CREATE INDEX payments_booking ON payments(booking_id);
  CREATE UNIQUE INDEX payments_reference_live ON payments(method, reference) WHERE reference <> '' AND status <> 'rejected' AND direction = 'in';

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    vendor TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    gst_paise INTEGER NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT 'upi',
    reference TEXT NOT NULL DEFAULT '',
    bill_media TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX expenses_date ON expenses(date);

  CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    highlights TEXT NOT NULL DEFAULT '',
    photo_media TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    visibility TEXT NOT NULL CHECK (visibility IN ('public','private')),
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER REFERENCES bookings(id),
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE audit (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '{}',
    mac TEXT NOT NULL
  );
  `,
  // 2: roles become a permission system (assistants), and cash custody: who took the money and
  // which manager answers for it until it is deposited and the admin confirms.
  `
  CREATE TABLE users_new (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','manager','assistant')),
    password_hash TEXT NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 1,
    totp_secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    session_gen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    reports_to INTEGER REFERENCES users(id)
  );
  INSERT INTO users_new (id, username, name, role, password_hash, must_change, totp_secret, active, session_gen, created_at, last_login_at)
    SELECT id, username, name, role, password_hash, must_change, totp_secret, active, session_gen, created_at, last_login_at FROM users;
  DROP TABLE users;
  ALTER TABLE users_new RENAME TO users;

  ALTER TABLE payments ADD COLUMN collected_by TEXT;
  ALTER TABLE payments ADD COLUMN custodian TEXT;
  UPDATE payments SET collected_by = created_by WHERE method = 'cash';
  CREATE INDEX payments_custodian ON payments(custodian) WHERE custodian IS NOT NULL;

  CREATE TABLE cash_deposits (
    id INTEGER PRIMARY KEY,
    custodian TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    method TEXT NOT NULL CHECK (method IN ('bank','handover')),
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    slip_media TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    decision_note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX cash_deposits_custodian ON cash_deposits(custodian, status);
  `,
  // 3: UPI payments confirm the booking at once; the admin ticks them off against the bank afterwards.
  `
  ALTER TABLE payments ADD COLUMN reconciled_at TEXT;
  ALTER TABLE payments ADD COLUMN reconciled_by TEXT;
  UPDATE payments SET reconciled_at = verified_at, reconciled_by = verified_by WHERE status = 'verified';
  `,
  // 4: health answers ('' = booked before the question existed) and under-18 guardian details.
  `
  ALTER TABLE bookings ADD COLUMN health_json TEXT NOT NULL DEFAULT '';
  ALTER TABLE bookings ADD COLUMN is_minor INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bookings ADD COLUMN guardian_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE bookings ADD COLUMN guardian_phone TEXT NOT NULL DEFAULT '';
  ALTER TABLE bookings ADD COLUMN guardian_relation TEXT NOT NULL DEFAULT '';
  ALTER TABLE bookings ADD COLUMN guardian_consent_at TEXT;
  `,
];

type Db = DatabaseSync;
const g = globalThis as unknown as { __gsaDb?: Db };

function open(): Db {
  const file = process.env.GSA_DB_FILE || dataFile('gsa.db');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;`);
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  if (version >= MIGRATIONS.length) return;
  // Rebuilding a table (the SQLite way to change a CHECK) needs foreign keys off for the copy; they are
  // checked again before anything commits.
  db.exec('PRAGMA foreign_keys = OFF');
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[version]);
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`Migration ${version + 1} broke ${broken.length} references.`);
      version += 1;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      db.exec('PRAGMA foreign_keys = ON');
      throw err;
    }
  }
  db.exec('PRAGMA foreign_keys = ON');
}

export function db(): Db {
  if (!g.__gsaDb) g.__gsaDb = open();
  return g.__gsaDb;
}

let depth = 0;
/** Run `fn` in one write transaction (nested calls join the outer one). */
export function tx<T>(fn: () => T): T {
  const d = db();
  if (depth > 0) return fn();
  d.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      d.exec('ROLLBACK');
    } catch {
      // already rolled back
    }
    throw err;
  } finally {
    depth--;
  }
}

/** Typed helpers: rows come back as plain objects. */
export function all<T>(sql: string, ...params: SqlParam[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}
export function get<T>(sql: string, ...params: SqlParam[]): T | undefined {
  return (db().prepare(sql).get(...params) as T | undefined) ?? undefined;
}
export function run(sql: string, ...params: SqlParam[]): { changes: number; lastId: number } {
  const r = db().prepare(sql).run(...params);
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}
export type SqlParam = string | number | null | bigint | Uint8Array;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

/** Test hook: close and forget the open database. */
export function _closeDb() {
  g.__gsaDb?.close();
  g.__gsaDb = undefined;
}
