#!/bin/bash
# usage: checks-locked.sh <worktree> <outdir>  (on the M5)
# Runs checks.sh in turn with other check runs: concurrent runs pushed the M5 to load 10+ and made timing cases flake.
# A SHA already checked all green reuses that run's results (marked in reused-from.txt),
# so a lane's run and Sol's run of the same head cost one run.
# Once `check-queue.py set-mode on`, the queue gives the turns (first come, 3 slots, held while the M5 is busy).
# Until then (shadow) the interim slots below decide (owner's yes to #333, 27 Oct 2026): slot 1 any time, slots 2
# and 3 only while the 1-minute load average is under 12; each slot a directory holding its owner's PID, taken
# over when that PID is gone. The queue only logs, as a SHADOW line, the order and slot it would have given.
# In shadow a queue error never stops the old path; once on, it never falls back to the old slots beside live
# queue runs.
R=${CHECKS_ROOT:-$HOME/Desktop/Agents/repos/code-factory}
Q=${CHECK_QUEUE_DIR:-$HOME/Desktop/Agents/check-queue}
MAXLOAD=${CHECKS_MAXLOAD:-12}
sha=$(git -C "$1" rev-parse HEAD 2>/dev/null)
mkdir -p "$2"
reuse() {
  local d
  d=$(bash "$R/green-run.sh" "$sha")
  [ -n "$d" ] && [ "$d" != "$2" ] && cp -p "$d"/* "$2"/ && echo "$d" > "$2/reused-from.txt"
}
queued() {
  reuse "$@" && { python3 "$R/check-queue.py" release --pid $$ >/dev/null 2>&1; exit 0; }
  exec python3 "$R/check-queue.py" run --project code-factory --key "$sha" -- nice -n 15 bash "$R/checks.sh" "$1" "$2"
}
# One step under the queue's lock: take a place and read the mode, so set-mode can't switch it in between.
mode=$(python3 "$R/check-queue.py" enter --project code-factory --key "$sha" --pid $$ 2>/dev/null)
[ -n "$mode" ] || mode=$(cat "$Q/mode" 2>/dev/null)
[ "$mode" = on ] && queued "$@"
load1() { sysctl -n vm.loadavg | awk '{print $2}'; }
under() { awk -v l="$(load1)" -v m=$MAXLOAD 'BEGIN{exit !(l<m)}'; }
take() {  # take slot dir $1, clearing it if its owner is gone
  local p
  if mkdir "$1" 2>/dev/null; then return 0; fi
  p=$(cat "$1/pid" 2>/dev/null)
  if [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then rm -rf "$1"; mkdir "$1" 2>/dev/null && return 0; fi
  return 1
}
L=""
until [ -n "$L" ]; do
  if take "$R/.checks.lock"; then L="$R/.checks.lock"
  elif under && take "$R/.checks.lock2"; then L="$R/.checks.lock2"
  elif under && take "$R/.checks.lock3"; then L="$R/.checks.lock3"
  else sleep 20; fi
done
echo $$ > "$L/pid"
# A caller whose enter failed read the mode on its own: if set-mode on landed before its slot, give the slot
# back and queue. set-mode checks the slots again after writing and puts the mode back if one appeared, so
# either this read sees on or the flip sees this slot (Sol r3).
[ "$(cat "$Q/mode" 2>/dev/null)" = on ] && { rm -rf "$L"; queued "$@"; }
trap 'rm -rf "$L"; python3 "$R/check-queue.py" release --pid $$ >/dev/null 2>&1' EXIT
python3 "$R/check-queue.py" shadow-grant --pid $$ >/dev/null 2>&1
reuse "$@" && exit 0
nice -n 15 bash "$R/checks.sh" "$1" "$2"
