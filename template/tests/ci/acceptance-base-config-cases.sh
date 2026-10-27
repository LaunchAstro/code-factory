#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Issue 30: no run reads the head's vitest configuration, and ORCH73 78PATH: a
# head that changed anything outside product source is refused.
#
# The plan commit may touch only its own directory, so every configuration file
# on a branch was written after the plan was fixed, by the person being
# measured. Both runs now use the runner's own configuration and read none of
# the repository's (ORCH75 78SEC). These cases are what the head's
# configuration can no longer do, the refusal arms nothing else reaches, and the
# one thing this still does not reach.
#
# The fixtures and the case runner are tests/ci/acceptance-case-harness.sh, the
# same ones tests/ci/acceptance-cases.sh uses. This is a second file rather than
# more of that one because that one is near the per-file cap no label lifts.
#
# Usage: tests/ci/acceptance-base-config-cases.sh [path-to-script]

set -uo pipefail
# Output is matched with `grep -q PATTERN <<<"$output"`, never piped into
# `grep -q`: grep exits at its first match, the writer dies of SIGPIPE, and
# pipefail reads that as no match (as pr-size-cases found, 3b23752).

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tests/ci/acceptance-case-harness.sh
. "$HARNESS_DIR/acceptance-case-harness.sh"

echo "base configuration cases, against $CHECKER"
echo

# A configuration committed on main before the branch forks, so it is the merge
# base's, which the check never reads. It echoes the commit, which the case
# passes to run_saying as the base ref.
base_config() {
  local dir="$1"
  cat > "$dir/vitest.config.ts"
  git -C "$dir" add -A >/dev/null
  git -C "$dir" commit -qm "chore: the repository's vitest configuration"
  git -C "$dir" rev-parse HEAD
}

# A plan that writes down what it has not decided. vitest reports the file
# passed with one todo assertion and exits zero, so nothing failed and nothing
# ran: the arm that says so had no case before this one.
plan_todo_only() {
  local dir="$1" ticket="$2"
  mkdir -p "$dir/tests/acceptance/$ticket"
  cat > "$dir/tests/acceptance/$ticket/answer.test.ts" <<'TS'
import { test } from 'vitest';

test.todo('the answer is the one the ticket asked for');
TS
  criteria_doc with > "$dir/tests/acceptance/$ticket/plan.md"
  git -C "$dir" add -A >/dev/null
  git -C "$dir" commit -qm "test: what we have not written yet"
}

# A plan whose test exists only while the code does not. Red at the plan commit
# for the right reason; at the head it registers no test at all, and the file
# is reported with nothing in it.
plan_conditional() {
  local dir="$1" ticket="$2"
  mkdir -p "$dir/tests/acceptance/$ticket"
  cat > "$dir/tests/acceptance/$ticket/answer.test.ts" <<'TS'
import { existsSync } from 'node:fs';
import { expect, test } from 'vitest';

if (!existsSync('src/answer.ts')) {
  test('there is no answer yet', () => {
    expect(1).toBe(2);
  });
}
TS
  criteria_doc with > "$dir/tests/acceptance/$ticket/plan.md"
  git -C "$dir" add -A >/dev/null
  git -C "$dir" commit -qm "test: only while the code is missing"
}

# A plan whose test passes at the head and leaves an unhandled rejection behind
# it. Every one of the plan's files is green and vitest still exits non-zero.
plan_leaking() {
  local dir="$1" ticket="$2"
  mkdir -p "$dir/tests/acceptance/$ticket"
  cat > "$dir/tests/acceptance/$ticket/answer.test.ts" <<'TS'
import { expect, test } from 'vitest';
import { answer } from '../../../src/answer';

test('the answer is the one the ticket asked for', () => {
  void Promise.reject(new Error('and nobody awaited this'));
  expect(answer()).toBe(42);
});
TS
  criteria_doc with > "$dir/tests/acceptance/$ticket/plan.md"
  git -C "$dir" add -A >/dev/null
  git -C "$dir" commit -qm "test: the acceptance criteria"
}

# --- what the head's configuration can no longer do --------------------------

# The finding, at its full width. The review of record on b50438b said the hole
# was not setupFiles but every head-side setting: here resolve.alias, pointing
# the module under test at a stub that answers correctly while src/answer.ts
# does not. The configuration and the stub are outside product source, so the
# head is refused before anything in it runs (ORCH73 78PATH).
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"
mkdir -p "$dir/src" "$dir/stub"
printf 'export function answer(): number {\n  return 0;\n}\n' > "$dir/src/answer.ts"
printf '%s\nexport function answer(): number {\n  return 42; // %s\n}\n' "$EFFECT_JS" "$MARKER" \
  > "$dir/stub/answer.ts"
