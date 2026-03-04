#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/flathockey-prod}"
BRANCH="${BRANCH:-dev}"
SERVICE_NAME="${SERVICE_NAME:-flathockey-ws2}"
PM2_APP_NAME="${PM2_APP_NAME:-flathockey-ws2}"

cd "$APP_DIR"

git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"
git clean -fd

PNPM_BIN=""
if command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="pnpm"
elif [ -x /usr/bin/pnpm ]; then
  PNPM_BIN="/usr/bin/pnpm"
fi

if [ -z "$PNPM_BIN" ]; then
  echo "pnpm is required for workspace installs but was not found."
  exit 1
fi

if [ -n "$PNPM_BIN" ]; then
  if [ -f pnpm-lock.yaml ]; then
    "$PNPM_BIN" install --frozen-lockfile
  else
    "$PNPM_BIN" install --no-frozen-lockfile
  fi
  "$PNPM_BIN" run build
fi

SYSTEMD_UNIT="$SERVICE_NAME"
if [[ "$SYSTEMD_UNIT" != *.service ]]; then
  SYSTEMD_UNIT="${SYSTEMD_UNIT}.service"
fi

if command -v systemctl >/dev/null 2>&1; then
  if sudo systemctl restart "$SYSTEMD_UNIT" || systemctl restart "$SYSTEMD_UNIT"; then
    sudo systemctl --no-pager --full status "$SYSTEMD_UNIT" | sed -n '1,20p' || true
    exit 0
  fi
fi

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME"
  pm2 status
  exit 0
fi

echo "No systemd service or pm2 process manager available for restart."
exit 1
