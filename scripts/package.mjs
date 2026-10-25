// Makes a ready-to-run archive of the built app (after `npm run build`): dist/gsa-app-<version>.tgz.
// Runs anywhere Node.js 22.13+ runs, including phones (Termux), with no build step there.
// Leaves out the image library Next.js bundles for its image optimizer: this app turns that off,
// and the library is native code for one kind of computer only.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const src = '.next/standalone';
if (!fs.existsSync(path.join(src, 'server.js'))) {
  console.error('Run `npm run build` first.');
  process.exit(1);
}
const out = path.join('dist', 'gsa-app');
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist');
fs.cpSync(src, out, { recursive: true });
for (const dir of ['node_modules/@img', 'node_modules/sharp', 'src']) fs.rmSync(path.join(out, dir), { recursive: true, force: true });

fs.writeFileSync(
  path.join(out, 'start.sh'),
  `#!/bin/sh
# Starts the app on this device at http://127.0.0.1:3000 (Termux, Linux, macOS).
# Data is kept in ~/gsa-data (or DATA_DIR). Stop with Ctrl+C.
cd "$(dirname "$0")" || exit 1
if ! node -e "require('node:sqlite')" 2>/dev/null; then
  echo "Needs Node.js 22.13 or newer (found: $(node -v 2>/dev/null || echo none))."
  echo "Termux: pkg install nodejs-lts   (or: pkg install nodejs)"
  exit 1
fi
export NODE_ENV=production
export PORT="\${PORT:-3000}"
export HOSTNAME="\${BIND:-127.0.0.1}"
# Plain http on this device: allow the sign-in cookie without https. Remove when serving over https only.
export INSECURE_COOKIES="\${INSECURE_COOKIES:-1}"
export NODE_OPTIONS="--disable-warning=ExperimentalWarning"
echo "Starting on http://127.0.0.1:$PORT  (staff app: /admin)"
exec node server.js
`,
  { mode: 0o755 },
);

const file = `gsa-app-${pkg.version}.tgz`;
execFileSync('tar', ['-czf', path.join('dist', file), '-C', 'dist', 'gsa-app']);
const mb = (fs.statSync(path.join('dist', file)).size / 1e6).toFixed(1);
console.log(`dist/${file} (${mb} MB)`);
