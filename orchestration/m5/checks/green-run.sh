#!/bin/bash
# usage: green-run.sh <sha or ref>  (on the M5): prints the newest finished run of that commit
# whose every step exited 0, or nothing. Only an all-green run is ever reused.
R=${CHECKS_ROOT:-$HOME/Desktop/Agents/repos/code-factory}
sha=$(git -C "$R/main" rev-parse --verify -q "$1^{commit}" || git -C "$R/main" rev-parse --verify -q "origin/$1^{commit}") || exit 0
for d in $(ls -dt "$R"/out-"$sha"-* 2>/dev/null); do
  awk '$1=="DONE"{d=1} $1!="DONE" && $2!=0 {b=1} END{exit !(d && !b)}' "$d/summary.tsv" 2>/dev/null && { echo "$d"; exit 0; }
done
