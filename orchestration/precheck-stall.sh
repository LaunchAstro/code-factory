#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Alert when a pre-check line stalls: line A (the M5) and line B (the Mac).
# Token-free and alert-only: it gates nothing. The director's kick.sh runs it.
#
#   ROUND=/path/to/round orchestration/precheck-stall.sh
#
# Reads the round's events.log and appends keyed RELAY-ALERT lines to
# RELAY-LOG.md, in kick.sh's format; each key is written once per stall.
#   precheck-stall  a batch START with no END past twice its usual run
#   precheck-idle   no START for 30+ min after an END while PRs wait for pre-check
#   precheck-gone   a batch START with no END, and no runner process for the line
#   precheck-unknown the runner check could not be read (never read as fine)
# A line is the lane tag LANE-...Precheck[-<n>]: -B is line B, anything else
# line A. A batch starts on START, RESUMED or a runner's CLAIM (one naming
# "(run "); it ends on END, RERUN-END, STOPPED, PAUSED, SETUP-FAILED or the
# runner's PRECHECK-BATCH line (run b-... is line A, B-... line B). A batch is
# known by its run name (b-<pr>-... or B-<pr>-...), or b-<first pr>-<head7> when
# its START names only PRs (b-<first pr>- when no head follows the PR), so two
# batches of one PR on different heads stay apart; an end naming another
# batch's run leaves it open.
# A PR head waits from ORCH PRECHECK-WAIT until PRECHECK-GREEN, PRECHECK-RED,
# PRECHECK-SKIPPED or ENQUEUED for that head (a line naming no head clears the
# PR). A PR in a line's queue file also waits, for that line.
# The defaults below watch the Ops Astro round's copy of the runner and its
# queue files. The kit's own precheck/runner.sh writes no <run>.pid, so another
# round sets PRECHECK_PIDS_A, PRECHECK_PIDS_B, PRECHECK_QUEUE_A and PRECHECK_QUEUE_B.
set -uo pipefail
cd "${ROUND:?set ROUND to the round folder}" || exit 1
STALL_MIN=${PRECHECK_STALL_MIN:-190}
IDLE_MIN=${PRECHECK_IDLE_MIN:-30}
GONE_MIN=${PRECHECK_GONE_MIN:-10}      # a runner's time to start after START
# Where each line's runner keeps <run>.pid: [host:]dir, host over ssh; empty skips the check.
PIDS_A=${PRECHECK_PIDS_A-}
PIDS_B=${PRECHECK_PIDS_B-}
# Each line's queue file, from the round folder: PR numbers before any #; missing is empty.
QUEUE_A=${PRECHECK_QUEUE_A-lane-scratch/OA-Precheck/line.txt}
QUEUE_B=${PRECHECK_QUEUE_B-lane-scratch/OA-Precheck-B/line.txt}

# -a: a NUL pasted into RELAY-LOG.md must not make the file unreadable as text.
said() { grep -aqF "$1" RELAY-LOG.md 2>/dev/null; }
alert() { local k="[$1]"; shift; said "$k" || echo "- $(date +%H:%M) RELAY-ALERT $k $*" >> RELAY-LOG.md; }
epoch() { date -j -u -f %Y-%m-%dT%H:%M:%SZ "$1" +%s 2>/dev/null || date -u -d "$1" +%s; }
NOW=$(epoch "${PRECHECK_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}")
mins() { echo $(( (NOW - $(epoch "$1")) / 60 )); }

# Live runners of one batch in a [host:]dir: a <run>.pid whose run starts with the batch's
# name and whose process is that run's *-run.sh. Prints a count, or fails. The name is
# letters, digits, dot, dash and underscore only (the awk below), as ssh re-parses it.
LIVE='[ -d "$1" ] || exit 1; n=0; for f in "$1/$2"*.pid; do [ -f "$f" ] || continue; r=$(basename "$f" .pid)
  ps -o command= -p "$(cat "$f")" 2>/dev/null | grep -- "-run.sh" | grep -qF -- "$r" && n=$((n + 1)); done; echo $n'
