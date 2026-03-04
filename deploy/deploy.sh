#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/flathockey-prod}"
BRANCH="${BRANCH:-dev}"
SERVICE_NAME="${SERVICE_NAME:-flathockey-ws2}"

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

if git rev-parse --verify HEAD@{1} >/dev/null 2>&1 && git diff --name-only HEAD@{1} HEAD | grep -q "pnpm-lock.yaml"; then
  echo "Lockfile changed -> installing deps"
  "$PNPM_BIN" install --frozen-lockfile
else
  echo "Lockfile unchanged -> skipping pnpm install"
fi

"$PNPM_BIN" --filter @flathockey/server build

systemctl restart "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME"

echo "Waiting for health endpoint..."
for i in {1..10}; do
  if curl -fsS http://127.0.0.1:7778/health >/dev/null; then
    echo "Health OK"
    exit 0
  fi
  sleep 1
done

echo "Health check failed"
exit 1
