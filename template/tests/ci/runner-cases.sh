#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# The runner stops where it must: the counting half.
#
# The one entry point. It loads the shared world, runs the cases about what a
# pull request may draw, then the cases about holding and the status table,
# and prints one total. Every case is named for the line it proves in the
# "Definition of implemented" list in Code Factory's
# docs/rounds/RUNNER-SPEC-2026-09-18.md.
#
# Usage: tests/ci/runner-cases.sh [path-to-runner.mjs]

# shellcheck source=tests/ci/runner-case-harness.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runner-case-harness.sh"

echo

if [ ! -f "$RUNNER" ]; then
  fail "the runner exists" "no file at $RUNNER; nothing counts anything"
  echo; echo "runner cases: $PASSED passed, $FAILED failed"; exit 1
fi

# Line 1 and 2: a second round is what the specification allows, so it must
# not be refused. A ceiling that stops everything proves nothing.
run_case "line 1: one review of record on the head, so a second may be drawn" 0 1 may --pr 31 --kind sol
run_case "line 2: no review yet, so the first may be drawn" 0 0 may --pr 32 --kind sol

# Line 3: the twice-caught pull request is held, and no third session exists.
run_case "line 3: two reviews of record, and the third is refused" 3 2 may --pr 33 --kind sol
grep -q "add-label held" "$WORK/case3/gh.log" && grep -q "Held for the owner" "$WORK/case3/gh.log" \
  && pass "line 3: the refusal labels and comments, it does not just exit" \
  || fail "line 3: the refusal labels and comments, it does not just exit" "gh was not asked for both: $(cat "$WORK/case3/gh.log")"
grep -q "HELD: sol ceiling reached" "$WORK/case3/STATUS.md" \
  && pass "line 3: and writes the status row in the same breath" \
  || fail "line 3: and writes the status row in the same breath" "no HELD row in the status table"

# A third that already exists is not a busy day, it is this code failing.
run_case "line 3: a third already on the pull request is a runner defect" 5 3 may --pr 34 --kind sol

# Line 6: a BLOCKER row, and a 4xx, both stop the pull request.
run_case "line 6: a BLOCKER line holds the pull request" 3 0 blocker --pr 35 --line "BLOCKER: the override GitHub cannot perform"
run_case "line 6: a 4xx from GitHub is a blocker" 3 0 blocker --pr 36 --line "gh: HTTP 422 Unprocessable Entity"
run_case "line 6: an ordinary log line is not" 0 0 blocker --pr 37 --line "review posted, verdict approve"

# A held pull request draws no further session from any runner, including a
# second call of this one: the second hold writes no second comment.
stage "$WORK/case9" 0 0
node "$RUNNER" --config "$CFG" blocker --pr 38 --line "BLOCKER: stop" > /dev/null 2>&1
node "$RUNNER" --config "$CFG" hold --pr 38 --reason "again" > /dev/null 2>&1
[ "$(grep -c "Held for the owner" "$FAKE_LOG")" = "1" ] \
  && pass "hold semantics: a held pull request is not held twice" \
  || fail "hold semantics: a held pull request is not held twice" "$(grep -c "Held for the owner" "$FAKE_LOG") comments were posted"

# Line 7: a deliberately lowered run ceiling stops the run at the fourth
# request, and the count comes off the budget before the launch, not after.
stage "$WORK/case10" 0 0 2 3
node "$RUNNER" --config "$CFG" begin > /dev/null 2>&1
SPENDS=""
for _ in 1 2 3 4; do
  node "$RUNNER" --config "$CFG" spend --kind copilot > /dev/null 2>&1
  SPENDS="$SPENDS$?"
done
[ "$SPENDS" = "0004" ] \
  && pass "line 7: a Copilot ceiling of 3 stops the run at the fourth request" \
  || fail "line 7: a Copilot ceiling of 3 stops the run at the fourth request" "the four exits were $SPENDS, wanted 0004"

# A ceiling of zero is a ceiling. Copilot is out of the loop by the owner's
# decision of 20 September 2026, so the first request is the one that is
# refused, and the config that carries the zero has to be a valid config to say
# it. The runner keeps the copilot kind for that reason: a kind it cannot count
# is a kind it cannot refuse.
stage "$WORK/case11" 0 0 2 20 0
OUT="$(node "$RUNNER" --config "$CFG" may --pr 39 --kind copilot 2>&1)"; ACTUAL=$?
if [ "$ACTUAL" = 3 ] && grep -q "0 of 0" <<<"$OUT"; then
  pass "a Copilot ceiling of zero refuses the first request"
else
  fail "a Copilot ceiling of zero refuses the first request" "exit $ACTUAL saying: $OUT"
fi

# shellcheck source=tests/ci/runner-hold-cases.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runner-hold-cases.sh"

# shellcheck source=tests/ci/runner-refusal-cases.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runner-refusal-cases.sh"

echo
echo "runner cases: $PASSED passed, $FAILED failed"
[ "$FAILED" = 0 ] || exit 1
