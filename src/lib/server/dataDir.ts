import fs from 'node:fs';
import path from 'node:path';

/**
 * Everything the portal keeps (database, photos, bills, keys) lives in one folder: DATA_DIR,
 * a Docker volume in production, ./data in development. Back up this one folder and you have it all.
 */
export function dataDir(): string {
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function dataFile(name: string): string {
  return path.join(dataDir(), name);
}

export function mediaDir(): string {
  const dir = path.join(dataDir(), 'media');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Write a file only this process's user can read. */
export function writePrivateFile(file: string, content: string | Buffer) {
  fs.writeFileSync(file, content, { mode: 0o600 });
}
