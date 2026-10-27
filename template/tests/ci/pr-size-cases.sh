#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# The pull request size gate and its waivers, against throwaway repositories.
#
# Round four, finding at rank 15: the mechanical waiver lifted the per-file
# handwritten cap as well as the total, so one label let a single file of any
# size through. The two limits exist for different reasons. The total is about
# how much a reviewer can hold; the per-file cap is about a file nobody can
# read in one sitting. A migration or a lock file is genuinely unreadable and
# genuinely mechanical, and it is caught by the generated-file patterns
# without anyone applying a label.
#
# Usage: tests/ci/pr-size-cases.sh [path-to-script]

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SIZER="${1:-$REPO_ROOT/scripts/pr-size.mjs}"

PASSED=0
FAILED=0
pass() { printf '  PASS  %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '  FAIL  %s\n' "$1"; printf '        %s\n' "$2"; FAILED=$((FAILED + 1)); }

new_repo() {
  local dir
  dir="$(mktemp -d)"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.name "Size Test"
  git -C "$dir" config user.email "size-test@example.invalid"
  git -C "$dir" config commit.gpgsign false
  printf 'seed\n' > "$dir/seed.txt"
  git -C "$dir" add seed.txt >/dev/null
  git -C "$dir" commit -qm "seed"
  echo "$dir"
}

# add_lines <dir> <path> <count>
add_lines() {
  local dir="$1" path="$2" count="$3"
  mkdir -p "$dir/$(dirname "$path")"
  : > "$dir/$path"
  local i=1
  while [ "$i" -le "$count" ]; do printf 'line %s\n' "$i" >> "$dir/$path"; i=$((i + 1)); done
  git -C "$dir" add "$path" >/dev/null
  git -C "$dir" commit -qm "feat: $path"
}

# add_files <dir> <count>: <count> separate small files, three lines each, so
# the file count trips before the line total goes anywhere near the ceiling.
add_files() {
  local dir="$1" count="$2"
  mkdir -p "$dir/src/many"
  local i=1
  while [ "$i" -le "$count" ]; do
    printf 'export const value%s = %s;\n\n// file %s\n' "$i" "$i" "$i" > "$dir/src/many/f$i.ts"
    i=$((i + 1))
  done
  git -C "$dir" add src/many >/dev/null
  git -C "$dir" commit -qm "feat: $count small files"
}

# A repository whose first commit already carries the file, so a later commit
# can delete from it. `run_sizer` measures from the root commit, and a file
# created and removed inside the span is not a deletion to anybody.
# seeded_repo <path> <count>
seeded_repo() {
  local path="$1" count="$2" dir i=1
  dir="$(mktemp -d)"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.name "Size Test"
  git -C "$dir" config user.email "size-test@example.invalid"
  git -C "$dir" config commit.gpgsign false
  mkdir -p "$dir/$(dirname "$path")"
  : > "$dir/$path"
  while [ "$i" -le "$count" ]; do printf 'line %s\n' "$i" >> "$dir/$path"; i=$((i + 1)); done
  git -C "$dir" add "$path" >/dev/null
  git -C "$dir" commit -qm "seed"
  echo "$dir"
}

# keep_lines <dir> <path> <count>: drop everything after line <count>.
keep_lines() {
  local dir="$1" path="$2" count="$3"
  head -n "$count" "$dir/$path" > "$dir/$path.kept"
  mv "$dir/$path.kept" "$dir/$path"
  git -C "$dir" add "$path" >/dev/null
  git -C "$dir" commit -qm "refactor: cut $path back"
}

# Both run the default mode, so every case before the mode cases reads
# today's blocking result, which shadow mode keeps deciding.
run_sizer() {
  local dir="$1" labels="$2"
  ( cd "$dir" && BASE_SHA="$(git rev-list --max-parents=0 HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
      PR_LABELS="$labels" env -u PR_SIZE_MODE node "$SIZER" >/dev/null 2>&1; echo $? )
}

# What the gate said, so a case can be about the arithmetic and not only about
# the exit code. A pull request is argued about at open on the figure the gate
# prints.
sizer_says() {
  local dir="$1" labels="$2"
  ( cd "$dir" && BASE_SHA="$(git rev-list --max-parents=0 HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
      PR_LABELS="$labels" env -u PR_SIZE_MODE node "$SIZER" 2>&1 )
}

# mode_says <dir> <mode>: what the gate printed in that mode, then its exit
# code as a last line `exit N`, so one run answers both.
mode_says() {
  local dir="$1" mode="$2"
  ( cd "$dir" && BASE_SHA="$(git rev-list --max-parents=0 HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
      PR_LABELS="" PR_SIZE_MODE="$mode" node "$SIZER" 2>&1; echo "exit $?" )
}

echo "pr-size cases, against $SIZER"
echo

dir="$(new_repo)"; add_lines "$dir" "src/small.ts" 50
status="$(run_sizer "$dir" "")"
[ "$status" = "0" ] && pass "a small change passes (exit 0)" || fail "a small change passes" "expected 0, got $status"
rm -rf "$dir"

# Three files of 350, so the total and not the per-file cap is what trips.
dir="$(new_repo)"; add_lines "$dir" "src/a.ts" 350; add_lines "$dir" "src/b.ts" 350; add_lines "$dir" "src/c.ts" 350
status="$(run_sizer "$dir" "")"
[ "$status" = "1" ] && pass "over the total ceiling fails (exit 1)" || fail "over the total ceiling fails" "expected 1, got $status"
rm -rf "$dir"

# Sol's CF-09 review, criterion 1: docs/METHOD.md sets about 800 lines of
# product code and 1,000 at most. Two files of 400 is that figure exactly, at
# the per-file cap, and needs no label.
dir="$(new_repo)"; add_lines "$dir" "src/a.ts" 400; add_lines "$dir" "src/b.ts" 400
status="$(run_sizer "$dir" "")"
[ "$status" = "0" ] && pass "the METHOD product ceiling passes without a waiver (exit 0)" \
  || fail "the METHOD product ceiling passes without a waiver" "expected 0, got $status: $(sizer_says "$dir" "" | head -1)"

# Sol's CF-09 third round: 1,000 is the most the method allows, so exactly
# 1,000 product lines passes without a waiver and only 1,001 is over.
dir2="$(new_repo)"; add_lines "$dir2" "src/a.ts" 400; add_lines "$dir2" "src/b.ts" 400; add_lines "$dir2" "src/c.ts" 200
said="$(sizer_says "$dir2" "")"
case "$(run_sizer "$dir2" ""):$said" in
  0:*'hand-written 1000 of 1000;'*) pass "exactly 1,000 product lines passes without a waiver (exit 0)" ;;
  *) fail "exactly 1,000 product lines passes without a waiver" "got: ${said%%$'\n'*}" ;;
