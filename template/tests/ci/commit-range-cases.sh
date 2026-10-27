#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# The commit-range check, tested against throwaway repositories.
#
# Finding 7 of the sweep: commitlint and the provenance trailers were listed
# as blocking from commit one, but ran only in a local hook. A local hook is
# advice, not a gate: it is absent on a fresh clone until `pnpm install`, and
# `--no-verify` skips it. Anything that must hold has to be checked in CI, on
# the range of commits a pull request actually introduces.
#
# Usage: tests/ci/commit-range-cases.sh [path-to-checker]

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="${1:-$REPO_ROOT/scripts/commit-range-check.mjs}"

PASSED=0
FAILED=0
pass() { printf '  PASS  %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '  FAIL  %s\n' "$1"; printf '        %s\n' "$2"; FAILED=$((FAILED + 1)); }

AGENT_TRAILERS=$'\n\nAssisted-by: LLM\nAgent-model: claude-opus-5\nAgent-tool: Claude Code'
HUMAN_TRAILER=$'\n\nSigned-off-by: A Person <person@example.invalid>'

new_repo() {
  local dir
  dir="$(mktemp -d)"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.name "Range Test"
  git -C "$dir" config user.email "range-test@example.invalid"
  git -C "$dir" config commit.gpgsign false
  printf 'seed\n' > "$dir/seed.txt"
  git -C "$dir" add seed.txt >/dev/null
  git -C "$dir" commit -qm "chore: seed$AGENT_TRAILERS"
  echo "$dir"
}

# commit <dir> <message>
commit() {
  local dir="$1" msg="$2"
  printf '%s\n' "$RANDOM" >> "$dir/seed.txt"
  git -C "$dir" add seed.txt >/dev/null
  git -C "$dir" commit -qm "$msg"
}

run_checker() {
  local dir="$1"
  ( cd "$dir" && BASE_SHA="$(git rev-list --max-parents=0 HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
      node "$CHECKER" >/dev/null 2>&1; echo $? )
}

# The whole-history shape: every commit reachable from the tip, with the tip as
# its own base. The `commit messages and provenance` job runs it on every push
# to main, and it is the only path on which a protected branch's own merge
# commits are ever checked. A pull request's range never contains them, and the
# publication receipt refuses any candidate that is more than one root commit.
run_checker_history() {
  local dir="$1"
  ( cd "$dir" && BASE_SHA="$(git rev-parse HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
      HUB_RANGE_INCLUDE_ROOT=1 node "$CHECKER" >/dev/null 2>&1; echo $? )
}

echo "commit-range cases, against $CHECKER"
echo

if [ ! -f "$CHECKER" ]; then
  fail "the checker exists" "no file at $CHECKER; nothing enforces commit messages or provenance in CI"
  echo
  echo "commit-range cases: $PASSED passed, $FAILED failed"
  exit 1
fi

# 1. a clean range passes
dir="$(new_repo)"
commit "$dir" "feat: something reasonable$AGENT_TRAILERS"
status="$(run_checker "$dir")"
[ "$status" = "0" ] && pass "a clean range passes (exit 0)" \
  || fail "a clean range passes" "expected exit 0, got $status"
rm -rf "$dir"

# 2. a message that is not a conventional commit fails
dir="$(new_repo)"
commit "$dir" "made some changes$AGENT_TRAILERS"
status="$(run_checker "$dir")"
[ "$status" = "1" ] && pass "a non-conventional subject fails (exit 1)" \
  || fail "a non-conventional subject fails" "expected exit 1, got $status"
rm -rf "$dir"

# 3. an unknown type fails
dir="$(new_repo)"
commit "$dir" "wibble: not a type we use$AGENT_TRAILERS"
status="$(run_checker "$dir")"
[ "$status" = "1" ] && pass "an unknown type fails (exit 1)" \
  || fail "an unknown type fails" "expected exit 1, got $status"
rm -rf "$dir"

# 4. no provenance at all fails
dir="$(new_repo)"
commit "$dir" "fix: no provenance of any kind"
status="$(run_checker "$dir")"
[ "$status" = "1" ] && pass "a commit with no provenance fails (exit 1)" \
  || fail "a commit with no provenance fails" "expected exit 1, got $status"
rm -rf "$dir"

# 5. partial agent trailers fail
dir="$(new_repo)"
commit "$dir" "fix: half the trailers"$'\n\nAssisted-by: LLM'
status="$(run_checker "$dir")"
[ "$status" = "1" ] && pass "partial agent trailers fail (exit 1)" \
  || fail "partial agent trailers fail" "expected exit 1, got $status"
rm -rf "$dir"

# 6. a human sign-off is provenance on its own
dir="$(new_repo)"
commit "$dir" "docs: typed by a person$HUMAN_TRAILER"
status="$(run_checker "$dir")"
[ "$status" = "0" ] && pass "a human sign-off is accepted as provenance (exit 0)" \
  || fail "a human sign-off is accepted as provenance" "expected exit 0, got $status"
rm -rf "$dir"

# 7. every commit in the range is checked, not just the tip
dir="$(new_repo)"
commit "$dir" "fix: no provenance in the middle"
commit "$dir" "feat: a clean tip$AGENT_TRAILERS"
status="$(run_checker "$dir")"
[ "$status" = "1" ] && pass "a bad commit behind a clean tip still fails (exit 1)" \
  || fail "a bad commit behind a clean tip still fails" "expected exit 1, got $status"
rm -rf "$dir"

# Round four, 7 September. The checker read trailer names and never their
# values, so a commit could carry the shape of provenance with nothing in it.
EMPTY_TRAILERS=$'\n\nAssisted-by:\nAgent-model:\nAgent-tool:'
dir="$(new_repo)"
commit "$dir" "fix: provenance with no values$EMPTY_TRAILERS"
status="$(run_checker "$dir")"
[ "$status" = "1" ] && pass "empty trailer values fail (exit 1)" \
  || fail "empty trailer values fail" "expected exit 1, got $status; the names were present and the values were blank"
rm -rf "$dir"

dir="$(new_repo)"
commit "$dir" "fix: whitespace provenance"$'\n\nAssisted-by:   \nAgent-model: \nAgent-tool:\t'
status="$(run_checker "$dir")"
[ "$status" = "1" ] && pass "whitespace-only trailer values fail (exit 1)" \
  || fail "whitespace-only trailer values fail" "expected exit 1, got $status"
rm -rf "$dir"

dir="$(new_repo)"
commit "$dir" "docs: an empty sign-off"$'\n\nSigned-off-by:'
status="$(run_checker "$dir")"
[ "$status" = "1" ] && pass "an empty Signed-off-by is not provenance (exit 1)" \
  || fail "an empty Signed-off-by is not provenance" "expected exit 1, got $status"
rm -rf "$dir"

dir="$(new_repo)"
commit "$dir" "docs: a sign-off with no email"$'\n\nSigned-off-by: Someone'
status="$(run_checker "$dir")"
[ "$status" = "1" ] && pass "a sign-off without an email fails (exit 1)" \
  || fail "a sign-off without an email fails" "expected exit 1, got $status"
rm -rf "$dir"

# The root commit must be checked too. A range computed as HEAD..HEAD selects
# nothing, and a gate that checked nothing has nothing to report as passing:
# Sol's CF-09 review found it exiting 0.
dir="$(new_repo)"
status="$( cd "$dir" && BASE_SHA="$(git rev-parse HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
    node "$CHECKER" >/dev/null 2>&1; echo $? )"
[ "$status" = "2" ] && pass "an empty range refuses rather than passing over nothing (exit 2)" \
  || fail "an empty range refuses rather than passing over nothing" "expected exit 2, got $status"

# Each variable names one commit, or the run refuses. An unresolved base fell
# into the no-common-ancestor branch and checked the whole history instead;
# a range in HEAD_SHA reached rev-list as a range that selected nothing.
status="$( cd "$dir" && BASE_SHA=no-such-base HEAD_SHA="$(git rev-parse HEAD)" \
    node "$CHECKER" >/dev/null 2>&1; echo $? )"
[ "$status" = "2" ] && pass "an unresolved BASE_SHA refuses (exit 2)" \
  || fail "an unresolved BASE_SHA refuses" "expected exit 2, got $status; it checked a selection nobody asked for"
status="$( cd "$dir" && head="$(git rev-parse HEAD)" && BASE_SHA="$head" HEAD_SHA="$head..$head" \
    node "$CHECKER" >/dev/null 2>&1; echo $? )"
[ "$status" = "2" ] && pass "a revision range in HEAD_SHA refuses (exit 2)" \
  || fail "a revision range in HEAD_SHA refuses" "expected exit 2, got $status; the range selected nothing and passed"
rm -rf "$dir"

# Sol's CF-09 second round. `git merge-base` exits 1 for two histories with no
# common ancestor, and that alone selects the whole of head; a tool error is
# no selection and refuses. The fake git fails merge-base and nothing else.
# What Git said is not repeated: its stderr can carry a credential.
dir="$(new_repo)"
commit "$dir" "feat: something reasonable$AGENT_TRAILERS"
mkdir "$dir/bin"
printf '#!/bin/sh\n[ "$1" = merge-base ] && { echo "fatal: injected" >&2; exit 128; }\nexec "%s" "$@"\n' \
  "$(command -v git)" > "$dir/bin/git"
chmod +x "$dir/bin/git"
said="$( cd "$dir" && BASE_SHA="$(git rev-list --max-parents=0 HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
    PATH="$dir/bin:$PATH" node "$CHECKER" 2>&1; echo "exit $?" )"
case "$said" in
  *injected*) fail "a merge-base tool error refuses, not a whole-history pass" "Git's stderr was repeated" ;;
  *'git merge-base: failed'*'exit 2') pass "a merge-base tool error refuses, not a whole-history pass (exit 2)" ;;
  *) fail "a merge-base tool error refuses, not a whole-history pass" "got: $(printf '%s' "$said" | tail -2 | tr '\n' ' ')" ;;