cat > "$dir/vitest.config.ts" <<TS
// $MARKER
export default {
  resolve: {
    alias: [{ find: '../../../src/answer', replacement: new URL('./stub/answer.ts', import.meta.url).pathname }],
  },
};
TS
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: the wrong answer, and an alias to a right one"
refused_naming "a head that aliases the module under test is refused" "vitest.config.ts" "$dir"
rm -rf "$dir"

# A head that adds a configuration and tests of its own is refused too, with the
# right code. Until ORCH73 78PATH the head's configuration was swapped for the
# merge base's and this passed; its own tests now go in a pull request of their
# own.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
mkdir -p "$dir/tests/other"
printf 'import { expect, test } from "vitest";\n%s\n// %s\ntest("mine", () => {\n  expect(1).toBe(1);\n});\n' \
  "$EFFECT_JS" "$MARKER" > "$dir/tests/other/extra.test.ts"
printf "// %s\nexport default { test: { include: ['tests/**/*.test.ts'] } };\n" "$MARKER" > "$dir/vitest.config.ts"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "test: a config and tests of my own"
refused_naming "a head that adds its own config and tests is refused" "tests/other/extra.test.ts" "$dir"
rm -rf "$dir"

# Markdown runs when something loads it, whatever its extension, so Markdown
# beside the code is refused like the rest, here one the base's configuration
# names as setup (Sol CF-05-FIX5, ORCH74 78R6, undoing 78EDGE). So is a package
# manifest (an install runs it), and a Markdown name on a link is still a link.
dir="$(new_repo)"; mkdir -p "$dir/test"; printf 'export {};\n' > "$dir/test/setup.md"
base="$(base_config "$dir" <<'TS'
export default { test: { setupFiles: ['./test/setup.md'] } };
TS
)"
plan_importing "$dir" "7-the-answer"; build_answer "$dir" 0
printf "import { vi } from 'vitest';\n%s\n// %s\nvi.mock('../src/answer', () => ({ answer: () => 42 }));\n" \
  "$EFFECT_JS" "$MARKER" > "$dir/test/setup.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: a Markdown setup file beside the code"
refused_naming "Markdown the base's setup names, changed beside the code, is refused" \
  "test/setup.md" "$dir" "$base"
rm -rf "$dir"
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
printf '{ "name": "fixture", "scripts": { "postinstall": "echo %s" } }\n' "$MARKER" > "$dir/package.json"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "build: a manifest beside the code"
refused_naming "a package manifest changed beside product source is refused" "package.json" "$dir"
rm -rf "$dir"
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
mkdir -p "$dir/docs"; ln -s ../src/answer.ts "$dir/docs/answer.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: a link named like Markdown"
refused_naming "a link with a Markdown name is refused" "docs/answer.md" "$dir"
rm -rf "$dir"

# --- the three refusal branches nothing reached, issue 27 item 9 -------------

# A plan written as todos. vitest exits zero, the file is reported passed, and
# no assertion in it passed, so it is not red and it is not green either.
dir="$(new_repo)"; plan_todo_only "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "a plan of todos is not red at the plan commit" 1 \
  "answer.test.ts was reported passed\." "$dir" "Closes #7"
rm -rf "$dir"

# The same file at the head with nothing in it at all: the test registers
# itself only while the code is missing.
dir="$(new_repo)"; plan_conditional "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "a plan test that registers nothing at the head refuses" 1 \
  "with no test in it" "$dir" "Closes #7"
rm -rf "$dir"

# Every one of the plan's files green and vitest still non-zero. The run's exit
# code is the whole run, and the plan's files are not the whole run.
dir="$(new_repo)"; plan_leaking "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "every plan file green and a non-zero vitest exit still refuses" 1 \
  "vitest still exited" "$dir" "Closes #7"
rm -rf "$dir"

# --- the limit, and the hole that used to sit beside it ---------------------

