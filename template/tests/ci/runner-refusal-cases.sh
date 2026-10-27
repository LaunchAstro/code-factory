# SPDX-License-Identifier: AGPL-3.0-only
# The runner refuses what it cannot count: the seventeen findings of Sol's
# review CF-03 at 69afe53, one named case or more for each, and the guards
# that close the same holes from the side.
#
# Sourced by `runner-cases.sh`; it counts into the same totals.

# Two runner processes that both read one file before either writes it. Each
# pauses after its first read of the file until the other has read it too, or
# half a second has passed, so a runner without a lock is caught in the act and
# a runner with one lets the first finish before the second reads.
cat > "$WORK/pause-after-read.mjs" <<'PRELOAD'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
let paused = false;
fs.readFileSync = function (path, ...args) {
  const data = read.call(this, path, ...args);
  if (String(path) === process.env.RACE_FILE && !paused) {
    paused = true;
    fs.writeFileSync(`${process.env.RACE_BARRIER}/${process.pid}`, 'ready');
    const end = Date.now() + 10000;
    while (!fs.existsSync(`${process.env.RACE_BARRIER}/go`)) {
      if (Date.now() > end) throw new Error('race barrier timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  return data;
};
syncBuiltinESMExports();
PRELOAD

# race <file> <args...>: RACE_EXITS is the two exit codes, in order. The
# second process takes RACE_CFG_B and RACE_FILE_B when they are set, which is
# one file reached by two names.
race() {
  local file="$1" barrier a b ea eb waited=0; shift
  barrier="$(mktemp -d "$WORK/barrier.XXXXXX")"
  RACE_FILE="$file" RACE_BARRIER="$barrier" node --import "$WORK/pause-after-read.mjs" "$RUNNER" --config "$CFG" "$@" > /dev/null 2>&1 &
  a=$!
  RACE_FILE="${RACE_FILE_B:-$file}" RACE_BARRIER="$barrier" node --import "$WORK/pause-after-read.mjs" "$RUNNER" --config "${RACE_CFG_B:-$CFG}" "$@" > /dev/null 2>&1 &
  b=$!
  # Neither reaching its read is a runner that refused before it, so the
  # wait ends when both have exited.
  while [ ! -f "$barrier/$a" ] && [ ! -f "$barrier/$b" ] && [ "$waited" -lt 200 ] \
    && { kill -0 "$a" 2> /dev/null || kill -0 "$b" 2> /dev/null; }; do sleep 0.05; waited=$((waited + 1)); done
  waited=0
  while { [ ! -f "$barrier/$a" ] || [ ! -f "$barrier/$b" ]; } && [ "$waited" -lt 10 ]; do sleep 0.05; waited=$((waited + 1)); done
  : > "$barrier/go"
  wait "$a"; ea=$?
  wait "$b"; eb=$?
  RACE_EXITS="$ea$eb"
}

# Finding 1. A held pull request draws no further session, of any kind: the
# hold was for a blocker, and an Opus launch is as much a session as a Sol one.
stage "$WORK/cf1" 0 0
node "$RUNNER" --config "$CFG" hold --pr 61 --reason "BLOCKER: stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" may --pr 61 --kind opus > /dev/null 2>&1; ACTUAL=$?
if [ "$ACTUAL" = 3 ] && ! grep -q "opus launched" "$DIR/STATUS.md"; then
  pass "a held pull request draws no session of any kind"
else
  fail "a held pull request draws no session of any kind" "exit $ACTUAL; rows: $(grep -c launched "$DIR/STATUS.md")"
fi

# Finding 2. The run budget is evidence. Damaged, missing, mistyped or above
# its own ceiling, it is refused rather than refilled from the config.
stage "$WORK/cf2" 0 0
ACCEPTED=""
for BUDGET in '{' '{}' 'null' '[]' '{"repository":"LaunchAstro/stub","opus":20,"sol":"0","copilot":20}' \
  '{"repository":"LaunchAstro/stub","opus":20,"sol":21,"copilot":20}' '{"repository":"LaunchAstro/stub","opus":20,"sol":-1,"copilot":20}'; do
  printf '%s' "$BUDGET" > "$DIR/budget.json"
  node "$RUNNER" --config "$CFG" spend --kind sol > /dev/null 2>&1 && ACCEPTED="$ACCEPTED $BUDGET"
done
rm -f "$DIR/budget.json"
node "$RUNNER" --config "$CFG" spend --kind sol > /dev/null 2>&1 && ACCEPTED="$ACCEPTED (no budget file)"
[ -z "$ACCEPTED" ] \
  && pass "damaged, missing or over-ceiling budget evidence cannot replenish a run" \
  || fail "damaged, missing or over-ceiling budget evidence cannot replenish a run" "spent against:$ACCEPTED"

# Finding 3. A blocker call with no line has no evidence, and a status that
# means the run is wrong stops the run: neither is an ordinary line.
stage "$WORK/cf3" 0 0
EXITS=""
node "$RUNNER" --config "$CFG" blocker --pr 62 > /dev/null 2>&1; EXITS="$EXITS$?"
node "$RUNNER" --config "$CFG" blocker --pr 62 --line > /dev/null 2>&1; EXITS="$EXITS$?"
node "$RUNNER" --config "$CFG" blocker --pr 62 --line "" > /dev/null 2>&1; EXITS="$EXITS$?"
[ "$EXITS" = "222" ] && ! grep -q '^| [^|]* | [0-9]' "$DIR/STATUS.md" 2> /dev/null \
  && pass "a blocker call with no line is a usage error and holds nothing" \
  || fail "a blocker call with no line is a usage error and holds nothing" "exits $EXITS"
EXITS=""
for STATUS in 401 403 408 429 503; do
  node "$RUNNER" --config "$CFG" blocker --pr 63 --line "gh: HTTP $STATUS" > /dev/null 2>&1
  EXITS="$EXITS$?"
done
[ "$EXITS" = "77777" ] && ! grep -q "add-label" "$FAKE_LOG" \
  && pass "a run-wide status in a blocker line stops the run and holds nothing" \
  || fail "a run-wide status in a blocker line stops the run and holds nothing" "exits $EXITS"

# Finding 4. Reads name the configured repository, and so must writes: `gh`
# without --repo writes to whatever checkout the caller stands in, which can be
# another business's.
stage "$WORK/cf4" 0 0
node "$RUNNER" --config "$CFG" hold --pr 64 --reason "stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" release --pr 64 --reason "owner decision" > /dev/null 2>&1
WRITES="$(grep -c '^pr ' "$FAKE_LOG")"
PINNED="$(grep '^pr ' "$FAKE_LOG" | grep -c -- ' --repo LaunchAstro/stub ')"
[ "$WRITES" = 3 ] && [ "$PINNED" = 3 ] \
  && pass "every GitHub write names the configured repository" \
  || fail "every GitHub write names the configured repository" "$PINNED of $WRITES writes carried --repo"

# Finding 5. A stage is free text, so it cannot be what tells the header from
# a row: a stage called ts made every launch row look like the header.
stage "$WORK/cf5" 0 0
EXITS=""
for _ in 1 2 3; do
  node "$RUNNER" --config "$CFG" may --pr 65 --kind opus --stage ts > /dev/null 2>&1
  EXITS="$EXITS$?"
done
[ "$EXITS" = "003" ] \
  && pass "a stage called ts still counts its launch rows" \
  || fail "a stage called ts still counts its launch rows" "the three exits were $EXITS, wanted 003"

# Finding 6. Every item in a list has the shape it is read for. A review
# without one is not a review that counts zero, and an open pull request
# without a number is not a closed one.
stage "$WORK/cf6" 0 0
printf '[{"unexpected":true}]' > "$FAKE_REVIEWS"
node "$RUNNER" --config "$CFG" may --pr 66 --kind sol > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" != 0 ] && ! grep -q "launched" "$DIR/STATUS.md" 2> /dev/null \
  && pass "a malformed review is refused, not counted as zero" \
  || fail "a malformed review is refused, not counted as zero" "exit $ACTUAL"
stage "$WORK/cf6b" 0 0
node "$RUNNER" --config "$CFG" hold --pr 67 --reason "stop" > /dev/null 2>&1
printf '[{}]' > "$FAKE_OPEN"
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" = 6 ] \
  && pass "a malformed open pull request is refused, not read as closed" \
  || fail "a malformed open pull request is refused, not read as closed" "status --check exit $ACTUAL"

# Finding 7. The table is the launch history. A table with no recognisable
# rows is damaged, and damaged history is not empty history.
stage "$WORK/cf7" 0 0
printf 'interrupted status write\n' > "$DIR/STATUS.md"
node "$RUNNER" --config "$CFG" may --pr 68 --kind opus > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" != 0 ] && ! grep -q "launched" "$DIR/STATUS.md" \
  && pass "a damaged status table stops the count instead of resetting it" \
  || fail "a damaged status table stops the count instead of resetting it" "exit $ACTUAL"

# Finding 8. A release GitHub refused has not happened. The hold stays in the
# table, so the retry still takes the label off.
stage "$WORK/cf8" 0 0
export FAKE_HELD_FROM_LABELS=1
node "$RUNNER" --config "$CFG" blocker --pr 69 --line "BLOCKER: stop" > /dev/null 2>&1
export FAKE_REMOVE_FAIL="gh: HTTP 403"
node "$RUNNER" --config "$CFG" release --pr 69 --reason "owner decision" > /dev/null 2>&1; FIRST=$?
unset FAKE_REMOVE_FAIL
node "$RUNNER" --config "$CFG" release --pr 69 --reason "owner decision, again" > /dev/null 2>&1; SECOND=$?
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1; CHECK=$?
if [ "$FIRST" != 0 ] && [ "$SECOND" = 0 ] && [ "$CHECK" = 0 ] && [ "$(grep -c RELEASED "$DIR/STATUS.md")" = 1 ]; then
  pass "a refused label removal keeps the hold, and a retry releases it"
else
  fail "a refused label removal keeps the hold, and a retry releases it" "first $FIRST, retry $SECOND, check $CHECK"
fi

# Finding 9. The hold is the label, the comment and the row. A refused
# comment is owed: status --check says so, and the next hold posts it.
stage "$WORK/cf9" 0 0
export FAKE_HELD_FROM_LABELS=1 FAKE_COMMENT_FAIL="gh: HTTP 503"
node "$RUNNER" --config "$CFG" blocker --pr 70 --line "BLOCKER: stop" > /dev/null 2>&1
OUT="$(node "$RUNNER" --config "$CFG" status --check 2>&1)"; FIRST=$?
unset FAKE_COMMENT_FAIL
node "$RUNNER" --config "$CFG" hold --pr 70 --reason "retry the comment" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1; SECOND=$?
POSTS="$(grep -c "Held for the owner" "$FAKE_LOG")"
if [ "$FIRST" = 6 ] && printf '%s' "$OUT" | grep -q "comment" && [ "$POSTS" = 2 ] && [ "$SECOND" = 0 ]; then
  pass "a refused hold comment is owed: status --check says so, and a retry posts it"
else
  fail "a refused hold comment is owed: status --check says so, and a retry posts it" "check $FIRST then $SECOND, $POSTS comment attempts: $OUT"
fi

# Finding 10. A ceiling hold names the reviews that spent the ceiling, as the
# specification's hold does, rather than none.
stage "$WORK/cf10" 2 0
node "$RUNNER" --config "$CFG" may --pr 71 --kind sol > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" = 3 ] && grep -q "Review ids: 9100, 9101" "$FAKE_LOG" \
  && pass "a ceiling hold names the reviews that consumed it" \
  || fail "a ceiling hold names the reviews that consumed it" "exit $ACTUAL; $(grep "Review ids" "$FAKE_LOG")"

# Finding 11. Only gh needs the GitHub token. The git that finds the checkout
# is handed none, and the case records only whether one arrived.
# token_case <runner>: succeeds when git ran and was handed no GitHub token.
# The fake git writes beside itself, because a path handed down in its
# environment is exactly what the sanitiser strips, and a git that cannot say
# what it saw says nothing (Sol, CF-03-FIX1).
token_case() {
  rm -f "$DIR/token-seen" "$DIR/git-ran"
  mkdir -p "$DIR/bin"
  cat > "$DIR/bin/git" <<'GIT'
#!/usr/bin/env bash
SEEN="$(dirname "$0")/.."
: > "$SEEN/git-ran"
if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}${GH_ENTERPRISE_TOKEN:-}${GITHUB_ENTERPRISE_TOKEN:-}" ]; then : > "$SEEN/token-seen"; fi
exit 1
GIT
  chmod +x "$DIR/bin/git"
  PATH="$DIR/bin:$PATH" GH_TOKEN=synthetic-marker GITHUB_TOKEN=synthetic-marker \
    node "$1" --config "$CFG" begin > /dev/null 2>&1
  [ -f "$DIR/git-ran" ] && [ ! -f "$DIR/token-seen" ]
}
stage "$WORK/cf11" 0 0
token_case "$RUNNER" \
  && pass "the git path resolver never sees a GitHub token" \
  || fail "the git path resolver never sees a GitHub token" "a token reached git"

# Finding 12. A ceiling the runner cannot count down by exactly one is no
# ceiling: above 2^53 the subtraction rounds back to the same number.
stage "$WORK/cf12" 0 0
node -e "const fs=require('node:fs');const c=JSON.parse(fs.readFileSync('$CFG','utf8'));c.perRun.sol=2**54;fs.writeFileSync('$CFG',JSON.stringify(c))"
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" = 1 ] && [ ! -f "$DIR/budget.json" ] \
  && pass "a ceiling too large to count down exactly is refused" \
  || fail "a ceiling too large to count down exactly is refused" "begin exit $ACTUAL"

# Finding 13. Run under another name, through a symlink, the runner still
# runs: a gate that exits 0 without deciding is the worst failure it has.
stage "$WORK/cf13" 0 0
ln -s "$RUNNER" "$DIR/review-gate.mjs"
node "$DIR/review-gate.mjs" --config "$CFG" may > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" = 2 ] \
  && pass "the runner called through a symlink still decides" \
  || fail "the runner called through a symlink still decides" "exit $ACTUAL, wanted the usage error 2"

# Finding 14. The run budget is read and written under one lock: two spends
# at once cannot both take the last slot.
stage "$WORK/cf14" 0 0
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
printf '{"repository":"LaunchAstro/stub","opus":20,"sol":1,"copilot":20}' > "$DIR/budget.json"
race "$DIR/budget.json" spend --kind sol
[ "$(printf '%s' "$RACE_EXITS" | tr -cd 0 | wc -c | tr -d ' ')" = 1 ] \
  && pass "two spends at once cannot both take the last run slot" \
  || fail "two spends at once cannot both take the last run slot" "exits $RACE_EXITS"

# Finding 15. The count and the launch row are under one lock: two may calls
# at once cannot both take the last slot on one pull request.
stage "$WORK/cf15" 0 0
node "$RUNNER" --config "$CFG" may --pr 72 --kind opus > /dev/null 2>&1
race "$DIR/STATUS.md" may --pr 72 --kind opus
[ "$(printf '%s' "$RACE_EXITS" | tr -cd 0 | wc -c | tr -d ' ')" = 1 ] && [ "$(grep -c "opus launched" "$DIR/STATUS.md")" = 2 ] \
  && pass "two may calls at once cannot both take the last slot on a pull request" \
  || fail "two may calls at once cannot both take the last slot on a pull request" "exits $RACE_EXITS, $(grep -c "opus launched" "$DIR/STATUS.md") launch rows"

# Finding 17. The pagination case has to fail a runner that does not
# paginate. The stub serves pages the way gh does, so a runner that drops
# --paginate sees one page, or an error, and not every page anyway.
# The copy is the whole scripts directory, because the runner reads the shared
# entry guard beside it: a copy of the runner alone fails on its import, and a
# case that failed there would pass for the wrong reason.
# mutant <file under the runner directory> <text> <replacement>: MUTANT is a
# copy of the scripts with that one change, or the call fails.
mutant() {
  MUTANT="$(mktemp -d "$WORK/mutant.XXXXXX")"
  cp -R "$(dirname "$(dirname "$RUNNER")")/." "$MUTANT"
  node -e 'const fs = require("node:fs"), [file, from, to] = process.argv.slice(1);
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes(from)) process.exit(1);
    fs.writeFileSync(file, text.replace(from, to));' "$MUTANT/runner/$1" "$2" "$3"
}
if mutant gh.mjs "'--paginate', " ''; then
  stage "$WORK/cf17" 0 0
  printf '[%s,%s]' "$(reviews 1 0)" "$(reviews 1 0)" > "$FAKE_REVIEWS"
  node "$MUTANT/runner/runner.mjs" --config "$CFG" may --pr 73 --kind sol > /dev/null 2>&1; ACTUAL=$?
  [ "$ACTUAL" != 0 ] && [ "$ACTUAL" != 3 ] \
    && pass "A: a runner that drops --paginate fails the two-page case" \
    || fail "A: a runner that drops --paginate fails the two-page case" "the mutant exited $ACTUAL as if it had read both pages, or allowed a launch"
else
  fail "A: a runner that drops --paginate fails the two-page case" "no '--paginate' argument left in gh.mjs to remove"
fi

# The same holes, from the side. `row` writes free text into the table the
# counts and holds are read from, so it cannot write the events those are
# read from: a typed RELEASED would let a held pull request launch again.
stage "$WORK/cf18" 0 0
node "$RUNNER" --config "$CFG" hold --pr 74 --reason "stop" > /dev/null 2>&1
ROWS="$(grep -c '^| [^|]* | [0-9]' "$DIR/STATUS.md")"
EXITS=""
for EVENT in "RELEASED: by hand" "HELD: by hand" "COMMENT POSTED: by hand" "opus launched (by hand)"; do
  node "$RUNNER" --config "$CFG" row --pr 74 --event "$EVENT" > /dev/null 2>&1
  EXITS="$EXITS$?"
done
node "$RUNNER" --config "$CFG" row --pr 74 > /dev/null 2>&1; EXITS="$EXITS$?"
[ "$EXITS" = "22222" ] && [ "$ROWS" -ge 1 ] && [ "$(grep -c '^| [^|]* | [0-9]' "$DIR/STATUS.md")" = "$ROWS" ] \
  && pass "row cannot forge a hold, a release, a comment or a launch" \
  || fail "row cannot forge a hold, a release, a comment or a launch" "exits $EXITS, rows $ROWS then $(grep -c '^| [^|]* | [0-9]' "$DIR/STATUS.md")"

# A hold or a release with no reason tells the owner nothing.
stage "$WORK/cf19" 0 0
EXITS=""
node "$RUNNER" --config "$CFG" hold --pr 75 > /dev/null 2>&1; EXITS="$EXITS$?"
node "$RUNNER" --config "$CFG" hold --pr 75 --reason "stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" release --pr 75 > /dev/null 2>&1; EXITS="$EXITS$?"
[ "$EXITS" = "22" ] && [ "$(grep -c "Held for the owner" "$FAKE_LOG")" = 1 ] && ! grep -q RELEASED "$DIR/STATUS.md" \
  && pass "a hold or a release needs a reason" \
  || fail "a hold or a release needs a reason" "exits $EXITS"

# Security review of 065a3a3, medium 1. A pull request has one spelling. The
# hold and the launch rows are keyed by it, so 012 was a fresh count for #12.
stage "$WORK/sr1" 0 0
node "$RUNNER" --config "$CFG" may --pr 76 --kind opus > /dev/null 2>&1
node "$RUNNER" --config "$CFG" may --pr 76 --kind opus > /dev/null 2>&1
EXITS=""
for PR in 076 0076 0; do
  node "$RUNNER" --config "$CFG" may --pr "$PR" --kind opus > /dev/null 2>&1; EXITS="$EXITS$?"
done
[ "$EXITS" = "222" ] && [ "$(grep -c "opus launched" "$DIR/STATUS.md")" = 2 ] \
  && pass "a pull request number with leading zeros is refused, not counted afresh" \
  || fail "a pull request number with leading zeros is refused, not counted afresh" "exits $EXITS, $(grep -c "opus launched" "$DIR/STATUS.md") launch rows"
printf '| 2026-10-03T00:00:00.000Z | 076 | may | opus launched (opus 1 of 2) | 0/0/0 |  |\n' >> "$DIR/STATUS.md"
node "$RUNNER" --config "$CFG" may --pr 77 --kind opus > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" = 1 ] && ! grep -q '| 77 |' "$DIR/STATUS.md" \
  && pass "a status row naming a pull request with leading zeros is damaged" \
  || fail "a status row naming a pull request with leading zeros is damaged" "exit $ACTUAL"

# Medium 2. The table is the launch history, so a missing table is not empty
# history: moved, deleted or on another machine, it reset every hold and
# every Opus count. Nothing reads it as empty, and nothing starts one in its
# place once a run has begun here.
stage "$WORK/sr2" 0 0
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
node "$RUNNER" --config "$CFG" spend --kind opus > /dev/null 2>&1
node "$RUNNER" --config "$CFG" may --pr 78 --kind opus > /dev/null 2>&1
node "$RUNNER" --config "$CFG" hold --pr 78 --reason "owner decision pending" > /dev/null 2>&1
BUDGET="$(cat "$DIR/budget.json")"
mv "$DIR/STATUS.md" "$DIR/STATUS.old"
OUT="$(node "$RUNNER" --config "$CFG" may --pr 78 --kind opus 2>&1)"; ACTUAL=$?
[ "$ACTUAL" = 1 ] && [ ! -f "$DIR/STATUS.md" ] \
  && pass "a missing status table is refused, not read as empty history" \
  || fail "a missing status table is refused, not read as empty history" "may exit $ACTUAL on a missing table"
printf '%s' "$OUT" | grep -q begin \
  && fail "the missing-table refusal does not send the caller to begin" "it says: $OUT" \
  || pass "the missing-table refusal does not send the caller to begin"

# Security review 828d63a, medium: begin refilled the budget and started an
# empty table, so every Opus count and every hold GitHub refused was gone and
# nothing recorded it. A plain begin refuses a missing table and refills
# nothing; a new history is its own step, and only where no run has begun.
OUT="$(node "$RUNNER" --config "$CFG" begin 2>&1)"; ACTUAL=$?
[ "$ACTUAL" = 1 ] && [ ! -f "$DIR/STATUS.md" ] && [ "$(cat "$DIR/budget.json")" = "$BUDGET" ] \
  && pass "begin refuses a missing status table and refills nothing" \
  || fail "begin refuses a missing status table and refills nothing" "begin exit $ACTUAL, table $([ -f "$DIR/STATUS.md" ] && echo started || echo absent), budget $(tr -d ' \n' < "$DIR/budget.json")"
node "$RUNNER" --config "$CFG" begin --new-history --reason "the table moved" > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" = 1 ] && [ ! -f "$DIR/STATUS.md" ] && [ "$(cat "$DIR/budget.json")" = "$BUDGET" ] \
  && pass "a new history is refused once a run has begun on this machine" \
  || fail "a new history is refused once a run has begun on this machine" "begin --new-history exit $ACTUAL, table $([ -f "$DIR/STATUS.md" ] && echo started || echo absent)"
mv "$DIR/STATUS.old" "$DIR/STATUS.md"
KEPT="$(grep -c 'opus launched\|HELD' "$DIR/STATUS.md")"
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1; FIRST=$?
rm "$DIR/budget.json"
node "$RUNNER" --config "$CFG" begin --new-history --reason "again" > /dev/null 2>&1; SECOND=$?
[ "$FIRST$SECOND" = 01 ] && [ "$KEPT" = 2 ] && [ "$(grep -c 'opus launched\|HELD' "$DIR/STATUS.md")" = 2 ] \
  && pass "begin keeps an existing table, and a new history never replaces one" \
  || fail "begin keeps an existing table, and a new history never replaces one" "begin exits $FIRST$SECOND, rows $KEPT then $(grep -c 'opus launched\|HELD' "$DIR/STATUS.md")"

# The one place a history starts: a machine where no run has begun, with the
# reason as the table's first row, which the counts never read as a launch.
SR4="$WORK/sr4"; mkdir -p "$SR4"; CFG="$(config "$SR4" 2 20 2)"
node "$RUNNER" --config "$CFG" begin --new-history > /dev/null 2>&1; NOREASON=$?
node "$RUNNER" --config "$CFG" begin --new-history --reason "   " > /dev/null 2>&1; BLANK=$?
[ "$NOREASON$BLANK" = 22 ] && [ ! -f "$SR4/STATUS.md" ] && [ ! -f "$SR4/budget.json" ] \
  && pass "a new history needs a reason, and without one starts nothing" \
  || fail "a new history needs a reason, and without one starts nothing" "exits $NOREASON$BLANK"
node "$RUNNER" --config "$CFG" begin --new-history --reason "first run on this machine" > /dev/null 2>&1; ACTUAL=$?
node "$RUNNER" --config "$CFG" count --pr 81 > /dev/null 2>&1; COUNT=$?
[ "$ACTUAL$COUNT" = 00 ] && [ -f "$SR4/budget.json" ] && sed -n 5p "$SR4/STATUS.md" | grep -q '| - | begin | HISTORY STARTED: first run on this machine |' \
  && pass "a new history on a fresh machine records its reason as the first row" \
  || fail "a new history on a fresh machine records its reason as the first row" "exits $ACTUAL$COUNT, first row: $(sed -n 5p "$SR4/STATUS.md" 2> /dev/null)"
printf '| 2026-01-01T00:00:00.000Z | - | begin | HISTORY STARTED: forged | 0/0/0 |  |\n' >> "$SR4/STATUS.md"
node "$RUNNER" --config "$CFG" count --pr 81 > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" = 1 ] \
  && pass "a history row anywhere but first is damage" \
  || fail "a history row anywhere but first is damage" "count exit $ACTUAL"

# The held label is the other half of the truth. An owner who labels a pull
# request by hand, or a hold made on another machine, stops the launch here.
stage "$WORK/sr3" 0 0
printf '[{"number":79,"pull_request":{}}]' > "$FAKE_HELD"
node "$RUNNER" --config "$CFG" may --pr 79 --kind opus > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" = 3 ] && ! grep -q "launched" "$DIR/STATUS.md" && ! grep -q "Held for the owner" "$FAKE_LOG" \
  && pass "the held label on GitHub stops a launch the status table does not know of" \
  || fail "the held label on GitHub stops a launch the status table does not know of" "exit $ACTUAL"
printf '[{}]' > "$FAKE_HELD"
node "$RUNNER" --config "$CFG" may --pr 80 --kind opus > /dev/null 2>&1; ACTUAL=$?
[ "$ACTUAL" = 7 ] && ! grep -q "launched" "$DIR/STATUS.md" \
  && pass "an unreadable held list stops the run and launches nothing" \
  || fail "an unreadable held list stops the run and launches nothing" "exit $ACTUAL"

# Sol's review CF-03-FIX1 at cbc41f1: nine findings, one named case or more
# for each.

# config_set <config> <key> <JSON value>: one field of a case's config, changed.
config_set() {
  node -e 'const fs = require("node:fs"), [file, key, value] = process.argv.slice(1);
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    config[key] = JSON.parse(value);
    fs.writeFileSync(file, JSON.stringify(config));' "$@"
}

# Finding 1. Every table the runner starts opens with its HISTORY STARTED row,
# so a table cut back to its header, or to blank lines under it, has lost its
# rows. Read as empty, it gave a third Opus session.
stage "$WORK/fx1" 0 0
node "$RUNNER" --config "$CFG" may --pr 86 --kind opus > /dev/null 2>&1
node "$RUNNER" --config "$CFG" may --pr 86 --kind opus > /dev/null 2>&1
cp "$DIR/STATUS.md" "$DIR/STATUS.full"
ACCEPTED=""
for TAIL in '' '\n' '\n\n'; do
  { head -4 "$DIR/STATUS.full"; printf "$TAIL"; } > "$DIR/STATUS.md"
  node "$RUNNER" --config "$CFG" may --pr 86 --kind opus > /dev/null 2>&1 && ACCEPTED="$ACCEPTED [header$TAIL]"
done
[ -z "$ACCEPTED" ] && ! grep -q "launched" "$DIR/STATUS.md" \
  && pass "a status table cut back to its header is damage, not empty history" \
  || fail "a status table cut back to its header is damage, not empty history" "a launch was granted over:$ACCEPTED"

# Findings 2 and 3. The runner decides when node was asked to run it, by the
# shared rule in scripts/main-module.mjs and no rule of its own. The probe
# loads the runner, can remove the link node was started through once the
# runner is loaded, and writes down what the shared guard says of it.
cat > "$WORK/entry-probe.mjs" <<'PROBE'
import { unlinkSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
const { isMainModule } = await import(process.env.PROBE_GUARD);
registerHooks({
  load(url, context, next) {
    const loaded = next(url, context);
    if (url.endsWith('/runner.mjs')) {
      if (process.env.PROBE_UNLINK === '1') unlinkSync(process.argv[1]);
      let verdict = 'refused';
      try {
        verdict = isMainModule(url) ? 'main' : 'imported';
      } catch {}
      writeFileSync(process.env.PROBE_OUT, verdict);
    }
    return loaded;
  },
});
PROBE
# probe <unlink 0|1> <node arguments...>: PROBE_VERDICT is what the shared
# guard said, PROBE_EXIT and PROBE_SAID what the runner did.
probe() {
  local unlink="$1"; shift
  rm -f "$DIR/verdict"
  PROBE_SAID="$(NODE_NO_WARNINGS=1 PROBE_GUARD="$REPO_ROOT/scripts/main-module.mjs" PROBE_OUT="$DIR/verdict" PROBE_UNLINK="$unlink" \
    node --import "$WORK/entry-probe.mjs" "$@" 2>&1)"
  PROBE_EXIT=$?
  PROBE_VERDICT="$(cat "$DIR/verdict" 2> /dev/null || echo 'never loaded')"
}
# Whether the runner did what the shared guard said: decided when invoked,
# nothing when imported, and never exit 0 when the guard refused.
agrees() {
  case "$PROBE_VERDICT" in
    main) printf '%s' "$PROBE_SAID" | grep -q 'runner:' ;;
    imported) [ "$PROBE_EXIT" = 0 ] && ! printf '%s' "$PROBE_SAID" | grep -q 'runner:\|usage:' ;;
    refused) [ "$PROBE_EXIT" != 0 ] ;;
    *) false ;;
  esac
}
stage "$WORK/fx2" 0 0
ln -s "$RUNNER" "$DIR/review-gate.mjs"
probe 1 "$DIR/review-gate.mjs" --config "$CFG" may
[ "$PROBE_VERDICT" = refused ] && [ "$PROBE_EXIT" != 0 ] \
  && pass "removing the entry link after loading cannot let the runner exit 0 undecided" \
  || fail "removing the entry link after loading cannot let the runner exit 0 undecided" "the shared guard: $PROBE_VERDICT; the runner: exit $PROBE_EXIT"
