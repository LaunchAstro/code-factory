#!/bin/bash
# Nudge a stalled orchestrator, prompt hand-overs and flag merge stalls. Token-free; WATCH.md's loop runs it.
# Every delivery goes through the orchestrator skill's send.sh (probe before Enter, no Escape into a
# working pane, stops on any dialog). Alerts go to RELAY-LOG.md; events.log keeps milestones only.
# Every grep reads text with -a: a raw NUL in events.log once made plain grep match nothing for ~2 h.
HERE=$(cd "$(dirname "$0")" && pwd)   # before the cd below, so a relative $0 still resolves
cd "${ROUND:?set ROUND to the round folder}" || exit 1
SEND="$HERE/../orchestrator/send.sh"; CTX="$HERE/../orchestrator/ctx.sh"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
said() { grep -aqF "$1" RELAY-LOG.md 2>/dev/null; }
# alert KEY TEXT: one line per condition; the key stops the same condition repeating every run.
alert() { local k="[$1]"; shift; said "$k" || echo "- $(date +%H:%M) RELAY-ALERT $k $*" >> RELAY-LOG.md; }
# Every send.sh attempt, delivered or not, is recorded in .kick-nudge.last beside RELAY-LOG.md ("<pane> <epoch>"),
# so a pane that stopped send.sh is not retyped into on the next run. AUTOKICK waits 30 minutes after any attempt.
# The first ORCHWATCH never waits: it goes once per pane the moment ctx.sh says HANDOVER; a retry after a failed
# one waits the same 30 minutes.
NUDGE_GAP=1800
nudged() { local t; t=$(grep -a "^$1 " .kick-nudge.last 2>/dev/null | tail -1 | cut -d' ' -f2); [ -n "$t" ] && [ $(( $(date -u +%s) - t )) -lt $NUDGE_GAP ]; }
mark() { echo "$1 $(date -u +%s)" >> .kick-nudge.last; }

# Hand-over lines (METHOD "Seats, lanes and stops"): <UTC> ORCHESTRATOR-HANDOVER <old-pane> -> <new-pane>,
# herdr pane ids. A last line that names no pane after "-> " is alerted, never skipped in silence.
OLINE=$(grep -aE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z ORCHESTRATOR-HANDOVER ' events.log | tail -1 | tr -d '\000')
DLINE=$(grep -aE ' RELAY-HANDOVER ' events.log | tail -1 | tr -d '\000')
pane() { grep -aoE -- "-> [a-zA-Z0-9]+:p[0-9]+" | awk '{print $2}'; }
ORCH=$(printf '%s\n' "$OLINE" | pane); DIR=$(printf '%s\n' "$DLINE" | pane)
[ -n "$OLINE" ] && [ -z "$ORCH" ] && alert "handover-unparsed orch ${OLINE%% *}" "no herdr pane after '-> ' in: $OLINE"
[ -n "$DLINE" ] && [ -z "$DIR" ] && alert "handover-unparsed relay ${DLINE%% *}" "no herdr pane after '-> ' in: $DLINE"
status() { herdr pane list | python3 -c "
import sys, json
for p in json.load(sys.stdin)['result']['panes']:
    if p['pane_id'] == '$1': print(p.get('agent_status'))"; }

# Hand-over prompts: ctx.sh holds the line (its HANDOVER is the owner's 50 percent, METHOD "Seats, lanes and
# stops"). Once per pane. The director's pane is the owner's chat, so it gets a RELAY-LOG.md line, never
# typed text that could land in the owner's draft.
for P in "$DIR" "$ORCH"; do
  [ -z "$P" ] && continue
  [ "$P" = "$ORCH" ] && [ "$ORCH" = "$DIR" ] && continue
  # Act only on a real reading; a missing gauge is not a reason to hand over.
  [[ $("$CTX" "$P") =~ ^CTX\ [0-9]+\ HANDOVER ]] || continue
  said "WATCHDOG $P" && continue
  said "[watchdog-failed $P]" && nudged "$P" && continue
  if [ "$P" = "$DIR" ]; then echo "- $(date +%H:%M) WATCHDOG $P: DIRWATCH, hand over" >> RELAY-LOG.md; continue; fi
  OUT=$("$SEND" "$P" ORCHWATCH "Relay watchdog: hand over now per the orchestrator skill. ORCHWATCH"); mark "$P"
  case $OUT in DELIVERED*|QUEUED*) echo "- $(date +%H:%M) WATCHDOG $P: hand over ($OUT)" >> RELAY-LOG.md ;; *) alert "watchdog-failed $P" "watchdog to $P did not land: $OUT" ;; esac
done

