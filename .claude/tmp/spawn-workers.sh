#!/usr/bin/env bash
set -euo pipefail

PROJECT="/mnt/c/Games/flathockey-move-rework"
LOG_DIR="$PROJECT/.claude/logs"
STATE_DIR="$PROJECT/.claude/worker-state"
TMP_DIR="$PROJECT/.claude/tmp"

mkdir -p "$LOG_DIR" "$STATE_DIR"

spawn_worker() {
  local name="$1"
  local prompt_file="$2"
  local session="fh-${name}"

  tmux has-session -t "$session" 2>/dev/null && tmux kill-session -t "$session" || true
  rm -f "$STATE_DIR/${name}.done" "$STATE_DIR/${name}.exit"

  tmux new-session -d -s "$session" -c "$PROJECT"
  tmux send-keys -t "$session" "claude -p \"\$(cat '${prompt_file}')\" </dev/null 2>&1 | tee '${LOG_DIR}/${name}.log'; echo \"\${PIPESTATUS[0]}\" > '${STATE_DIR}/${name}.exit'; touch '${STATE_DIR}/${name}.done'" C-m

  echo "spawned: $session"
}

spawn_worker "movement" "$TMP_DIR/movement-bugs.md"
spawn_worker "puck"     "$TMP_DIR/puck-bugs.md"
spawn_worker "combat"   "$TMP_DIR/combat-bugs.md"

echo "all workers spawned"
