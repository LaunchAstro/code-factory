# SPDX-License-Identifier: AGPL-3.0-only
# The runner stops where it must: holding, the status table, and the six
# findings round two of the review of record raised at d3000b6.
#
# Sourced by `runner-cases.sh`; it counts into the same totals.

# Line 8: the status table and `is:pr label:held` must list the same pull
# requests, and the check must say which way they differ.
stage "$WORK/case11" 0 0
printf '[{"number":39,"pull_request":{}}]' > "$FAKE_HELD"
node "$RUNNER" --config "$CFG" blocker --pr 39 --line "BLOCKER: stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1
[ "$?" = "0" ] && pass "line 8: the table and the label agree when they agree" \
  || fail "line 8: the table and the label agree when they agree" "status --check refused a matching pair"
printf '[{"number":39,"pull_request":{}},{"number":40,"pull_request":{}}]' > "$FAKE_HELD"
OUT="$(node "$RUNNER" --config "$CFG" status --check 2>&1)"; ACTUAL=$?
if [ "$ACTUAL" = "6" ] && printf '%s' "$OUT" | grep -q "#40 carries the label"; then
  pass "line 8: a label with no row is a disagreement, and it says which"
else
  fail "line 8: a label with no row is a disagreement, and it says which" "exit $ACTUAL: $OUT"
fi

# Every number lives in runner.json. A config missing one does not start a run
# with the ceiling silently absent.
DIR="$WORK/case12"; mkdir -p "$DIR"
printf '{"repository":"a/b"}' > "$DIR/runner.json"
node "$RUNNER" --config "$DIR/runner.json" count --pr 41 > /dev/null 2>&1
[ "$?" = "1" ] && pass "a config missing a ceiling will not start a run" \
  || fail "a config missing a ceiling will not start a run" "an incomplete config was accepted"

# The checked-in config is the one phase 2 runs with, so it must be one of the
# configs that loads.
node -e "process.env.RUNNER_CONFIG='$REPO_ROOT/scripts/runner/runner.json';import('$REPO_ROOT/scripts/runner/config.mjs').then((m)=>{m.loadConfig();}).catch((e)=>{console.error(e.message);process.exit(1)})" \
  && pass "the checked-in runner.json is valid" \
  || fail "the checked-in runner.json is valid" "scripts/runner/runner.json did not load"

# Line 6 again, the half that is not hand-fed: a 4xx answering the runner's
# own call must hold, not fail. A failure is the one thing a caller retries.
stage "$WORK/case13" 0 0
export FAKE_REVIEWS_FAIL="gh: HTTP 422 Unprocessable Entity"
OUT="$(node "$RUNNER" --config "$CFG" may --pr 42 --kind sol 2>&1)"; ACTUAL=$?
if [ "$ACTUAL" = "3" ] && grep -q "HELD: BLOCKER: gh: HTTP 422" "$DIR/STATUS.md"; then
  pass "line 6: a 4xx answering the runner's own call holds the pull request"
else
  fail "line 6: a 4xx answering the runner's own call holds the pull request" "exit $ACTUAL: $OUT"
fi

# A flag typo is the caller's mistake. Holding on it takes a live pull request
# out of the run, and a hold is not taken back.
run_case "a mistyped kind is a usage error, not a hold" 2 0 may --pr 43 --kind sonnet
[ -f "$DIR/STATUS.md" ] && grep -q "HELD" "$DIR/STATUS.md" \
  && fail "a mistyped kind holds nothing" "the status table gained a HELD row" \
  || pass "a mistyped kind holds nothing"

# Opus has no artefact of its own on GitHub, so the row the runner writes
# before the launch is the count. If nothing writes it, the ceiling is absent.
stage "$WORK/case15" 0 0
OPUS=""
for _ in 1 2 3; do
  node "$RUNNER" --config "$CFG" may --pr 44 --kind opus > /dev/null 2>&1
  OPUS="$OPUS$?"