esac
git -C "$dir" checkout -q --orphan unrelated
git -C "$dir" commit -qm "feat: an unrelated root$AGENT_TRAILERS"
status="$( cd "$dir" && BASE_SHA=main HEAD_SHA=unrelated node "$CHECKER" >/dev/null 2>&1; echo $? )"
[ "$status" = "0" ] && pass "histories with no common ancestor check all of head (exit 0)" \
  || fail "histories with no common ancestor check all of head" "expected exit 0, got $status"
rm -rf "$dir"

# A repository whose only commit is bad must fail, not pass because the range
# excluded the root.
dir="$(mktemp -d)"
git -C "$dir" init -q -b main
git -C "$dir" config user.name "Range Test"
git -C "$dir" config user.email "range-test@example.invalid"
git -C "$dir" config commit.gpgsign false
printf 'seed\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null
git -C "$dir" commit -qm "no type and no provenance at all"
status="$( cd "$dir" && BASE_SHA="$(git rev-parse HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
    HUB_RANGE_INCLUDE_ROOT=1 node "$CHECKER" >/dev/null 2>&1; echo $? )"
[ "$status" = "1" ] && pass "the root commit is checked when asked (exit 1)" \
  || fail "the root commit is checked when asked" "expected exit 1, got $status; a first push would never check its own first commit"
