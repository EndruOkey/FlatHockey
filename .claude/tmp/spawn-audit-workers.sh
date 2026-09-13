#!/usr/bin/env bash
set -euo pipefail

PROJECT="/mnt/c/Games/flathockey-move-rework"
SCRIPTS="$PROJECT/.claude/scripts"
TMP="$PROJECT/.claude/tmp"

echo "Spawning puck audit worker..."
bash "$SCRIPTS/worker-spawn.sh" "$PROJECT" "audit-puck" "$TMP/puck_audit_prompt.txt"

echo "Spawning stick audit worker..."
bash "$SCRIPTS/worker-spawn.sh" "$PROJECT" "audit-stick" "$TMP/stick_audit_prompt.txt"

echo "Spawning visual audit worker..."
bash "$SCRIPTS/worker-spawn.sh" "$PROJECT" "audit-visual" "$TMP/visual_audit_prompt.txt"

echo "All workers spawned. Sessions: fh-audit-puck, fh-audit-stick, fh-audit-visual"
