import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Everything the portal keeps (database, photos, bills, keys) lives in one folder. Back up this one
 * folder and you have it all.
 *
 *  - DATA_DIR when set.
 *  - Production without DATA_DIR: ~/gsa-data in the hosting account's home folder. Managed Node.js
 *    hosting replaces the app's own folder on every deployment, so data must never live inside it.
 *  - Development: ./data.
 */
let announced = false;

export function dataDir(): string {
  const fallback =
    process.env.NODE_ENV === 'production' ? path.join(/*turbopackIgnore: true*/ os.homedir(), 'gsa-data') : path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || fallback);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!announced) {
    announced = true;
    if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify({ level: 'info', event: 'data_dir', dir }));
  }
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
