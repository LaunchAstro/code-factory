#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cases for orchestration/precheck, offline: no test machine, no GitHub.
# ssh, scp and gh are stubs on PATH. The "test machine" is a scratch home on
# this one, so precheck.sh and runner.sh run for real, end to end, on a small
# step list. pnpm and docker are stubs there, and sleep is cut short.
#   bash orchestration/tests/precheck-cases.sh
set -uo pipefail
KIT=$(cd "$(dirname "$0")/../precheck" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
[ -n "${PRECHECK_CASES_KEEP:-}" ] && { trap - EXIT; echo "scratch kept: $T"; }
pass=0 fail=0
ok() { if [ "$1" = 0 ]; then pass=$((pass + 1)); echo "ok   $2"; else fail=$((fail + 1)); echo "FAIL $2"; fi; }
fn() { awk -v n="$2" '$0 ~ "^"n"\\(\\) \\{" {p=1} p {print} p && /^}/ {exit}' "$1"; }

for f in precheck.sh runner.sh stop-run.sh steps/ops-astro.sh; do bash -n "$KIT/$f"; ok $? "$f parses"; done

# step: every step runs after a failure, one line each, and the unit fails.
out=$(DIR=$T bash -c "$(fn "$KIT/runner.sh" step)"'
  UNIT=u; STEP_FAILED=0
  step "first" true; step "second" false; step "third" echo ran
  echo "failed=$STEP_FAILED"' 2>&1)
grep -q '^ran$' <<< "$out"; ok $? "a step after a failing one still runs"
grep -q '^failed=1$' <<< "$out"; ok $? "one failing step fails the unit"
[ "$(grep -c '^STEP ' "$T/steps.log")" = 3 ]; ok $? "one result line per step in steps.log"
grep -q '^STEP FAIL u [0-9]*s second$' "$T/steps.log"; ok $? "the failing step is named"

# scrubbed: only the allowlist reaches the command; no token, no keychain path.
out=$(BASE=$T REALHOME=$T PATH=$PATH GH_TOKEN=planted-token-value CI=true STEPS_VARS="" \
  SCRUB_VARS="CI DATABASE_URL" DATABASE_URL=postgres://x bash -c "$(fn "$KIT/runner.sh" scrubbed)"'
  scrubbed env' 2>&1)
grep -q '^CI=true$' <<< "$out"; ok $? "an allowlisted variable passes"
! grep -q 'planted-token-value' <<< "$out"; ok $? "GH_TOKEN does not pass"
grep -q '^GIT_CONFIG_NOSYSTEM=1$' <<< "$out" && ! grep -q '^GIT_CONFIG_GLOBAL=' <<< "$out"
ok $? "git reads no system config, and GIT_CONFIG_GLOBAL is unset (the scratch HOME has none)"
grep -q "^DOCKER_CONFIG=$T/docker-config$" <<< "$out"; ok $? "docker reads the empty config"
grep -q "^HOME=$T/home$" <<< "$out"; ok $? "HOME is the scratch one"

# admit: two heavy units always run; a third waits while the machine is at or
# past MAX_LOAD per core, and load-based starts are 60 s apart. Only started
# units count. Light units never wait. (sleep is stubbed to stop at the first
# wait.)
A=$T/admit; mkdir -p "$A/done" "$A/logs"
adm() { # load, unit: prints "ran" or "waited"
  DIR=$A MIN_HEAVY=2 MAX_LOAD=1.0 LOAD=$1 bash -c "$(fn "$KIT/runner.sh" admit); $(fn "$KIT/steps/ops-astro.sh" heavy_unit)"'
    load_per_core() { echo "$LOAD"; }; sleep() { echo waited; exit 0; }
    admit "$1"; echo ran' _ "$2"
}
[ "$(adm 3.00 gate)" = ran ]; ok $? "a light unit never waits"
[ "$(adm 3.00 db1)" = ran ] && [ "$(adm 3.00 iso1)" = ran ]; ok $? "two heavy units start at any load"
[ "$(adm 1.00 db2)" = waited ] && [ ! -e "$A/running/db2" ]; ok $? "a third waits at 1.00 per core, and is not counted while it waits"
[ "$(adm 0.50 db2)" = ran ]; ok $? "a third starts under 1 per core"
[ "$(adm 0.50 db3)" = waited ]; ok $? "a fourth waits 60 s after a load-based start, even under 1 per core"
echo "0 10" > "$A/done/db1"; echo "0 10" > "$A/done/iso1"
[ "$(adm 3.00 db3)" = ran ]; ok $? "finished units free their places"
mkdir "$A/admit.lock"; [ "$(adm 0.50 db4)" = waited ]; ok $? "a held admission lock makes the next one wait"; rmdir "$A/admit.lock"

# The repository: main moved on after PR 8 branched, and both touch a.txt,
# so #8 conflicts with main alone; #7 merges.
git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/clone" 2>/dev/null
g() { git -C "$T/clone" -c user.name=t -c user.email=t@example.invalid "$@"; }
echo 0 > "$T/clone/a.txt"; g add a.txt; g commit -q -m zero
echo 8 > "$T/clone/a.txt"; g commit -q -am eight; pr8=$(g rev-parse HEAD); g reset -q --hard HEAD~1
echo 1 > "$T/clone/a.txt"; g commit -q -am one; main=$(g rev-parse HEAD)
echo 7 > "$T/clone/b.txt"; g add b.txt; g commit -q -m seven; head=$(g rev-parse HEAD)
g push -q origin "$main:refs/heads/main" "$head:refs/pull/7/head" "$pr8:refs/pull/8/head"

# The stubs. ssh runs its command in the scratch machine's home, from an empty
# environment as real ssh does (nothing of this shell's is forwarded), and
# waits for anything it started in the background, so a launched runner has
# finished when ssh returns. gh logs every call, one argument a line between ==, and
# answers pr view from GH_WHO and GH_BRANCH.
M=$T/machine; mkdir -p "$T/bin" "$T/mbin" "$M" "$T/root"
cat > "$T/bin/ssh" <<'STUB'
#!/usr/bin/env bash
while [ "${1#-}" != "$1" ]; do case $1 in -o|-p|-i|-F) shift 2 ;; *) shift ;; esac; done
shift
cd "$FAKE_HOME" && exec env -i PATH="$PATH" HOME="$FAKE_HOME" bash -c "$*"$'\n'wait
STUB
cat > "$T/bin/scp" <<'STUB'
#!/usr/bin/env bash
a=(); for x in "$@"; do case $x in -*) ;; *:*) a+=("$FAKE_HOME/${x#*:}") ;; *) a+=("$x") ;; esac; done
exec cp "${a[@]}"
STUB
cat > "$T/bin/gh" <<'STUB'
#!/usr/bin/env bash
{ echo ==; printf '%s\n' "$@"; } >> "$CASE_DIR/gh.log"
case "$1 $2" in
  "pr view") case "$*" in *headRefName*) echo "${GH_BRANCH-feature/seven}" ;; *) echo "${GH_WHO:-alice false acme}" ;; esac ;;