esac
rm -rf "$dir2"

# Sol's CF-09 second round, and the owner's ruling ORCH71-PRSIZE: the ceiling
# is on product code and its tests ride along, printed and not counted.
add_lines "$dir" "tests/ci/product-cases.mjs" 300
said="$(sizer_says "$dir" "")"
case "$(run_sizer "$dir" ""):$said" in
  0:*'hand-written 800 of 1000; tests 300, not counted;'*) pass "800 product lines with 300 test lines passes, the tests printed (exit 0)" ;;
  *) fail "800 product lines with 300 test lines passes, the tests printed" "got: ${said%%$'\n'*}" ;;
esac
rm -rf "$dir"

# Uncounted is not uncapped: a test file still meets the per-file cap.
dir="$(new_repo)"; add_lines "$dir" "tests/ci/huge-cases.mjs" 401
status="$(run_sizer "$dir" '["size-waiver-mechanical"]')"
[ "$status" = "1" ] && pass "a test file over the per-file cap still fails (exit 1)" \
  || fail "a test file over the per-file cap still fails" "expected 1, got $status"
rm -rf "$dir"

dir="$(new_repo)"; add_lines "$dir" "src/a.ts" 350; add_lines "$dir" "src/b.ts" 350; add_lines "$dir" "src/c.ts" 350
status="$(run_sizer "$dir" '["size-waiver-coherence"]')"
[ "$status" = "0" ] && pass "the coherence waiver lifts the total (exit 0)" || fail "the coherence waiver lifts the total" "expected 0, got $status"
rm -rf "$dir"

# The one round four found. A single handwritten file over the per-file cap
# must not be waved through by the mechanical label.
dir="$(new_repo)"; add_lines "$dir" "src/huge.ts" 600
status="$(run_sizer "$dir" '["size-waiver-mechanical"]')"
[ "$status" = "1" ] && pass "the mechanical waiver does not lift the per-file cap (exit 1)" \
  || fail "the mechanical waiver does not lift the per-file cap" "expected 1, got $status; one label let a single unreadable file through"
rm -rf "$dir"

dir="$(new_repo)"; add_lines "$dir" "src/huge.ts" 600
status="$(run_sizer "$dir" '["size-waiver-coherence"]')"
[ "$status" = "1" ] && pass "the coherence waiver does not lift the per-file cap (exit 1)" \
  || fail "the coherence waiver does not lift the per-file cap" "expected 1, got $status"
