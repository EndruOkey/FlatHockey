#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/worker-runtime.sh"

PROJECT_DIR="${1:?project dir required}"
WORKER_NAME="${2:?worker name required}"

RUNTIME_MODE="$(select_tmux_runtime)" || {
  echo "missing"
  exit 0
}

PROJECT_DIR_WSL="$(to_wsl_path "$PROJECT_DIR")"
SESSION_NAME="fh-${WORKER_NAME}"
STATE_DIR="$PROJECT_DIR_WSL/.claude/worker-state"
DONE_FILE="$STATE_DIR/${WORKER_NAME}.done"
EXIT_FILE="$STATE_DIR/${WORKER_NAME}.exit"

SESSION_Q="$(shell_quote "$SESSION_NAME")"
DONE_FILE_Q="$(shell_quote "$DONE_FILE")"
EXIT_FILE_Q="$(shell_quote "$EXIT_FILE")"

STATUS_SCRIPT="
if [[ -f $DONE_FILE_Q ]]; then
  if [[ -f $EXIT_FILE_Q ]]; then
    echo \"done:\$(cat $EXIT_FILE_Q)\"
  else
    echo done
  fi
  exit 0
fi

if tmux has-session -t $SESSION_Q 2>/dev/null; then
  echo running
else
  echo missing
fi
"

run_in_runtime "$STATUS_SCRIPT" "$RUNTIME_MODE"
