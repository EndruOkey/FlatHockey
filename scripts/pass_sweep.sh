#!/bin/sh
# Přihrávky botů: sh scripts/pass_sweep.sh "PLEAD LANE OPEN" ... → zachycené pasy (chaos_breakdown) + rubrika
O=${OUT:-.}; i=0
for cfg in "$@"; do set -- $cfg; i=$((i+1))
  ( A=$(FH_PLEAD=$1 FH_LANE=$2 FH_OPEN=$3 PORT=$((4800+i*2)) node scripts/chaos_breakdown.mjs 2>/dev/null | grep 'kdo získá' | sed 's/.*after//')
    B=$(FH_PLEAD=$1 FH_LANE=$2 FH_OPEN=$3 PORT=$((4801+i*2)) node scripts/tempo_sweep.mjs 2>/dev/null | grep '^TEMPO' | sed 's/^TEMPO 1 GRACE 0 //')
    echo "PLEAD=$1 LANE=$2 OPEN=$3 | $A | $B" > "$O/ps$i.txt" ) &
done; wait; cat "$O"/ps*.txt