DISAGREED=""
ln -s "$RUNNER" "$DIR/linked.mjs"
probe 0 "$DIR/linked.mjs" --config "$CFG" count
agrees || DISAGREED="$DISAGREED [linked: $PROBE_VERDICT, exit $PROBE_EXIT]"
ln -s "$RUNNER" "$DIR/removed.mjs"
probe 1 "$DIR/removed.mjs" --config "$CFG" count
agrees || DISAGREED="$DISAGREED [link removed: $PROBE_VERDICT, exit $PROBE_EXIT]"
probe 0 --input-type=module -e "await import('$RUNNER');" -- --config "$CFG" count
agrees || DISAGREED="$DISAGREED [eval: $PROBE_VERDICT, exit $PROBE_EXIT]"
printf "import '%s';\n" "$RUNNER" > "$DIR/importer.mjs"
probe 0 "$DIR/importer.mjs" --config "$CFG" count
agrees || DISAGREED="$DISAGREED [imported: $PROBE_VERDICT, exit $PROBE_EXIT]"
[ -z "$DISAGREED" ] \
  && pass "the runner starts exactly when the shared main-module guard says node ran it" \
  || fail "the runner starts exactly when the shared main-module guard says node ran it" "disagreed:$DISAGREED"

# Finding 4. A lock named by the spelling a config gave is one lock per
# spelling. Through a symlinked file, a symlinked directory or a hard link,
# one status table is one lock, or it is refused.
stage "$WORK/fx4" 0 0
node "$RUNNER" --config "$CFG" may --pr 87 --kind opus > /dev/null 2>&1
cp "$DIR/STATUS.md" "$DIR/STATUS.one-launch"
ln -s "$DIR" "$WORK/fx4-alias"
RACED=""
for VARIANT in file directory hard; do
  cat "$DIR/STATUS.one-launch" > "$DIR/STATUS.md"
  case "$VARIANT" in
    file) ALIAS="$DIR/alias-STATUS.md"; ln -s "$DIR/STATUS.md" "$ALIAS" ;;
    directory) ALIAS="$WORK/fx4-alias/STATUS.md" ;;
    hard) ALIAS="$DIR/hard-STATUS.md"; ln "$DIR/STATUS.md" "$ALIAS" ;;
  esac
  mkdir -p "$DIR/$VARIANT"; cp "$CFG" "$DIR/$VARIANT/runner.json"
  config_set "$DIR/$VARIANT/runner.json" statusPath "\"$ALIAS\""
  config_set "$DIR/$VARIANT/runner.json" budgetPath "\"$DIR/budget.json\""
  RACE_CFG_B="$DIR/$VARIANT/runner.json" RACE_FILE_B="$ALIAS" race "$DIR/STATUS.md" may --pr 87 --kind opus
  GRANTED="$(printf '%s' "$RACE_EXITS" | tr -cd 0 | wc -c | tr -d ' ')"
  LAUNCHES="$(grep -c "opus launched" "$DIR/STATUS.md")"
  if [ "$VARIANT" = hard ]; then
    [ "$GRANTED" -le 1 ] && [ "$LAUNCHES" -le 2 ] || RACED="$RACED [$VARIANT: exits $RACE_EXITS, $LAUNCHES launches]"
    rm -f "$ALIAS"
  else
    [ "$GRANTED" = 1 ] && [ "$LAUNCHES" = 2 ] || RACED="$RACED [$VARIANT: exits $RACE_EXITS, $LAUNCHES launches]"
  fi
