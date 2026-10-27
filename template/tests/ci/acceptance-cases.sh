#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# The acceptance check, against throwaway repositories.
#
# Every case is one repository built commit by commit, one run of the check over
# it, and one expected exit code with the refusal it must name. A case that only
# checks the exit code proves nothing: Sol's review of 8a316ff found a fixture
# reporting two problems and proving neither.
#
# Three of these settle questions the reviews asked. A plan test that loads a
# module which does not exist yet fails on its assertion, and that is red; one
# that fails at collection is not (Sol CF-05). A plan test that only reads its
# own fixture is green before any code is written, and is refused. A head whose
# config skips the plan's tests by name is refused for changing a file outside
# product source, before it runs.
#
# The fixtures live in tests/ci/acceptance-case-harness.sh. The cases for the
# merge base's configuration, and the limits it does not reach, live in
# tests/ci/acceptance-base-config-cases.sh.
#
# Usage: tests/ci/acceptance-cases.sh [path-to-script]

set -uo pipefail
# Output is matched with `grep -q PATTERN <<<"$output"`, never piped into
# `grep -q`: grep exits at its first match, the writer dies of SIGPIPE, and
# pipefail reads that as no match (as pr-size-cases found, 3b23752).

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tests/ci/acceptance-case-harness.sh
. "$HARNESS_DIR/acceptance-case-harness.sh"

echo "acceptance cases, against $CHECKER"
echo

if [ ! -f "$CHECKER" ]; then
  fail "the checker exists" "no file at $CHECKER; nothing makes anyone write a test first"
  echo; echo "acceptance cases: $PASSED passed, $FAILED failed"; exit 1
fi

# The happy path, and the answer to the open question in one: a plan test whose
# load of the missing module is caught fails on its assertion, and that is red.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "the happy path passes, and a failed assertion is red" 0 \
  "ran and failed at .*, vitest exit 1" "$dir" "Closes #7"
rm -rf "$dir"

# A branch with nothing on it plans nothing.
dir="$(new_repo)"
run_saying "a branch with no commit refuses" 1 "this branch adds no commit" "$dir" "Closes #7"
rm -rf "$dir"

# The first commit is the product code. This is what the night of 17 September
# did on every pull request it merged.
dir="$(new_repo)"; build_answer "$dir" 42; plan_importing "$dir" "7-the-answer"
run_saying "a first commit that is product code refuses" 1 \
  "outside tests/acceptance/" "$dir" "Closes #7"
rm -rf "$dir"

# The first commit carries the tests and one product file beside them.
dir="$(new_repo)"
mkdir -p "$dir/tests/acceptance/7-the-answer" "$dir/src"
printf 'import { expect, test } from "vitest";\n\ntest("x", () => {\n  expect(1).toBe(1);\n});\n' \
  > "$dir/tests/acceptance/7-the-answer/answer.test.ts"
printf 'export const answer = 42;\n' > "$dir/src/answer.ts"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "test: and a little code"
run_saying "a plan commit touching a product file refuses" 1 \
  "outside tests/acceptance/" "$dir" "Closes #7"
rm -rf "$dir"

# The builder editing what it is measured against.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
printf '\n// and one more thought\n' >> "$dir/tests/acceptance/7-the-answer/answer.test.ts"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "test: tidy"
run_saying "the plan's tests edited at the head refuses" 1 \
  "does not edit what it is measured against" "$dir" "Closes #7"
rm -rf "$dir"

# Green before the code: the fixture-only plan. This is the second half of the
# open question, and it is refused.
dir="$(new_repo)"; plan_fixture_only "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "a plan test green at the plan commit refuses, saying it tests nothing" 1 \
  "event.test.ts was reported passed and already passes" "$dir" "Closes #7"
rm -rf "$dir"

# Sol's review of 03b8239: the runner ran a plan's .spec.ts file that the check
# never graded, so one green before the code passed. What runs is what is graded:
# here the .spec.ts file never runs, and the plan's .test.ts carries the verdict.
dir="$(new_repo)"; mkdir -p "$dir/tests/acceptance/7-the-answer"
printf "%s\nimport { expect, test } from 'vitest';\ntest('already green', () => { expect(1).toBe(1); });\n" \
  "$EFFECT_JS" > "$dir/tests/acceptance/7-the-answer/extra.spec.ts"
plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42; rm -f "$EFFECT"
out="$(cd "$dir" && clean_env BASE_SHA="$(git rev-list --max-parents=0 HEAD)" \
  HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="Closes #7" PR_HEAD_REF=work PR_NUMBER=101 \
  node "$CHECKER" 2>&1)"
status=$?
if [ -e "$EFFECT" ]; then
  fail "a plan file the check does not grade never runs" "extra.spec.ts ran (exit $status)"
elif [ "$status" != 0 ] || ! grep -q "1 test file(s) ran and failed at" <<<"$out"; then
  fail "a plan file the check does not grade never runs" "exit $status: $(printf '%s' "$out" | grep REFUSE | head -2)"
else
  pass "a plan file the check does not grade never runs"
fi
rm -rf "$dir"

# The code does not do what the plan asked for.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 41
run_saying "the plan's tests red at the head refuses" 1 \
  "answer.test.ts was reported failed" "$dir" "Closes #7"
rm -rf "$dir"

# One integer against one integer.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "a ticket number that is not the directory's refuses" 1 \
  "closes #9 and the directory is for #7" "$dir" "Closes #9"
rm -rf "$dir"

# The template's own instructions are an HTML comment carrying `Closes #123`.
# GitHub renders them as nothing and this must read them as nothing, or every
# pull request written from the template would claim ticket 123.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "a ticket number only inside an HTML comment is not a ticket number" 1 \
  "names no ticket" "$dir" "<!-- One paragraph. Link the issue: Closes #123 -->"
rm -rf "$dir"

# The number may come from the branch instead, when the branch carries one.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "a numbered branch names the ticket when the body does not" 0 \
  "ticket number: #7" "$dir" "no link here" "feat/7-the-answer"
rm -rf "$dir"

# A directory of fixtures and no test is nothing to be red.
dir="$(new_repo)"
mkdir -p "$dir/tests/acceptance/7-the-answer/fixtures"
printf '{ "id": 1 }\n' > "$dir/tests/acceptance/7-the-answer/fixtures/event.json"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "test: a fixture"
build_answer "$dir" 42
run_saying "a plan with no test file refuses" 1 "nothing to be red" "$dir" "Closes #7"
rm -rf "$dir"

# Documentation is exempt by path, never by a word in a body.
dir="$(new_repo)"
mkdir -p "$dir/docs"
printf '# Notes\n' > "$dir/docs/notes.md"
printf '# Read me\n' > "$dir/README.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: notes"
run_saying "a documentation-only diff is exempt" 0 "needs no acceptance directory" "$dir" ""
rm -rf "$dir"

# A link is never documentation, whatever its name or directory: what it points
# at is code (Sol CF-05-FIX5).
for link in README.md docs/payload.ts; do
  dir="$(new_repo)"; mkdir -p "$dir/docs"
  printf 'export const setup = true;\n' > "$dir/payload.ts"
  git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: a payload"
  base="$(git -C "$dir" rev-parse HEAD)"; target=payload.ts; [ "$link" = README.md ] || target=../payload.ts
  ln -s "$target" "$dir/$link"
  git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: a link"
  run_saying "a link at $link is not documentation" 1 "exempt: \"$link\" is a link" "$dir" "" "work" "$base"
  rm -rf "$dir"
done

# And a script change is not.
dir="$(new_repo)"
mkdir -p "$dir/scripts"
printf 'console.log("hello");\n' > "$dir/scripts/thing.mjs"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: a script"
run_saying "a script change is in scope, not exempt" 1 "outside tests/acceptance/" "$dir" "Closes #7"
rm -rf "$dir"

# The head's configuration is the builder's to write, and three reviews found
# what it could do: run none of the plan's tests (3aa9719), skip them by name
# (4e4d0cc), or load a setup file that mocks the module under test. Issue 30
# replaced it with the merge base's; ORCH73 78PATH refuses it instead, before
# anything at the head runs, so each of these heads is refused for the file it
# changed, the right code in the first one included.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"
mkdir -p "$dir/scripts"
printf 'export const feature = true; // %s\n' "$MARKER" > "$dir/scripts/feature.mjs"
cat > "$dir/vitest.config.ts" <<TS
// $MARKER
export default { test: { passWithNoTests: true, exclude: ['**/tests/acceptance/**'] } };
TS
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: and a config that runs none of it"
build_answer "$dir" 42
refused_naming "a head whose config would run none of the plan's tests is refused" \
  "vitest.config.ts" "$dir"
