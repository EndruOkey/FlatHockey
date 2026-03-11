#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/flathockey-prod}"
BRANCH="${BRANCH:-dev}"
SERVICE_NAME="${SERVICE_NAME:-flathockey-ws2}"
SERVICE_PORT="${SERVICE_PORT:-7778}"
RUNTIME_ENV="${RUNTIME_ENV:-dev}"
PID_FILE="${PID_FILE:-/tmp/${SERVICE_NAME}.pid}"
LOG_FILE="${LOG_FILE:-/tmp/${SERVICE_NAME}.log}"

cd "$APP_DIR"

git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"
git clean -fd

if ! command -v pnpm >/dev/null 2>&1 && [ ! -x /usr/bin/pnpm ]; then
  echo "pnpm is required for workspace installs but was not found."
  exit 1
fi

PNPM_BIN="pnpm"
if ! command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="/usr/bin/pnpm"
fi

INSTALL_ARGS="install --no-frozen-lockfile"
if [ -f pnpm-lock.yaml ]; then
  INSTALL_ARGS="install --frozen-lockfile"
fi

restart_service() {
  if systemctl restart "$SERVICE_NAME" >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE_NAME"; then
    return 0
  fi

  if command -v sudo >/dev/null 2>&1; then
    if sudo -n systemctl restart "$SERVICE_NAME" >/dev/null 2>&1 && sudo -n systemctl is-active --quiet "$SERVICE_NAME"; then
      return 0
    fi
  fi

  echo "systemctl unavailable -> using manual background process"

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1; then
    kill "$(cat "$PID_FILE")" >/dev/null 2>&1 || true
    sleep 1
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${SERVICE_PORT}/tcp" >/dev/null 2>&1 || true
    sleep 1
  fi

  nohup env PORT="$SERVICE_PORT" RUNTIME_ENV="$RUNTIME_ENV" "$PNPM_BIN" --filter @flathockey/server run start > "$LOG_FILE" 2>&1 < /dev/null &
  echo $! > "$PID_FILE"
  return 0
}

if [ ! -d node_modules ] || [ ! -x node_modules/.bin/tsc ]; then
  echo "Dependencies missing -> installing deps"
  "$PNPM_BIN" $INSTALL_ARGS
elif git rev-parse --verify HEAD@{1} >/dev/null 2>&1 && git diff --name-only HEAD@{1} HEAD | grep -q "pnpm-lock.yaml"; then
  echo "Lockfile changed -> installing deps"
  "$PNPM_BIN" $INSTALL_ARGS
else
  echo "Lockfile unchanged -> skipping pnpm install"
fi

"$PNPM_BIN" --filter @flathockey/server build

if ! restart_service; then
  echo "Service restart failed"
  exit 1
fi

echo "Waiting for health endpoint..."
for i in {1..10}; do
  if curl -fsS "http://127.0.0.1:${SERVICE_PORT}/health" >/dev/null; then
    echo "Health OK"
    exit 0
  fi
  sleep 1
done

echo "Health check failed"
exit 1