done
[ "$OPUS" = "003" ] \
  && pass "line 3: opus is counted from its own rows, and the third is refused" \
  || fail "line 3: opus is counted from its own rows, and the third is refused" "the three exits were $OPUS, wanted 003"

# Copilot is counted from the reviews actually on the pull request.
stage "$WORK/case16" 0 2
OUT="$(node "$RUNNER" --config "$CFG" may --pr 45 --kind copilot 2>&1)"; ACTUAL=$?
[ "$ACTUAL" = "3" ] \
  && pass "line 3: two Copilot reviews on the head, and the third is refused" \
  || fail "line 3: two Copilot reviews on the head, and the third is refused" "exit $ACTUAL: $OUT"

# Line 7's other half: a budget that is never put back is a lifetime total,
# and the second run stops on its first request.
stage "$WORK/case17" 0 0 2 3
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
for _ in 1 2 3; do node "$RUNNER" --config "$CFG" spend --kind copilot > /dev/null 2>&1; done
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
node "$RUNNER" --config "$CFG" spend --kind copilot > /dev/null 2>&1
[ "$?" = "0" ] && pass "line 7: begin puts the run budget back, so a second run starts" \
  || fail "line 7: begin puts the run budget back, so a second run starts" "the run stayed exhausted"

# A hold GitHub refused is a hold the owner cannot see. It is written into the
# row and said out loud, so status --check reports it instead of inventing it.
stage "$WORK/case18" 0 0
export FAKE_LABEL_FAIL="could not add label: 'held' not found"
OUT="$(node "$RUNNER" --config "$CFG" blocker --pr 46 --line "BLOCKER: stop" 2>&1)"
if printf '%s' "$OUT" | grep -q "label was refused" && grep -q "HELD (unrecorded on GitHub)" "$DIR/STATUS.md"; then
  pass "a refused label is said out loud and written into the row"
else
  fail "a refused label is said out loud and written into the row" "$OUT"
fi

# Line 8: the comparison is over open pull requests. An issue carrying the
# label is not a held pull request, and a pull request the owner has closed has
# left the run.
stage "$WORK/case19" 0 0
printf '[{"number":88}]' > "$FAKE_HELD"
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1
[ "$?" = "0" ] && pass "line 8: an issue carrying the label is not a held pull request" \
  || fail "line 8: an issue carrying the label is not a held pull request" "status --check called it a disagreement"

stage "$WORK/case20" 0 0
node "$RUNNER" --config "$CFG" blocker --pr 47 --line "BLOCKER: stop" > /dev/null 2>&1
printf '[]' > "$FAKE_OPEN"
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1
[ "$?" = "0" ] && pass "line 8: a closed pull request leaves both lists" \
  || fail "line 8: a closed pull request leaves both lists" "a dealt-with hold kept the check red forever"

# The counts column is read off the pull request, not typed by the caller.
stage "$WORK/case21" 2 0
node "$RUNNER" --config "$CFG" row --pr 48 --stage review --event "sol review posted" > /dev/null 2>&1
grep -q "| 0/2/0 |" "$DIR/STATUS.md" \
  && pass "a row's counts are read off the pull request, not left at zero" \
  || fail "a row's counts are read off the pull request, not left at zero" "$(tail -1 "$DIR/STATUS.md")"

# A reason carrying a pipe must parse back whole, or every later column of
# that row shifts and the counts the opus limb reads are off by one.
stage "$WORK/case22" 0 0
node "$RUNNER" --config "$CFG" hold --pr 49 --reason "sol said a|b" > /dev/null 2>&1
node -e "import('$REPO_ROOT/scripts/runner/status.mjs').then(async (s) => {
  const { loadConfig } = await import('$REPO_ROOT/scripts/runner/config.mjs');
  const { withLock } = await import('$REPO_ROOT/scripts/runner/lock.mjs');
  const config = loadConfig('$CFG');
  const rows = withLock(config.root, config.statusPath, () => s.readRows(config));
  process.exit(rows[0].event === 'HELD: sol said a|b' && rows[0].counts === '0/0/0' ? 0 : 1);
})" \
  && pass "a reason carrying a pipe parses back whole" \
  || fail "a reason carrying a pipe parses back whole" "the pipe shifted the row's columns"