done
[ -z "$RACED" ] \
  && pass "two names for one status table are one lock, so the last slot is taken once" \
  || fail "two names for one status table are one lock, so the last slot is taken once" "$RACED"

# The budget the same way. Written through a symlink, the runner replaced the
# link with a file of its own, and the two names became two budgets. A second
# name is now refused, and the budget's own name still spends (Sol, CF-03-FIX2).
stage "$WORK/fx4b" 0 0
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
printf '{"repository":"LaunchAstro/stub","opus":20,"sol":1,"copilot":20}' > "$DIR/budget.json"
ln -s "$DIR/budget.json" "$DIR/alias-budget.json"
mkdir -p "$DIR/b"; cp "$CFG" "$DIR/b/runner.json"
config_set "$DIR/b/runner.json" statusPath "\"$DIR/STATUS.md\""
config_set "$DIR/b/runner.json" budgetPath "\"$DIR/alias-budget.json\""
EXITS=""
node "$RUNNER" --config "$DIR/b/runner.json" spend --kind sol > /dev/null 2>&1; EXITS="$EXITS$?"
node "$RUNNER" --config "$CFG" spend --kind sol > /dev/null 2>&1; EXITS="$EXITS$?"
printf '{"repository":"LaunchAstro/stub","opus":20,"sol":1,"copilot":20}' > "$DIR/budget.json"
ln "$DIR/budget.json" "$DIR/hard-budget.json"
config_set "$DIR/b/runner.json" budgetPath "\"$DIR/hard-budget.json\""
node "$RUNNER" --config "$DIR/b/runner.json" spend --kind sol > /dev/null 2>&1; HARD=$?
node "$RUNNER" --config "$CFG" spend --kind sol > /dev/null 2>&1; HARD="$HARD$?"
[ "$EXITS" = 10 ] && [ -L "$DIR/alias-budget.json" ] && [ "$(printf '%s' "$HARD" | tr -cd 0 | wc -c | tr -d ' ')" -le 1 ] \
  && pass "a budget reached by two names stays one budget" \
  || fail "a budget reached by two names stays one budget" "symlink spends $EXITS, hard link spends $HARD"

