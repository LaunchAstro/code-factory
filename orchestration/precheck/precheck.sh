#!/usr/bin/env bash
# The pre-queue check, laptop half. See precheck.md.
# Edit this file by writing a copy and moving it into place: a waiting run
# reads it as it goes.
#
#   precheck.sh [-w workers] <pr> <head> [<pr> <head> ...]
#
# One batch of PRs a run. On the test machine it builds the tree the merge queue
# would build (latest origin/main, then each PR head in the order given,
# `git merge --no-ff`), runs the project's step list there (runner.sh), and,
# per PR head:
#   - a commit status (context $PRECHECK_CONTEXT): pending while it runs, then
#     success or failure, gh-signoff style (the description names the exact
#     head and base; a failure names the unit, step and log). Not a required
#     check;
#   - $PRECHECK_ROOT/prechecks/<pr>-<fullhead>.green or .red (line 1: failing
#     job, file, assertion; line 2: log summary path), a trail row, and one
#     events line `<UTC> PRECHECK-GREEN|PRECHECK-RED PR <n> head <sha> main <sha> <minutes>`.
# A PR that conflicts with main is red; one that conflicts only with the PRs
# before it in the batch gets no verdict. A batch red is held for review
# (PRECHECK_REVIEW=1, the default): split it with single-PR runs restricted to
# the red units (PRECHECK_UNITS="..." PRECHECK_REVIEW=0). PRECHECK_ATTACH=1
# re-attaches to a run already going. PRECHECK_BASE="<pr> <head> ..." names the
# queue entries ahead of the batch: they are merged first, in that order, so
# the tree is the one the queue will build, and get no verdict or status; if
# one doesn't merge, no head gets a verdict (exit 3). Only PRs whose head branch is in
# $PRECHECK_GH_REPO itself and whose author is in $PRECHECK_AUTHORS are run.
# Nothing is pushed anywhere but the test machine's own mirror.
set -uo pipefail
WORKERS=5
usage() { echo "usage: precheck.sh [-w n] <pr> <head> [...]${1:+: $1}" >&2; exit 2; }
[ "${1:-}" = -w ] && { WORKERS=${2:-}; shift 2 || usage; }
[[ $WORKERS =~ ^[1-9][0-9]?$ ]] || usage "workers must be 1 to 99"
[ $# -ge 2 ] && [ $(( $# % 2 )) = 0 ] || usage
# Settings (precheck.md): where the round's records go, the local clone, the
# GitHub repository, the test machine and its folder, the step list, and who
# may be pre-checked.
ROOT=${PRECHECK_ROOT:?set PRECHECK_ROOT}
REPO=${PRECHECK_REPO:?set PRECHECK_REPO}
GH_REPO=${PRECHECK_GH_REPO:?set PRECHECK_GH_REPO}
HOST=${PRECHECK_HOST:?set PRECHECK_HOST}
REMOTE=${PRECHECK_REMOTE:-precheck}
STEPS=${PRECHECK_STEPS:?set PRECHECK_STEPS}
AUTHORS=${PRECHECK_AUTHORS:?set PRECHECK_AUTHORS}
CONTEXT=${PRECHECK_CONTEXT:-precheck}
LANE=${PRECHECK_LANE:-precheck}
HERE=$(cd "$(dirname "$0")" && pwd)
LOGS=${PRECHECK_LOGS:-$ROOT/precheck-logs}
mkdir -p "$ROOT/prechecks" "$ROOT/trails" "$LOGS"
REVIEW=${PRECHECK_REVIEW:-1}
# Every value that reaches the test machine's shell is checked here first:
# PR numbers, heads, branch names, unit names and the repository.
UNITS=${PRECHECK_UNITS:-}
[[ $GH_REPO =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || usage "PRECHECK_GH_REPO must be owner/name"
[[ $UNITS =~ ^[A-Za-z0-9_\ -]*$ ]] || usage "PRECHECK_UNITS must be unit names"
utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }
die() { echo "$(utc) LANE-$LANE BLOCKER precheck ${PRS[*]:-}: $*" >> "$ROOT/events.log"; echo "precheck: $*" >&2; exit 2; }
# The commit status on a PR head. A refused post is a BLOCKER.
status() { # head state description
  gh api -X POST "repos/$GH_REPO/statuses/$1" -f state="$2" -f context="$CONTEXT" \
    -f description="${3:0:140}" >/dev/null || die "commit status $2 refused for $1"
}

cd "$REPO" || die "no repo at $REPO"
git fetch -q origin main || die "fetch failed"
PRS=() HEADS=() SPECS=() BPRS=() BHEADS=() BSPECS=()
read -r -a BASEARGS <<< "${PRECHECK_BASE:-}"
[ $(( ${#BASEARGS[@]} % 2 )) = 0 ] || die "PRECHECK_BASE needs <pr> <head> pairs"
NBASE=$(( ${#BASEARGS[@]} / 2 ))
set -- ${BASEARGS[@]+"${BASEARGS[@]}"} "$@"
for ((i = 1; i < $#; i += 2)); do
  j=$((i + 1))
  [[ ${!i} =~ ^[1-9][0-9]*$ && ${!j} =~ ^[0-9a-f]{7,40}$ ]] || die "'${!i} ${!j}' is not a PR number and commit sha"
done
while [ $# -gt 0 ]; do
  pr=$1 want=$2; shift 2
  git fetch -q origin "+refs/pull/$pr/head:refs/precheck/pr-$pr" || die "fetch of #$pr failed"
  tip=$(git rev-parse "refs/precheck/pr-$pr")
  case $tip in
    "$want"*) full=$tip ;;
    *) if [[ $want =~ ^[0-9a-f]{40}$ ]] && git fetch -q origin "$want" 2>/dev/null; then full=$want
       else die "head $want is not #$pr's head ($tip) and cannot be fetched by full sha"; fi ;;
  esac
  # Only the round's own PRs, never an outside contributor's: the head branch
  # in the repository itself and opened by one of $PRECHECK_AUTHORS.
  who=$(gh pr view "$pr" --repo "$GH_REPO" --json author,isCrossRepository,headRepositoryOwner \
    -q '"\(.author.login) \(.isCrossRepository) \(.headRepositoryOwner.login)"' 2>/dev/null)
  ok=
  for a in $AUTHORS; do [ "$who" = "$a false ${GH_REPO%%/*}" ] && ok=1; done
  case "$ok" in
    1) ;;
    *) echo "$(utc) LANE-$LANE REFUSED PR $pr: not a round lane's PR ($who); no pre-check" >> "$ROOT/events.log"
       echo "precheck: refused #$pr ($who)" >&2; exit 5 ;;
  esac
  # The branch names the merge commit, so it reaches the test machine's shell.
  branch=$(gh pr view "$pr" --repo "$GH_REPO" --json headRefName -q .headRefName 2>/dev/null)
  [[ $branch =~ ^[A-Za-z0-9_./-]+$ ]] || die "the head branch of #$pr is not a plain ref name"
  if [ ${#BPRS[@]} -lt "$NBASE" ]; then BPRS+=("$pr"); BHEADS+=("$full"); BSPECS+=("$pr:$full:$branch")
  else PRS+=("$pr"); HEADS+=("$full"); SPECS+=("$pr:$full:$branch"); fi
done
[ ${#PRS[@]} -ge 1 ] || die "no PR to judge"
ON=; [ ${#BPRS[@]} -gt 0 ] && ON=" after $(printf '#%s ' "${BPRS[@]}")" && ON=${ON% }
RUN=b
for i in "${!PRS[@]}"; do RUN="$RUN-${PRS[$i]}-${HEADS[$i]:0:7}"; done
[ ${#BPRS[@]} -gt 0 ] && RUN="$RUN-on-${BPRS[${#BPRS[@]}-1]}"
OUT=$LOGS/$RUN

if [ "${PRECHECK_ATTACH:-0}" != 1 ]; then
  MAIN=$(git rev-parse origin/main)
  ssh "$HOST" "mkdir -p ~/$REMOTE/bin && { [ -d ~/$REMOTE/mirror.git ] || git init -q --bare ~/$REMOTE/mirror.git; } &&
    rm -f ~/$REMOTE/$RUN/result" || die "setup on $HOST failed"
  # CI's checkout (fetch-depth 0) carries every tag, and a test reads a commit
  # only a tag holds (t2d-proof-body-byte-identity). GitHub's tags go to a
  # private namespace here, never over this clone's own tags.
  git fetch -q --no-tags origin '+refs/tags/*:refs/precheck-tags/*' || die "tag fetch failed"
  refs=("$MAIN:refs/precheck/main-$MAIN")
  for h in ${BHEADS[@]+"${BHEADS[@]}"} "${HEADS[@]}"; do refs+=("$h:refs/precheck/head-$h"); done
  git push -q --no-verify --force "$HOST:$REMOTE/mirror.git" "${refs[@]}" 'refs/precheck-tags/*:refs/tags/*' \
    || die "push to the mirror on $HOST failed"
  # Copy, then rename: a run already going there reads its scripts as it goes.
  scp -q "$HERE/runner.sh" "$HOST:$REMOTE/bin/runner.sh.$$" && scp -q "$STEPS" "$HOST:$REMOTE/bin/steps.sh.$$" &&
    ssh "$HOST" "mv ~/$REMOTE/bin/runner.sh.$$ ~/$REMOTE/bin/runner.sh && mv ~/$REMOTE/bin/steps.sh.$$ ~/$REMOTE/bin/steps.sh" \
    || die "copy to $HOST failed"
  # ssh forwards no environment, so the split's units go in the command.
  ssh "$HOST" "cd ~/$REMOTE && GH_REPO=$GH_REPO PRECHECK_UNITS='$UNITS' nohup bash bin/runner.sh $RUN $MAIN $WORKERS ${BSPECS[*]:-} ${SPECS[*]} > launch-$RUN.log 2>&1 < /dev/null &" \
    || die "launch failed"
  echo "$(utc) precheck: started $RUN on main $MAIN with $WORKERS workers"
else
  MAIN=$(ssh "$HOST" "grep -o '\"base_sha\":\"[0-9a-f]*' ~/$REMOTE/$RUN/event.json" | cut -d'"' -f4)
  [[ $MAIN =~ ^[0-9a-f]{40}$ ]] || die "attach: no run $RUN on $HOST"
fi
WITH=$(printf '#%s ' "${PRS[@]}"); WITH=${WITH% }
# gh-signoff style: every description names the exact head and base.
for h in "${HEADS[@]}"; do status "$h" pending "running: head $h base $MAIN${ON}"; done

# Wait for the verdict, sampling the test machine's load per core (180 min at
# most). load.tsv: UTC, the machine's load per core (everything on it), and the
# cores this run's own processes use (ps over its folder; containers in a VM,
# like Docker Desktop's, are not counted).
mkdir -p "$OUT"
peak=0
for _ in $(seq 1 360); do
  sleep 30
  s=$(ssh "$HOST" "{ sysctl -n vm.loadavg hw.ncpu 2>/dev/null || { cut -d' ' -f1 /proc/loadavg; nproc; }; }; ps -Ao pcpu,command | grep -F '$REMOTE/$RUN/' | grep -v grep | awk '{c+=\$1} END{printf \"%.1f\", c/100}'" 2>/dev/null)
  l=$(echo "$s" | tr -d '{}' | awk 'NR==1{l=$1} NR==2{printf "%.2f", l/$1}')
  [ -n "$l" ] && printf '%s\t%s\t%s\n' "$(utc)" "$l" "$(echo "$s" | sed -n 3p)" >> "$OUT/load.tsv"
  [ -n "$l" ] && awk -v a="$l" -v b="$peak" 'BEGIN{exit !(a>b)}' && peak=$l
  ssh "$HOST" "test -f ~/$REMOTE/$RUN/result" 2>/dev/null && break
done
if ! scp -q "$HOST:$REMOTE/$RUN/result" "$OUT/result" 2>/dev/null; then
  for h in "${HEADS[@]}"; do status "$h" error "no verdict in 180 min"; done
  die "no verdict from $HOST after 180 min ($RUN)"
fi
scp -q "$HOST:$REMOTE/$RUN/summary.txt" "$HOST:$REMOTE/$RUN/logs/admit.log" "$HOST:$REMOTE/$RUN/minutes" "$HOST:$REMOTE/$RUN/prs" "$HOST:$REMOTE/$RUN/conflicts" "$OUT/" 2>/dev/null
MIN=$(cat "$OUT/minutes" 2>/dev/null || echo '?')
VERDICT=$(head -1 "$OUT/result")
echo "$peak" > "$OUT/peak-load-per-core"
if [ "$VERDICT" = SETUP ]; then
  for h in "${HEADS[@]}"; do status "$h" error "setup failed, no verdict; rerun"; done
  echo "$(utc) LANE-$LANE SETUP-FAILED $RUN: $(sed -n 2p "$OUT/result")" >> "$ROOT/events.log"
  echo "precheck: setup failed, no verdict: $(sed -n 2p "$OUT/result")" >&2; exit 3
fi

# The log summary: per job exit and time, and for each failure its FAIL and
# assertion lines and its tail.
{
  echo "$RUN: ${WITH} on main $MAIN${ON} verdict $VERDICT minutes $MIN peak load/core $peak"
  echo "logs on $HOST: ~/$REMOTE/$RUN/logs"
  echo "tree holds: $(awk '{printf "#%s ", $1}' "$OUT/prs" 2>/dev/null)"
  [ -s "$OUT/conflicts" ] && { echo "left out:"; cat "$OUT/conflicts"; }
  cat "$OUT/summary.txt" 2>/dev/null
  tail -n +2 "$OUT/result" | while read -r job _ log; do
    echo; echo "== $job ($log)"
    ssh "$HOST" "sed -E 's/\x1b\[[0-9;]*m//g' '$log' | grep -nE '^ FAIL  |AssertionError|Error:|not ok|::error::|failed assertion|precheck:' | grep -v 'stub database' | head -40; echo ...; tail -40 '$log'" 2>/dev/null
  done
} > "$OUT/summary-full.txt"

publish() { # pr head word line1 description
  local pr=$1 h=$2 word=$3 line1=$4 desc=$5 state=success ext=green other=red
  [ "$word" = PRECHECK-RED ] && { state=failure ext=red other=green; }
  rm -f "$ROOT/prechecks/$pr-$h.$other"
  printf '%s\n%s\n' "$line1" "$OUT/summary-full.txt" > "$ROOT/prechecks/$pr-$h.$ext"
  status "$h" "$state" "$desc"
  echo "$(utc) $word PR $pr head $h main $MAIN $MIN" >> "$ROOT/events.log"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(utc)" "$pr" "$h" "$MAIN" "$word" "$MIN" "$OUT/summary-full.txt" >> "$ROOT/trails/$LANE.tsv"
}

# A queue entry ahead that did not merge means the tree is not the one the
# queue will build: no verdict on any head.
while read -r pr where files; do
  [ -n "$pr" ] || continue
  case " ${BPRS[*]:-} " in *" $pr "*)
    for h in "${HEADS[@]}"; do status "$h" error "no verdict: queue entry #$pr ahead conflicts ($where); tree is not the queue's"; done
    echo "$(utc) LANE-$LANE NO-VERDICT $RUN: queue entry PR $pr (merged ahead) conflicts ($where: $files); tree is not the queue's" >> "$ROOT/events.log"
    echo "precheck: no verdict, queue entry #$pr conflicts ($where: $files)" >&2; exit 3 ;;
  esac
done < "$OUT/conflicts"

# Left out: a conflict with main is the PR's red; one only with the batch is no verdict.
while read -r pr where files; do
  [ -n "$pr" ] || continue
  for i in "${!PRS[@]}"; do [ "${PRS[$i]}" = "$pr" ] && h=${HEADS[$i]}; done
  if [ "$where" = main ]; then
    publish "$pr" "$h" PRECHECK-RED "merge-conflict with main $MAIN: $files" "red merge conflict: head ${h:0:12} base ${MAIN:0:12}: $files"
  else
    status "$h" pending "no verdict: head ${h:0:12} conflicts only with earlier PRs in its batch; back in the line"
    echo "$(utc) LANE-$LANE NOTE PR $pr head ${h:0:7} conflicts only with the PRs before it in $RUN ($files); back in the line" >> "$ROOT/events.log"
  fi
done < "$OUT/conflicts"

IN=$(awk -v b=" ${BPRS[*]:-} " 'index(b, " " $1 " ") == 0 {print $1}' "$OUT/prs" 2>/dev/null)
TREE=$(printf '#%s ' $IN); TREE=${TREE% }; TREE="$TREE$ON"
if [ "$VERDICT" = GREEN ]; then
  for pr in $IN; do
    for i in "${!PRS[@]}"; do [ "${PRS[$i]}" = "$pr" ] && h=${HEADS[$i]}; done
    publish "$pr" "$h" PRECHECK-GREEN "green: every merge_group job passed with ${TREE} on main $MAIN ($MIN min)" \
      "green: head $h base $MAIN with ${TREE}"
  done
  echo "$(utc) PRECHECK-BATCH $RUN green ${TREE} main ${MAIN:0:7} wall ${MIN} min peak load/core $peak workers $WORKERS" >> "$ROOT/events.log"
  echo "$(utc) GREEN $RUN ${TREE} $MIN min, peak load/core $peak"
elif [ "$VERDICT" = RED ] && [ "$REVIEW" = 0 ] && [ "$(echo $IN | wc -w)" -eq 1 ]; then
  # One PR in the tree, looked at: the red is that PR's.
  pr=$IN; for i in "${!PRS[@]}"; do [ "${PRS[$i]}" = "$pr" ] && h=${HEADS[$i]}; done
  first=$(sed -n 2p "$OUT/result"); job=${first%% *}; log=${first##* }
  file=$(grep -m1 -oE '(FAIL|failed assertion in) +[^ ]+\.(test|proof)\.[a-z]+' "$OUT/summary-full.txt" | awk '{print $NF}')
  assert=$(grep -m1 -E 'AssertionError|Error:|not ok|precheck:' "$OUT/summary-full.txt" | sed 's/^[0-9]*://; s/^ *//' | head -c 160)
  others=$(tail -n +3 "$OUT/result" | awk '{print $1}' | tr '\n' ' ')
  publish "$pr" "$h" PRECHECK-RED "$job; ${file:-file: see summary}; ${assert:-see summary}${others:+; also red: $others}" \
    "red ${job:0:40} head ${h:0:12} base ${MAIN:0:12} log ${log#*/$REMOTE/}"
elif [ "$VERDICT" = RED ] && [ -n "$IN" ]; then
  # A batch red names jobs, not PRs: held here until a split run says whose.
  printf 'red jobs: %s\n' "$(tail -n +2 "$OUT/result" | awk '{print $1}' | tr '\n' ' ')" > "$OUT/pending.red"
  echo "$(utc) PRECHECK-BATCH $RUN red ${TREE} main ${MAIN:0:7} wall ${MIN} min peak load/core $peak: $(sed -n 1p "$OUT/pending.red"); held for review and split" >> "$ROOT/events.log"
  echo "$(utc) RED $RUN held: $OUT/pending.red"; exit 4
fi
