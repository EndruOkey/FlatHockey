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

npm ci || npm install
npm run build

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
