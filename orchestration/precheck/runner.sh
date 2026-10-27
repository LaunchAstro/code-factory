#!/usr/bin/env bash
# The pre-check runner: runs on the test machine from <base>/bin, started by
# precheck.sh under nohup:
#
#   runner.sh <run> <main> <workers> <pr>:<head>:<branch> [...]
#
# It builds the tree the merge queue would build (main, then each PR head in
# order with `git merge --no-ff` and the queue's message), fakes the
# merge_group event (gh-readonly-queue ref, base and head), and runs the
# project's step list (<base>/bin/steps.sh; steps/ops-astro.sh is one) on it,
# each unit in its own checkout, each Postgres unit with its own throwaway
# Postgres on a port of its own, at most <workers> units at once.
#
# On the Rails 8.1 pattern (ActiveSupport::ContinuousIntegration, the pattern
# only): named steps, every step runs even after one fails, one result line
# per step in <run>/steps.log, green only if every step passed. A unit that
# failed in the parallel phase runs once more alone; the first failure stays
# in its log.
#
# A PR that does not merge is left out and named in <dir>/conflicts, as
# `<pr> main` (conflicts with main alone) or `<pr> batch` (only with the PRs
# before it); <dir>/prs lists the PRs the tree holds. PRECHECK_UNITS, when set,
# runs only those units (the split after a batch red); a name the step list
# lacks, or no unit at all, is SETUP. A job killed by a signal exits 128 + n.
# Writes <dir>/result: line 1 GREEN, RED or SETUP, then one line per failing
# unit (`<unit>:<step> exit=<n> <log>`), and <dir>/summary.txt. Touches nothing
# outside <base>, and removes every container it started (label
# precheck=<run>) and any compose stack built from its folder.
#
# Machine paths come from <base>/precheck.env (see precheck.md): NODE_BIN,
# BROWSERS_SEED, DOCKER_PLUGINS, DOCKER_BIN, PORT_BASE, and the admission
# limits MIN_HEAVY and MAX_LOAD.
set -uo pipefail
RUN=${1:?run} MAIN=${2:?main} WORKERS=${3:?workers}; shift 3
[ $# -ge 1 ] || { echo "m5-run: no PR" >&2; exit 2; }
case $RUN in */*|.*|'') echo "m5-run: bad run name" >&2; exit 2 ;; esac
BASE=$(cd "$(dirname "$0")/.." && pwd)
MIRROR=$BASE/mirror.git
DIR=$BASE/$RUN
NODE_BIN=${NODE_BIN:-} BROWSERS_SEED=${BROWSERS_SEED:-} DOCKER_PLUGINS=${DOCKER_PLUGINS:-}
DOCKER_BIN=${DOCKER_BIN:-docker} PORT_BASE=${PORT_BASE:-56500} GH_REPO=${GH_REPO:-}
MIN_HEAVY=${MIN_HEAVY:-2} MAX_LOAD=${MAX_LOAD:-1.0}
[ -f "$BASE/precheck.env" ] && . "$BASE/precheck.env"
[ -n "$GH_REPO" ] || { echo "runner: GH_REPO (owner/name) is not set in $BASE/precheck.env" >&2; exit 2; }
export PATH=${NODE_BIN:+$NODE_BIN:}/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PLAYWRIGHT_BROWSERS_PATH=$BASE/ms-playwright
[ -d "$PLAYWRIGHT_BROWSERS_PATH" ] || { [ -n "$BROWSERS_SEED" ] && cp -Rc "$BROWSERS_SEED" "$PLAYWRIGHT_BROWSERS_PATH" 2>/dev/null; }
export npm_config_store_dir=$BASE/pnpm-store
export DOCKER_BIN
. "$BASE/bin/steps.sh"
LABEL="precheck=$RUN"
START=$(date +%s)

# A stopped run can leave the compose stacks its tests were building, and
# they hold docker's address pools until removed. Every stack whose compose files sit in this run's folder goes,
# with the containers, networks and volumes named after its project.
sweep_stacks() {
  local id proj p
  for id in $(docker ps -aq); do
    case "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$id" 2>/dev/null)" in
      "$DIR"/*) proj="$proj $(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$id")" ;;
    esac
  done
  for p in $(printf '%s\n' $proj | sort -u); do
    [ -n "$p" ] || continue
    docker ps -aq --filter "name=^$p-" | xargs docker rm -f >/dev/null 2>&1
    docker network ls -q --filter "name=^$p-" | xargs docker network rm >/dev/null 2>&1
    docker volume ls -q --filter "name=^$p-" | xargs docker volume rm >/dev/null 2>&1
    echo "swept stack $p" >> "$DIR/logs/sweep.log"
  done
}

cleanup() {
  sweep_stacks
  ids=$(docker ps -aq --filter "label=$LABEL")
  [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1
  [ -n "${SLOT:-}" ] && rmdir "$BASE/slots/$SLOT" 2>/dev/null
}
trap cleanup EXIT

# A clean folder for this run. A re-run of the same head (main moved) starts over.
if [ -d "$DIR" ]; then
  old=$(docker ps -aq --filter "label=$LABEL"); [ -n "$old" ] && docker rm -f $old >/dev/null 2>&1
  rm -rf "$DIR"
fi
mkdir -p "$DIR/logs" "$DIR/units" "$DIR/done" "$BASE/slots"

# A port slot (3 runs at once): ports PORT_BASE + 30*slot + n.
SLOT=
for s in 0 1 2; do mkdir "$BASE/slots/$s" 2>/dev/null && { SLOT=$s; break; }; done
if [ -z "$SLOT" ]; then printf 'SETUP\nsetup no-free-slot (3 runs already)\n' > "$DIR/result"; exit 1; fi
PORTBASE=$((PORT_BASE + 30 * SLOT))

finish() { # $1 GREEN|RED, $2.. failing lines
  local verdict=$1; shift
  { echo "$verdict"; printf '%s\n' "$@"; } > "$DIR/result"
  echo "$(( ($(date +%s) - START + 59) / 60 ))" > "$DIR/minutes"
}

if [ -n "${PRECHECK_UNITS:-}" ]; then
  # A name the step list doesn't have would drop units unseen: no verdict.
  for u in $PRECHECK_UNITS; do
    case " $UNITS $LIGHT " in *" $u "*) ;; *) finish SETUP "setup unknown-unit $u"; exit 1 ;; esac
  done
  keep() { local out= u; for u in $1; do case " $PRECHECK_UNITS " in *" $u "*) out="$out $u" ;; esac; done; echo $out; }
  UNITS=$(keep "$UNITS"); LIGHT=$(keep "$LIGHT")
fi
# No unit to run is no check at all, never a green.
[ -n "$UNITS$LIGHT" ] || { finish SETUP "setup no-units"; exit 1; }

# The tree the queue builds: main, then each PR in order.
git clone -q --shared --no-checkout "$MIRROR" "$DIR/build" || { finish SETUP "setup clone-failed"; exit 1; }
cd "$DIR/build"
git update-ref refs/heads/main "$MAIN" && git checkout -q --detach "$MAIN" || { finish SETUP "setup main-missing $MAIN"; exit 1; }
: > "$DIR/prs"; : > "$DIR/conflicts"; LAST=
for spec in "$@"; do
  IFS=: read -r pr head branch <<< "$spec"
  if git -c user.name=GitHub -c user.email=noreply@github.com merge -q --no-ff --no-edit \
      -m "Merge pull request #$pr from ${GH_REPO%%/*}/$branch" "$head" >> "$DIR/logs/merge.log" 2>&1; then
    echo "$pr $head" >> "$DIR/prs"; LAST=$pr
  else
    files=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
    git merge --abort 2>/dev/null
    if git merge-tree --write-tree "$MAIN" "$head" > /dev/null 2>&1; then where=batch; else where=main; fi
    echo "$pr $where ${files:-see $DIR/logs/merge.log}" >> "$DIR/conflicts"
  fi
done
if [ -z "$LAST" ]; then finish RED "merge-conflict every PR: $(tr '\n' ';' < "$DIR/conflicts") $DIR/logs/merge.log"; exit 1; fi
QREF=gh-readonly-queue/main/pr-$LAST-$MAIN
git checkout -q -B "$QREF"
MERGE=$(git rev-parse HEAD)
echo "$MERGE" > "$DIR/merge-sha"
cat > "$DIR/event.json" <<JSON
{"merge_group":{"head_sha":"$MERGE","head_ref":"refs/heads/$QREF","base_sha":"$MAIN","base_ref":"refs/heads/main","head_commit":{"id":"$MERGE"}},"repository":{"full_name":"$GH_REPO"}}
JSON

export CI=true GITHUB_ACTIONS=true GITHUB_EVENT_NAME=merge_group GITHUB_EVENT_PATH=$DIR/event.json \
  GITHUB_SHA=$MERGE GITHUB_REF=refs/heads/$QREF GITHUB_REF_NAME=$QREF GITHUB_BASE_REF= \
  GITHUB_REPOSITORY=$GH_REPO GITHUB_SERVER_URL=https://github.com \
  GITHUB_API_URL=https://api.github.com GITHUB_WORKFLOW=ci RUNNER_ENVIRONMENT=self-hosted GH_TOKEN=

# Fill this folder's pnpm store once, so the workers' installs only link.
# Scrubbed like every install; `scrubbed` is defined below, so inline.
( cd "$DIR/build" && env -i PATH="$PATH" HOME="$BASE/home" LANG=C.UTF-8 COREPACK_HOME="$HOME/.cache/node/corepack" \
    GIT_CONFIG_NOSYSTEM=1 npm_config_store_dir="$npm_config_store_dir" \
    pnpm fetch --store-dir "$npm_config_store_dir" ) > "$DIR/logs/fetch.log" 2>&1 \
  || { finish SETUP "setup pnpm-fetch-failed $DIR/logs/fetch.log"; exit 1; }

# A checkout of the merge tree, origin = build (whose main is the base).
# Every install and every job runs under `env -i` with only PATH, a scratch
# HOME in this folder and the test variables below. No GitHub token, no
# keychain: git reads no system config (it can name a keychain helper) and
# no global one: the scratch HOME has no ~/.gitconfig, and GIT_CONFIG_GLOBAL
# is left unset (Ops Astro's pre-push hook treats a push with any
# GIT_CONFIG_* but NOSYSTEM as unpinned, and its range tests fail), docker an empty config
# (no credential helper) with its socket and compose plugins named, and gh
# finds no login under the scratch HOME.
REALHOME=$HOME
mkdir -p "$BASE/home" "$BASE/docker-config"
# No global git config carries over from an earlier run (a test may write one).
rm -rf "$BASE/home/.gitconfig" "$BASE/home/.config/git"
[ -f "$BASE/docker-config/config.json" ] || echo '{}' > "$BASE/docker-config/config.json"
[ -e "$BASE/docker-config/cli-plugins" ] || [ -z "$DOCKER_PLUGINS" ] || ln -s "$DOCKER_PLUGINS" "$BASE/docker-config/cli-plugins"
# A test that calls docker with only PATH and HOME reads ~/.docker: give the
# scratch HOME the same empty config and plugins.
mkdir -p "$BASE/home/.docker"
[ -f "$BASE/home/.docker/config.json" ] || echo '{}' > "$BASE/home/.docker/config.json"
[ -e "$BASE/home/.docker/cli-plugins" ] || [ -z "$DOCKER_PLUGINS" ] || ln -s "$DOCKER_PLUGINS" "$BASE/home/.docker/cli-plugins"
SCRUB_VARS="CI GITHUB_ACTIONS GITHUB_EVENT_NAME GITHUB_EVENT_PATH GITHUB_SHA GITHUB_REF GITHUB_REF_NAME
  GITHUB_REPOSITORY GITHUB_SERVER_URL GITHUB_API_URL GITHUB_WORKFLOW RUNNER_ENVIRONMENT RUNNER_TEMP
  DATABASE_URL FIXTURE_PG_CONTAINER npm_config_store_dir RUN PORTBASE LABEL DIR STEP_TAG $STEPS_VARS"
scrubbed() { # command...: run it with the allowlist alone
  local v args=()
  for v in $SCRUB_VARS; do [ -n "${!v+x}" ] && args+=("$v=${!v}"); done
  env -i PATH="$PATH" HOME="$BASE/home" LANG=C.UTF-8 TERM=dumb \
    COREPACK_HOME="$REALHOME/.cache/node/corepack" \
    DOCKER_HOST="unix://$REALHOME/.docker/run/docker.sock" DOCKER_CONFIG="$BASE/docker-config" \
    GIT_CONFIG_NOSYSTEM=1 \
    "${args[@]}" "$@"
}

# --ignore-scripts: no install-time script runs, the project's own `prepare`
# included. A step that needs one runs it as a named step.
checkout() { # $1 dir, $2 install|bare
  git clone -q --shared "$DIR/build" "$1" && git -C "$1" checkout -q -B "$QREF" "$MERGE" || return 1
  [ "$2" = install ] || return 0
  ( cd "$1" && scrubbed pnpm install --frozen-lockfile --prefer-offline --ignore-scripts --store-dir "$npm_config_store_dir" )
}

for u in $UNITS; do touch "$DIR/units/$u"; done

pg_up() { # $1 name, $2 port
  docker run -d --label "$LABEL" --name "$1" -e POSTGRES_PASSWORD=conformance-throwaway \
    -e POSTGRES_DB=conformance -p "127.0.0.1:$2:5432" "$PGIMG" >/dev/null || return 1
  for _ in $(seq 1 60); do
    docker exec "$1" pg_isready -h 127.0.0.1 -U postgres -d conformance -q 2>/dev/null && return 0
    sleep 2
  done
  return 1
}

# A step (Rails 8.1's ActiveSupport::ContinuousIntegration#step,
# continuous_integration.rb:55-83, the pattern only): each step is named,
# every step runs even after one fails, each writes one result line to
# <run>/steps.log and to its unit's log, and a unit is green only when all of
# its steps passed, the run only when every unit is.
step() { # title, then the command and its words
  local title=$1 t0 rc; shift
  t0=$(date +%s)
  echo "--- step: $title"
  "$@"; rc=$?
  local line
  line=$(printf 'STEP %s %s%s %ss %s' "$([ "$rc" = 0 ] && echo PASS || echo FAIL)" "$UNIT" "${STEP_TAG:+ ($STEP_TAG)}" "$(( $(date +%s) - t0 ))" "$title")
  echo "$line"; echo "$line" >> "$DIR/steps.log"
  [ "$rc" = 0 ] || STEP_FAILED=1
  return 0
}

# Run one unit with CI's job timeout, in its own process group. A job killed
# by a signal exits 128 + its number, as a shell reports it, never 0.
run_unit() { # $1 unit, $2 checkout, $3 worker number
  local u=$1 wd=$2 k=$3 limit pg="" t0 rc
  limit=$(unit_limit "$u")
  export RUNNER_TEMP=$DIR/tmp/$u; rm -rf "$RUNNER_TEMP"; mkdir -p "$RUNNER_TEMP"
  unset DATABASE_URL FIXTURE_PG_CONTAINER
  t0=$(date +%s)
  if needs_pg "$u"; then
      pg=precheck-$RUN-w$k-pg
      docker rm -f "$pg" >/dev/null 2>&1
      if ! pg_up "$pg" $((PORTBASE + k)) >> "$DIR/logs/$u.log" 2>&1; then
        echo "precheck: postgres did not come up" >> "$DIR/logs/$u.log"; echo 1 > "$DIR/done/$u"; return; fi
      export DATABASE_URL=postgres://postgres:conformance-throwaway@127.0.0.1:$((PORTBASE + k))/conformance FIXTURE_PG_CONTAINER=$pg
  fi
  ( cd "$wd" && scrubbed perl -e '$t=shift; $p=fork; if(!$p){setpgrp(0,0); exec @ARGV} $SIG{ALRM}=sub{kill "TERM",-$p; sleep 5; kill "KILL",-$p; print STDERR "precheck: job timed out after ${t}s\n"; exit 124}; alarm $t; waitpid($p,0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' \
      "$limit" bash -c "source '$DIR/job.sh'; job $u" ) >> "$DIR/logs/$u.log" 2>&1
  rc=$?
  [ -n "$pg" ] && docker rm -f "$pg" >/dev/null 2>&1
  echo "$rc $(( $(date +%s) - t0 ))" > "$DIR/done/$u"
}

# The machine's 1-minute load per core (macOS, then Linux).
load_per_core() {
  { sysctl -n vm.loadavg hw.ncpu 2>/dev/null || { cut -d' ' -f1 /proc/loadavg; nproc; }; } |
    tr -d '{}' | awk 'NR==1{l=$1} NR==2{printf "%.2f", l/$1}'
}

# Admission: MIN_HEAVY heavy units always run; one more starts only while the
# machine is under MAX_LOAD per core, one at a time and at least 60 s apart, so
# each start shows in the load before the next. The machine may be shared, and
# timing proofs fail past about one load per core. Only started units count
# (running/), not ones still waiting here. The step list's heavy_unit names the
# heavy units; without one, every unit is.
admit() { # $1 unit
  local w=0 busy c last
  if type heavy_unit >/dev/null 2>&1; then heavy_unit "$1" || return 0; fi
  mkdir -p "$DIR/running"
  while :; do
    if mkdir "$DIR/admit.lock" 2>/dev/null; then
      busy=0
      for c in "$DIR"/running/*; do
        [ -e "$c" ] || continue
        [ -f "$DIR/done/${c##*/}" ] || busy=$((busy + 1))
      done
      last=$(cat "$DIR/admit.last" 2>/dev/null || echo 0)
      if [ "$busy" -lt "$MIN_HEAVY" ]; then
        : > "$DIR/running/$1"; rmdir "$DIR/admit.lock"; break
      elif [ $(( $(date +%s) - last )) -ge 60 ] &&
          awk -v l="$(load_per_core)" -v m="$MAX_LOAD" 'BEGIN{exit !(l != "" && l < m)}'; then
        : > "$DIR/running/$1"; date +%s > "$DIR/admit.last"; rmdir "$DIR/admit.lock"; break
      fi
      rmdir "$DIR/admit.lock"
    fi
    w=$((w + 20)); sleep 20
  done
  echo "$(date -u +%H:%M:%S) $1 admitted after ${w}s with $busy heavy running" >> "$DIR/logs/admit.log"
}