rm -rf "$dir"

dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"
mkdir -p "$dir/src"
printf 'export function answer(): number {\n  return 0;\n}\n' > "$dir/src/answer.ts"
cat > "$dir/vitest.config.ts" <<TS
// $MARKER
export default { test: { testNamePattern: 'nothing matches this' } };
TS
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: the wrong answer, and a config that skips the test"
refused_naming "a head whose config skips the plan's tests by name is refused" \
  "vitest.config.ts" "$dir"
rm -rf "$dir"

dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"
mkdir -p "$dir/src"
printf 'export function answer(): number {\n  return 0;\n}\n' > "$dir/src/answer.ts"
printf "export default { test: { setupFiles: ['./vitest.setup.ts'] } };\n" > "$dir/vitest.config.ts"
printf "import { vi } from 'vitest';\n// %s\nvi.mock('./src/answer', () => ({ answer: () => 42 }));\n" \
  "$MARKER" > "$dir/vitest.setup.ts"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: the wrong answer, and a mock of it"
refused_naming "a head that mocks the module under test is refused" "vitest.setup.ts" "$dir"
rm -rf "$dir"

# A branch that has merged main is judged on the plan commit's own diff. With
# the merge base as the anchor, every file main gained since the fork was
# reported as a file the plan commit touched, and the refusal was false.
dir="$(new_repo)"
git -C "$dir" checkout -q -b work
plan_importing "$dir" "7-the-answer"
build_answer "$dir" 42
git -C "$dir" checkout -q main
printf 'main moved on\n' > "$dir/othermain.txt"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "chore: main moves"
git -C "$dir" checkout -q work
git -C "$dir" merge -q --no-ff -m "chore: merge main" main
run_saying "a branch that merged main is still judged on the plan commit's own diff" 0 \
  "ran and passed at" "$dir" "Closes #7" "work" "$(git -C "$dir" rev-parse main)"
rm -rf "$dir"

# The four refusals nothing exercised.
dir="$(new_repo)"
git -C "$dir" commit -q --allow-empty -m "chore: nothing"
run_saying "a first commit that changes no file refuses" 1 "changes no file" "$dir" "Closes #7"
rm -rf "$dir"

dir="$(new_repo)"
mkdir -p "$dir/tests/acceptance/7-one" "$dir/tests/acceptance/8-two"
printf 'import { expect, test } from "vitest";\ntest("a", () => { expect(1).toBe(2); });\n' \
  > "$dir/tests/acceptance/7-one/a.test.ts"
printf 'import { expect, test } from "vitest";\ntest("b", () => { expect(1).toBe(2); });\n' \
  > "$dir/tests/acceptance/8-two/b.test.ts"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "test: two tickets at once"
run_saying "a plan commit writing two acceptance directories refuses" 1 \
  "One commit plans one ticket" "$dir" "Closes #7"
rm -rf "$dir"

dir="$(new_repo)"; plan_importing "$dir" "the-answer"; build_answer "$dir" 42
run_saying "an acceptance directory not named <number>-<slug> refuses" 1 \
  "is not named" "$dir" "Closes #7"
rm -rf "$dir"

dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "a body that closes two tickets refuses" 1 \
  "One pull request, one ticket" "$dir" "Closes #7 and also closes #9"
rm -rf "$dir"

# The body is read the way the other checks read it. The review checkpoint is
# pasted inside a fence and carries the branch's commit subjects, so a subject
# saying "closes #12" would otherwise be a second ticket. And GitHub closes an
# issue on any of three verbs.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "a ticket number inside a fenced block is not a second ticket" 0 \
  "ticket number: #7" "$dir" 'Closes #7

```
Review checkpoint
  head:        abc1234
    def5678 fix: closes #12 for good
```'
rm -rf "$dir"

dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
run_saying "GitHub closes an issue on three verbs, and so does this" 0 \
  "ticket number: #7" "$dir" "Fixes #7"
rm -rf "$dir"

# A merge in the range, with the merge on the branch the code was built on.
# `git rev-list` orders by commit date, so without --first-parent the oldest
# date wins: commit the code, commit the tests on a sibling branch off the merge
# base with a backdated date, merge that sibling in, and the check names the
# tests as the plan while the code went in first. `--first-parent` is what
# refuses it, and this is the whole of what it defends: the branch the pull
# request is opened from keeps its own commits in the order it made them.
# Merging the other way round is not defended, and the case after this one is
# the record of that.
dir="$(new_repo)"
git -C "$dir" checkout -q -b work
build_answer "$dir" 42
git -C "$dir" checkout -q -b plan main
export GIT_COMMITTER_DATE="2020-01-01T00:00:00 +0000" GIT_AUTHOR_DATE="2020-01-01T00:00:00 +0000"
plan_importing "$dir" "7-the-answer"
unset GIT_COMMITTER_DATE GIT_AUTHOR_DATE
git -C "$dir" checkout -q work
git -C "$dir" merge -q --no-ff -m "merge: the plan" plan
run_saying "a backdated sibling merged into the branch cannot reorder the plan" 1 \
  "outside tests/acceptance/" "$dir" "Closes #7"
rm -rf "$dir"

# A vitest that never starts is not evidence that anything was red. Run the
# check from a copy of scripts/ with no node_modules beside it: the binary is
# not there, spawn fails, and the check must refuse rather than read the
# non-zero exit as "the tests failed before the code". What it says is fixed
# text and the error's code, never the error's message (CF-08-F3).
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
nowhere="$(mktemp -d)"
cp -R "$REPO_ROOT/scripts" "$nowhere/scripts"
out="$(cd "$dir" && clean_env BASE_SHA="$(git rev-list --max-parents=0 HEAD)" \
  HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="Closes #7" PR_HEAD_REF=work PR_NUMBER=101 \
  node "$nowhere/scripts/acceptance-check.mjs" 2>&1)"
status=$?
if [ "$status" = "1" ] && grep -q "vitest could not be run" <<<"$out" &&
  ! grep -q "spawnSync" <<<"$out"; then
  pass "a vitest that never starts is not evidence of red"
else
  fail "a vitest that never starts is not evidence of red" "expected exit 1 and no spawn message, got $status: $(printf '%s' "$out" | tail -4)"
fi
rm -rf "$dir" "$nowhere"

# A report the run cannot read, here because tested code put a directory where
# vitest writes it, is a refusal in fixed words through refuse(), never the
# read error's message and stack (CF-08-F3).
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; mkdir -p "$dir/src"
printf "import { mkdirSync } from 'node:fs';\n\nexport function answer(): number {\n  mkdirSync('../report.json', { recursive: true });\n  return 42;\n}\n" \
  > "$dir/src/answer.ts"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: the answer, and a directory where the report goes"
out="$(cd "$dir" && clean_env BASE_SHA="$(git rev-list --max-parents=0 HEAD)" \
  HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="Closes #7" PR_HEAD_REF=work PR_NUMBER=101 \
  node "$CHECKER" 2>&1)"
status=$?
if [ "$status" = "2" ] && grep -q "^acceptance: vitest's report at [0-9a-f]\{7\}: " <<<"$out" &&
  ! grep -q "EISDIR" <<<"$out"; then
  pass "an unreadable vitest report is refused in fixed words"
else
  fail "an unreadable vitest report is refused in fixed words" "expected exit 2 and no read error, got $status: $(printf '%s' "$out" | tail -4)"
fi
rm -rf "$dir"

# A revision is resolved by git, not trusted as text. Every git call below
# takes it as an argument, so a value beginning with a dash would be read as an
# option. Exit 2 is misuse, not a refusal: the check could not run at all.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
out="$(cd "$dir" && clean_env BASE_SHA="--upload-pack=touch /tmp/pwned" \
  HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="Closes #7" node "$CHECKER" 2>&1)"
status=$?
if [ "$status" = "2" ] && grep -q "BASE_SHA is not a commit" <<<"$out"; then
  pass "an option-shaped revision is refused before any git command runs"
