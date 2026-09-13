#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/worker-runtime.sh"

PROJECT_DIR="${1:?project dir required}"
WORKER_NAME="${2:?worker name required}"
PROMPT_FILE="${3:?prompt file required}"

RUNTIME_MODE="$(select_worker_runtime)" || {
  echo "No worker runtime available. Need native tmux+claude or WSL bridge tmux+claude in distro ${FH_WORKER_WSL_DISTRO}." >&2
  exit 1
}

PROJECT_DIR_WSL="$(to_wsl_path "$PROJECT_DIR")"
PROMPT_FILE_WSL="$(to_wsl_path "$PROMPT_FILE")"

SESSION_NAME="fh-${WORKER_NAME}"
LOG_DIR="$PROJECT_DIR_WSL/.claude/logs"
STATE_DIR="$PROJECT_DIR_WSL/.claude/worker-state"

LOG_FILE="$LOG_DIR/${WORKER_NAME}.log"
DONE_FILE="$STATE_DIR/${WORKER_NAME}.done"
EXIT_FILE="$STATE_DIR/${WORKER_NAME}.exit"

SESSION_Q="$(shell_quote "$SESSION_NAME")"
PROJECT_DIR_Q="$(shell_quote "$PROJECT_DIR_WSL")"
PROMPT_FILE_Q="$(shell_quote "$PROMPT_FILE_WSL")"
LOG_DIR_Q="$(shell_quote "$LOG_DIR")"
STATE_DIR_Q="$(shell_quote "$STATE_DIR")"
LOG_FILE_Q="$(shell_quote "$LOG_FILE")"
DONE_FILE_Q="$(shell_quote "$DONE_FILE")"
EXIT_FILE_Q="$(shell_quote "$EXIT_FILE")"

RUNNER_CMD="claude -p \"\$(cat $PROMPT_FILE_Q)\" </dev/null 2>&1 | tee $LOG_FILE_Q; echo \"\${PIPESTATUS[0]}\" > $EXIT_FILE_Q; touch $DONE_FILE_Q"
RUNNER_CMD_Q="$(shell_quote "$RUNNER_CMD")"

SPAWN_SCRIPT="
mkdir -p $LOG_DIR_Q $STATE_DIR_Q
tmux has-session -t $SESSION_Q 2>/dev/null && tmux kill-session -t $SESSION_Q || true
rm -f $DONE_FILE_Q $EXIT_FILE_Q
tmux new-session -d -s $SESSION_Q -c $PROJECT_DIR_Q
tmux send-keys -t $SESSION_Q $RUNNER_CMD_Q C-m
"

run_in_runtime "$SPAWN_SCRIPT" "$RUNTIME_MODE"

echo "$SESSION_NAME"