# Merge alarms while the merge queue or a CLEAN PR waits (owner, 19 Oct, METHOD "Merge alarm (50b)"):
# no merge for 45 minutes, under 3 merges in the last hour, and FLEET.md's 2-hour tripwire, which stays.
# Read live from GitHub. A failed read is UNKNOWN, never "fine". Alert once per stall, the floor once per hour.
REPO=${REPO:-$(grep -aoE 'Product [A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+' ORCHESTRATOR-STATE.md 2>/dev/null | head -1 | cut -d' ' -f2 | sed 's/[.]*$//')}
if [ -n "$REPO" ]; then
  OWNER=${REPO%%/*}; NAME=${REPO#*/}
  MS=$(gh api "repos/$REPO/pulls?state=closed&sort=updated&direction=desc&per_page=50" \
    -q '.[] | select(.merged_at) | .merged_at' 2>/dev/null); RC1=$?
  LASTM=$(printf '%s\n' "$MS" | grep -aE '^[0-9]{4}-' | sort | tail -1)
  QN=$(gh api graphql -f query="{repository(owner:\"$OWNER\",name:\"$NAME\"){mergeQueue{entries{totalCount}}}}" \
    -q '.data.repository.mergeQueue.entries.totalCount // 0' 2>/dev/null); RC2=$?
  CN=$(gh pr list -R "$REPO" --state open -L 200 --json mergeStateStatus \
    -q '[.[] | select(.mergeStateStatus=="CLEAN")] | length' 2>/dev/null); RC3=$?
  if [ $RC1 -ne 0 ] || [ $RC2 -ne 0 ] || [ $RC3 -ne 0 ] || [ -z "$LASTM" ] || [ -z "$QN" ] || [ -z "$CN" ]; then
    alert "merge-unknown $(date -u +%Y-%m-%dT%H)" "merge check UNKNOWN: GitHub read failed for $REPO ($RC1/$RC2/$RC3)"
  elif [ $(( QN + CN )) -gt 0 ]; then
    MAGE=$(( ( $(date -u +%s) - $(date -j -u -f %Y-%m-%dT%H:%M:%SZ "$LASTM" +%s) ) / 60 ))
    N1H=$(printf '%s\n' "$MS" | awk -v c="$(date -u -v-60M +%Y-%m-%dT%H:%M:%SZ)" '$0 >= c' | wc -l | tr -d ' ')
    [ "$MAGE" -ge 45 ] && alert "stall $LASTM" "merge stall since $LASTM: no merge for $MAGE min while $QN queued and $CN CLEAN PRs wait ($REPO)"
    [ "$MAGE" -ge 120 ] && alert "tripwire $LASTM" "FLEET tripwire: no merge for $MAGE min while $QN queued and $CN CLEAN PRs wait ($REPO)"
    [ "$N1H" -lt 3 ] && alert "floor $(date -u +%Y-%m-%dT%H)" "merge floor: $N1H merges in the last hour, under 3, while $QN queued and $CN CLEAN PRs wait ($REPO)"
  fi
fi

# Pre-check lines A (M5) and B (Mac): stall, idle and gone-runner alerts, keyed in RELAY-LOG.md
# (code-factory #220, merged #222; same-PR heads apart, #228 merged #233). .precheck-stall.last records each run and its exit.
CF=${CODE_FACTORY:-$HOME/.cache/code-factory}
if [ -x "$CF/orchestration/precheck-stall.sh" ]; then
  ROUND=$PWD "$CF/orchestration/precheck-stall.sh"; echo "$(now) exit $?" > .precheck-stall.last
else
  alert "precheck-missing $(date -u +%Y-%m-%d)" "pre-check stall check not run: $CF/orchestration/precheck-stall.sh missing"
fi

[ -z "$ORCH" ] && exit 0
# The director's pane is the owner's chat: never deliver into it, even if the logs name it as the orchestrator.
[ "$ORCH" = "$DIR" ] && { alert "same-pane $ORCH" "orchestrator and director both resolve to $ORCH; nothing sent"; exit 0; }
STATUS=$(status "$ORCH")
[ -z "$STATUS" ] && { alert "gone $ORCH" "orchestrator pane $ORCH is gone"; exit 0; }
LAST=$(grep -aE '^[0-9]{4}-' events.log | tail -1 | cut -d' ' -f1)
QUIET=$(( ( $(date -u +%s) - $(date -j -u -f %Y-%m-%dT%H:%M:%SZ "$LAST" +%s) ) / 60 ))
[ "$STATUS" = working ] && [ "$QUIET" -ge 60 ] && alert "silent $ORCH $LAST" "orchestrator working but no event for $QUIET min"
[ "$QUIET" -lt 20 ] && exit 0
[ "$STATUS" = working ] && exit 0
nudged "$ORCH" && exit 0

# Idle or finished, and quiet for 20+ minutes: nudge it. send.sh stops on any dialog.
OUT=$("$SEND" "$ORCH" AUTOKICK "Relay kick: no event for $QUIET minutes. Read events.log and your state note, act on everything pending, keep the lanes full, then carry on. AUTOKICK"); mark "$ORCH"
case $OUT in DELIVERED*|QUEUED*) echo "- $(date +%H:%M) RELAY-KICK auto: $ORCH $STATUS, quiet $QUIET min" >> RELAY-LOG.md ;; *) alert "kick-failed $ORCH $LAST" "kick to $ORCH did not land: $OUT" ;; esac