rm -rf "$dir"

# A genuinely generated file is caught by its pattern, with no label needed.
dir="$(new_repo)"; add_lines "$dir" "pnpm-lock.yaml" 600
status="$(run_sizer "$dir" '["size-waiver-mechanical"]')"
[ "$status" = "0" ] && pass "a generated file over the cap passes on its pattern (exit 0)" \
  || fail "a generated file over the cap passes on its pattern" "expected 0, got $status"
rm -rf "$dir"

# The file-count ceiling. Lines alone do not measure how much reading a pull
# request is: these changes are a few hundred lines either way, and it is the
# number of files that decides whether the last one gets read.
dir="$(new_repo)"; add_files "$dir" 12
status="$(run_sizer "$dir" "")"
[ "$status" = "0" ] && pass "a dozen small files passes (exit 0)" || fail "a dozen small files passes" "expected 0, got $status"
rm -rf "$dir"

dir="$(new_repo)"; add_files "$dir" 45
status="$(run_sizer "$dir" "")"
[ "$status" = "1" ] && pass "over the file ceiling fails (exit 1)" || fail "over the file ceiling fails" "expected 1, got $status"
rm -rf "$dir"

# The boundary itself. CONTRIBUTING.md allows up to 40 files, so exactly 40
# passes and 41 is the first count that fails.
dir="$(new_repo)"; add_files "$dir" 40
status="$(run_sizer "$dir" "")"
[ "$status" = "0" ] && pass "exactly the file ceiling passes (exit 0)" || fail "exactly the file ceiling passes" "expected 0, got $status"
rm -rf "$dir"

dir="$(new_repo)"; add_files "$dir" 41
status="$(run_sizer "$dir" "")"
[ "$status" = "1" ] && pass "one over the file ceiling fails (exit 1)" || fail "one over the file ceiling fails" "expected 1, got $status"
rm -rf "$dir"

dir="$(new_repo)"; add_files "$dir" 45
status="$(run_sizer "$dir" '["size-waiver-mechanical"]')"
[ "$status" = "0" ] && pass "the mechanical waiver lifts the file ceiling (exit 0)" \
  || fail "the mechanical waiver lifts the file ceiling" "expected 0, got $status"
rm -rf "$dir"

# The plan commit is under tests/acceptance/ and the planning session wrote it,
# not the builder whose pull request is being measured. Five of round two's six
# pull requests needed a waiver typed by hand at open for carrying their own
# plan.
dir="$(new_repo)"; add_lines "$dir" "tests/acceptance/50-x/plan.md" 600; add_lines "$dir" "src/small.ts" 50
status="$(run_sizer "$dir" "")"
[ "$status" = "0" ] && pass "a six-hundred line plan and fifty hand-written lines passes (exit 0)" \
  || fail "a six-hundred line plan and fifty hand-written lines passes" "expected 0, got $status; the plan commit is being counted against the builder"
# Into a variable, not through `grep -q`: under load grep could exit before
# the writer's last line and `pipefail` read that as the case failing.
said="$(sizer_says "$dir" "")"
case "$said" in
  *"hand-written 50 of 1000; tests 0, not counted; plan and deletions 600"*) pass "both figures print, and the gating one is the hand-written count" ;;
  *) fail "both figures print, and the gating one is the hand-written count" "it said: ${said%%$'\n'*}" ;;
esac
rm -rf "$dir"

# The per-file cap is about a file nobody can read. A plan file is read by the
# planning session and by the owner, and it is not the builder's work, so the same
# exemption applies to it.
dir="$(new_repo)"; add_lines "$dir" "tests/acceptance/50-x/plan.md" 600
status="$(run_sizer "$dir" "")"
[ "$status" = "0" ] && pass "a plan file over the per-file cap passes (exit 0)" \
  || fail "a plan file over the per-file cap passes" "expected 0, got $status"
rm -rf "$dir"

# A deletion is not a thing a reviewer holds in their head the way an addition
# is: five hundred lines removed and nothing added is a shorter file to read.
dir="$(seeded_repo "src/long.ts" 600)"; keep_lines "$dir" "src/long.ts" 100
status="$(run_sizer "$dir" "")"
[ "$status" = "0" ] && pass "five hundred deleted lines and nothing added passes (exit 0)" \
  || fail "five hundred deleted lines and nothing added passes" "expected 0, got $status"