# Issue 27 item 7. --first-parent defends the branch the pull request is opened
# from: its own commits, in the order it made them. Merge the code branch into
# the plan branch instead and the plan commit is genuinely first on that chain,
# with no backdating and nothing to read in the graph, while the code was
# written first. The claim the case next door makes is that narrow, and this is
# the record of what it does not cover.
dir="$(new_repo)"
git -C "$dir" checkout -q -b code
build_answer "$dir" 42
git -C "$dir" checkout -q -b work main
plan_importing "$dir" "7-the-answer"
git -C "$dir" merge -q --no-ff -m "chore: merge the code" code
run_saying "merging the code branch into the plan branch is NOT caught, and this records it" 0 \
  "ran and passed at" "$dir" "Closes #7"
rm -rf "$dir"

# Sol CF-05, 3 October: this case recorded a hole, and recording it did not
# close it. The base's setup file is outside product source, so a head that
# rewrites it is refused, and so is one that rewrites a helper it loads.
for edited in vitest.setup.ts test/helper.ts; do
  dir="$(new_repo)"
  mkdir -p "$dir/test"
  printf 'export {};\n' > "$dir/test/helper.ts"
  printf "import './test/helper';\n" > "$dir/vitest.setup.ts"
  base="$(base_config "$dir" <<'TS'
export default { test: { setupFiles: ['./vitest.setup.ts'] } };
TS
)"
  plan_importing "$dir" "7-the-answer"
  mkdir -p "$dir/src"
  printf 'export function answer(): number {\n  return 0;\n}\n' > "$dir/src/answer.ts"
  from="../src/answer"; [ "$edited" = test/helper.ts ] || from="./src/answer"
  printf "import { vi } from 'vitest';\n%s\n// %s\nvi.mock('%s', () => ({ answer: () => 42 }));\n" \
    "$EFFECT_JS" "$MARKER" "$from" > "$dir/$edited"
  git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: the wrong answer, and a mock in $edited"
  refused_naming "a head rewriting $edited, which the base's setup loads, is refused" \
    "$edited" "$dir" "$base"
  rm -rf "$dir"
done

# Sol CF-05: a plan whose file cannot even be loaded at the plan commit has no
# test that ran and failed. A missing import is not the right reason.
dir="$(new_repo)"
plan_importing_statically "$dir" "7-the-answer"
build_answer "$dir" 42
run_saying "a plan file that fails to load is not red at the plan commit" 1 \
  "failed before any test ran" "$dir" "Closes #7"
rm -rf "$dir"

# Sol CF-05: tested code never sees the runner's credentials, and nothing it
# prints of them reaches the refusal.
dir="$(new_repo)"
plan_importing "$dir" "7-the-answer"
mkdir -p "$dir/src"
printf 'export function answer(): number {\n  console.error(process.env.GH_TOKEN);\n  return 0;\n}\n' > "$dir/src/answer.ts"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: prints the token"
marker="SYNTHETIC_CF05_CREDENTIAL_MARKER"
output="$(cd "$dir" && clean_env GH_TOKEN="$marker" BASE_SHA="$(git rev-list --max-parents=0 HEAD)" \
  HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="Closes #7" PR_HEAD_REF=work PR_NUMBER=101 node "$CHECKER" 2>&1)"
if grep -q "$marker" <<<"$output"; then
  fail "an inherited credential never reaches the transcript" "the marker was printed"
elif ! grep -q "green at the head" <<<"$output"; then
  fail "an inherited credential never reaches the transcript" "the run did not reach the head: $(printf '%s' "$output" | head -4)"
else
  pass "an inherited credential never reaches the transcript"
fi
rm -rf "$dir"

# Sol's review of 03b8239: a failure message in vitest's report went into the
# refusal without passing through the withholding the transcript gets. Sol's
# review of f555b81: a value shorter than eight characters was not withheld at
# all, so the marker is seven, under a name no list of credentials would hold.
dir="$(new_repo)"; mkdir -p "$dir/tests/acceptance/7-the-answer"
marker="Cf87pwd"; criteria_doc with > "$dir/tests/acceptance/7-the-answer/plan.md"
cat > "$dir/tests/acceptance/7-the-answer/answer.test.ts" <<TS
import { expect, test } from 'vitest';
test('an error before the assertion', async () => {
  const code = await import('../../../src/answer').catch(() => ({ answer: () => { throw new Error('$marker'); } }));
  expect(code.answer()).toBe(42);
});
TS
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "test: the plan"; build_answer "$dir" 42
output="$(cd "$dir" && clean_env SYNTHETIC_PASSWORD="$marker" BASE_SHA="$(git rev-list --max-parents=0 HEAD)" \
  HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="Closes #7" PR_HEAD_REF=work PR_NUMBER=101 node "$CHECKER" 2>&1)"
