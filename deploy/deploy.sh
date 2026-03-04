#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/flathockey-prod}"
BRANCH="${BRANCH:-dev}"
SERVICE_NAME="${SERVICE_NAME:-flathockey-ws2}"
PM2_APP_NAME="${PM2_APP_NAME:-flathockey-ws2}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:7778/health}"
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-30}"
HEALTHCHECK_INTERVAL_SECS="${HEALTHCHECK_INTERVAL_SECS:-1}"

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

wait_for_health() {
  local i=1
  while [ "$i" -le "$HEALTHCHECK_RETRIES" ]; do
    if curl -fsS "$HEALTHCHECK_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$HEALTHCHECK_INTERVAL_SECS"
    i=$((i + 1))
  done
  return 1
}

SYSTEMD_UNIT="$SERVICE_NAME"
if [[ "$SYSTEMD_UNIT" != *.service ]]; then
  SYSTEMD_UNIT="${SYSTEMD_UNIT}.service"
fi

if command -v systemctl >/dev/null 2>&1; then
  if sudo systemctl restart "$SYSTEMD_UNIT" || systemctl restart "$SYSTEMD_UNIT"; then
    sudo systemctl is-active --quiet "$SYSTEMD_UNIT" || systemctl is-active --quiet "$SYSTEMD_UNIT"
    wait_for_health
    sudo systemctl --no-pager --full status "$SYSTEMD_UNIT" | sed -n '1,20p' || true
    exit 0
  fi
fi

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME"
  wait_for_health
  pm2 status
  exit 0
fi

echo "No systemd service or pm2 process manager available for restart."
exit 1
