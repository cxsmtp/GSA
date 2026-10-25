import fs from 'node:fs';
import path from 'node:path';
import { get, run } from './db';
import { mediaDir } from './dataDir';
import { HttpError } from './http';
import { randomToken } from './secrets';

/**
 * Uploaded files (coach photos: public; expense bills: admin only). The type is decided from the
 * file's own first bytes, never from its name or the browser's word, and only images and PDFs are
 * kept. Files live in DATA_DIR/media under random names.
 */
const MAX_BYTES = 4 * 1024 * 1024;

function sniff(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** A data: URL from the browser → stored file id. */
export function saveDataUrl(dataUrl: unknown, visibility: 'public' | 'private', actor: string, { allowPdf = false } = {}): string {
  if (typeof dataUrl !== 'string') throw new HttpError(400, 'File is required.');
  const m = /^data:[\w/+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'File could not be read.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'File is too large (max 4 MB).');
  const mime = sniff(buf);
  if (!mime || (mime === 'application/pdf' && !allowPdf)) throw new HttpError(415, allowPdf ? 'Use a photo (JPEG, PNG, WebP) or a PDF.' : 'Use a photo (JPEG, PNG or WebP).');
  const id = randomToken(18);
  fs.writeFileSync(path.join(mediaDir(), id), buf, { mode: 0o600 });
  run('INSERT INTO media (id, visibility, mime, size, created_by, created_at) VALUES (?,?,?,?,?,?)', id, visibility, mime, buf.length, actor, new Date().toISOString());
  return id;
}

export function readMedia(id: string, visibility: 'public' | 'private' | 'any'): { mime: string; body: Buffer } | null {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) return null;
  const row = get<{ mime: string; visibility: string }>('SELECT mime, visibility FROM media WHERE id = ?', id);
  if (!row || (visibility !== 'any' && row.visibility !== visibility)) return null;
  try {
    return { mime: row.mime, body: fs.readFileSync(path.join(/*turbopackIgnore: true*/ mediaDir(), id)) };
  } catch {
    return null;
  }
}
