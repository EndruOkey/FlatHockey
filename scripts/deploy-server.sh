#!/usr/bin/env bash
set -euo pipefail

cd /opt/flathockey-prod
git pull
pnpm install
pm2 restart flathockey