if grep -q "$marker" <<<"$output"; then
  fail "a credential of any length in a reported failure message is withheld" "the marker was printed"
elif ! grep -q "failed on an error before its assertion" <<<"$output"; then
  fail "a credential of any length in a reported failure message is withheld" "no such refusal: $(printf '%s' "$output" | grep REFUSE | head -2)"
else
  pass "a credential of any length in a reported failure message is withheld"
fi
rm -rf "$dir"

# The same review: the check's own Git reads inherited GH_TOKEN, which reading
# commits already in the clone never needs. A git first on PATH records it.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42; bin="$(mktemp -d)"
printf '#!/bin/sh\n[ -z "${GH_TOKEN:-}" ] || printf seen >> "%s/seen"\nexec "%s" "$@"\n' "$bin" "$(command -v git)" > "$bin/git"
chmod +x "$bin/git"
output="$(cd "$dir" && clean_env GH_TOKEN="SYNTHETIC_CF87_GIT_MARKER" PATH="$bin:$PATH" \
  BASE_SHA="$(git rev-list --max-parents=0 HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
  PR_BODY="Closes #7" PR_HEAD_REF=work PR_NUMBER=101 node "$CHECKER" 2>&1)"
status=$?
if [ -e "$bin/seen" ]; then
  fail "the check's Git reads get no ambient credential" "a git child saw GH_TOKEN (exit $status)"
elif [ "$status" != 0 ]; then
  fail "the check's Git reads get no ambient credential" "exit $status: $(printf '%s' "$output" | grep REFUSE | head -2)"
else
  pass "the check's Git reads get no ambient credential"
fi
rm -rf "$dir" "$bin"

# Sol CF-05-FIX5: tested code runs with a fresh, empty HOME and config
# directories inside it, so a credential stored in the caller's is out of reach.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; home="$(mktemp -d)"
marker="SYNTHETIC_CF05_STORED_CREDENTIAL"; mkdir -p "$home/.config/gh" "$home/xdg/gh" "$dir/src"
printf 'example.invalid:\n  oauth_token: %s\n' "$marker" > "$home/.config/gh/hosts.yml"
cp "$home/.config/gh/hosts.yml" "$home/xdg/gh/hosts.yml"
cat > "$dir/src/answer.ts" <<'TS'
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

export function answer(): number {
  for (const config of [`${homedir()}/.config`, process.env['XDG_CONFIG_HOME']]) {
    try { console.error(readFileSync(`${config}/gh/hosts.yml`, 'utf8')); }
    catch { console.error(`no stored credential under ${config}`); }
  }
  return 0;
}
TS
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: prints a stored credential"
output="$(cd "$dir" && clean_env HOME="$home" XDG_CONFIG_HOME="$home/xdg" BASE_SHA="$(git rev-list --max-parents=0 HEAD)" \
  HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="Closes #7" PR_HEAD_REF=work PR_NUMBER=101 node "$CHECKER" 2>&1)"
if grep -q "$marker" <<<"$output"; then
  fail "a credential stored in the caller's home never reaches tested code" "the marker was printed"
elif ! grep -q "no stored credential under" <<<"$output"; then
  fail "a credential stored in the caller's home never reaches tested code" "the code did not run: $(printf '%s' "$output" | grep REFUSE | head -2)"
else
  pass "a credential stored in the caller's home never reaches tested code"
fi
rm -rf "$dir" "$home"

# Sol CF-05: a path that starts with a space is not under docs/.
dir="$(new_repo)"
mkdir -p "$dir/ docs"
printf 'export const guard = () => false;\n' > "$dir/ docs/guard.mjs"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: code under space-docs"
output="$(cd "$dir" && clean_env BASE_SHA="$(git rev-list --max-parents=0 HEAD)" \
  HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="" PR_HEAD_REF=work PR_NUMBER=101 node "$CHECKER" 2>&1)"
if [ $? -ne 0 ]; then
  pass "a path under ' docs/' does not take the docs exemption"
else
  fail "a path under ' docs/' does not take the docs exemption" "exit 0: $(printf '%s' "$output" | head -3)"
fi
rm -rf "$dir"

# shellcheck source=tests/ci/acceptance-setup-cases.sh
. "$HARNESS_DIR/acceptance-setup-cases.sh"

echo
echo "base configuration cases: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
