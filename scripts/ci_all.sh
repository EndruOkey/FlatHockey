#!/usr/bin/env bash
# Celá CI sada souběžně (každý test vlastní PORT a DB) → zlomek času proti postupnému běhu (postupně > 10 min).
# bash scripts/ci_all.sh   → jeden řádek na test + souhrn; exit 1 při selhání. Seznam = .github/workflows (deploy) + netteleport, biomech.
cd "$(dirname "$0")/.." || exit 1
D="${TMPDIR:-/tmp}/fh-ci-$$"; mkdir -p "$D"; t0=$(date +%s); i=0
T="puck determinism server accounts cg buy scorehack balance freeze cc bot dev steer goalzone kick deflect knock faceoff netteleport biomech"
for t in $T; do i=$((i+1)); (PORT=$((${PORT_BASE:-4900} + i * 10)) DB_PATH="$D/$t.db" npm run -s test:$t > "$D/$t.log" 2>&1; echo "exit $?" >> "$D/$t.log") & done; wait
fail=0; for t in $T; do e=$(tail -1 "$D/$t.log"); [ "$e" = "exit 0" ] || fail=$((fail+1)); printf "%-12s %-6s %s\n" "$t" "${e#exit }" "$(grep -v '^exit' "$D/$t.log" | tail -1 | cut -c1-60)"; done
echo "$([ $fail = 0 ] && echo 'VŠE OK' || echo "NEPROŠLO $fail") ($(( $(date +%s) - t0 )) s)"; rm -rf "$D"; exit $([ $fail = 0 ] && echo 0 || echo 1)