# Round two, finding A. `gh api --paginate` writes one array per page, so
# --slurp is what makes it parseable and the pages still have to be flattened.
# This repository fixed this once already at scripts/review-of-record.mjs:147;
# the first version of gh.mjs reintroduced it on all three of its calls. Two
# pages of one review each is two reviews, and the third must be refused.
stage "$WORK/case23" 0 0
printf '[%s,%s]' "$(reviews 1 0)" "$(reviews 1 0)" > "$FAKE_REVIEWS"
OUT="$(node "$RUNNER" --config "$CFG" may --pr 50 --kind sol 2>&1)"; ACTUAL=$?
[ "$ACTUAL" = "3" ] \
  && pass "A: a reviews list spread over two pages is counted, not dropped" \
  || fail "A: a reviews list spread over two pages is counted, not dropped" "exit $ACTUAL: $OUT"
grep -q -- "--slurp" "$FAKE_LOG" \
  && pass "A: every paginated call asks for --slurp" \
  || fail "A: every paginated call asks for --slurp" "$(head -1 "$FAKE_LOG")"

# Round two, finding B. A 403 is the token or the rate limit, not this pull
# request. Holding on it would label every pull request in the run for one
# cause and call the owner in twenty times.
stage "$WORK/case24" 0 0
export FAKE_REVIEWS_FAIL="gh: API rate limit exceeded for user ID 1234 (HTTP 403)"
OUT="$(node "$RUNNER" --config "$CFG" may --pr 51 --kind sol 2>&1)"; ACTUAL=$?
if [ "$ACTUAL" = "7" ] && ! grep -q "add-label" "$FAKE_LOG"; then
  pass "B: a 403 stops the run and holds nothing"
else
  fail "B: a 403 stops the run and holds nothing" "exit $ACTUAL, log: $(cat "$FAKE_LOG")"
fi

# Round two, finding C. The old predicate matched the http inside any URL and
# any number in the four hundreds, so an ordinary log line held a healthy pull
# request. The hold is the one action here that cannot be undone.
run_case "C: a log line with a URL and a line count holds nothing" 0 0 \
  blocker --pr 52 --line "sol review posted https://github.com/<OWNER>/<REPO>/pull/52, 437 lines changed"
run_case "C: a real status line still holds" 3 0 \
  blocker --pr 53 --line "gh: Unprocessable Entity (HTTP 422)"

# Round two, finding D. The ceiling is on sessions, not on artefacts. A Codex
# session that runs out of context posts nothing, so counting posted reviews
# alone lets it run again, and again.
stage "$WORK/case27" 0 0
SOL=""
for _ in 1 2 3; do
  node "$RUNNER" --config "$CFG" may --pr 54 --kind sol > /dev/null 2>&1
  SOL="$SOL$?"
done
[ "$SOL" = "003" ] \
  && pass "D: a sol session that posts nothing is still counted" \
  || fail "D: a sol session that posts nothing is still counted" "the three exits were $SOL, wanted 003"

# Round two, finding E. A hold GitHub refused was unrecoverable, so one
# refused label made status --check red for the rest of the run.
stage "$WORK/case28" 0 0
export FAKE_HELD_FROM_LABELS=1 FAKE_LABEL_FAIL="could not add label: 'held' not found"
node "$RUNNER" --config "$CFG" blocker --pr 55 --line "BLOCKER: stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1
FIRST=$?
unset FAKE_LABEL_FAIL
node "$RUNNER" --config "$CFG" hold --pr 55 --reason "retry the label" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1
SECOND=$?
if [ "$FIRST" = "6" ] && [ "$SECOND" = "0" ]; then
  pass "E: a hold GitHub refused can be retried back into agreement"
else
  fail "E: a hold GitHub refused can be retried back into agreement" "first $FIRST, then $SECOND"
fi

