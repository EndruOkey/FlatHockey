#!/bin/sh
# Měří kombinace obrany: attack_test (dostanu se ke střele) + rubrika/chaos. Použití: sh scripts/defense_sweep.sh "ENGAGE GAP COVER" ...
O=${OUT:-.}
i=0
for cfg in "$@"; do set -- $cfg; i=$((i+1))
  ( A=$(FH_ENGAGE=$1 FH_GAP=$2 FH_COVER=$3 PORT=$((4720+i*2)) node scripts/attack_test.mjs 2>/dev/null | grep '^{')
    B=$(FH_ENGAGE=$1 FH_GAP=$2 FH_COVER=$3 PORT=$((4721+i*2)) node scripts/tempo_sweep.mjs 2>/dev/null | grep '^TEMPO' | sed 's/^TEMPO 1 GRACE 0 //')
    echo "E=$1 G=$2 C=$3 | $A | $B" > "$O/def$i.txt" ) &
done; wait; cat "$O"/def*.txt