# Into a variable, not through `grep -q`: under load grep could exit before
# the writer's last line and `pipefail` read that as the case failing.
said="$(sizer_says "$dir" "")"
case "$said" in
  *"hand-written 0 of 1000; tests 0, not counted; plan and deletions 500"*) pass "a cut counts as nothing hand-written, and still prints" ;;
  *) fail "a cut counts as nothing hand-written, and still prints" "it said: ${said%%$'\n'*}" ;;
esac
rm -rf "$dir"

# And the exemptions do not reach the thing the ceiling is for: hand-written
# code outside the plan directory still stops at 1,000.
dir="$(new_repo)"; add_lines "$dir" "tests/acceptance/50-x/plan.md" 600
add_lines "$dir" "src/a.ts" 350; add_lines "$dir" "src/b.ts" 350; add_lines "$dir" "src/c.ts" 350
status="$(run_sizer "$dir" "")"
[ "$status" = "1" ] && pass "1,050 hand-written lines beside a plan still fails (exit 1)" \
  || fail "1,050 hand-written lines beside a plan still fails" "expected 1, got $status"
rm -rf "$dir"

# The review of record on 58b1ba3 found the third column of `--numstat` is not
# always a path. A rename prints one compacted form for both ends, and git
# C-quotes a path carrying a byte outside ASCII. Both read as outside the plan
# directory, so both counted the plan against the builder.
dir="$(seeded_repo "src/a.ts" 500)"
mkdir -p "$dir/tests/acceptance/50-x"
git -C "$dir" mv src/a.ts tests/acceptance/50-x/a.ts >/dev/null
i=1; while [ "$i" -le 450 ]; do printf 'added %s\n' "$i" >> "$dir/tests/acceptance/50-x/a.ts"; i=$((i + 1)); done
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "refactor: move it under the plan"
status="$(run_sizer "$dir" "")"
[ "$status" = "0" ] && pass "a file renamed into the plan directory is in the plan directory (exit 0)" \
  || fail "a file renamed into the plan directory is in the plan directory" "expected 0, got $status; the compacted rename form is being read as a path: $(sizer_says "$dir" "" | head -1)"
rm -rf "$dir"

# A C-quoted path, built here from bytes so this file stays ASCII.
NON_ASCII="tests/acceptance/50-$(printf 'caf\303\251')/plan.md"
dir="$(new_repo)"; add_lines "$dir" "$NON_ASCII" 600
status="$(run_sizer "$dir" "")"
[ "$status" = "0" ] && pass "a plan path outside ASCII is still the plan directory (exit 0)" \
  || fail "a plan path outside ASCII is still the plan directory" "expected 0, got $status; the quoted form is being read as a path: $(sizer_says "$dir" "" | head -1)"
rm -rf "$dir"

# And the compacted form cannot be used the other way: a rename out of the
# plan directory is hand-written work at the head, and meets the per-file cap.
dir="$(seeded_repo "tests/acceptance/50-x/a.ts" 500)"
mkdir -p "$dir/src"
git -C "$dir" mv tests/acceptance/50-x/a.ts src/a.ts >/dev/null
i=1; while [ "$i" -le 450 ]; do printf 'added %s\n' "$i" >> "$dir/src/a.ts"; i=$((i + 1)); done
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "refactor: move it out of the plan"
status="$(run_sizer "$dir" "")"
[ "$status" = "1" ] && pass "a file renamed out of the plan directory is hand-written (exit 1)" \
  || fail "a file renamed out of the plan directory is hand-written" "expected 1, got $status"
rm -rf "$dir"

# Sol's CF-09 review. A path may hold a tab, and splitting the record on every
# tab cut `src/review.snap<TAB>code.ts` to `src/review.snap`, a generated name,
# so 401 hand-written lines passed the cap no label lifts.
dir="$(new_repo)"; add_lines "$dir" "src/review.snap$(printf '\t')code.ts" 401
said="$(sizer_says "$dir" '["size-waiver-mechanical"]')"
status="$(run_sizer "$dir" '["size-waiver-mechanical"]')"
case "$status:$said" in
  1:*'code.ts changes 401 hand-written lines'*) pass "a tab in a source filename does not borrow a generated pattern (exit 1)" ;;
  *) fail "a tab in a source filename does not borrow a generated pattern" "expected 1 naming the whole path, got $status: $said" ;;
esac
rm -rf "$dir"

# Labels arrive as the JSON array the workflow writes. Joined with commas, the
# one label `ordinary,size-waiver-mechanical` read as two, and one of them a
# waiver nobody applied.
dir="$(new_repo)"; add_lines "$dir" "src/a.ts" 350; add_lines "$dir" "src/b.ts" 350; add_lines "$dir" "src/c.ts" 350
status="$(run_sizer "$dir" 'ordinary,size-waiver-mechanical')"
[ "$status" = "2" ] && pass "a comma-joined label string is malformed, not a waiver (exit 2)" \
  || fail "a comma-joined label string is malformed, not a waiver" "expected 2, got $status"