# Finding 5. A retry GitHub still refuses has not recorded the hold, so it is
# not reported as done: not the comment, and not the label.
stage "$WORK/fx5" 0 0
export FAKE_COMMENT_FAIL="gh: HTTP 503"
node "$RUNNER" --config "$CFG" hold --pr 88 --reason "stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" hold --pr 88 --reason "retry the comment" > /dev/null 2>&1; COMMENT=$?
unset FAKE_COMMENT_FAIL
export FAKE_LABEL_FAIL="gh: HTTP 503"
node "$RUNNER" --config "$CFG" hold --pr 89 --reason "stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" hold --pr 89 --reason "retry the label" > /dev/null 2>&1; LABEL=$?
unset FAKE_LABEL_FAIL
[ "$COMMENT" != 0 ] && [ "$LABEL" != 0 ] \
  && pass "a hold retry GitHub still refuses is not reported as done" \
  || fail "a hold retry GitHub still refuses is not reported as done" "comment retry exit $COMMENT, label retry exit $LABEL"

# Finding 6. A comment GitHub posted but whose answer was lost is on the pull
# request. The retry reads the comments first and posts only if it is not
# there: one hold, one comment.
stage "$WORK/fx6" 0 0
export FAKE_HELD_FROM_LABELS=1 FAKE_COMMENT_LOST="gh: connection reset"
node "$RUNNER" --config "$CFG" hold --pr 90 --reason "stop" > /dev/null 2>&1
unset FAKE_COMMENT_LOST
node "$RUNNER" --config "$CFG" hold --pr 90 --reason "retry" > /dev/null 2>&1; RETRY=$?
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1; CHECK=$?
COMMENTS="$(grep -o 'Held for the owner' "$FAKE_COMMENTS" | wc -l | tr -d ' ')"
[ "$COMMENTS" = 1 ] && [ "$RETRY" = 0 ] && [ "$CHECK" = 0 ] \
  && pass "a hold comment whose answer was lost is found on GitHub, not posted twice" \
  || fail "a hold comment whose answer was lost is found on GitHub, not posted twice" "$COMMENTS comments, retry exit $RETRY, check $CHECK"