else
  fail "an option-shaped revision is refused before any git command runs" "expected exit 2, got $status: $out"
fi
rm -rf "$dir"

dir="$(new_repo)"; plan_importing "$dir" "7-the-answer"; build_answer "$dir" 42
out="$(cd "$dir" && clean_env HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="Closes #7" \
  node "$CHECKER" 2>&1)"
status=$?
if [ "$status" = "2" ] && grep -q "BASE_SHA must be set" <<<"$out"; then
  pass "a missing revision is misuse, not a pass"
else
  fail "a missing revision is misuse, not a pass" "expected exit 2, got $status: $out"
fi
rm -rf "$dir"

# The standing fail-closed criterion, which round 3's merged defect broke none
# of because no plan carried one. A plan an earlier round wrote is not reopened.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer" with; build_answer "$dir" 42
run_saying "a plan carrying the standing criterion passes" 0 \
  "standing criterion: tests/acceptance/7-the-answer/plan.md carries it" "$dir" "Closes #7"
rm -rf "$dir"
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer" without; build_answer "$dir" 42
run_saying "a plan without the standing criterion refuses" 1 \
  "no numbered item beginning" "$dir" "Closes #7"
rm -rf "$dir"
dir="$(new_repo)"; mkdir -p "$dir/tests/acceptance/9-an-earlier-round"
criteria_doc without > "$dir/tests/acceptance/9-an-earlier-round/plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "chore: an earlier plan"
older="$(git -C "$dir" rev-parse HEAD)"; plan_importing "$dir" "7-the-answer" with
build_answer "$dir" 42
run_saying "a plan this diff does not touch is not read" 0 "ran and passed at" \
  "$dir" "Closes #7" "work" "$older"
rm -rf "$dir"
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer" hidden; build_answer "$dir" 42
run_saying "an item GitHub renders as nothing is not a criterion to cite" 1 \
  "no numbered item beginning" "$dir" "Closes #7"
rm -rf "$dir"
# And the scope predicate itself. Git pairs a plan.md with a deleted file of
# similar content and reports it as a rename, which a filter naming only A and M
# never lists. Nothing is excluded but a deletion.
dir="$(new_repo)"; mkdir -p "$dir/docs"; criteria_doc without > "$dir/docs/draft-plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: a draft plan"
older="$(git -C "$dir" rev-parse HEAD)"; mkdir -p "$dir/tests/acceptance/7-the-answer"
cp "$dir/docs/draft-plan.md" "$dir/tests/acceptance/7-the-answer/plan.md"
plan_importing "$dir" "7-the-answer" none; rm "$dir/docs/draft-plan.md"; build_answer "$dir" 42
run_saying "a plan git reports as a rename is still read" 1 \
  "no numbered item beginning" "$dir" "Closes #7" "work" "$older"
rm -rf "$dir"
# The same pairing the other way round, which the review of bdf856a built: git
# names a rename by its destination alone, so a plan moved out of the acceptance
# directory left `plansIn` empty and handed the exemption one exempt path.
dir="$(new_repo)"; mkdir -p "$dir/tests/acceptance/7-the-answer" "$dir/docs"
criteria_doc with > "$dir/tests/acceptance/7-the-answer/plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: the plan"
older="$(git -C "$dir" rev-parse HEAD)"
git -C "$dir" mv "tests/acceptance/7-the-answer/plan.md" "docs/archived-plan.md"
git -C "$dir" commit -qm "docs: the plan is archived" >/dev/null
run_saying "a plan renamed out of the acceptance directory is not exempt" 1 \
  "is not in the tree at" "$dir" "" "work" "$older"
rm -rf "$dir"
# The same dropped source losing code rather than a plan: one changed file, all
# of it documentation, exit 0, and scripts/guard.mjs never reached the list.
dir="$(new_repo)"; mkdir -p "$dir/scripts" "$dir/docs"
printf 'export const guard = () => 1;\n' > "$dir/scripts/guard.mjs"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "feat: the guard"
older="$(git -C "$dir" rev-parse HEAD)"
git -C "$dir" mv "scripts/guard.mjs" "docs/guard.md"
git -C "$dir" commit -qm "docs: the guard becomes a note" >/dev/null
run_saying "a script renamed under docs/ is not exempt" 1 \
  "outside tests/acceptance/" "$dir" "" "work" "$older"