status="$(run_sizer "$dir" '["ordinary,size-waiver-mechanical"]')"
[ "$status" = "1" ] && pass "a label holding a comma is one label and no waiver (exit 1)" \
  || fail "a label holding a comma is one label and no waiver" "expected 1, got $status"
# Sol's CF-09 third round: an array is not enough, every member is a label
# name, so a number beside a waiver is malformed and waives nothing.
status="$(run_sizer "$dir" '["size-waiver-coherence",123]')"
[ "$status" = "2" ] && pass "a label array with a member that is not a string is malformed, not a waiver (exit 2)" \
  || fail "a label array with a member that is not a string is malformed, not a waiver" "expected 2, got $status"
rm -rf "$dir"
if grep -qF 'PR_LABELS: ${{ toJSON(github.event.pull_request.labels.*.name) }}' "$REPO_ROOT/.github/workflows/pr-size.yml"; then
  pass "the workflow passes the labels as a JSON array"
else
  fail "the workflow passes the labels as a JSON array" "pr-size.yml does not set PR_LABELS from toJSON, so a comma inside a label is ambiguous"
fi

# An empty diff is no input at all. Zero files and zero lines used to print
# `within the rule` and exit 0 over a range that measured nothing.
dir="$(new_repo)"
status="$(run_sizer "$dir" "")"
[ "$status" = "2" ] && pass "an empty diff refuses rather than passing over nothing (exit 2)" \
  || fail "an empty diff refuses rather than passing over nothing" "expected 2, got $status: $(sizer_says "$dir" "" | tail -1)"
rm -rf "$dir"

# Inform-only (#307, the owner's answer of 26 October 2026): over any limit the
# gate says which limit and exits 0. Shadow mode is the default until the flip:
# the blocking result still decides and one SHADOW line beside it says what
# inform-only would have done, so ten pull requests of those lines can show the
# two agree before inform-only is switched on.
# Each limit alone: the line total (three files of 350), the file count (45
# small files), and the per-file cap (one file of 600).
for shape in total files per-file; do
  dir="$(new_repo)"
  case "$shape" in
    total) add_lines "$dir" "src/a.ts" 350; add_lines "$dir" "src/b.ts" 350; add_lines "$dir" "src/c.ts" 350
      limit='line-ceiling'; named='over the line ceiling: 1050 hand-written lines of 1000' ;;
    files) add_files "$dir" 45
      limit='file-ceiling'; named='over the file ceiling: 45 changed files of 40' ;;
    per-file) add_lines "$dir" "src/huge.ts" 600
      limit='per-file-cap'; named='over the per-file cap: src/huge.ts adds 600 hand-written lines of 400' ;;
  esac
  said="$(mode_says "$dir" inform)"
  case "$said" in
    *"$named"*'exit 0') pass "inform-only names the $limit and exits 0" ;;
    *) fail "inform-only names the $limit and exits 0" "expected '$named' and exit 0, got: $said" ;;
  esac
  case "$said" in
    *'::error::'*) fail "inform-only raises no error over the $limit" "an error annotation reads as a failed gate: $said" ;;
    *) pass "inform-only raises no error over the $limit" ;;
  esac
  said="$(mode_says "$dir" shadow)"
  case "$said" in
    *"pr-size: SHADOW block=1 inform=0 over=$limit"*'exit 1') pass "shadow blocks over the $limit and logs what inform-only would do" ;;
    *) fail "shadow blocks over the $limit and logs what inform-only would do" "expected the SHADOW line and exit 1, got: $said" ;;
  esac
  rm -rf "$dir"
done

# Shadow is the default, so the hosted run is in shadow with nothing set.
dir="$(new_repo)"; add_lines "$dir" "src/a.ts" 350; add_lines "$dir" "src/b.ts" 350; add_lines "$dir" "src/c.ts" 350
said="$(sizer_says "$dir" "")"
case "$(run_sizer "$dir" ""):$said" in
  1:*'pr-size: SHADOW block=1 inform=0 over=line-ceiling'*) pass "with no mode set the gate runs in shadow (exit 1)" ;;
  *) fail "with no mode set the gate runs in shadow" "got: $said" ;;
esac
rm -rf "$dir"