runners() {
  case $1 in
    /*) sh -c "$LIVE" sh "$1" "$2" ;;
    *:*) ssh -o BatchMode=yes -o ConnectTimeout=10 "${1%%:*}" sh -s -- "${1#*:}" "$2" <<<"$LIVE" 2>/dev/null ;;
    *) return 1 ;;
  esac
}

# One record per line (L OPEN START-TS RUN LABEL / L ENDED END-TS) and one per waiting PR (W PR).
STATE=$(awk '
  function line(tag) { return tag ~ /Precheck-B[0-9]*$/ ? "B" : "A" }
  function run(   i, s) {
    for (i = 4; i <= NF; i++) if ($i ~ /^\(?[bB]-[0-9]/) { s = $i; gsub(/[^A-Za-z0-9._-]/, "", s); return s }
    return ""
  }
  function label(   i, s, n) {
    if ((s = run()) != "") return s
    for (i = 4; i <= NF && n < 6; i++) if ($i ~ /^#[0-9]+$/) { s = s (n++ ? " " : "") $i } else if (n && $i == "after") break
    return n ? s : "batch"
  }
  # The batch a start names: its run, else <b|B>-<first pr>-<head7> (the hex after
  # that PR; <b|B>-<first pr>- when none follows), else "-" (unknown).
  function ident(L,   s, i, h) {
    if ((s = run()) != "") return s
    for (i = 4; i <= NF; i++) if (match($i, /^#[0-9]+/)) {
      s = (L == "B" ? "B-" : "b-") substr($i, 2, RLENGTH - 1) "-"; h = tolower($(i + 1)); sub(/,$/, "", h)
      return h ~ /^[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]+$/ ? s substr(h, 1, 7) : s
    }
    return "-"
  }
  # An end closes the open batch unless it names another batch.
  function finish(L, ts,   e, o) {
    e = tolower(run()); o = tolower(id[L])
    if (open[L] && e != "" && o != "-" && index(e, o) != 1 && index(o, e) != 1) return
    open[L] = 0; en[L] = ts
  }
  # A verdict for PR p clears its wait when it names the waiting head, or no head.
  function clear(p, h) { if (h == "" || index(h, w[p]) == 1 || index(w[p], h) == 1) delete w[p] }
  function head(i) { return $i == "head" ? $(i + 1) : "" }
  $1 !~ /^20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9:]+Z$/ { next }
  $2 ~ /^LANE-[A-Za-z0-9-]*Precheck(-[A-Za-z0-9]+)?$/ {
    L = line($2)
    if ($3 == "START" || $3 == "RESUMED" || ($3 == "CLAIM" && index($0, "(run "))) { open[L] = 1; st[L] = $1; id[L] = ident(L); lb[L] = label() }
    else if ($3 ~ /^(END|RERUN-END|STOPPED|PAUSED|SETUP-FAILED)$/) finish(L, $1)
    next
  }
  $2 == "PRECHECK-BATCH" { $4 = $3; L = $3 ~ /^B-/ ? "B" : "A"; finish(L, $1); next }
  $2 == "ORCH" && $3 == "PRECHECK-WAIT" && $4 == "PR" { w[$5] = head(6); next }
  $2 ~ /^PRECHECK-(GREEN|RED)$/ && $3 == "PR" && ($4 in w) { clear($4, head(5)); next }
  $2 == "ORCH" && $3 ~ /^(PRECHECK-SKIPPED|ENQUEUED)$/ && $4 == "PR" && ($5 in w) { clear($5, head(6)); next }
  END {
    for (L in open) print L, (open[L] ? "OPEN " st[L] " " id[L] " " lb[L] : "ENDED " en[L])
    for (p in w) print "W", p
  }' events.log 2>/dev/null | sort)

# waiting L: the PRs waiting for line L, from the log and the line's queue file.
waiting() {
  local q=QUEUE_$1
  { awk '$1 == "W" { print $2 }' <<<"$STATE"
    [ -n "${!q}" ] && awk '{ sub(/#.*/, ""); for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) print $i }' "${!q}" 2>/dev/null
  } | sort -un
}

while read -r L KIND TS RUN LABEL; do
  [ "$L" = A ] || [ "$L" = B ] || continue
  AGE=$(mins "$TS")
  if [ "$KIND" = OPEN ]; then
    [ "$AGE" -ge "$STALL_MIN" ] && alert "precheck-stall $L $TS" "line $L batch $LABEL started $TS, no END after $AGE min (twice its usual run is $STALL_MIN)"
    PIDS=PIDS_$L; [ -n "${!PIDS}" ] && [ "$AGE" -ge "$GONE_MIN" ] || continue
    [ "$RUN" = - ] && RUN=
    N=$(runners "${!PIDS}" "$RUN")
    if ! [[ $N =~ ^[0-9]+$ ]]; then alert "precheck-unknown $L $TS" "line $L runner check UNKNOWN for batch $LABEL ($AGE min since START): ${!PIDS} could not be read"
    elif [ "$N" = 0 ]; then alert "precheck-gone $L $TS" "line $L batch $LABEL started $TS, no END and no runner process after $AGE min"; fi
  elif [ "$AGE" -ge "$IDLE_MIN" ]; then
    WAIT=$(waiting "$L" | sed 's/^/#/' | paste -sd ' ' -); NWAIT=$(wc -w <<<"$WAIT" | tr -d ' ')
    [ "$NWAIT" -gt 0 ] || continue
    S=s; [ "$NWAIT" = 1 ] && S=
    alert "precheck-idle $L $TS" "line $L idle: no START for $AGE min since its END at $TS while $NWAIT PR$S wait for pre-check ($WAIT)"
  fi
done <<<"$STATE"
exit 0