# And the comment found has to be this hold's. A pull request held, released
# and held again for the same reason already carries the first comment, which
# told the owner about the first hold and not this one.
stage "$WORK/fx6b" 0 0
export FAKE_HELD_FROM_LABELS=1
node "$RUNNER" --config "$CFG" hold --pr 91 --reason "stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" release --pr 91 --reason "owner decision" > /dev/null 2>&1
export FAKE_COMMENT_FAIL="gh: HTTP 503"
node "$RUNNER" --config "$CFG" hold --pr 91 --reason "stop" > /dev/null 2>&1
unset FAKE_COMMENT_FAIL
node "$RUNNER" --config "$CFG" hold --pr 91 --reason "retry" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1; CHECK=$?
COMMENTS="$(grep -o 'Held for the owner' "$FAKE_COMMENTS" | wc -l | tr -d ' ')"
[ "$COMMENTS" = 2 ] && [ "$CHECK" = 0 ] \
  && pass "an earlier hold's comment does not stand in for a later hold's" \
  || fail "an earlier hold's comment does not stand in for a later hold's" "$COMMENTS comments, check $CHECK"

# Finding 7. The held label is the operator's text. In the query it is one
# value, whatever it holds, so it cannot add a parameter or end the query.
# A comma GitHub reads as two labels, so a label with one is refused.
stage "$WORK/fx7" 0 0
printf '[{"number":92,"pull_request":{}}]' > "$FAKE_HELD"
MISSED=""
for LABEL in 'needs & owner' 'held#owner' 'held?state=closed' '50%+ off' 'held=yes;x'; do
  config_set "$CFG" heldLabel "$(node -p 'JSON.stringify(process.argv[1])' "$LABEL")"
  FAKE_LABEL_NAME="$LABEL" node "$RUNNER" --config "$CFG" may --pr 92 --kind opus > /dev/null 2>&1
  ACTUAL=$?; [ "$ACTUAL" = 3 ] || MISSED="$MISSED [$LABEL: exit $ACTUAL]"
done
config_set "$CFG" heldLabel '"needs,owner"'
FAKE_LABEL_NAME='needs,owner' node "$RUNNER" --config "$CFG" may --pr 92 --kind opus > /dev/null 2>&1
ACTUAL=$?; [ "$ACTUAL" = 1 ] || MISSED="$MISSED [needs,owner: exit $ACTUAL]"
[ -z "$MISSED" ] && ! grep -q "launched" "$DIR/STATUS.md" \
  && pass "a held label with query characters still finds the held pull request" \
  || fail "a held label with query characters still finds the held pull request" "$MISSED"

# Finding 8. A pull request is numbered from 1. Zero or a negative number in
# either list is a list the runner cannot read, not a pull request that is
# closed or one nobody holds.
stage "$WORK/fx8" 0 0
node "$RUNNER" --config "$CFG" hold --pr 93 --reason "stop" > /dev/null 2>&1
EXITS=""
for NUMBER in 0 -93; do
  printf '[{"number":%s}]' "$NUMBER" > "$FAKE_OPEN"
  node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1; EXITS="$EXITS$?"
done
printf '%s' "$ALL_OPEN" > "$FAKE_OPEN"
printf '[{"number":0,"pull_request":{}}]' > "$FAKE_HELD"
node "$RUNNER" --config "$CFG" may --pr 94 --kind opus > /dev/null 2>&1; EXITS="$EXITS$?"
[ "$EXITS" = 667 ] && ! grep -q "launched" "$DIR/STATUS.md" \
  && pass "an open or held pull request numbered zero or below is refused, not read as closed" \
  || fail "an open or held pull request numbered zero or below is refused, not read as closed" "exits $EXITS, wanted 667"

# Finding 9. The credential case has to go red when git is handed the token:
# a fake git that reports through a variable the sanitiser strips never
# reports anything.
stage "$WORK/fx9" 0 0
if mutant config.mjs "['PATH', 'HOME']" "['PATH', 'HOME', 'GH_TOKEN']"; then
  token_case "$MUTANT/runner/runner.mjs" \
    && fail "the credential case goes red when git is handed GH_TOKEN" "it stayed green with GH_TOKEN on the allowlist" \
    || pass "the credential case goes red when git is handed GH_TOKEN"
else
  fail "the credential case goes red when git is handed GH_TOKEN" "no ['PATH', 'HOME'] allowlist left in config.mjs to widen"
fi

# Sol's review CF-03-FIX2 at a4cf38a: a named case for each finding but the
# fourth (a restored snapshot that keeps its first row), which is left as a
# stated limit.

# Finding 1. The status table and the budget each have one name. A symlink at
# the file or at a directory below the config root, or a second hard link, is
# a second name, and a second name took a second lock: retargeted once the
# lock was held, two runners both granted the last slot. Each is refused
# before anything is fetched, locked or written.
stage "$WORK/fy1" 0 0
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
node "$RUNNER" --config "$CFG" may --pr 95 --kind opus > /dev/null 2>&1
cp "$DIR/STATUS.md" "$DIR/STATUS.before"; cp "$DIR/budget.json" "$DIR/budget.before"
ACCEPTED=""
for VARIANT in status-link status-dir status-hard budget-link budget-hard; do
  case "$VARIANT" in
    status-link) ln -s "$DIR/STATUS.md" "$DIR/alias"; NAME="$DIR/alias" ;;
    status-dir) ln -s "$DIR" "$DIR/alias"; NAME="$DIR/alias/STATUS.md" ;;
    status-hard) ln "$DIR/STATUS.md" "$DIR/alias"; NAME="$DIR/alias" ;;
    budget-link) ln -s "$DIR/budget.json" "$DIR/alias"; NAME="$DIR/alias" ;;
    budget-hard) ln "$DIR/budget.json" "$DIR/alias"; NAME="$DIR/alias" ;;
  esac
  cp "$CFG" "$DIR/alias.json"
  case "$VARIANT" in
    status-*) config_set "$DIR/alias.json" statusPath "\"$NAME\""; ARGS="may --pr 95 --kind opus" ;;
    *) config_set "$DIR/alias.json" budgetPath "\"$NAME\""; ARGS="spend --kind opus" ;;
  esac
  : > "$FAKE_LOG"
  # shellcheck disable=SC2086
  node "$RUNNER" --config "$DIR/alias.json" $ARGS > /dev/null 2>&1; ACTUAL=$?
  rm "$DIR/alias"
  { [ "$ACTUAL" = 1 ] && [ ! -s "$FAKE_LOG" ]; } || ACCEPTED="$ACCEPTED [$VARIANT: exit $ACTUAL]"
done
cmp -s "$DIR/STATUS.md" "$DIR/STATUS.before" && cmp -s "$DIR/budget.json" "$DIR/budget.before" \
  || ACCEPTED="$ACCEPTED [the table or the budget changed]"
[ -z "$ACCEPTED" ] \
  && pass "a status table or budget reached by a second name is refused before anything is read or written" \
  || fail "a status table or budget reached by a second name is refused before anything is read or written" "accepted:$ACCEPTED"

# Finding 2. The next budget is written to a file of its own, created here.
# One already at that name, a symlink to another business's file or a file a
# crashed write left, is refused and never written through.
stage "$WORK/fy2" 0 0
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
cp "$DIR/budget.json" "$DIR/budget.before"
printf 'another business file\n' > "$DIR/foreign.json"
ln -s "$DIR/foreign.json" "$DIR/budget.json.next"
node "$RUNNER" --config "$CFG" spend --kind sol > /dev/null 2>&1; LINKED=$?
rm -f "$DIR/budget.json.next"; printf 'left by a crash\n' > "$DIR/budget.json.next"
node "$RUNNER" --config "$CFG" spend --kind sol > /dev/null 2>&1; LEFT=$?
[ "$LINKED$LEFT" = 11 ] && [ "$(cat "$DIR/foreign.json")" = "another business file" ] \
  && cmp -s "$DIR/budget.json" "$DIR/budget.before" && [ "$(cat "$DIR/budget.json.next")" = "left by a crash" ] \
  && pass "a budget temp file that already exists is refused, never written through" \
  || fail "a budget temp file that already exists is refused, never written through" "spend exits $LINKED$LEFT, foreign file: $(cat "$DIR/foreign.json")"