# A worker: its own checkout, then units until none is left.
worker() { # $1 number
  local k=$1 wd=$DIR/w$1 u
  checkout "$wd" install > "$DIR/logs/w$k-setup.log" 2>&1 || { echo "setup failed" >> "$DIR/logs/w$k-setup.log"; touch "$DIR/w$k.failed"; return; }
  while :; do
    u=""
    for f in $UNITS; do
      [ -e "$DIR/units/$f" ] && mv "$DIR/units/$f" "$DIR/units/.$f.$k" 2>/dev/null && { u=$f; break; }
    done
    [ -z "$u" ] && break
    admit "$u"
    run_unit "$u" "$wd" "$k"
  done
}

# The jobs CI runs before any install: their own bare checkout, one after another.
light() {
  local wd=$DIR/wlight u
  [ -n "$LIGHT" ] || return 0
  checkout "$wd" bare > "$DIR/logs/wlight-setup.log" 2>&1 || { for u in $LIGHT; do echo "1 0" > "$DIR/done/$u"; done; return; }
  for u in $LIGHT; do run_unit "$u" "$wd" 0; done
}

# The jobs, as a file the scrubbed shells source (env -i drops exported functions).
declare -f step $STEP_FUNCS > "$DIR/job.sh"
light &
for k in $(seq 1 "$WORKERS"); do worker "$k" & sleep 1; done
wait

