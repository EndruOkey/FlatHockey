#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/worker-runtime.sh"

WORKER_NAME="${1:?worker name required}"
SESSION_NAME="fh-${WORKER_NAME}"
SESSION_Q="$(shell_quote "$SESSION_NAME")"

RUNTIME_MODE="$(select_tmux_runtime)" || exit 0

KILL_SCRIPT="
tmux has-session -t $SESSION_Q 2>/dev/null && tmux kill-session -t $SESSION_Q || true
"

run_in_runtime "$KILL_SCRIPT" "$RUNTIME_MODE"