rm -rf "$dir"

# The criterion the review of 15473f1 held on: nothing required a branch to
# bring a plan, so one that writes none was never asked for the standing item.
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer" none; build_answer "$dir" 42
run_saying "a code change bringing no plan refuses, naming the plan it wants" 1 \
  "brings no tests/acceptance/7-the-answer/plan.md" "$dir" "Closes #7"
rm -rf "$dir"

# The second route, from its notes: a deleted plan was out of scope and exempt.
dir="$(new_repo)"; mkdir -p "$dir/tests/acceptance/7-the-answer"
criteria_doc with > "$dir/tests/acceptance/7-the-answer/plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: the plan"
older="$(git -C "$dir" rev-parse HEAD)"; git -C "$dir" rm -q "tests/acceptance/7-the-answer/plan.md"
git -C "$dir" commit -qm "docs: and the plan goes away" >/dev/null
run_saying "a diff that only deletes a plan is not exempt" 1 \
  "is not in the tree at" "$dir" "" "work" "$older"
rm -rf "$dir"

dir="$(new_repo)"; plan_importing "$dir" "7-the-answer" nested; build_answer "$dir" 42
run_saying "an item nested under another criterion is not one to cite" 1 \
  "no numbered item beginning" "$dir" "Closes #7"
rm -rf "$dir"
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer" setext; build_answer "$dir" 42
run_saying "an item below a setext heading is outside the criteria" 1 \
  "no numbered item beginning" "$dir" "Closes #7"
rm -rf "$dir"
dir="$(new_repo)"; plan_importing "$dir" "7-the-answer" indented; build_answer "$dir" 42
run_saying "an item below an indented ATX heading is outside the criteria" 1 \
  "no numbered item beginning" "$dir" "Closes #7"
rm -rf "$dir"
# A plan over spawnSync's 1 MB maxBuffer: git hands back a null status and no
# text, and the refusal then named a cause, the tree, that it had not read.
dir="$(new_repo)"; mkdir -p "$dir/tests/acceptance/7-the-answer"
criteria_doc with > "$dir/tests/acceptance/7-the-answer/plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: the plan"
older="$(git -C "$dir" rev-parse HEAD)"
awk 'BEGIN{for(i=0;i<60000;i++) print "and a further line of the plan document"}' \
  >> "$dir/tests/acceptance/7-the-answer/plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: a much longer plan"
run_saying "a plan git cannot hand over names the read, not the tree" 1 \
  "git could not read it at" "$dir" "" "work" "$older"
rm -rf "$dir"

# A plan is a .md file, so the exemption by path reaches it: the review of
# cb8051b deleted the standing item from one plan, changed nothing else, and
# watched `pass exempt` and exit 0 over the one file the diff named. The
# exemption keeps its meaning; a plan the diff changes is read before it.
dir="$(new_repo)"; mkdir -p "$dir/tests/acceptance/7-the-answer"
criteria_doc with > "$dir/tests/acceptance/7-the-answer/plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: the plan"
older="$(git -C "$dir" rev-parse HEAD)"
criteria_doc without > "$dir/tests/acceptance/7-the-answer/plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: tidy the plan"
run_saying "a plan-only diff with the item deleted is not exempt" 1 \
  "standing criterion: tests/acceptance/7-the-answer/plan.md" "$dir" "" "work" "$older"
rm -rf "$dir"
dir="$(new_repo)"; mkdir -p "$dir/tests/acceptance/7-the-answer"
criteria_doc without > "$dir/tests/acceptance/7-the-answer/plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: the plan"
older="$(git -C "$dir" rev-parse HEAD)"
criteria_doc with > "$dir/tests/acceptance/7-the-answer/plan.md"
git -C "$dir" add -A >/dev/null; git -C "$dir" commit -qm "docs: the standing item"
run_saying "a plan-only diff carrying the item is still exempt" 0 \
  "needs no acceptance directory" "$dir" "" "work" "$older"
rm -rf "$dir"

echo
echo "acceptance cases: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