# Finding 3. A table is one repository's. begin --new-history writes the
# configured repository into its first row, and every command refuses a table
# that names another repository or none, before it fetches or writes
# anything, and without saying what the table holds.
stage "$WORK/fy3" 0 0
BOUND="$(sed -n 5p "$DIR/STATUS.md")"
export FAKE_COMMENT_FAIL="gh: HTTP 503"
node "$RUNNER" --config "$CFG" hold --pr 96 --reason "BusinessA private marker" > /dev/null 2>&1
unset FAKE_COMMENT_FAIL
cp "$DIR/STATUS.md" "$DIR/STATUS.before"
cp "$CFG" "$DIR/b.json"; config_set "$DIR/b.json" repository '"BusinessB/other"'
: > "$FAKE_LOG"
CROSSED=""
for ARGS in "count --pr 96" "may --pr 96 --kind opus" "row --pr 96 --event note" "hold --pr 96 --reason again" \
  "blocker --pr 96 --line BLOCKER:stop" "release --pr 96 --reason done" "status --check" "begin" "spend --kind opus"; do
  # shellcheck disable=SC2086
  OUT="$(node "$RUNNER" --config "$DIR/b.json" $ARGS 2>&1)"; ACTUAL=$?
  { [ "$ACTUAL" = 1 ] && ! printf '%s' "$OUT" | grep -q 'private marker\|LaunchAstro/stub'; } \
    || CROSSED="$CROSSED [${ARGS%% *}: exit $ACTUAL]"
done
[ -s "$FAKE_LOG" ] && CROSSED="$CROSSED [gh was called: $(head -1 "$FAKE_LOG")]"
cmp -s "$DIR/STATUS.md" "$DIR/STATUS.before" || CROSSED="$CROSSED [the table changed]"
awk 'NR == 5 { sub(/\| LaunchAstro\/stub \|$/, "|  |") } { print }' "$DIR/STATUS.before" > "$DIR/STATUS.unbound"
cat "$DIR/STATUS.unbound" > "$DIR/STATUS.md"
node "$RUNNER" --config "$CFG" may --pr 97 --kind opus > /dev/null 2>&1; ACTUAL=$?
{ [ "$ACTUAL" = 1 ] && [ ! -s "$FAKE_LOG" ]; } || CROSSED="$CROSSED [unbound table: exit $ACTUAL]"
printf '%s' "$BOUND" | grep -q '| - | begin | HISTORY STARTED: a fresh case world | 0/0/0 | LaunchAstro/stub |$' \
  || CROSSED="$CROSSED [first row: $BOUND]"
[ -z "$CROSSED" ] \
  && pass "a status table is bound to one repository, and another repository's or an unbound one is refused" \
  || fail "a status table is bound to one repository, and another repository's or an unbound one is refused" "$CROSSED"

# Finding 5. Only the comment this hold posted discharges it: the heading,
# the reason, the review ids and the Held at line as the runner wrote them,
# posted by the account gh is signed in as. A comment that only carries the
# Held at line, the whole text posted by someone else, or another hold's
# review ids, is not it.
stage "$WORK/fy5" 0 0
export FAKE_HELD_FROM_LABELS=1 FAKE_COMMENT_FAIL="gh: HTTP 503"
node "$RUNNER" --config "$CFG" hold --pr 98 --reason "stop" > /dev/null 2>&1
unset FAKE_COMMENT_FAIL
SINCE="$(grep 'HELD' "$DIR/STATUS.md" | tail -1 | cut -d'|' -f2 | tr -d ' ')"
node -e 'const fs = require("node:fs"), [file, since] = process.argv.slice(1);
  const hold = (reviews) => `## Held for the owner\n\nstop\n\nReview ids: ${reviews}\nHeld at: ${since}\n`;
  fs.writeFileSync(file, JSON.stringify([
    { id: 1, user: { login: "runner-account" }, body: `Unrelated\nHeld at: ${since}` },
    { id: 2, user: { login: "someone-else" }, body: hold("none") },
    { id: 3, user: { login: "runner-account" }, body: hold("9100") },
  ]));' "$FAKE_COMMENTS" "$SINCE"
node "$RUNNER" --config "$CFG" hold --pr 98 --reason "retry" > /dev/null 2>&1; RETRY=$?
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1; CHECK=$?
POSTS="$(grep -c "Held for the owner" "$FAKE_LOG")"
[ "$POSTS" = 2 ] && [ "$RETRY" = 0 ] && [ "$CHECK" = 0 ] \
  && pass "only the comment the runner posted for this hold discharges it" \
  || fail "only the comment the runner posted for this hold discharges it" "$POSTS comment attempts, retry exit $RETRY, check $CHECK"

# Finding 6. The hold is written down before its comment is posted. A refused
# write posts nothing; a comment posted whose row was then refused is found
# by the hold it carries, and not posted again.
cat > "$WORK/fail-append.mjs" <<'PRELOAD'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
// Appends to FAIL_APPEND_FILE whose text holds FAIL_APPEND_MATCH fail, as a
// full disk or a lost mount would.
// The file by its name, or by a descriptor opened on that name.
const append = fs.appendFileSync, open = fs.openSync, opened = new Set();
fs.openSync = function (path, ...rest) {
  const fd = open.call(this, path, ...rest);
  if (String(path) === process.env.FAIL_APPEND_FILE) opened.add(fd);
  return fd;
};
fs.appendFileSync = function (path, data, ...rest) {
  const target = opened.has(path) || String(path) === process.env.FAIL_APPEND_FILE;
  if (target && String(data).includes(process.env.FAIL_APPEND_MATCH ?? ''))
    throw new Error('synthetic status append failure');
  return append.call(this, path, data, ...rest);
};
syncBuiltinESMExports();
PRELOAD
stage "$WORK/fy6" 0 0
export FAKE_HELD_FROM_LABELS=1
FAIL_APPEND_FILE="$DIR/STATUS.md" node --import "$WORK/fail-append.mjs" "$RUNNER" --config "$CFG" hold --pr 99 --reason "stop" > /dev/null 2>&1; REFUSED=$?
REFUSED_POSTS="$(grep -c '^pr comment' "$FAKE_LOG")"
FAIL_APPEND_FILE="$DIR/STATUS.md" FAIL_APPEND_MATCH="COMMENT POSTED" \
  node --import "$WORK/fail-append.mjs" "$RUNNER" --config "$CFG" hold --pr 99 --reason "stop" > /dev/null 2>&1; LOST=$?
node "$RUNNER" --config "$CFG" hold --pr 99 --reason "retry" > /dev/null 2>&1; RETRY=$?
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1; CHECK=$?
COMMENTS="$(grep -o 'Held for the owner' "$FAKE_COMMENTS" | wc -l | tr -d ' ')"
[ "$REFUSED" != 0 ] && [ "$REFUSED_POSTS" = 0 ] && [ "$LOST" != 0 ] && [ "$COMMENTS" = 1 ] && [ "$RETRY" = 0 ] && [ "$CHECK" = 0 ] \
  && pass "a hold is written down before its comment, so a refused write posts nothing and a retry posts once" \
  || fail "a hold is written down before its comment, so a refused write posts nothing and a retry posts once" "refused exit $REFUSED with $REFUSED_POSTS posts; then exit $LOST, $COMMENTS comments, retry $RETRY, check $CHECK"

# Finding 7. An answer with no page at all read nothing, which is the run's
# problem: exit 7, nothing held, nothing launched. One empty page is a pull
# request with no reviews.
stage "$WORK/fy7" 0 0
export FAKE_REVIEWS_RAW='[]'
node "$RUNNER" --config "$CFG" may --pr 82 --kind opus > /dev/null 2>&1; NONE=$?
export FAKE_REVIEWS_RAW='[[]]'
node "$RUNNER" --config "$CFG" may --pr 82 --kind opus > /dev/null 2>&1; EMPTY=$?
unset FAKE_REVIEWS_RAW
[ "$NONE$EMPTY" = 70 ] && [ "$(grep -c 'opus launched' "$DIR/STATUS.md")" = 1 ] && ! grep -q add-label "$FAKE_LOG" \
  && pass "an API answer with no page at all stops the run, and one empty page does not" \
  || fail "an API answer with no page at all stops the run, and one empty page does not" "exits $NONE then $EMPTY, wanted 7 then 0"

# Finding 8. A lock a dead runner left is never broken: once the wait is over
# the decision is refused, names the lock, and leaves it. The clock jumps two
# minutes a reading, so the wait ends at once; a runner that ran the decision
# instead of refusing it launches here, and this case goes red.
printf 'let now = 0;\nDate.now = () => (now += 120000);\n' > "$WORK/clock.mjs"
stage "$WORK/fy8" 0 0
printf 'dead holder\n' > "$DIR/STATUS.md.lock"
OUT="$(node --import "$WORK/clock.mjs" "$RUNNER" --config "$CFG" may --pr 83 --kind opus 2>&1)"; ACTUAL=$?
[ "$ACTUAL" = 1 ] && [ "$(cat "$DIR/STATUS.md.lock")" = "dead holder" ] && ! grep -q launched "$DIR/STATUS.md" \
  && [ ! -s "$FAKE_LOG" ] && printf '%s' "$OUT" | grep -q 'STATUS.md.lock' \
  && pass "a stale lock is refused once the wait is over, never taken over" \
  || fail "a stale lock is refused once the wait is over, never taken over" "exit $ACTUAL: $OUT"

