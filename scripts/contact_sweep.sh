#!/bin/sh
# Kontakt/crosscheck: sh scripts/contact_sweep.sh "KBMAX KBF CCSPD CCPUSH" ...  → k ráně + rubrika/chaos
O=${OUT:-.}; i=0
for cfg in "$@"; do set -- $cfg; i=$((i+1))
  ( A=$(FH_KBMAX=$1 FH_KBF=$2 FH_CCSPD=$3 FH_CCPUSH=$4 PORT=$((4760+i*2)) node scripts/attack_test.mjs 2>/dev/null | grep '^{')
    B=$(FH_KBMAX=$1 FH_KBF=$2 FH_CCSPD=$3 FH_CCPUSH=$4 PORT=$((4761+i*2)) node scripts/tempo_sweep.mjs 2>/dev/null | grep '^TEMPO' | sed 's/^TEMPO 1 GRACE 0 //')
    echo "KB=$1 F=$2 CCS=$3 CCP=$4 | $A | $B" > "$O/con$i.txt" ) &
done; wait; cat "$O"/con*.txt
