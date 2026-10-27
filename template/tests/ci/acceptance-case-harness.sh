#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# The fixtures the acceptance cases are built from: a throwaway repository, the
# two shapes of plan commit, the product code, and the runners that bind every
# case to the refusal it names.
#
# Sourced by tests/ci/acceptance-cases.sh, which holds the cases themselves. The
# split is the per-file cap in CONTRIBUTING.md, which no label lifts, and it
# follows tests/ci/runner-case-harness.sh.

set -uo pipefail
# Output is matched with `grep -q PATTERN <<<"$output"`, never piped into
# `grep -q`: grep exits at its first match, the writer dies of SIGPIPE, and
# pipefail reads that as no match (as pr-size-cases found, 3b23752).

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="${1:-$REPO_ROOT/scripts/acceptance-check.mjs}"

PASSED=0
FAILED=0
pass() { printf '  PASS  %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '  FAIL  %s\n' "$1"; printf '        %s\n' "$2"; FAILED=$((FAILED + 1)); }

new_repo() {
  local dir
  dir="$(mktemp -d)"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.name "Acceptance Test"
  git -C "$dir" config user.email "acceptance-test@example.invalid"
  git -C "$dir" config commit.gpgsign false
  printf 'seed\n' > "$dir/seed.txt"
  git -C "$dir" add seed.txt >/dev/null
  git -C "$dir" commit -qm "seed"
  echo "$dir"
}

# A plan document: `with` the standing fail-closed criterion, `hidden` for one
# GitHub renders as nothing, `nested` for one indented under criterion 1,
# `setext` for one below a heading ruled with dashes, `indented` for one below an
# ATX heading indented into the column CommonMark still renders, else without
# it. plan_importing takes the same word as a third argument and writes the plan
# beside its test; `none` is how a case asks for a branch that brings no plan.
# Its fourth is the module the test loads, src/answer unless a case says.
STANDING='Fails closed: when any input, file, tool or service the change depends on is missing, malformed or errors, the change refuses or exits non-zero and says why; it never reports success on an unread input.'
criteria_doc() {
  printf '# Plan\n\n## Acceptance criteria\n\n1. The answer is the one asked for.\n'
  [ "$1" != "with" ] || printf '2. %s\n' "$STANDING"
  [ "$1" != "hidden" ] || printf '<!--\n2. Fails closed: where a reader is shown nothing.\n-->\n'
  [ "$1" != "nested" ] || printf '   2. %s\n' "$STANDING"
  [ "$1" != "setext" ] || printf '\nBuild brief\n-----------\n\n2. %s\n' "$STANDING"
  [ "$1" != "indented" ] || printf '\n # Build brief\n\n2. %s\n' "$STANDING"
}
# A plan whose test loads code that does not exist yet, inside the test, and
# asserts on what it got. At the plan commit the load finds nothing and the
# assertion fails; at the head it passes. A load that throws fails before the
# assertion, inside the test or at the top of the file, which proves nothing
# (Sol CF-05, CF-05-FIX1): plan_importing_statically is the second shape.
plan_importing() {
  local dir="$1" ticket="$2" standing="${3:-with}" module="${4:-src/answer}"
  mkdir -p "$dir/tests/acceptance/$ticket"
  cat > "$dir/tests/acceptance/$ticket/answer.test.ts" <<TS
import { expect, test } from 'vitest';

test('the answer is the one the ticket asked for', async () => {
  const code = await import('../../../$module').catch(() => ({ answer: () => undefined }));
  expect(code.answer()).toBe(42);
});
TS
  [ "$standing" = "none" ] || criteria_doc "$standing" > "$dir/tests/acceptance/$ticket/plan.md"
  git -C "$dir" add -A >/dev/null
  git -C "$dir" commit -qm "test: the acceptance criteria"
}

plan_importing_statically() {
  local dir="$1" ticket="$2"
  mkdir -p "$dir/tests/acceptance/$ticket"
  cat > "$dir/tests/acceptance/$ticket/answer.test.ts" <<'TS'
import { expect, test } from 'vitest';
import { answer } from '../../../src/answer';

test('the answer is the one the ticket asked for', () => {
  expect(answer()).toBe(42);
});
TS
  criteria_doc with > "$dir/tests/acceptance/$ticket/plan.md"
  git -C "$dir" add -A >/dev/null
  git -C "$dir" commit -qm "test: the acceptance criteria"
}

# A plan that asserts about its own recorded fixture and nothing else. Green
# before the code exists, which is the whole reason rule five exists.
plan_fixture_only() {
  local dir="$1" ticket="$2"
  mkdir -p "$dir/tests/acceptance/$ticket/fixtures"
  printf '{ "id": 1 }\n' > "$dir/tests/acceptance/$ticket/fixtures/event.json"
  cat > "$dir/tests/acceptance/$ticket/event.test.ts" <<'TS'
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the recorded event carries an id', () => {
  const event = JSON.parse(readFileSync(new URL('./fixtures/event.json', import.meta.url), 'utf8'));
  expect(event.id).toBe(1);
});
TS
  criteria_doc with > "$dir/tests/acceptance/$ticket/plan.md"
  git -C "$dir" add -A >/dev/null
  git -C "$dir" commit -qm "test: the recorded event"
}

# The product code, right or wrong.
build_answer() {
  local dir="$1" value="$2"
  mkdir -p "$dir/src"
  printf 'export function answer(): number {\n  return %s;\n}\n' "$value" > "$dir/src/answer.ts"
  git -C "$dir" add -A >/dev/null
  git -C "$dir" commit -qm "feat: the answer"
}