# Sol's review CF-03-FIX3 at 7198e2b: Sol's own proofs for its three runner
# findings, run as Sol wrote them against this runner. Only where the runner
# is found is changed. The fourth finding, a restored snapshot that keeps its
# first row, is the owner's to decide and has no case here.
cat > "$WORK/sol-cf03-fix3-proofs.mjs" <<'PROOFS'
// SPDX-License-Identifier: AGPL-3.0-only
// Independent hostile proofs for the exact CF-03-FIX3 candidate. No live services.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const runner = process.env.RUNNER;
const header = '# Runner status\n\n| ts | pr | stage | event | opus/sol/copilot | link |\n| --- | --- | --- | --- | --- | --- |\n';
const history = repository => `| 2026-10-04T00:00:00.000Z | - | begin | HISTORY STARTED: independent fixture | 0/0/0 | ${repository} |\n`;
function world(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sol-cf03-fix3-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'bin'));
  const config = { repository: 'BusinessA/project', launcher: {template: '$HOME/bin/claude-<seat>', model: 'test'}, reviewOfRecord: {reviewer: 'Sol (Codex)'}, copilotLogin: 'copilot', minutes: {plan: 45, build: 75, review: 15, fix: 45}, perPullRequest: {opus: 2, sol: 2, copilot: 0}, perRun: {opus: 20, sol: 1, copilot: 0}, heldLabel: 'held', statusPath: join(dir, 'STATUS.md'), budgetPath: join(dir, 'budget.json') };
  const file = join(dir, 'runner.json');
  writeFileSync(file, JSON.stringify(config));
  writeFileSync(config.statusPath, header + history(config.repository));
  writeFileSync(join(dir, 'comments.json'), '[[]]');
  writeFileSync(join(dir, 'bin/gh'), `#!/usr/bin/env node
const fs = require('node:fs'), a = process.argv.slice(2), d = process.env.PROOF_WORLD;
fs.appendFileSync(d+'/calls.jsonl', JSON.stringify(a)+'\\n');
if(a[0]==='api') {
 if(a[1]==='user') { if(process.env.ACCOUNT_FAIL) { console.error('HTTP 503');process.exit(1); } console.log('runner-account'); }
 else if(a[1].endsWith('/comments')) console.log(fs.readFileSync(d+'/comments.json','utf8'));
 else if(a[1].endsWith('/reviews')) console.log('[[]]');
 else if(a[1].includes('/issues?')) console.log(fs.existsSync(d+'/labelled') ? '[[{"number":31,"pull_request":{}}]]':'[[]]');
 else console.log('[[{"number":31}]]');
} else if(a.includes('--add-label')) fs.writeFileSync(d+'/labelled','yes');
else if(a[1]==='comment') {
 if(process.env.COMMENT_FAIL) { console.error('HTTP 503');process.exit(1); }
 const p=JSON.parse(fs.readFileSync(d+'/comments.json','utf8'));
 p[0].push({user:{login:'runner-account'},body:a[a.indexOf('--body')+1]});
 fs.writeFileSync(d+'/comments.json',JSON.stringify(p));
}
`, {mode: 0o755});
  const env = {...process.env, PATH: join(dir,'bin')+':'+process.env.PATH, PROOF_WORLD:dir};
  for(const k of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN']) delete env[k];
  const run = (...args) => spawnSync(process.execPath,[runner,'--config',file,...args],{env,encoding:'utf8',timeout:15000});
  return {dir,config,file,env,run};
}

test('Sol proof, criterion 2: person to person comment evidence refuses an unreadable runner identity', t => {
  const w=world(t);w.env.COMMENT_FAIL='1';
  assert.equal(w.run('hold','--pr','31','--reason','stop').status,3);
  const row=readFileSync(w.config.statusPath,'utf8').trim().split('\n').at(-1);
  const since=row.split('|')[1].trim();
  writeFileSync(join(w.dir,'comments.json'),JSON.stringify([[{user:{login:'another-person'},body:`## Held for the owner\n\nstop\n\nReview ids: none\nHeld at: ${since}\n`}]]));
  w.env.ACCOUNT_FAIL='1'; // identity lookup cannot run successfully, rather than a different account
  const retry=w.run('hold','--pr','31','--reason','retry');
  assert.notEqual(retry.status,0,'another person discharged the hold when gh api user failed');
  assert.notEqual(w.run('status','--check').status,0,'foreign-person evidence was recorded as posted');
});

test('Sol proof, criterion 4: business to business budget sharing cannot spend or refill another repository allowance', t => {
  const w=world(t);
  assert.equal(w.run('begin').status,0);
  const before=readFileSync(w.config.budgetPath,'utf8');
  const b={...w.config,repository:'BusinessB/project',statusPath:join(w.dir,'BusinessB.md')};
  writeFileSync(b.statusPath,header+history(b.repository));
  const bf=join(w.dir,'BusinessB.json');writeFileSync(bf,JSON.stringify(b));
  const runB=(...args)=>spawnSync(process.execPath,[runner,'--config',bf,...args],{env:w.env,encoding:'utf8',timeout:15000});
  const cross=runB('spend','--kind','sol');
  assert.notEqual(cross.status,0,'BusinessB spent BusinessA\'s repository budget');
  assert.equal(readFileSync(w.config.budgetPath,'utf8'),before,'foreign repository changed the budget');
  assert.equal(w.run('spend','--kind','sol').status,0);
  assert.equal(w.run('spend','--kind','sol').status,4);
  assert.notEqual(runB('begin').status,0,'BusinessB refilled BusinessA\'s exhausted budget');
  assert.equal(w.run('spend','--kind','sol').status,4,'foreign begin purchased another session for BusinessA');
});