rm -rf "$dir"

# Placeholder and partial declarations remain invalid beside a human sign-off.
for trailers in \
  $'Assisted-by: LLM\nAgent-model: <actual-model-id>\nAgent-tool: test-tool' \
  $'Assisted-by: LLM\nAgent-model: TODO\nAgent-tool: test-tool' \
  $'Assisted-by: LLM\nAgent-model: fixture-model\nAgent-tool: [actual tool]' \
  $'Assisted-by: LLM\nAgent-model: fixture-model\nAgent-tool: test-tool\nAgent-model:' \
  $'Signed-off-by: A Person <person@example.invalid>\nAssisted-by: LLM'; do
  dir="$(new_repo)"
  commit "$dir" "fix: invalid declaration"$'\n\n'"$trailers"
  status="$(run_checker "$dir")"
  [ "$status" = "1" ] && pass "placeholder or partial declaration fails (exit 1)" \
    || fail "placeholder or partial declaration fails" "expected exit 1, got $status"
  rm -rf "$dir"
done

# The assistance value is a literal contract, including duplicate declarations.
for trailers in \
  $'Assisted-by: automation\nAgent-model: fixture-model\nAgent-tool: fixture-tool' \
  $'Assisted-by: llm\nAgent-model: fixture-model\nAgent-tool: fixture-tool' \
  $'Assisted-by: LLM\nAgent-model: fixture-model\nAgent-tool: fixture-tool\nAssisted-by: automation' \
  $'Assisted-by: LLM\nAgent-model: fixture-model\nAgent-tool: fixture-tool\nAgent-model: conflicting-model'; do
  dir="$(new_repo)"
  commit "$dir" "fix: invalid assistance"$'\n\n'"$trailers"
  status="$(run_checker "$dir")"
  [ "$status" = "1" ] && pass "invalid assistance or conflicting declarations fail (exit 1)" \
    || fail "invalid assistance or conflicting declarations fail" "expected exit 1, got $status"
  rm -rf "$dir"