# Every limit over at once is named, in the order the gate checks them.
dir="$(new_repo)"; add_lines "$dir" "src/huge.ts" 600; add_lines "$dir" "src/b.ts" 350; add_lines "$dir" "src/c.ts" 350
add_files "$dir" 45
said="$(mode_says "$dir" shadow)"
case "$said" in
  *'pr-size: SHADOW block=1 inform=0 over=line-ceiling,file-ceiling,per-file-cap'*'exit 1') pass "shadow names every limit over, in order" ;;
  *) fail "shadow names every limit over, in order" "got: $said" ;;
esac
said="$(mode_says "$dir" inform)"
case "$said" in
  *'over the line ceiling'*'over the file ceiling'*'over the per-file cap'*'exit 0') pass "inform-only names every limit over and exits 0" ;;
  *) fail "inform-only names every limit over and exits 0" "got: $said" ;;
esac
rm -rf "$dir"

# Within every limit both results pass and the SHADOW line still prints, so an
# agreeing pull request is a line in the record too.
dir="$(new_repo)"; add_lines "$dir" "src/small.ts" 50
said="$(mode_says "$dir" shadow)"
case "$said" in
  *'pr-size: SHADOW block=0 inform=0 over=none'*'exit 0') pass "shadow logs a pull request within the rule as agreeing" ;;
  *) fail "shadow logs a pull request within the rule as agreeing" "got: $said" ;;
esac
said="$(mode_says "$dir" inform)"
case "$said" in
  *'pr-size: within the rule.'*'exit 0') pass "inform-only within the rule says so (exit 0)" ;;
  *) fail "inform-only within the rule says so" "got: $said" ;;
esac
rm -rf "$dir"

# A waiver still answers in shadow: the blocking result is today's, and a
# lifted limit is not one inform-only reports as over.
dir="$(new_repo)"; add_files "$dir" 45
said="$( cd "$dir" && BASE_SHA="$(git rev-list --max-parents=0 HEAD)" HEAD_SHA="$(git rev-parse HEAD)" \
    PR_LABELS='["size-waiver-mechanical"]' PR_SIZE_MODE=shadow node "$SIZER" 2>&1; echo "exit $?" )"
case "$said" in
  *'pr-size: SHADOW block=0 inform=0 over=none'*'exit 0') pass "a waived limit is over in neither result" ;;
  *) fail "a waived limit is over in neither result" "got: $said" ;;
esac
rm -rf "$dir"

# A mode the gate cannot read refuses, never falls back to either one.
dir="$(new_repo)"; add_lines "$dir" "src/small.ts" 50
said="$(mode_says "$dir" "")"
case "$said" in
  *'pr-size: SHADOW block=0'*'exit 0') pass "an empty mode is the default (exit 0)" ;;
  *) fail "an empty mode is the default" "got: $said" ;;
esac
for mode in "block" "Inform"; do
  said="$(mode_says "$dir" "$mode")"
  case "$said" in
    *'PR_SIZE_MODE'*'exit 2') pass "an unknown mode refuses: $mode (exit 2)" ;;
    *) fail "an unknown mode refuses: $mode" "got: $said" ;;
  esac
done
rm -rf "$dir"

# Inform-only changes what an over-limit result does, not what a measurement
# that measured nothing does: an empty range still refuses.
dir="$(new_repo)"
said="$(mode_says "$dir" inform)"
case "$said" in
  *'exit 2') pass "inform-only still refuses an empty diff (exit 2)" ;;
  *) fail "inform-only still refuses an empty diff" "got: $said" ;;
esac
rm -rf "$dir"

# Moves count as moves (docs/LESSONS-2026-09.md, "measure moves as moves"): with
# git's rename detection on, its default, a whole file renamed adds no
# hand-written line and meets no limit. METHOD's "Pull request size" names no
# rule for lines moved between files, and under inform-only no count blocks.
dir="$(seeded_repo "src/long.ts" 600)"
mkdir -p "$dir/lib"; git -C "$dir" mv src/long.ts lib/long.ts >/dev/null
git -C "$dir" commit -qm "refactor: move it"
git -C "$dir" config diff.renames true
said="$(mode_says "$dir" shadow)"
case "$said" in
  *'hand-written 0 of 1000'*'pr-size: SHADOW block=0 inform=0 over=none'*'exit 0') pass "a renamed file counts as a move" ;;
  *) fail "a renamed file counts as a move" "got: $said" ;;
esac
# Sol's first round on #345: shadow leaves today's result deciding, so where
# the configuration turns rename detection off the same rename still meets the
# per-file cap. Forcing detection on is the flip's change (#344), not shadow's.
git -C "$dir" config diff.renames false
said="$(mode_says "$dir" shadow)"
case "$said" in
  *'lib/long.ts changes 600 hand-written lines'*'pr-size: SHADOW block=1 inform=0 over=per-file-cap'*'exit 1') pass "shadow keeps today's result with rename detection off (exit 1)" ;;
  *) fail "shadow keeps today's result with rename detection off" "expected the per-file cap and exit 1, got: $said" ;;
