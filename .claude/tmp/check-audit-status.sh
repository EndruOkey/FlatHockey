#!/usr/bin/env bash
STATE="/mnt/c/Games/flathockey-move-rework/.claude/worker-state"
LOGS="/mnt/c/Games/flathockey-move-rework/.claude/logs"
for w in audit-puck audit-stick audit-visual; do
  if [ -f "$STATE/$w.done" ]; then
    code=$(cat "$STATE/$w.exit" 2>/dev/null || echo "?")
    size=$(wc -l < "$LOGS/$w.log" 2>/dev/null || echo "?")
    echo "$w: DONE (exit $code, $size lines)"
  else
    size=$(wc -l < "$LOGS/$w.log" 2>/dev/null || echo "0")
    echo "$w: running... ($size lines so far)"
  fi
done