# A unit that failed in the parallel phase runs once more, alone, on its own
# checkout: a hosted job has its 4 vCPUs to itself, and a red that only the
# test machine's load made is not the queue's red. The first failure stays in the log.
for u in $UNITS $LIGHT; do
  [ -f "$DIR/done/$u" ] || continue
  read -r rc secs < "$DIR/done/$u"
  [ "$rc" = 0 ] && continue
  case " $LIGHT " in *" $u "*) wd=$DIR/wlight ;; *) wd=$DIR/w1 ;; esac
  [ -d "$wd" ] || continue
  mv "$DIR/logs/$u.log" "$DIR/logs/$u.first.log"
  ( cd "$wd" && git clean -qfdx -e node_modules -e .local && git checkout -q --force "$MERGE" )
  export STEP_TAG=alone; run_unit "$u" "$wd" 1; unset STEP_TAG
  read -r rc2 secs2 < "$DIR/done/$u"
  [ "$rc2" = 0 ] && echo "$u first-run exit=$rc (${secs}s, $DIR/logs/$u.first.log), green alone in ${secs2}s" >> "$DIR/retried.txt"
done

# The verdict: every unit done and zero.
fails=() total=0
for u in $LIGHT $UNITS; do
  if [ ! -f "$DIR/done/$u" ]; then fails+=("$u never-ran $DIR/logs/$u.log"); continue; fi
  read -r rc secs < "$DIR/done/$u"
  echo "$u exit=$rc ${secs}s" >> "$DIR/summary.txt"
  if [ "$rc" != 0 ]; then
    # The unit and its first failing step (the alone run's, when it had one).
    st=$(grep "^STEP FAIL $u " "$DIR/steps.log" 2>/dev/null | { grep ' (alone) ' || cat; } | head -1 | sed -E 's/^STEP FAIL [^ ]+( \(alone\))? [0-9]+s //')
    fails+=("$u:$(echo "${st:-exit-$rc}" | tr ' ' '-') exit=$rc $DIR/logs/$u.log")
  fi
done
for k in $(seq 1 "$WORKERS"); do [ -e "$DIR/w$k.failed" ] && fails+=("worker$k setup-failed $DIR/logs/w$k-setup.log"); done
[ -f "$DIR/retried.txt" ] && { echo "retried alone:"; cat "$DIR/retried.txt"; } >> "$DIR/summary.txt"
{ echo "steps:"; sort -k3,3 -s "$DIR/steps.log" 2>/dev/null; } >> "$DIR/summary.txt"
if [ ${#fails[@]} -eq 0 ]; then finish GREEN; else finish RED "${fails[@]}"; fi
# Leave the logs, drop the checkouts (node_modules are large).
rm -rf "$DIR"/w[0-9]* "$DIR/wlight" "$DIR/build" "$DIR/tmp"
