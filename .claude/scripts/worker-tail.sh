#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/worker-runtime.sh"

PROJECT_DIR="${1:?project dir required}"
WORKER_NAME="${2:?worker name required}"

PROJECT_DIR_WSL="$(to_wsl_path "$PROJECT_DIR")"
LOG_FILE="$PROJECT_DIR_WSL/.claude/logs/${WORKER_NAME}.log"
LOG_FILE_Q="$(shell_quote "$LOG_FILE")"

if RUNTIME_MODE="$(select_tmux_runtime)"; then
  TAIL_SCRIPT="
if [[ -f $LOG_FILE_Q ]]; then
  tail -n 120 $LOG_FILE_Q
fi
"
  run_in_runtime "$TAIL_SCRIPT" "$RUNTIME_MODE"
  exit 0
fi

LOCAL_LOG_FILE="$PROJECT_DIR/.claude/logs/${WORKER_NAME}.log"
if [[ -f "$LOCAL_LOG_FILE" ]]; then
  tail -n 120 "$LOCAL_LOG_FILE"
fi