esac
rm -rf "$dir"

# The command line, with nothing a runner sets, because a builder who cannot
# run the gate does not know the figure. Both round five fix lanes counted
# their own commit instead of the pull request and one reached 429 of 400.
# cli_sizer <dir> <args...>: the exit code. cli_says: what it printed.
cli_sizer() {
  local dir="$1"; shift
  ( cd "$dir" && env -u BASE_SHA -u HEAD_SHA -u PR_LABELS node "$SIZER" "$@" >/dev/null 2>&1; echo $? )
}

cli_says() {
  local dir="$1"; shift
  ( cd "$dir" && env -u BASE_SHA -u HEAD_SHA -u PR_LABELS node "$SIZER" "$@" 2>&1 )
}

dir="$(new_repo)"
git -C "$dir" checkout -q -b feature
add_lines "$dir" "src/one.ts" 350
add_lines "$dir" "src/two.ts" 350
add_lines "$dir" "src/three.ts" 350
status="$(cli_sizer "$dir" --base main --head HEAD)"
[ "$status" = "1" ] && pass "two refs measure the whole branch, not the last commit (exit 1)" \
  || fail "two refs measure the whole branch, not the last commit" "expected 1, got $status; the last commit alone is 350 and passes"
# The output goes into a variable rather than through `grep -q`, because
# `pipefail` reads the writer's broken pipe as the case failing.
said="$(cli_says "$dir" --base main --head HEAD)"
case "$said" in
  *'hand-written 1050 of 1000'*) pass "the command line prints the same figure as the workflow" ;;
  *) fail "the command line prints the same figure as the workflow" "expected hand-written 1050 of 1000, got: ${said%%$'\n'*}" ;;
esac
rm -rf "$dir"

# An unresolved ref must refuse and name the flag, because a range that
# resolves to nothing measures nothing and reports zero.
dir="$(new_repo)"; add_lines "$dir" "src/small.ts" 50
status="$(cli_sizer "$dir" --base no-such-ref --head HEAD)"
[ "$status" = "2" ] && pass "a ref that is not a commit refuses (exit 2)" \
  || fail "a ref that is not a commit refuses" "expected 2, got $status"
said="$(cli_says "$dir" --base no-such-ref --head HEAD)"
case "$said" in
  *'--base'*) pass "the refusal names the flag that was wrong" ;;
  *) fail "the refusal names the flag that was wrong" "no --base in: ${said%%$'\n'*}" ;;
esac
rm -rf "$dir"

# A revision is allowed to look like a flag, and git resolves `--base` as a
# ref name given `--end-of-options`. Reading the argument list once per flag
# counted the value as a second occurrence of the flag it belonged to, so a
# command line the script can measure refused instead.
dir="$(new_repo)"
git -C "$dir" checkout -q -b feature
add_lines "$dir" "src/one.ts" 40
git -C "$dir" update-ref refs/tags/--base main
status="$(cli_sizer "$dir" --base --base --head HEAD)"
[ "$status" = "0" ] && pass "a revision named --base is a value, not a repeated flag (exit 0)" \
  || fail "a revision named --base is a value, not a repeated flag" "expected 0, got $status; the value is being counted as a second --base"
said="$(cli_says "$dir" --base --base --head HEAD)"
case "$said" in
  *'hand-written 40 of 1000'*) pass "the dash-prefixed revision measures the range it names" ;;
  *) fail "the dash-prefixed revision measures the range it names" "expected hand-written 40 of 1000, got: ${said%%$'\n'*}" ;;
esac

# And the flag really given twice still refuses, in the same repository, so
# the case above cannot be passed by dropping the duplicate check.
status="$(cli_sizer "$dir" --base main --base --base --head HEAD)"
[ "$status" = "2" ] && pass "--base given twice still refuses (exit 2)" \
  || fail "--base given twice still refuses" "expected 2, got $status"
rm -rf "$dir"

