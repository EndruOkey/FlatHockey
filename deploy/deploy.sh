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

EXPECTED_COMMIT="$(git rev-parse HEAD)"
EXPECTED_PROTO="$(sed -n 's/^export const NET_PROTOCOL_VERSION = \([0-9][0-9]*\);$/\1/p' shared/src/net/protocol.ts | head -n 1)"
if [ -z "$EXPECTED_PROTO" ]; then
  echo "Unable to resolve expected protocol version"
  exit 1
fi

restart_service() {
  if command -v sudo >/dev/null 2>&1; then
    sudo -n systemctl set-environment BUILD_VERSION="$EXPECTED_COMMIT" RUNTIME_ENV="$RUNTIME_ENV" PORT="$SERVICE_PORT" || true
  fi

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

  nohup env PORT="$SERVICE_PORT" RUNTIME_ENV="$RUNTIME_ENV" BUILD_VERSION="$EXPECTED_COMMIT" "$PNPM_BIN" --filter @flathockey/server run start > "$LOG_FILE" 2>&1 < /dev/null &
  echo $! > "$PID_FILE"
  return 0
}

verify_runtime_contract() {
  local runtime_json runtime_proto runtime_env runtime_build runtime_pid runtime_cwd runtime_app_dir listen_pid
  runtime_json="$(curl -fsS "http://127.0.0.1:${SERVICE_PORT}/health")"
  runtime_proto="$(node -p "const data = JSON.parse(process.argv[1]); String(data.config?.protocolVersion ?? '')" "$runtime_json")"
  runtime_env="$(node -p "const data = JSON.parse(process.argv[1]); String(data.config?.runtimeEnv ?? '')" "$runtime_json")"
  runtime_build="$(node -p "const data = JSON.parse(process.argv[1]); String(data.config?.serverBuild ?? '')" "$runtime_json")"
  runtime_pid="$(node -p "const data = JSON.parse(process.argv[1]); String(data.config?.pid ?? '')" "$runtime_json")"
  runtime_cwd="$(node -p "const data = JSON.parse(process.argv[1]); String(data.config?.cwd ?? '')" "$runtime_json")"
  runtime_app_dir="$(node -p "const data = JSON.parse(process.argv[1]); String(data.config?.appDir ?? '')" "$runtime_json")"
  listen_pid="$(ss -lntp | awk '/:'"$SERVICE_PORT"'/ {print $NF}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -n 1)"

  echo "Runtime contract:"
  echo "  commit=$EXPECTED_COMMIT"
  echo "  app_dir=$APP_DIR"
  echo "  protocol=$runtime_proto"
  echo "  runtime_env=$runtime_env"
  echo "  runtime_build=$runtime_build"
  echo "  health_pid=$runtime_pid"
  echo "  port_pid=$listen_pid"
  echo "  cwd=$runtime_cwd"
  echo "  app_dir_reported=$runtime_app_dir"

  if [ "$runtime_proto" != "$EXPECTED_PROTO" ]; then
    echo "Protocol mismatch: expected $EXPECTED_PROTO got $runtime_proto"
    exit 1
  fi
  if [ "$runtime_env" != "$RUNTIME_ENV" ]; then
    echo "Runtime mismatch: expected $RUNTIME_ENV got $runtime_env"
    exit 1
  fi
  if [ "$runtime_build" != "$EXPECTED_COMMIT" ]; then
    echo "Build mismatch: expected $EXPECTED_COMMIT got $runtime_build"
    exit 1
  fi
  if [ "$runtime_app_dir" != "$APP_DIR" ]; then
    echo "App dir mismatch: expected $APP_DIR got $runtime_app_dir"
    exit 1
  fi
  if [ -z "$listen_pid" ] || [ "$runtime_pid" != "$listen_pid" ]; then
    echo "PID mismatch: health_pid=$runtime_pid port_pid=$listen_pid"
    exit 1
  fi
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
    verify_runtime_contract
    exit 0
  fi
  sleep 1
done

echo "Health check failed"
exit 1
