#!/usr/bin/env bash

PROJECT="/mnt/c/Games/flathockey-move-rework"
STATE_DIR="$PROJECT/.claude/worker-state"

workers=("movement" "puck" "combat")
max_wait=600  # 10 minutes
interval=10
elapsed=0

while true; do
  all_done=true
  for w in "${workers[@]}"; do
    if [[ ! -f "$STATE_DIR/${w}.done" ]]; then
      all_done=false
      echo "  waiting: $w (${elapsed}s)"
    else
      exit_code="$(cat "$STATE_DIR/${w}.exit" 2>/dev/null || echo '?')"
      echo "  done: $w (exit=$exit_code)"
    fi
  done

  if $all_done; then
    echo "ALL DONE"
    break
  fi

  if (( elapsed >= max_wait )); then
    echo "TIMEOUT after ${elapsed}s"
    break
  fi

  sleep "$interval"
  (( elapsed += interval ))
done