# Sol's CF-09 seventh round: a token the reader does not consume refuses. A
# misspelled `--haed` was skipped, so `HEAD_SHA` supplied the head and the
# runner's range passed for a command line that named a head nobody had.
dir="$(new_repo)"; add_lines "$dir" "src/small.ts" 50
head="$(git -C "$dir" rev-parse HEAD)"
for extra in "--haed no-such-head" "stray"; do
  # shellcheck disable=SC2086 # the words are separate tokens on purpose
  status="$( cd "$dir" && env -u BASE_SHA -u PR_LABELS HEAD_SHA="$head" node "$SIZER" --base main~1 $extra >/dev/null 2>&1; echo $? )"
  [ "$status" = "2" ] && pass "an unread token refuses: $extra (exit 2)" \
    || fail "an unread token refuses: $extra" "expected 2, got $status; HEAD_SHA supplied the range instead"
done
status="$( cd "$dir" && env -u BASE_SHA -u PR_LABELS HEAD_SHA="$head" node "$SIZER" --base main~1 >/dev/null 2>&1; echo $? )"
[ "$status" = "0" ] && pass "the same range with nothing unread measures (exit 0)" \
  || fail "the same range with nothing unread measures" "expected 0, got $status"
rm -rf "$dir"

# Sol's CF-09 fourth round, criterion 3: measuring local commits needs no
# credential, so none reaches the Git the gate runs. The spy git records only
# whether a credential's name arrived, then runs the real one.
dir="$(new_repo)"; add_lines "$dir" "src/small.ts" 50
base="$(git -C "$dir" rev-list --max-parents=0 HEAD)"
spy="$(mktemp -d)"
cat > "$spy/git" <<EOF
#!/bin/sh
if env | cut -d= -f1 | grep -qxE 'GH_TOKEN|GITHUB_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN'; then seen=credential; else seen=clean; fi
printf '%s %s\n' "\$seen" "\$1" >> "$spy/audit"
exec "$(command -v git)" "\$@"
EOF
chmod +x "$spy/git"
marker="size-marker-$RANDOM$RANDOM"
said="$( cd "$dir" && PATH="$spy:$PATH" GH_TOKEN="$marker" GITHUB_TOKEN="$marker" NODE_AUTH_TOKEN="$marker" \
    NPM_TOKEN="$marker" node "$SIZER" --base "$base" --head HEAD 2>&1; echo "exit $?" )"
carried="$(grep -c '^credential' "$spy/audit")"
case "$said" in
  *"$marker"*) fail "the size gate's Git carries no credential" "the marker was printed" ;;
  *'exit 0') if grep -q '^clean rev-parse' "$spy/audit" && [ "$carried" = "0" ]; then
      pass "the size gate's Git carries no credential"
    else
      fail "the size gate's Git carries no credential" "$carried of $(wc -l < "$spy/audit" | tr -d ' ') git call(s) carried a credential's name"
    fi ;;
  *) fail "the size gate's Git carries no credential" "expected exit 0, got: ${said##*$'\n'}" ;;
esac
rm -rf "$dir" "$spy"

# Removing a waiver label must change the result, which is only true if the
# workflow reruns on a label change. That is a workflow setting, checked here
# because the rule is meaningless without it. It is `pr-size.yml` that reruns:
# a label must not wake `ci.yml`, and the job reporting this context must not
# be one a condition can skip, because a skipped required check is not a red
# one. `tests/acceptance/10-label-trigger/` is the rest of that rule.
#
# Both events, each read as its own item of the list: Sol's CF-09 review found
# an alternation that one of the two satisfied, so a gate that a waiver could
# no longer turn green passed this case.
SIZE_WORKFLOW="$REPO_ROOT/.github/workflows/pr-size.yml"
size_types=",$(sed -nE 's/^ *types: *\[(.*)\].*/\1/p' "$SIZE_WORKFLOW" | tr -d ' '),"
case "$size_types" in
  *,labeled,*) pass "the size gate reruns when a label is applied" ;;
  *) fail "the size gate reruns when a label is applied" "pr-size.yml types are $size_types; without labeled a waiver never turns a red result green" ;;
esac
case "$size_types" in
  *,unlabeled,*) pass "the size gate reruns when a label is removed" ;;
  *) fail "the size gate reruns when a label is removed" "pr-size.yml types are $size_types; without unlabeled removing a waiver leaves the old green result standing" ;;
esac

if grep -qE 'types:.*(labeled|unlabeled)' "$REPO_ROOT/.github/workflows/ci.yml"; then
  fail "a label wakes nothing but the size gate" "ci.yml still lists labeled/unlabeled, so held starts it again"
else
  pass "a label wakes nothing but the size gate"
fi

if grep -q '^    if:' "$SIZE_WORKFLOW"; then
  fail "the job reporting the size context cannot be skipped" "pr-size.yml carries a job condition; a skipped required check is not a red one"
else
  pass "the job reporting the size context cannot be skipped"
fi

echo
echo "pr-size cases: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