done

# 17 September, the loop rehearsal. The ruleset requires merge commits, and
# GitHub writes them as "Merge pull request #N from ..." with no trailers. Run
# over a whole history the checker rejected all twelve of the rehearsal
# repository's merges: 24 problems on a main that nothing had refused. The
# platform's own merge commit is exempt. Three things must hold at once for the
# exemption: exactly two parents, the web-flow identity on the committer, and
# the commit already being on the base's own history. Sol's review of 979094
# raised the third: a branch must not be able to introduce a commit that
# exempts itself.

# merge_as <dir> <branch> <committer-name> <committer-email> [subject]
merge_as() {
  local dir="$1" branch="$2" name="$3" email="$4"
  local subject="${5:-Merge pull request #1 from LaunchAstro/$branch}"
  git -C "$dir" checkout -q -b "$branch"
  commit "$dir" "feat: work on a branch$AGENT_TRAILERS"
  git -C "$dir" checkout -q main
  GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" \
    git -C "$dir" merge -q --no-ff -m "$subject" "$branch"
}

dir="$(new_repo)"
merge_as "$dir" "topic" "GitHub" "noreply@github.com"
status="$(run_checker_history "$dir")"
[ "$status" = "0" ] && pass "GitHub's own merge commit is exempt (exit 0)" \
  || fail "GitHub's own merge commit is exempt" "expected exit 0, got $status; the ruleset requires a merge commit the provenance rule then rejects"
rm -rf "$dir"

dir="$(new_repo)"
merge_as "$dir" "topic" "Range Test" "range-test@example.invalid"
status="$(run_checker_history "$dir")"
[ "$status" = "1" ] && pass "a merge commit written locally is not exempt (exit 1)" \
  || fail "a merge commit written locally is not exempt" "expected exit 1, got $status; the wording alone must not buy the exemption"
rm -rf "$dir"

dir="$(new_repo)"
printf '%s\n' "$RANDOM" >> "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null
GIT_COMMITTER_NAME="GitHub" GIT_COMMITTER_EMAIL="noreply@github.com" \
  git -C "$dir" commit -qm "Update seed.txt"
status="$(run_checker_history "$dir")"
[ "$status" = "1" ] && pass "a one-parent web-flow commit is not exempt (exit 1)" \
  || fail "a one-parent web-flow commit is not exempt" "expected exit 1, got $status; the web editor writes ordinary commits and they carry provenance"
rm -rf "$dir"

dir="$(new_repo)"
git -C "$dir" checkout -q -b topic
commit "$dir" "fix: no provenance on the branch"
git -C "$dir" checkout -q main
GIT_COMMITTER_NAME="GitHub" GIT_COMMITTER_EMAIL="noreply@github.com" \
  git -C "$dir" merge -q --no-ff -m "Merge pull request #2 from LaunchAstro/topic" topic
