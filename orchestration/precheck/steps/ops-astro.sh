#!/usr/bin/env bash
# The pre-check step list for LaunchAstro/ops-astro: its .github/workflows/ci.yml
# merge_group jobs, one unit a job (or a shard of one). runner.sh sources this
# file, like Rails' config/ci.rb beside bin/ci. Skipped: CodeQL, the Sol
# verdict, visual drift (none runs in a merge group). On one machine: the
# upgrade drill runs once (database shard 1), not in each of 12 shards; the
# inbox restart proof gets a container name and ports of its own.

# The images ci.yml pins.
PGIMG=postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 # postgres:17-alpine
SEMGREP_IMAGE=semgrep/semgrep:1.177.0@sha256:acaac22ffc7b7cc5926de0751b223bce0b2491c33d18422fa72f632c78d81198
# A hosted runner has 4 vCPUs, so vitest runs 3 workers there; uncapped on an
# 18-core machine it ran 17 a shard and the load reached 86. Config
# values (the database suites' maxWorkers 4) still win over this.
export VITEST_MAX_WORKERS=3
# Variables the steps read, passed through the scrubbed environment.
STEPS_VARS="PLAYWRIGHT_BROWSERS_PATH VITEST_MAX_WORKERS DOCKER_BIN SEMGREP_IMAGE"

# The units, longest first. Each is one CI job (or one shard of it).
# LIGHT runs first, in a checkout with no install, as ci.yml runs them before
# any install.
# Interleaved, so the three check shards and the three isolation shards never
# all start together: on a shared machine the timing proofs (2 s live-board
# windows) failed at 0% idle.
UNITS="iso1 check1 iso2 db1 iso3 check2 db2 db3 check3"
for i in 4 5 6 7 8 9 10 11 12; do UNITS="$UNITS db$i"; done
UNITS="$UNITS pins dbgate commits licences parity"
LIGHT="gate secrets prsize audit semgrep"

# Which units get a throwaway Postgres, and each unit's limit (ci.yml's
# timeout-minutes).
needs_pg() { case $1 in dbgate) return 1 ;; db*|iso*) return 0 ;; *) return 1 ;; esac; }
# The units admission holds back on a loaded machine (runner.sh admit): the
# database, isolation and local-check shards, 20-30 minutes each.
heavy_unit() { case $1 in dbgate) return 1 ;; db*|iso*|check*) return 0 ;; *) return 1 ;; esac; }
unit_limit() { case $1 in gate|secrets|prsize|audit|semgrep|pins|licences|commits|parity|dbgate) echo 900 ;; *) echo 2100 ;; esac; }

# Steps with shell inside them, named so `step` can run them.
gate_scope() {
  GITHUB_OUTPUT=$RUNNER_TEMP/out node scripts/full-run.ts || return 1
  if grep -q '^scope=light' "$RUNNER_TEMP/out"; then echo "precheck: a merge group took the light set"; return 1; fi
}
lockfile_history() {
  git log --format=%H -- pnpm-lock.yaml | while read -r c; do
    git show "$c:pnpm-lock.yaml" | gitleaks stdin --no-banner --redact --exit-code 1 --config .gitleaks.toml || exit 1
  done
}
audit_gate() {
  pnpm audit --json > "$RUNNER_TEMP/audit.json" || true
  node scripts/security-gate.mjs audit --report "$RUNNER_TEMP/audit.json"
}
semgrep_gate() {
  docker run --rm --label "$LABEL" -v "$PWD:/src:ro" -w /src "$SEMGREP_IMAGE" \
    semgrep scan --config p/default --config p/secrets --config p/typescript \
    --metrics off --json . > "$RUNNER_TEMP/semgrep.json" || true
  node scripts/security-gate.mjs semgrep --report "$RUNNER_TEMP/semgrep.json"
}
container_suites() { # shard
  node scripts/ci-scope.ts 'local checks' -- node scripts/ci-shards.ts 'local checks' --shard "$1/3" --step 'container suites' -- \
    pnpm vitest run $(node -p "require('./tests/ci/container-suites.json').suites.join(' ')")
}
upgrade_drill() { # ci.yml's database shard step; run in shard 1 only (one machine)
  local BASE_SHA added from
  BASE_SHA="$(node scripts/merge-group.mjs base)" || return 1
  git fetch -q --no-tags origin "$BASE_SHA" || return 1
  added=$(git diff --name-only --diff-filter=A "$BASE_SHA" HEAD -- migrations/)
  if [ -z "$added" ]; then echo "upgrade-drill: no migration added; not run"; return 0; fi
  from=$(git ls-tree --name-only "$BASE_SHA" migrations/ | grep '\.sql$' | sort | tail -1)
  pnpm run verify:upgrade-drill --from "$(basename "$from" .sql)" --base "$BASE_SHA"
}
migration_ids() {
  BASE_SHA="$(node scripts/merge-group.mjs base)" HEAD_SHA="$(git rev-parse HEAD)" node scripts/migration-ids.mjs
}

