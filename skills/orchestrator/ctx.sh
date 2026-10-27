#!/bin/zsh
# ctx.sh [PANE] : print the orchestrator's context gauge as one line, CTX <n> GO|PREPARE|HANDOVER.
# Reads the statusline gauge (a bar of at least 5 block characters, then the percent) off the pane,
# default your own. No pane id prints CTX ? NO-PANE (exit 2). A known pane with no gauge is read
# once more after CTX_RETRY_SECONDS (default 3), as single/handoff.sh does; a second miss prints
# CTX ? HANDOVER (no gauge reading).
# Exit 0 GO, 10 PREPARE (at 45), 20 HANDOVER (at 50), per the owner's hand-off rule in Code Factory
# METHOD "Seats, lanes and stops". The skill's files point here for these two numbers.
P=${1:-$HERDR_PANE_ID}; PREP=${CTX_PREP:-45}; STOP=${CTX_STOP:-50}   # a round may override both
[[ -z $P ]] && { echo "CTX ? NO-PANE"; exit 2; }
gauge(){ herdr pane read "$P" --source visible --lines 4 2>/dev/null | grep -oE '[█░▓▒]{5,} [0-9]{1,3}% │ \$' | tail -1 | grep -oE '[0-9]+%' | tr -d '%'; }
n=$(gauge)
[[ -z $n ]] && { sleep "${CTX_RETRY_SECONDS:-3}"; n=$(gauge); }
[[ -z $n ]] && { echo "CTX ? HANDOVER (no gauge reading)"; exit 20; }
(( n >= STOP )) && { echo "CTX $n HANDOVER"; exit 20; }
(( n >= PREP )) && { echo "CTX $n PREPARE"; exit 10; }
echo "CTX $n GO"