status="$(run_checker_history "$dir")"
[ "$status" = "1" ] && pass "the exemption does not cover what the merge brings in (exit 1)" \
  || fail "the exemption does not cover what the merge brings in" "expected exit 1, got $status; a bad commit must not reach main behind a merge"
rm -rf "$dir"

# Sol's first finding on 979094: the identity is a claim anyone can type, so a
# branch could carry its own web-flow merge and exempt it. A commit the branch
# introduces is never on the base's history, and that is what is checked.
dir="$(new_repo)"
git -C "$dir" checkout -q -b side
printf 'side\n' > "$dir/side.txt"
git -C "$dir" add side.txt >/dev/null
git -C "$dir" commit -qm "feat: side work$AGENT_TRAILERS"
git -C "$dir" checkout -q -b topic main
commit "$dir" "feat: topic work$AGENT_TRAILERS"
GIT_COMMITTER_NAME="GitHub" GIT_COMMITTER_EMAIL="noreply@github.com" \
  git -C "$dir" merge -q --no-ff -m "Merge pull request #3 from LaunchAstro/side" side
status="$( cd "$dir" && BASE_SHA="$(git rev-parse main)" HEAD_SHA="$(git rev-parse topic)" \
    node "$CHECKER" >/dev/null 2>&1; echo $? )"
[ "$status" = "1" ] && pass "a branch cannot introduce its own exempt merge (exit 1)" \
  || fail "a branch cannot introduce its own exempt merge" "expected exit 1, got $status; a pull request would exempt a commit of its own writing"
rm -rf "$dir"

# Sol's second finding on 979094: Git keeps a unit separator inside an identity,
# so a crafted author name could shift the parsed fields and make an ordinary
# identity read as web-flow. Nothing may frame these fields but NUL, which a
# commit object cannot contain.
dir="$(new_repo)"
git -C "$dir" checkout -q -b topic
commit "$dir" "feat: work on a branch$AGENT_TRAILERS"
git -C "$dir" checkout -q main
GIT_AUTHOR_NAME=$'GitHub\x1fnoreply@github.com' \
  git -C "$dir" merge -q --no-ff -m "Merge pull request #4 from LaunchAstro/topic" topic
status="$(run_checker_history "$dir")"
[ "$status" = "1" ] && pass "a separator inside an identity buys nothing (exit 1)" \
  || fail "a separator inside an identity buys nothing" "expected exit 1, got $status; the parse shifted and read an ordinary identity as web-flow"
rm -rf "$dir"

# Copilot's review of 7a767bc: GitHub's pull-request merge has exactly two
# parents and a person as its author, so neither an octopus merge nor a
# web-flow claim on the author alone is the shape being exempted.
dir="$(new_repo)"
for side in one two; do
  git -C "$dir" checkout -q -b "side-$side" main
  printf '%s\n' "$side" > "$dir/$side.txt"
  git -C "$dir" add "$side.txt" >/dev/null
  git -C "$dir" commit -qm "feat: $side$AGENT_TRAILERS"
done
git -C "$dir" checkout -q main
GIT_COMMITTER_NAME="GitHub" GIT_COMMITTER_EMAIL="noreply@github.com" \
  git -C "$dir" merge -q --no-ff -m "Merge pull request #5 from LaunchAstro/both" side-one side-two
status="$(run_checker_history "$dir")"
[ "$status" = "1" ] && pass "an octopus merge is not the shape exempted (exit 1)" \
  || fail "an octopus merge is not the shape exempted" "expected exit 1, got $status; GitHub's pull-request merge has two parents"
rm -rf "$dir"

dir="$(new_repo)"
git -C "$dir" checkout -q -b topic
commit "$dir" "feat: work on a branch$AGENT_TRAILERS"
git -C "$dir" checkout -q main
GIT_AUTHOR_NAME="GitHub" GIT_AUTHOR_EMAIL="noreply@github.com" \
  git -C "$dir" merge -q --no-ff -m "Merge pull request #6 from LaunchAstro/topic" topic