# A case starts from a clean environment. A hosted runner sets BASE_SHA,
# HEAD_SHA and the PR_* variables for the whole step, so a case that leaves one
# unset inherits the real pull request's instead and tests the runner rather
# than the check. This file was green here and red on the first hosted run for
# exactly that reason, and the check found it by refusing its own pull request.
clean_env() { env -u BASE_SHA -u HEAD_SHA -u PR_BODY -u PR_HEAD_REF -u PR_NUMBER "$@"; }

# run_saying <label> <expect> <pattern> <dir> <body> [branch] [base ref]
# The base defaults to the root commit. A case that names one is testing what
# happens when the pull request's base has moved, which is where the merge base
# stops being the plan commit's parent.
run_saying() {
  local label="$1" expect="$2" pattern="$3" dir="$4" body="$5" branch="${6:-work}" output actual
  local base="${7:-}"
  [ -n "$base" ] || base="$(git -C "$dir" rev-list --max-parents=0 HEAD)"
  output="$(cd "$dir" && clean_env BASE_SHA="$base" \
    HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="$body" PR_HEAD_REF="$branch" PR_NUMBER=101 \
    node "$CHECKER" 2>&1)"
  actual=$?
  if [ "$actual" != "$expect" ]; then
    fail "$label" "expected exit $expect, got $actual; it said: $(printf '%s' "$output" | grep REFUSE | head -2)"
  elif ! grep -q "$pattern" <<<"$output"; then
    fail "$label" "exit $expect, but nothing said \"$pattern\"; it said: $(printf '%s' "$output" | head -8)"
  else
    pass "$label"
  fi
}

# refused_naming <label> <path> <dir> [base ref] [phrase]
# The path rule in scripts/acceptance/run.mjs: the plan commit still runs red,
# the head is refused, the refusal names the path quoted (beside `phrase`,
# "outside product source" unless a case says), and nothing a changed file says
# reaches the output. A case writes $MARKER into what it changes, and $EFFECT_JS
# into what would run, so a refusal that comes after the run is red too (Sol
# CF-05-FIX5).
MARKER='SYNTHETIC_CHANGED_CONTENT'
EFFECT_DIR="$(mktemp -d)"; EFFECT="$EFFECT_DIR/executed"
trap 'rm -rf "$EFFECT_DIR"' EXIT
EFFECT_JS="import { writeFileSync } from 'node:fs';
writeFileSync('$EFFECT', 'executed');"
refused_naming() {
  local label="$1" path="$2" dir="$3" base="${4:-}" phrase="${5:-outside product source}" output actual
  [ -n "$base" ] || base="$(git -C "$dir" rev-list --max-parents=0 HEAD)"
  rm -f "$EFFECT"
  output="$(cd "$dir" && clean_env BASE_SHA="$base" HEAD_SHA="$(git rev-parse HEAD)" \
    PR_BODY="Closes #7" PR_HEAD_REF=work PR_NUMBER=101 node "$CHECKER" 2>&1)"
  actual=$?
  if [ "$actual" != 1 ]; then
    fail "$label" "expected exit 1, got $actual; it said: $(printf '%s' "$output" | grep REFUSE | head -2)"
  elif [ -e "$EFFECT" ]; then
    fail "$label" "a changed file ran before the refusal"
  elif ! grep -q "pass    red at the plan commit" <<<"$output"; then
    fail "$label" "the plan commit did not run red: $(printf '%s' "$output" | grep REFUSE | head -2)"
  elif ! grep -qF "$phrase" <<<"$(grep -F "\"$path\"" <<<"$output")"; then
    fail "$label" "nothing named \"$path\" $phrase; it said: $(printf '%s' "$output" | grep -A2 REFUSE | head -4)"
  elif grep -q "$MARKER" <<<"$output"; then
    fail "$label" "the output carries what a changed file says"
  else
    pass "$label"
  fi
}

# never_ran <label> <dir> <base ref>
# The other side of the path rule (ORCH75 78SEC): product source the head may
# change, a file the base's own layout would load or a test file of its own,
# never runs except through the plan's tests' own imports. Both runs happen,
# the wrong answer at the head is refused as wrong, and $EFFECT_JS in the
# changed file never ran.
never_ran() {
  local label="$1" dir="$2" base="$3" output actual
  rm -f "$EFFECT"
  output="$(cd "$dir" && clean_env BASE_SHA="$base" HEAD_SHA="$(git rev-parse HEAD)" \
    PR_BODY="Closes #7" PR_HEAD_REF=work PR_NUMBER=101 node "$CHECKER" 2>&1)"
  actual=$?
  if [ -e "$EFFECT" ]; then
    fail "$label" "a changed file ran that no plan test imports (exit $actual)"
  elif [ "$actual" != 1 ]; then
    fail "$label" "expected exit 1, got $actual; it said: $(printf '%s' "$output" | grep REFUSE | head -2)"
  elif ! grep -q "pass    red at the plan commit" <<<"$output"; then
    fail "$label" "the plan commit did not run red: $(printf '%s' "$output" | grep REFUSE | head -2)"
  elif ! grep -q "REFUSE  green at the head: .*answer.test.ts was reported failed" <<<"$output"; then
    fail "$label" "the head did not run the wrong answer: $(printf '%s' "$output" | grep REFUSE | head -2)"
  elif grep -q "$MARKER" <<<"$output"; then
    fail "$label" "the output carries what a changed file says"
  else
    pass "$label"
  fi
}
