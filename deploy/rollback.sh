#!/usr/bin/env bash
set -e

APP_DIR=${APP_DIR:-/opt/flathockey-prod}
SERVICE_NAME=${SERVICE_NAME:-flathockey-ws2}

cd "$APP_DIR"

echo "Rolling back one commit..."

git reset --hard HEAD~1

pnpm --filter @flathockey/server build

sudo systemctl restart "$SERVICE_NAME"

echo "Rollback complete"