status="$(run_checker_history "$dir")"
[ "$status" = "1" ] && pass "the web-flow claim on the author alone is not enough (exit 1)" \
  || fail "the web-flow claim on the author alone is not enough" "expected exit 1, got $status; GitHub writes itself as the committer, not the author"
rm -rf "$dir"

# Sol's CF-09 fourth round, criterion 3: reading local commits needs no
# credential, so none reaches Git, or commitlint and the Git it runs. The git
# first on PATH writes down whether a credential's name reached it, never the
# value, and runs the real one.
dir="$(new_repo)"
commit "$dir" "feat: something reasonable$AGENT_TRAILERS"
base="$(git -C "$dir" rev-list --max-parents=0 HEAD)"
head="$(git -C "$dir" rev-parse HEAD)"
spy="$(mktemp -d)"
cat > "$spy/git" <<EOF
#!/bin/sh
if env | cut -d= -f1 | grep -qxE 'GH_TOKEN|GITHUB_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN'; then seen=credential; else seen=clean; fi
printf '%s %s\n' "\$seen" "\$1" >> "$spy/audit"
exec "$(command -v git)" "\$@"
EOF
chmod +x "$spy/git"
marker="range-marker-$RANDOM$RANDOM"
said="$( cd "$dir" && PATH="$spy:$PATH" BASE_SHA="$base" HEAD_SHA="$head" GH_TOKEN="$marker" \
    GITHUB_TOKEN="$marker" NODE_AUTH_TOKEN="$marker" NPM_TOKEN="$marker" node "$CHECKER" 2>&1; echo "exit $?" )"
carried="$(grep -c '^credential' "$spy/audit")"
case "$said" in
  *"$marker"*) fail "a local Git read carries no credential" "the marker was printed" ;;
  *'exit 0') if grep -q '^clean rev-parse' "$spy/audit" && [ "$carried" = "0" ]; then
      pass "a local Git read carries no credential"
    else
      fail "a local Git read carries no credential" "$carried of $(wc -l < "$spy/audit" | tr -d ' ') git call(s) carried a credential's name"
    fi ;;
  *) fail "a local Git read carries no credential" "expected exit 0, got: ${said##*$'\n'}" ;;
esac
rm -rf "$dir" "$spy"

# Sol's third review of 390b00d: the whole-history invocation was hard-coded in
# this file and nothing held the workflow to supplying it. Delete the step, or
# change either SHA or the flag, and every case here stays green while the
# exemption goes back to having no caller.
WORKFLOW="$REPO_ROOT/.github/workflows/ci.yml"
step="$(awk '/Every commit on main, including the merges GitHub wrote/,/The checker.s own cases/' "$WORKFLOW")"
missing=""
for needed in \
  "if: github.event_name == 'push'" \
  'BASE_SHA: ${{ github.sha }}' \
  'HEAD_SHA: ${{ github.sha }}' \
  "HUB_RANGE_INCLUDE_ROOT: '1'" \
  'run: node scripts/commit-range-check.mjs'; do
  case "$step" in
    *"$needed"*) ;;
    *) missing="$missing
        $needed" ;;
  esac
done
# the job itself must not be skipped on a push: restoring the job-level
# condition would take the caller away again and leave every step untouched
case "$(awk '/^  commits:/,/steps:/' "$WORKFLOW")" in
  *"if:"*) missing="$missing
        the job must carry no job-level if:, or it is skipped on a push" ;;
  *) ;;
esac
# and the pull-request step keeps its own condition, now that the job runs on both
case "$(awk '/Every commit in the pull request, not only the tip/,/HEAD_SHA/' "$WORKFLOW")" in
  *"if: github.event_name == 'pull_request'"*) ;;
  *) missing="$missing
        the pull-request step's own if: condition" ;;
esac
[ -z "$missing" ] && pass "the workflow runs the whole history on a push to main" \
  || fail "the workflow runs the whole history on a push to main" "missing from .github/workflows/ci.yml:$missing"

echo
echo "commit-range cases: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
