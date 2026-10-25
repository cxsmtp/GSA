#!/usr/bin/env bash
# One-time server setup on Ubuntu 22.04/24.04 (x86_64 or arm64), e.g. an Oracle Cloud Always Free VM.
#   sudo bash ops/setup.sh
# Installs Node.js (checksum-verified), creates an unprivileged service user, builds and starts the app
# behind systemd on 127.0.0.1:3000, schedules nightly backups and installs Cloudflare Tunnel.
# Safe to run again: it keeps the existing settings file and data.
set -euo pipefail

REPO="${REPO:-https://github.com/cxsmtp/GSA.git}"
BRANCH="${BRANCH:-claude/badminton-booking-portal-m9ll2i}"
NODE_MAJOR="${NODE_MAJOR:-24}"
BASE=/opt/gsa
DATA_DIR=/var/lib/gsa
BACKUP_DIR=/var/lib/gsa-backups
ENV_FILE=/etc/gsa.env
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo: sudo bash ops/setup.sh"; exit 1; }
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

say "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git gnupg xz-utils unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

# Small machines (1 GB) need swap to build.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 3000000 ] && ! swapon --show | grep -q .; then
  say "Adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null || ! node -v | grep -q "^v${NODE_MAJOR}\."; then
  say "Node.js ${NODE_MAJOR} (official build, SHA-256 checked)"
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;;
  esac
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE="$(grep -oE "node-v[0-9.]+-linux-${ARCH}\.tar\.xz" "$TMP/SHASUMS256.txt" | head -1)"
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${FILE}" -o "$TMP/$FILE"
  (cd "$TMP" && grep " ${FILE}\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf /usr/local/lib/nodejs && mkdir -p /usr/local/lib/nodejs
  tar -xJf "$TMP/$FILE" -C /usr/local/lib/nodejs --strip-components=1
  for b in node npm npx; do ln -sf "/usr/local/lib/nodejs/bin/$b" "/usr/local/bin/$b"; done
  rm -rf "$TMP"
fi
node -v

say "Service user and folders"
id gsa >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin gsa
install -d -o gsa -g gsa -m 750 "$BASE" "$BASE/releases"
install -d -o gsa -g gsa -m 700 "$DATA_DIR" "$BACKUP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  say "Settings"
  DOMAIN="${DOMAIN:-}"
  if [ -z "$DOMAIN" ] && [ -t 0 ]; then read -rp "Your domain (e.g. example.in): " DOMAIN; fi
  [ -n "$DOMAIN" ] || { echo "Set DOMAIN, e.g. sudo DOMAIN=example.in bash ops/setup.sh"; exit 1; }
  ADMIN_PW="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  umask 077
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=3000
HOSTNAME=127.0.0.1
DATA_DIR=$DATA_DIR
TRUST_PROXY=1
APP_URL=https://$DOMAIN
ADMIN_USERNAME=admin
ADMIN_INITIAL_PASSWORD=$ADMIN_PW
NODE_OPTIONS=--disable-warning=ExperimentalWarning
# Optional Razorpay keys:
# RAZORPAY_KEY_ID=
# RAZORPAY_KEY_SECRET=
# RAZORPAY_WEBHOOK_SECRET=
ENV
  chown root:root "$ENV_FILE" && chmod 600 "$ENV_FILE"
  echo
  echo "  First admin sign-in:  https://$DOMAIN/admin"
  echo "  Username: admin   One-time password: $ADMIN_PW"
  echo "  (Write it down now. You choose your own password at first sign-in.)"
fi

say "Service files"
install -m 644 "$HERE/gsa.service" /etc/systemd/system/gsa.service
install -m 644 "$HERE/gsa-backup.service" /etc/systemd/system/gsa-backup.service
install -m 644 "$HERE/gsa-backup.timer" /etc/systemd/system/gsa-backup.timer
install -m 755 "$HERE/deploy.sh" /usr/local/sbin/gsa-update
install -m 755 "$HERE/backup.sh" /usr/local/sbin/gsa-backup
systemctl daemon-reload
systemctl enable gsa.service gsa-backup.timer >/dev/null

say "Building and starting the app (a few minutes)"
REPO="$REPO" BRANCH="$BRANCH" /usr/local/sbin/gsa-update
systemctl start gsa-backup.timer

if ! command -v cloudflared >/dev/null; then
  say "Cloudflare Tunnel"
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -y && apt-get install -y cloudflared
fi
if [ -n "${TUNNEL_TOKEN:-}" ] && ! systemctl is-enabled cloudflared >/dev/null 2>&1; then
  cloudflared service install "$TUNNEL_TOKEN"
fi

say "Done"
systemctl --no-pager --lines=0 status gsa.service || true
if systemctl is-enabled cloudflared >/dev/null 2>&1; then
  echo "Tunnel: installed. Open https://<your domain>."
else
  echo "Next: create the tunnel in Cloudflare and run:  sudo cloudflared service install <TOKEN>"
fi