# And the other way back: an owner decision lets a held pull request rejoin
# the run, with one row saying so, and the table still agrees with GitHub.
stage "$WORK/case29" 0 0
export FAKE_HELD_FROM_LABELS=1
node "$RUNNER" --config "$CFG" blocker --pr 56 --line "BLOCKER: stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1
BEFORE_RELEASE=$?
node "$RUNNER" --config "$CFG" release --pr 56 --reason "owner decision" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" status --check > /dev/null 2>&1
RELEASED=$?
if [ "$BEFORE_RELEASE" = "0" ] && [ "$RELEASED" = "0" ] && grep -q "RELEASED: owner decision" "$DIR/STATUS.md" && grep -q "remove-label" "$FAKE_LOG"; then
  pass "E: release takes the label off and the table agrees again"
else
  fail "E: release takes the label off and the table agrees again" "held $BEFORE_RELEASE, released $RELEASED"
fi

# Round two, finding F. --pr omitted reached GitHub as the string undefined,
# came back 404, and held a pull request called undefined.
stage "$WORK/case30" 0 0
NOPR=""
for ARGS in "may --kind sol" "hold --reason x" "count"; do
  # shellcheck disable=SC2086
  node "$RUNNER" --config "$CFG" $ARGS > /dev/null 2>&1
  NOPR="$NOPR$?"
done
if [ "$NOPR" = "222" ] && ! grep -q '^| [^|]* | [0-9]' "$DIR/STATUS.md" 2> /dev/null; then
  pass "F: a missing --pr is a usage error and holds nothing"
else
  fail "F: a missing --pr is a usage error and holds nothing" "exits $NOPR, status rows $(grep -c '^| [^|]* | [0-9]' "$DIR/STATUS.md" 2> /dev/null)"
fi
run_case "F: a --pr that is not a number is refused too" 2 0 may --pr undefined --kind sol

# The other half of round one's finding 7: hold and blocker write the counts
# too, not only row.
stage "$WORK/case32" 2 0
node "$RUNNER" --config "$CFG" hold --pr 57 --reason "two rounds spent" > /dev/null 2>&1
grep -q "| 0/2/0 |" "$DIR/STATUS.md" \
  && pass "a HELD row carries the counts that caused it" \
  || fail "a HELD row carries the counts that caused it" "$(tail -1 "$DIR/STATUS.md")"

# A review of record declares its reviewer on a line of its own. Round two's
# own review quoted the shape inside a finding and was counted as a review by
# the reviewer it named, which is a ceiling firing on a reviewer who never ran.
stage "$WORK/case33" 0 0
python3 - "$FAKE_REVIEWS" <<'FIXTURE'
import json, sys
json.dump([
  {"id": 1, "user": {"login": "someone"},
   "body": "Reviewer: Opus (Claude Code, fresh session)\nVerdict: approve\nFindings: the fixture writes `Reviewer: Sol (Codex)` and the count read it."},
  {"id": 2, "user": {"login": "someone"},
   "body": "Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nVerdict: approve"},
], open(sys.argv[1], "w"))
FIXTURE
OUT="$(node "$RUNNER" --config "$CFG" count --pr 58 2>&1)"
printf '%s' "$OUT" | grep -q "sol 1" \
  && pass "a review that merely quotes the reviewer line is not a review of record" \
  || fail "a review that merely quotes the reviewer line is not a review of record" "$OUT"

# No seat name is checked in: the template takes one at run time, so this
# repository can be published without naming whose subscription paid.
node -e "import('$REPO_ROOT/scripts/runner/config.mjs').then((m)=>{
  const c = m.loadConfig('$REPO_ROOT/scripts/runner/runner.json');
  if (!m.launcherFor(c, 'a-seat').endsWith('/bin/claude-a-seat')) process.exit(1);
  try { m.launcherFor(c, ''); } catch (e) { process.exit(/needs a seat/.test(e.message) ? 0 : 1); }
  process.exit(1);
})" \
  && pass "a launch takes its seat at run time, and is refused without one" \
  || fail "a launch takes its seat at run time, and is refused without one" "launcherFor did not behave"
