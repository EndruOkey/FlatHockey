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

if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile || pnpm install
  pnpm run build
else
  npm ci || npm install
  npm run build
fi

SYSTEMD_UNIT="$SERVICE_NAME"
if [[ "$SYSTEMD_UNIT" != *.service ]]; then
  SYSTEMD_UNIT="${SYSTEMD_UNIT}.service"
fi

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^${SYSTEMD_UNIT}"; then
  sudo systemctl restart "$SYSTEMD_UNIT" || systemctl restart "$SYSTEMD_UNIT"
  sudo systemctl --no-pager --full status "$SYSTEMD_UNIT" | sed -n '1,20p' || true
elif command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME"
  pm2 status
else
  echo "No systemd service or pm2 process manager available for restart."
  exit 1
fi
