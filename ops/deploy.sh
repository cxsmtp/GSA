#!/usr/bin/env bash
# Build the latest code as a new release, switch to it, check it answers, and roll back if not.
#   sudo gsa-update
# Each release lives in /opt/gsa/releases/<commit>; /opt/gsa/current points at the live one.
set -euo pipefail

REPO="${REPO:-https://github.com/cxsmtp/GSA.git}"
BRANCH="${BRANCH:-claude/badminton-booking-portal-m9ll2i}"
BASE=/opt/gsa
KEEP=3
[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo."; exit 1; }
as_gsa() { runuser -u gsa -- env HOME="$BASE" "$@"; }

SHA="$(git ls-remote "$REPO" "refs/heads/$BRANCH" | cut -c1-12)"
[ -n "$SHA" ] || { echo "Branch $BRANCH not found in $REPO"; exit 1; }
DIR="$BASE/releases/$SHA"
PREV="$(readlink -f "$BASE/current" 2>/dev/null || true)"

if [ "$PREV" = "$DIR" ]; then echo "Already running $SHA."; exit 0; fi

if [ ! -f "$DIR/.next/standalone/server.js" ]; then
  echo "Building $SHA ..."
  rm -rf "$DIR"
  as_gsa git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
  (cd "$DIR" && as_gsa npm ci --no-audit --no-fund --loglevel=error && as_gsa env NEXT_TELEMETRY_DISABLED=1 npm run build)
  chmod -R a-w "$DIR/.next/standalone"
fi

ln -sfn "$DIR" "$BASE/current.new" && mv -Tf "$BASE/current.new" "$BASE/current"
systemctl restart gsa.service

ok=""
for _ in $(seq 1 "${HEALTH_TRIES:-30}"); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "New version did not start."
  journalctl -u gsa.service -n 30 --no-pager || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    echo "Rolling back to $(basename "$PREV")."
    ln -sfn "$PREV" "$BASE/current.new" && mv -Tf "$BASE/current.new" "$BASE/current"
    systemctl restart gsa.service
  fi
  exit 1
fi
echo "Live: $SHA"

# Keep the newest releases (including the live one) for quick rollback.
live="$(readlink -f "$BASE/current")"
find "$BASE/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2- | while read -r old; do
  [ "$(readlink -f "$old")" = "$live" ] && continue
  chmod -R u+w "$old" && rm -rf "$old"
done
