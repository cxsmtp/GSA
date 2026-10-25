#!/usr/bin/env bash
# Nightly backup: a consistent copy of the database plus uploaded files and keys, 14 days kept.
# Runs as the service user from gsa-backup.timer; also fine by hand: sudo -u gsa gsa-backup
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/gsa}"
OUT="${BACKUP_DIR:-/var/lib/gsa-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
umask 077

# VACUUM INTO writes a consistent copy even while the app is running.
node --disable-warning=ExperimentalWarning - "$DATA_DIR/gsa.db" "$WORK/gsa.db" <<'JS'
const { DatabaseSync } = require('node:sqlite');
const [src, dst] = process.argv.slice(2);
new DatabaseSync(src).exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
JS

extra=()
for f in media server.key; do [ -e "$DATA_DIR/$f" ] && extra+=("$f"); done
tar -czf "$OUT/gsa-$STAMP.tgz" -C "$WORK" gsa.db -C "$DATA_DIR" "${extra[@]}"
find "$OUT" -name 'gsa-*.tgz' -mtime +"$KEEP_DAYS" -delete
echo "Backup: $OUT/gsa-$STAMP.tgz"
