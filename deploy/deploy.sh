#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/flathockey-prod"
BRANCH="dev"
SERVICE_NAME="${SERVICE_NAME:-flathockey-prod}"

cd "$APP_DIR"

git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

pnpm install

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,20p'