esac
STUB
# The runner's steps see no CASE_DIR (the scrub drops it), so these name $T.
printf '#!/bin/sh\necho "$*" >> "%s/pnpm.log"\n' "$T" > "$T/mbin/pnpm"
printf '#!/bin/sh\necho "$*" >> "%s/docker.log"\n' "$T" > "$T/mbin/docker"
printf '#!/bin/sh\nexec /bin/sleep 0.1\n' > "$T/bin/sleep"
cp "$T/bin/sleep" "$T/mbin/sleep"
chmod +x "$T"/bin/* "$T"/mbin/*

# A step list of three units. u1 fails its middle step when the machine holds
# make-red; l1, a light unit, when it holds make-l1-red. u2 keeps the
# environment its step saw.
cat > "$T/steps.sh" <<'STEPS'
UNITS="u1 u2"
LIGHT="l1"
STEPS_VARS=""
needs_pg() { return 1; }
heavy_unit() { return 1; }
unit_limit() { echo 120; }
job() {
  export UNIT=$1; STEP_FAILED=0
  case $1 in
    u1) step "first" true; step "boom" sh -c '[ ! -e "$DIR/../make-red" ]'; step "after the failure" true ;;
    u2) step "environment" sh -c 'env > "$DIR/env-u2"' ;;
    l1) step "where" sh -c 'pwd >> "$DIR/pwd-l1"; [ ! -e "$DIR/../make-l1-red" ]' ;;
  esac
  return "$STEP_FAILED"
}
STEP_FUNCS="job"
STEPS
mkdir -p "$M/precheck"
# The test machine's own environment carries a token; no step may see it.
printf 'NODE_BIN=%s\nMIN_HEAVY=2\nexport NPM_TOKEN=planted-precheck-marker\n' "$T/mbin" > "$M/precheck/precheck.env"

pc() { # precheck.sh args...: with the stubs, as the round runs it; exit code in $rc
  PATH="$T/bin:$PATH" FAKE_HOME=$M CASE_DIR=$T \
    PRECHECK_ROOT=$T/root PRECHECK_REPO=$T/clone PRECHECK_GH_REPO=acme/app PRECHECK_HOST=testbox \
    PRECHECK_STEPS=$T/steps.sh PRECHECK_AUTHORS="alice" PRECHECK_CONTEXT=box/precheck \
    bash "$KIT/precheck.sh" "$@" > "$T/out" 2>&1
  rc=$?
}
# The descriptions of the statuses posted on a head, one a line.
statuses() { awk -v h="repos/acme/app/statuses/$1" '$0 == "==" {s=0} $0 == h {s=1} s && /^description=/ {sub(/^description=/, ""); print}' "$T/gh.log"; }
RUN=b-7-${head:0:7}

# Refusals: before a byte leaves this machine (no mirror on the test machine).
# fresh clears what a case that wrongly ran left there, so each case stands alone.
fresh() { rm -rf "$M/precheck/mirror.git" "$M/pwned"; }
for who in "stranger false acme" "alice true someone-else"; do
  GH_WHO=$who pc 7 "$head"
  [ "$rc" = 5 ] && grep -q 'REFUSED PR 7' "$T/root/events.log" && [ ! -e "$M/precheck/mirror.git" ]
  ok $? "refuses #7 when gh says: $who"
done
GH_WHO="stranger false acme" PRECHECK_BASE="7 $head" pc 7 "$head"
[ "$rc" = 5 ]; ok $? "a stranger's queue entry ahead is refused"
PRECHECK_BASE="7" pc 7 "$head"
[ "$rc" = 2 ] && grep -q 'PRECHECK_BASE needs' "$T/out"; ok $? "an odd PRECHECK_BASE is refused"
for bad in "7;id $head" "7 \$(id)" "-1 $head"; do
  # shellcheck disable=SC2086
  fresh; pc $bad
  [ "$rc" = 2 ] && grep -q 'not a PR number and commit' "$T/out" && [ ! -e "$M/precheck/mirror.git" ]
  ok $? "refuses the pair '$bad' before it leaves"
done
fresh; pc -w 'x' 7 "$head"
[ "$rc" = 2 ] && [ ! -e "$M/precheck/mirror.git" ]; ok $? "refuses a worker count that is not a number"
fresh; GH_BRANCH='x;touch${IFS}$HOME/pwned' pc 7 "$head"
[ "$rc" = 2 ] && [ ! -e "$M/pwned" ] && [ ! -e "$M/precheck/mirror.git" ]
ok $? "refuses a head branch name that is not a plain ref, and runs nothing it carries"
fresh; PRECHECK_UNITS='u2;touch${IFS}$HOME/pwned' pc 7 "$head"
[ "$rc" = 2 ] && [ ! -e "$M/pwned" ] && [ ! -e "$M/precheck/mirror.git" ]; ok $? "refuses a PRECHECK_UNITS that is not unit names"

# Run 1: #7 alone, looked at (PRECHECK_REVIEW=0), u1's middle step red.
: > "$T/gh.log"; touch "$M/precheck/make-red"
PRECHECK_REVIEW=0 pc 7 "$head"
D=$M/precheck/$RUN
[ "$rc" = 0 ] && [ "$(head -1 "$D/result" 2>/dev/null)" = RED ]; ok $? "a red step makes the run red (exit $rc)"
grep -q '^STEP PASS u1 [0-9]*s after the failure$' "$D/steps.log" 2>/dev/null; ok $? "the step after the red one still ran"
grep -q '^STEP FAIL u1 (alone) [0-9]*s boom$' "$D/steps.log" 2>/dev/null; ok $? "the red unit ran once more, alone"
sed -n 2p "$D/result" 2>/dev/null | grep -q '^u1:boom exit=1 '; ok $? "the result names unit:step"
statuses "$head" | grep -qx "running: head $head base $main"; ok $? "pending names the full head and base"
statuses "$head" | grep -q "^red u1:boom head ${head:0:12} base ${main:0:12} log $RUN/logs/u1.log$"
ok $? "the red status names unit:step, head, base and log"
grep -q "state=failure" "$T/gh.log" && grep -qx "context=box/precheck" "$T/gh.log"; ok $? "the status is a failure in PRECHECK_CONTEXT"
[ -f "$T/root/prechecks/7-$head.red" ] && grep -q "PRECHECK-RED PR 7 head $head main $main " "$T/root/events.log"
ok $? "a .red file and a PRECHECK-RED line"
grep -q "^HOME=$M/precheck/home$" "$D/env-u2" 2>/dev/null && grep -q '^GIT_CONFIG_NOSYSTEM=1$' "$D/env-u2" &&
  ! grep -q '^GH_TOKEN=' "$D/env-u2" && ! grep -q '^NPM_TOKEN=' "$D/env-u2"; ok $? "a step sees the scrubbed environment"
! grep -rqs --exclude=precheck.env planted-precheck-marker "$M/precheck" "$T/root" "$T/out"; ok $? "the planted token reaches no log, record or output"
[ -s "$T/pnpm.log" ] && ! grep '^install' "$T/pnpm.log" | grep -qv -- '--ignore-scripts'; ok $? "every install runs with lifecycle scripts off"
[ -d "$D/logs" ] && [ ! -e "$D/w1" ] && [ ! -e "$D/build" ]; ok $? "the checkouts are dropped, the logs kept"

# Run 2: #7 and #8 as a batch, all steps green; #8 conflicts with main.
: > "$T/gh.log"; rm -f "$M/precheck/make-red"
pc 7 "$head" 8 "$pr8"
[ "$rc" = 0 ] && statuses "$head" | grep -qx "green: head $head base $main with #7"; ok $? "green names the full head, base and the tree's PRs"
[ -f "$T/root/prechecks/7-$head.green" ] && [ ! -e "$T/root/prechecks/7-$head.red" ]; ok $? "a green replaces the head's .red"
statuses "$pr8" | grep -q "^red merge conflict: head ${pr8:0:12} base ${main:0:12}: a.txt"; ok $? "a conflict with main is that PR's red"
grep -q "PRECHECK-BATCH b-7-${head:0:7}-8-${pr8:0:7} green #7 main ${main:0:7}" "$T/root/events.log"; ok $? "one PRECHECK-BATCH line for the batch"

# Run 3: a split, PRECHECK_UNITS="u2 l1": only those units run; l1 is red and
# runs again in the bare checkout the light units use.
: > "$T/gh.log"; touch "$M/precheck/make-red" "$M/precheck/make-l1-red"
PRECHECK_UNITS="u2 l1" PRECHECK_REVIEW=0 pc 7 "$head"
! grep -q ' u1 ' "$D/steps.log" 2>/dev/null && grep -q '^STEP PASS u2 ' "$D/steps.log" 2>/dev/null; ok $? "PRECHECK_UNITS reaches the test machine: u1 never ran"
[ "$(grep -c '/wlight$' "$D/pwd-l1" 2>/dev/null)" = 2 ]; ok $? "a red light unit runs again in the light checkout"
statuses "$head" | grep -q '^red l1:where '; ok $? "the split's red names its own unit"

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