job() { # $1 unit, in its checkout: its ci.yml steps, in order
  local u=$1 i
  export UNIT=$u; STEP_FAILED=0
  local py='import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is required"'
  case $u in
    gate)
      step "sent-back hold" node scripts/sent-back-hold.mjs
      step "never on a merge-queue commit" node scripts/queue-head-check.mjs
      step "full or light set" gate_scope
      step "scanner runtime" python3 -c "$py"
      step "sweep self-test" python3 scripts/gate/sweep.py --self-test
      step "gate cases" bash tests/gate/gate-cases.sh
      step "pre-push hook exit codes" bash tests/gate/hook-exit-cases.sh
      step "skill references" node scripts/skill-refs-check.mjs
      step "session check" bash scripts/agent-session-check.sh
      step "session check cases" bash tests/agents/session-check-cases.sh
      step "nothing merges itself" node scripts/merge-policy-check.mjs
      step "sweep incoming commits" node scripts/merge-group.mjs each sh -c 'python3 scripts/gate/sweep.py --range "$BASE_SHA..$HEAD_SHA"'
      step "sweep tracked files" python3 scripts/gate/sweep.py
      step "public content, incoming commits" node scripts/merge-group.mjs each sh -c 'node scripts/public-content-check.mjs --repo "$PWD" --range "$BASE_SHA..$HEAD_SHA"'
      ;;
    secrets)
      step "gitleaks, every commit" gitleaks git --no-banner --redact --config .gitleaks.toml .
      step "gitleaks, every lockfile version" lockfile_history
      ;;
    prsize)
      step "pull request size" node scripts/merge-group.mjs each node scripts/pr-size.mjs
      step "size gate cases" bash tests/ci/pr-size-cases.sh
      ;;
    audit)
      step "dependency audit" audit_gate
      ;;
    semgrep)
      step "semgrep p/default p/secrets p/typescript" semgrep_gate
      ;;
    pins)
      step "pin and count tests" node scripts/ci-scope.ts 'pin and count tests' -- pnpm exec vitest run
      ;;
    check*)
      i=${u#check}
      step "local toolchain" python3 -c "$py"
      step "headless shell" pnpm exec playwright install --only-shell chromium
      step "pnpm check $i/3" env CONTAINER_SUITES=apart CHECK_SCOPE='local checks' CHECK_SHARD="$i/3" pnpm check
      step "container suites" container_suites "$i"
      step "browser proofs" env BROWSER_PROOFS=1 node scripts/ci-scope.ts 'local checks' -- node scripts/ci-shards.ts 'local checks' --shard "$i/3" --step 'browser proofs' -- pnpm vitest run tests/browser/
      step "semgrep settings" node scripts/ci-scope.ts 'local checks' -- node scripts/ci-shards.ts 'local checks' --shard "$i/3" --step 'semgrep settings' -- bash scripts/local/semgrep-settings.sh
      step "public content snapshot" node scripts/ci-scope.ts 'local checks' -- node scripts/ci-shards.ts 'local checks' --shard "$i/3" --step 'public content snapshot' -- node scripts/public-content-check.mjs --repo "$PWD"
      step "promotion dry run" promotion_dry_run "$i"
      step "inbox restart" env DOCKER=docker L5_RUNTIME_PROOFS=1 node scripts/ci-scope.ts 'local checks' -- node scripts/ci-shards.ts 'local checks' --shard "$i/3" --step 'inbox restart' -- bash scripts/local/restart-proof.sh --suite tests/acceptance/inbox-worker-restart.test.ts \
        --name "oa-precheck-$RUN-restart" --port $((PORTBASE + 20)) --api-port $((PORTBASE + 21))
      ;;
    dbgate)
      step "no named or isolation suite dropped" node scripts/merge-group.mjs each sh -c 'node scripts/named-suites.ts kept "$BASE_SHA"'
      step "database gate cases" pnpm run db:cases
      ;;
    db*)
      i=${u#db}
      step "database conformance $i/12" node scripts/ci-scope.ts 'database conformance' --shard "$i/12" -- pnpm run db:conformance --shard "$i/12" --without-isolation
      [ "$i" = 1 ] && step "upgrade drill" upgrade_drill
      ;;
    iso*)
      i=${u#iso}
      step "isolation suites $i/3" node scripts/ci-scope.ts 'isolation tests' -- node scripts/db-conformance.mjs --isolation --shard "$i/3"
      step "service stop, two addresses" env DATABASE_ADMIN_URL="$DATABASE_URL" node scripts/ci-scope.ts 'isolation tests' -- node scripts/ci-shards.ts 'isolation tests' --shard "$i/3" --step 'service stop, two addresses' -- pnpm vitest run tests/ci/named-service-stop-proof-two-urls.test.ts
      step "seed boundaries" env DATABASE_ADMIN_URL="$DATABASE_URL" node scripts/ci-scope.ts 'isolation tests' -- node scripts/ci-shards.ts 'isolation tests' --shard "$i/3" --step 'seed boundaries' -- node --test tests/review/seed-boundaries-proof.test.mjs
      step "seed redirect" env DATABASE_ADMIN_URL="$DATABASE_URL" node scripts/ci-scope.ts 'isolation tests' -- node scripts/ci-shards.ts 'isolation tests' --shard "$i/3" --step 'seed redirect' -- node --test tests/review/seed-redirect-keeps-key-off-http.proof.test.mjs
      ;;
    licences)
      step "licence checker cases" bash tests/licences/licence-cases.sh
      step "OSI licence allowlist" pnpm run licences
      ;;
    commits)
      step "every commit's message and provenance" node scripts/merge-group.mjs each node scripts/commit-range-check.mjs
      step "commit checker cases" bash tests/ci/commit-range-cases.sh
      step "migrations on main unchanged" node scripts/merge-group.mjs each node scripts/migrations-unchanged.mjs
      step "migration check cases" node --test tests/ci/migrations-unchanged-cases.mjs
      step "migration ids unique and after main's" migration_ids
      step "migration id cases" node --test tests/ci/migration-ids-cases.mjs
      ;;
    parity)
      step "command parity" node scripts/command-parity.mjs --check
      step "API-1 catalogue suites" pnpm vitest run tests/commands/api-1-catalogue.test.ts tests/commands/api-1-catalogue-authority.test.ts tests/commands/api-1-parity-bypasses.test.ts tests/commands/api-1-parity-redirects-and-agent-discovery.test.ts
      ;;
    *) echo "precheck: no unit $u"; return 2 ;;
  esac
  return "$STEP_FAILED"
}

