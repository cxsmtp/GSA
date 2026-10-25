// Makes .next/standalone a complete, self-contained app: `node .next/standalone/server.js`.
import fs from 'node:fs';

const out = '.next/standalone';
if (fs.existsSync(out)) {
  fs.cpSync('public', `${out}/public`, { recursive: true });
  fs.cpSync('.next/static', `${out}/.next/static`, { recursive: true });
  console.log('standalone build ready: node .next/standalone/server.js');
}