test('Sol proof, criterion 4: a plain budget replaced by a symlink after validation cannot spend the final slot twice', async t => {
  const w=world(t);assert.equal(w.run('begin').status,0);
  const target=join(w.dir,'other-budget.json');writeFileSync(target,readFileSync(w.config.budgetPath));
  const other=join(w.dir,'other-config.json');writeFileSync(other,JSON.stringify({...w.config,budgetPath:target}));
  const barrier=join(w.dir,'barrier');mkdirSync(barrier);
  const hook=join(w.dir,'swap-after-validation.mjs');
  writeFileSync(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const stat=fs.lstatSync,read=fs.readFileSync;let checks=0,paused=false;
fs.lstatSync=function(path,...args) {
 const result=stat.call(this,path,...args);
 if(process.env.SWAP==='1' && String(path)===${JSON.stringify(w.config.budgetPath)} && ++checks===2) {
  fs.unlinkSync(path);fs.symlinkSync(${JSON.stringify(target)},path);
 }
 return result;
};
fs.readFileSync=function(path,...args) {
 const data=read.call(this,path,...args);
 if(String(path)===process.env.PAUSE_FILE && !paused) {
  paused=true;fs.writeFileSync(${JSON.stringify(barrier)}+'/'+process.pid,'ready');
  const end=Date.now()+15000;
  while(!fs.existsSync(${JSON.stringify(join(barrier,'go'))})) {
   if(Date.now()>end) throw new Error('barrier timed out');
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
  }
 }
 return data;
};syncBuiltinESMExports();`);
  const children=[];
  const start=(file,swap,path)=>{
    const c=spawn(process.execPath,['--import',hook,runner,'--config',file,'spend','--kind','sol'],{env:{...w.env,SWAP:swap,PAUSE_FILE:path},stdio:'ignore'});
    const done=new Promise(resolve=>c.once('close',resolve));children.push(c);return {c,done};
  };
  t.after(()=>{for(const c of children)if(c.exitCode===null)c.kill();});
  const ready=async c=>{const end=Date.now()+15000;while(!existsSync(join(barrier,String(c.pid)))){assert.equal(c.exitCode,null,'runner refused before the intended replacement race');assert.ok(Date.now()<end,'no read barrier');await new Promise(r=>setTimeout(r,5));}};
  const a=start(w.file,'1',w.config.budgetPath);await ready(a.c);
  assert.ok(lstatSync(w.config.budgetPath).isSymbolicLink(),'the post-validation replacement did not occur');
  assert.equal(readlinkSync(w.config.budgetPath),target,'the racers are not reading the same budget');
  const b=start(other,'0',target);await ready(b.c);
  writeFileSync(join(barrier,'go'),'go');
  const exits=await Promise.all([a.done,b.done]);
  assert.ok(exits.filter(e=>e===0).length<=1,`two separately locked runners spent one final slot, exits ${exits}`);
});
PROOFS

# sol_proof <name>: the one proof of that name, alone, passing. A name that
# matched nothing would pass nothing, so exactly one passing test is asked for.
sol_proof() {
  RUNNER="$RUNNER" node --test --test-reporter=tap --test-name-pattern="$1" "$WORK/sol-cf03-fix3-proofs.mjs" > "$WORK/sol-proof.log" 2>&1
  grep -qx '# pass 1' "$WORK/sol-proof.log" && grep -qx '# fail 0' "$WORK/sol-proof.log" \
    && pass "$1" || fail "$1" "$(grep -m1 'error:' "$WORK/sol-proof.log" || tail -1 "$WORK/sol-proof.log")"
}

# Finding 1, status.mjs: gh could not say which account it posts as, so the
# author of a comment carrying the hold's exact text cannot be checked.
sol_proof 'Sol proof, criterion 2: person to person comment evidence refuses an unreadable runner identity'
# Finding 2, lock.mjs: the budget's name turned into a symlink after the last
# check and before the read. The second budget proof Sol gave crosses the same
# missing boundary as the first, which already refuses the refill.
sol_proof 'Sol proof, criterion 4: a plain budget replaced by a symlink after validation cannot spend the final slot twice'
# Finding 3, ceilings.mjs: the budget names no repository, so another
# repository's config spent it and its begin refilled it.
sol_proof 'Sol proof, criterion 4: business to business budget sharing cannot spend or refill another repository allowance'

# CF-08-F3. A message the runner caught is not printed: it can quote what was
# read, and an error from below the runner is not text this code wrote. The
# append fails with a message of its own, which must not reach the output.
stage "$WORK/fz4" 0 0
OUT="$(FAIL_APPEND_FILE="$DIR/STATUS.md" node --import "$WORK/fail-append.mjs" "$RUNNER" --config "$CFG" row --pr 84 --event note 2>&1)"; ACTUAL=$?
[ "$ACTUAL" = 1 ] && printf '%s' "$OUT" | grep -q '^runner: ' && ! printf '%s' "$OUT" | grep -q 'synthetic status append failure' \
  && pass "a caught error's own message is never printed" \
  || fail "a caught error's own message is never printed" "exit $ACTUAL: $OUT"

# Security review of G4 at 75146a0, finding 1. The status table was read and
# appended by name, so the check under its lock did not cover the read or the
# append: a table replaced by a symlink to a second table after that check let
# two runners with two locks both take the last per-pull-request slot, as Sol
# proved for the budget (CF-03-FIX3). Sol's review of PR 88, round 1, finding
# 5: the swap came before the reads, so an append by name stayed green. Each
# runner now pauses at its append, after its decision's last read, and only
# then is A's table P replaced by a link to B's table Q.
stage "$WORK/fz5" 0 0
node "$RUNNER" --config "$CFG" may --pr 31 --kind opus > /dev/null 2>&1
cp "$DIR/STATUS.md" "$DIR/Q.md"
sed 's/"STATUS.md"/"Q.md"/' "$CFG" > "$DIR/runner-q.json"
mkdir "$DIR/barrier"
cat > "$WORK/swap-status.mjs" <<'HOOK'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const exists = fs.existsSync, read = fs.readFileSync, env = process.env;
let reads = 0;
fs.readFileSync = function (path, ...rest) {
  if (String(path) === env.PAUSE_FILE) reads += 1;
  return read.call(this, path, ...rest);
};
// The append's own check: the decision has read the table three times.
fs.existsSync = function (path) {
  if (String(path) === env.PAUSE_FILE && reads === 3) {
    fs.writeFileSync(`${env.BARRIER}/${process.pid}`, 'ready');
    const end = Date.now() + 15000;
    while (!exists(`${env.BARRIER}/go`) && Date.now() < end)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    if (env.SWAP_TO) {
      fs.unlinkSync(path);
      fs.symlinkSync(env.SWAP_TO, path);
    }
  }
  return exists.call(this, path);
};
syncBuiltinESMExports();
HOOK
# paused <pid>: wait until the runner is at its barrier or has stopped.
paused() {
  local tries=0
  while [ ! -e "$DIR/barrier/$1" ] && kill -0 "$1" 2> /dev/null && [ "$tries" -lt 1500 ]; do
    sleep 0.01; tries=$((tries + 1))
  done
}
BARRIER="$DIR/barrier" SWAP_TO="$DIR/Q.md" PAUSE_FILE="$DIR/STATUS.md" \
  node --import "$WORK/swap-status.mjs" "$RUNNER" --config "$CFG" may --pr 31 --kind opus > /dev/null 2>&1 &
RACER_A=$!
paused "$RACER_A"
BARRIER="$DIR/barrier" PAUSE_FILE="$DIR/Q.md" \
  node --import "$WORK/swap-status.mjs" "$RUNNER" --config "$DIR/runner-q.json" may --pr 31 --kind opus > /dev/null 2>&1 &
RACER_B=$!
paused "$RACER_B"
: > "$DIR/barrier/go"
wait "$RACER_A"; EXIT_A=$?
wait "$RACER_B"; EXIT_B=$?
LAUNCHES="$(grep -c 'opus launched' "$DIR/Q.md")"
[ -L "$DIR/STATUS.md" ] && [ "$LAUNCHES" -le 2 ] && [ "$EXIT_A$EXIT_B" != 00 ] \
  && pass "a status table replaced by a symlink before its append cannot give two runners the last slot" \
  || fail "a status table replaced by a symlink before its append cannot give two runners the last slot" "exits $EXIT_A and $EXIT_B, $LAUNCHES opus launches on #31 against a ceiling of 2"

# Security review of G4 at 75146a0, finding 6. A config the runner refuses
# said only that it stopped on an error it would not print. Each refusal now
# says which problem it was, in the runner's own words, and never what the
# file holds.
stage "$WORK/fz6" 0 0
marker="CF_FIX_BC_CONFIG_MARKER_$$"
config_set "$CFG" repository "\"$marker\""
BAD="$(node "$RUNNER" --config "$CFG" count --pr 31 2>&1)"; BAD_EXIT=$?
MISSING="$(node "$RUNNER" --config "$DIR/absent.json" count --pr 31 2>&1)"; MISSING_EXIT=$?
[ "$BAD_EXIT$MISSING_EXIT" = 11 ] && printf '%s' "$BAD" | grep -q 'repository must be owner/name' \
  && printf '%s' "$MISSING" | grep -q 'absent.json: cannot be read as a JSON config' \
  && ! printf '%s%s' "$BAD" "$MISSING" | grep -qF "$marker" \
  && pass "a refused config says which problem it is, never what the file holds" \
  || fail "a refused config says which problem it is, never what the file holds" "exits $BAD_EXIT and $MISSING_EXIT: $(printf '%s | %s' "$BAD" "$MISSING" | sed "s/$marker/<marker>/g")"

# Security review of G4 at 264a68b, finding 4. A runner stopped between
# writing the next budget and renaming it left budget.json.next behind, and
# every later spend and begin stopped on the line that names no file. Both
# now name it and say what to do, and still never write through it.
stage "$WORK/next-budget" 0 0
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
marker="CF_FIX_BC_NEXT_MARKER_$$"
printf '%s' "$marker" > "$DIR/budget.json.next"
SPEND="$(node "$RUNNER" --config "$CFG" spend --kind opus 2>&1)"; SPEND_EXIT=$?
BEGIN="$(node "$RUNNER" --config "$CFG" begin 2>&1)"; BEGIN_EXIT=$?
NAMED="$(printf '%s\n%s\n' "$SPEND" "$BEGIN" | grep -c 'budget\.json\.next: is left by an interrupted write; with no runner running, remove it')"
[ "$SPEND_EXIT$BEGIN_EXIT$NAMED" = 112 ] && [ "$(cat "$DIR/budget.json.next")" = "$marker" ] \
  && pass "a next budget left by an interrupted write is named, with what to do" \
  || fail "a next budget left by an interrupted write is named, with what to do" "exits $SPEND_EXIT and $BEGIN_EXIT: $(printf '%s | %s' "$SPEND" "$BEGIN" | sed "s/$marker/<marker>/g")"

# Sol's review of PR 88, round 1, finding 3. JSON.parse keeps the last of two
# repository members, so a budget naming BusinessA and then this repository
# was this repository's to spend. A key given twice is ambiguous evidence:
# spend and begin both refuse it, and leave it as it was.
stage "$WORK/repeated-budget" 0 0
BUDGET='{"repository":"BusinessA/project","repository":"LaunchAstro/stub","opus":20,"sol":1,"copilot":20}'
printf '%s' "$BUDGET" > "$DIR/budget.json"
node "$RUNNER" --config "$CFG" spend --kind sol > /dev/null 2>&1; SPEND=$?
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1; BEGIN=$?
[ "$SPEND$BEGIN" = 11 ] && [ "$(cat "$DIR/budget.json")" = "$BUDGET" ] \
  && pass "a budget that names its repository twice is refused, never spent or refilled" \
  || fail "a budget that names its repository twice is refused, never spent or refilled" "spend exit $SPEND, begin exit $BEGIN"

# Sol's review of PR 88, round 2, finding 2. The config was read with
# JSON.parse, so one naming BusinessA and then this repository spent this
# repository's budget. It is read with the reader the budget uses, and a
# repository given twice refuses before anything is spent.
stage "$WORK/repeated-config" 0 0
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
BUDGET="$(cat "$DIR/budget.json")"
sed '1s/{/{ "repository": "BusinessA\/project",/' "$CFG" > "$DIR/runner-twice.json"
TWICE="$(node "$RUNNER" --config "$DIR/runner-twice.json" spend --kind sol 2>&1)"; SPEND=$?
[ "$SPEND" = 1 ] && [ "$(cat "$DIR/budget.json")" = "$BUDGET" ] \
  && printf '%s' "$TWICE" | grep -q 'runner-twice.json: is not usable: a repeated key' \
  && pass "a config that names its repository twice is refused, never spent" \
  || fail "a config that names its repository twice is refused, never spent" "spend exit $SPEND: $TWICE"