# ci.yml's S0-1 promotion dry run, word for word but for the matrix values.
promotion_dry_run() ( # in a subshell, so its set -e ends with it
  set -euo pipefail
  decision="$(node scripts/ci-scope.ts 'local checks' --decide)"
  case "$decision" in run) ;; skip) return 0 ;; *) return 1 ;; esac
  shard="$(node scripts/ci-shards.ts 'local checks' --shard $1/3 --step 'promotion dry run' --decide)"
  case "$shard" in run) ;; skip) return 0 ;; *) return 1 ;; esac
  version="$(node -p "JSON.parse(require('node:fs').readFileSync('apps/web/dist/build.json', 'utf8')).build")"
  store="${RUNNER_TEMP}/artefacts"
  mkdir -p "$store"
  node scripts/ops/release.ts --out "${store}/ops-astro-${version}"
  records="$(mktemp -d "${PWD}/.promotion-records-XXXXXX")"
  node -e 'const fs = require("node:fs"); const [out, folder, version] = process.argv.slice(1); const { digest } = JSON.parse(fs.readFileSync(`${out}/build.json`, "utf8")); fs.writeFileSync(`${folder}/deployments.jsonl`, `${JSON.stringify({ action: "deploy recorded", environment: "staging", version, digest })}\n`, { mode: 0o600 });' \
    "${store}/ops-astro-${version}" "$records" "$version"
  OPS_ASTRO_DEPLOYMENTS="$records" node scripts/ops/promote.mjs --dry-run --version "$version" --artefacts "$store" \
    --line "CI dry run of the promotion step over the build just made"
  rm -rf "$records"
)

# The functions the scrubbed job shells source (env -i drops exported ones).
STEP_FUNCS="gate_scope lockfile_history audit_gate semgrep_gate container_suites upgrade_drill migration_ids job promotion_dry_run"
