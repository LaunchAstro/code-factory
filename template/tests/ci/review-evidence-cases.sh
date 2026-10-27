#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Review evidence, bound to a revision.
#
# ADR 0046: the owner merges only what the machine has already proven. One rule
# remains under that heading, and these are its cases: is there a review of
# record for the head being merged, and what did it conclude?
#
# Three other rules stood here and are gone with ticket 52: a pasted checkpoint
# block, a typed `Code review:` line, a typed security line, and a step count
# inside the block. Their cases went with them. What is left reads the reviews
# and the head, so no case here sets a pull request body, and the first case is
# that a body cannot change the answer.
#
# Usage: tests/ci/review-evidence-cases.sh [path-to-script]

set -uo pipefail
# Output is matched with `grep -q PATTERN <<<"$output"`, never piped into
# `grep -q`: grep exits at its first match, the writer dies of SIGPIPE, and
# pipefail reads that as no match (as pr-size-cases found, 3b23752).

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="${1:-$REPO_ROOT/scripts/review-evidence-check.mjs}"

# The checker's three inputs come from the environment, so the cases set them
# per case and this file has to start from nothing. Inherited values are not
# hypothetical: `tests/acceptance/1-evidence-on-review/` runs this script from
# a test, which runs under the acceptance check, which is given `HEAD_SHA` by
# the workflow, and the "no head at all" case below then saw a head and read
# the usage error as a refusal. Unset once, here, rather than per case.
unset HEAD_SHA REVIEWS REVIEWS_FILE

PASSED=0
FAILED=0
pass() { printf '  PASS  %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '  FAIL  %s\n' "$1"; printf '        %s\n' "$2"; FAILED=$((FAILED + 1)); }

HEAD=1111111111111111111111111111111111111111
OTHER=2222222222222222222222222222222222222222

# The review of record, in the shape CONTRIBUTING.md step 4 asks for. Every
# case carries one unless it is testing what happens without it.
#
# A refusal carries a criterion, because from 20 September that is part of the
# shape: the reviewer may hold only by naming the plan criterion the code
# breaks. Cases about the criterion rule itself pass their own fifth argument,
# which is the whole of what follows the verdict.
# review_of_record <id> <head sha> <verdict> [recorded commit] [lines after the verdict]
review_of_record() {
  local id="$1" sha="$2" verdict="$3" recorded="${4:-$2}" rest
  if [ -n "${5+set}" ]; then
    rest="$5"
  elif [ "$verdict" = "changes requested" ]; then
    rest='\nCriterion: 1\nFindings:\n  - a.ts:1 - criterion 1 is not met'
  else
    rest='\nFindings: none'
  fi
  printf '[{"id":%s,"state":"COMMENTED","commit_id":"%s","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\\nModel: gpt-5.6-sol\\nHead SHA: %s\\nVerdict: %s%s"}]' \
    "$id" "$recorded" "$sha" "$verdict" "$rest"
}

REVIEW_ID=99001
APPROVED="$(review_of_record "$REVIEW_ID" "$HEAD" "approve")"

# run_case <label> <expected exit> <reviews json>
run_case() {
  local label="$1" expect="$2" actual
  local reviews="${3-$APPROVED}"
  actual="$(HEAD_SHA="$HEAD" REVIEWS="$reviews" node "$CHECKER" >/dev/null 2>&1; echo $?)"
  if [ "$actual" = "$expect" ]; then pass "$label"; else fail "$label" "expected exit $expect, got $actual"; fi
}

# A case that names the problem it is about, so it cannot pass on a different
# refusal. Sol's review of 8a316ff found a fixture reporting two problems and
# proving neither.
# run_saying <label> <expected exit> <pattern> <reviews json>
run_saying() {
  local label="$1" expect="$2" pattern="$3" output actual
  local reviews="${4-$APPROVED}"
  output="$(HEAD_SHA="$HEAD" REVIEWS="$reviews" node "$CHECKER" 2>&1 >/dev/null)"
  actual=$?
  if [ "$actual" != "$expect" ]; then
    fail "$label" "expected exit $expect, got $actual"
  elif ! grep -q "$pattern" <<<"$output"; then
    fail "$label" "exit $expect, but nothing said \"$pattern\"; it said: $(printf '%s' "$output" | head -3)"
  else
    pass "$label"
  fi
}

echo "review evidence cases, against $CHECKER"
echo

if [ ! -f "$CHECKER" ]; then
  fail "the checker exists" "no file at $CHECKER; nothing binds a review to a revision in CI"
  echo; echo "review evidence cases: $PASSED passed, $FAILED failed"; exit 1
fi

# Ticket 52. The body is not evidence and is not read: a body that claims
# everything, with no review behind it, refuses; an empty body with the review
# behind it passes. Round 1 of the rehearsal merged twelve pull requests on a
# typed line while the reviewer had refused ten of them.
BOASTFUL="Review checkpoint
  head:        $HEAD
  checks:      41 step(s), all pass

Code review: approved by Sol (Codex) at ${HEAD:0:7}, review $REVIEW_ID
Security review: run against $HEAD, no findings"
actual="$(PR_BODY="$BOASTFUL" HEAD_SHA="$HEAD" CHANGED_FILES="packages/core-custody/broker.ts" REVIEWS="[]" \
  node "$CHECKER" >/dev/null 2>&1; echo $?)"
[ "$actual" = "1" ] && pass "a body that claims everything, with no review, fails (exit 1)" \
  || fail "a body that claims everything, with no review, fails" "expected exit 1, got $actual"
actual="$(PR_BODY="" HEAD_SHA="$HEAD" CHANGED_FILES="packages/core-custody/broker.ts" REVIEWS="$APPROVED" \
  node "$CHECKER" >/dev/null 2>&1; echo $?)"
[ "$actual" = "0" ] && pass "an empty body on a sensitive change passes on the review (exit 0)" \
  || fail "an empty body on a sensitive change passes on the review" "expected exit 0, got $actual"

# 17 September, the loop rehearsal. Sol requested changes on ten of twelve
# pull requests, GitHub recorded every one as COMMENTED because the reviewing
# account is the author's, and the check passed all twelve on a line the
# builder typed. The verdict is read off the review of record.
run_case "an approving review of record passes" 0 "$APPROVED"
run_case "a refusal of this head refuses" 1 "$(review_of_record "$REVIEW_ID" "$HEAD" "changes requested")"
run_saying "a verdict on an older head is not a verdict on this one" 1 "A review of one revision is not a review of another" \
  "$(review_of_record "$REVIEW_ID" "$OTHER" "approve")"
run_case "no review of record at all fails" 1 "[]"

# A review whose recorded head disagrees with the head it claims to cover:
# the head moved under the reviewer, and neither revision can be trusted.
run_case "a review GitHub recorded against another head fails" 1 \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$OTHER")"

# A verdict a reader would have to interpret is not a verdict.
run_case "a verdict the check cannot read fails" 1 \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "looks reasonable to me")"

# The owner's decision of 20 September 2026, and the shape of round two: twelve
# refusals out of twelve, both clean controls held twice, and every
# second-round finding against an input no criterion mentions. A refusal that
# names no criterion is a note, and a note does not hold a pull request.
run_saying "a refusal naming no criterion is not a review of record, and says so" 1 \
  "names no criterion" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "changes requested" "$HEAD" \
    '\nFindings:\n  - a.ts:1 - there is a path no test reaches')"
run_case "a refusal that names a criterion still refuses" 1 \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "changes requested")"
# The rule is about refusals only. An approval has no criterion to name, and
# asking one of it would be a second way to fail an approval that said approve.
run_case "an approval needs no criterion" 0 \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\nFindings: none')"
# A refusal's criterion is read off the body as written, fenced or commented
# included. Sol's review of 7790dc6 found a visible criterion after
# `<pre>```</pre>` read as fenced, which dropped the refusal and left an
# earlier approval standing, and this check cannot tell that fence from a real
# one without modelling more of Markdown. So a criterion hidden in a fence or a
# comment binds its refusal too: a refusal never drops out over an approval.
run_saying "a criterion inside a fenced block still binds its refusal over an approval" 1 "requests changes" \
  "$(review_of_record 8 "$HEAD" "changes requested" "$HEAD" \
    '\n```\nCriterion: 2\n```\nFindings:\n  - a.ts:1 - a note' | sed 's/]$//'),${APPROVED#[}"
run_saying "a criterion inside an HTML comment still binds its refusal over an approval" 1 "requests changes" \
  "$(review_of_record 8 "$HEAD" "changes requested" "$HEAD" \
    '\n<!-- Criterion: 2 -->\nFindings:\n  - a.ts:1 - a note' | sed 's/]$//'),${APPROVED#[}"
run_saying "a finding that merely mentions the word supplies no criterion" 1 "names no criterion" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "changes requested" "$HEAD" \
    '\nFindings:\n  - a.ts:1 - this breaks a Criterion: somewhere in the plan')"

# A comment without the shape is not a review of record, however positive.
run_case "a review without the evidence shape is not a review of record" 1 \
  '[{"id":42,"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Looks good to me, no findings."}]'

# The reviews are the evidence. A check that cannot see them refuses.
actual="$(HEAD_SHA="$HEAD" node "$CHECKER" >/dev/null 2>&1; echo $?)"
[ "$actual" = "1" ] && pass "no reviews source at all fails (exit 1)" \
  || fail "no reviews source at all fails" "expected exit 1, got $actual; a control whose input vanished must refuse, not pass"

# And it reads them from a file, which is how the hosted job passes them.
tmp_reviews="$(mktemp)"
printf '%s' "$APPROVED" > "$tmp_reviews"
actual="$(HEAD_SHA="$HEAD" REVIEWS_FILE="$tmp_reviews" node "$CHECKER" >/dev/null 2>&1; echo $?)"
[ "$actual" = "0" ] && pass "the reviews are read from REVIEWS_FILE (exit 0)" \
  || fail "the reviews are read from REVIEWS_FILE" "expected exit 0, got $actual"
rm -f "$tmp_reviews"

# And HEAD_SHA is not optional: without a head there is no revision to bind to.
actual="$(REVIEWS="$APPROVED" node "$CHECKER" >/dev/null 2>&1; echo $?)"
[ "$actual" = "2" ] && pass "no head at all is a usage error (exit 2)" \
  || fail "no head at all is a usage error" "expected exit 2, got $actual"

# Sol's review of 1e90365, six findings, each one a way past the rule.

# Every review here is posted from one account, so "the latest review wins"
# would let an approval posted after a refusal erase it on the same revision
# with nothing changed. The strictest verdict on a head wins.
two_reviews() {
  printf '[{"id":1,"state":"COMMENTED","commit_id":"%s","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\\nModel: gpt-5.6-sol\\nHead SHA: %s\\nVerdict: changes requested\\nCriterion: 1\\nFindings:\\n  - a.ts:1 - wrong"},{"id":%s,"state":"COMMENTED","commit_id":"%s","submitted_at":"2026-09-17T02:00:00Z","body":"Reviewer: Sol (Codex)\\nModel: gpt-5.6-sol\\nHead SHA: %s\\nVerdict: approve\\nFindings: none"}]' \
    "$HEAD" "$HEAD" "$REVIEW_ID" "$HEAD" "$HEAD"
}
run_case "a later approval cannot erase a refusal on the same head" 1 "$(two_reviews)"

# A verdict is one of two words, matched whole. Substring matching authorised
# its own opposite.
for wording in "not approved" "do not accept" "approve with one nit" "changes requested, now fixed by me"; do
  run_case "the verdict \"$wording\" is not one of the two" 1 \
    "$(review_of_record "$REVIEW_ID" "$HEAD" "$wording")"
done
run_case "the verdict \"Approved.\" is an approval" 0 \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "Approved.")"

# The shape CONTRIBUTING.md asks for includes the model. A review without it
# is a comment.
run_case "a review with no Model line is not a review of record" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'

# `gh api --paginate --slurp` writes one array per page, so the reviews arrive
# as pages once a pull request has more than thirty of them.
run_case "the reviews arrive as pages and are still read" 0 "[[],$APPROVED]"

# One workflow reports this context, and it is the one triggered by a review.
#
# The job used to live in ci.yml as well, and two copies were held equal here.
# They should never have both run. ci.yml cannot know a verdict on a head that
# nobody has reviewed, so its copy failed on every first push, and GitHub holds
# a merge while either reporting workflow's latest run of the context is red,
# which left that stale failure blocking the merge after the review landed
# green. Ticket 1 cut the ci.yml copy. Absence is the stronger gate anyway: a
# required context with no check run on the head blocks a merge outright.
#
# So the case is now the opposite of the old one. ci.yml must report nothing
# about review evidence, under any job key.
ci_yml="$(cat "$REPO_ROOT/.github/workflows/ci.yml")"
ci_reports=""
case "$ci_yml" in
  *'review evidence for this revision'*) ci_reports="it names the context" ;;
  *'review-evidence-check.mjs'*) ci_reports="it runs the evidence checker" ;;
  *'review-evidence-cases.sh'*) ci_reports="it runs these cases" ;;
esac
if [ -n "$ci_reports" ]; then
  fail "ci.yml reports nothing about review evidence" "$ci_reports; an unreviewed head would go red for want of a review, and the stale run would block the merge after the review landed"
else
  pass "ci.yml reports nothing about review evidence"
fi

# Note 2 of review 5260911453. The range starts at the `steps:` line and so
# always returns it, and testing that for emptiness asked only whether the file
# had a `steps:` key at all: the reviewer emptied the block underneath and this
# case still passed. What the case is for is a step block with nothing in it,
# so it drops the key line and asks for a step.
arrival_steps="$(sed -n '/^    steps:/,$p' "$REPO_ROOT/.github/workflows/review-evidence.yml" | sed '1d')"
if grep -q '^ *- ' <<<"$arrival_steps"; then
  pass "the review-evidence job still has its steps"
else
  fail "the review-evidence job still has its steps" "review-evidence.yml has an empty step block; nothing would report the context at all"
fi

# And the arrival workflow must actually be triggered by a review arriving, and
# must report the context the ruleset requires. The strings are exact: the
# workflow's own header comment names the three trigger types in prose, so a
# loose word would be satisfied by the comment with the `types:` line deleted.
#
# Note 3 of the same review. The loop used to call `fail` on a miss and `pass`
# unconditionally after it, so one broken copy was counted as a pass and a
# failure at once. The misses are collected and reported as the one result the
# one case has.
missing=""
for needed in 'pull_request_review:' 'types: [submitted, edited, dismissed]' 'name: review evidence for this revision'; do
  case "$(cat "$REPO_ROOT/.github/workflows/review-evidence.yml")" in
    *"$needed"*) ;;
    *) missing="$missing $needed;" ;;
  esac
done
if [ -n "$missing" ]; then
  fail "review-evidence.yml runs on a review arriving and reports the same context" "missing:$missing"
else
  pass "review-evidence.yml runs on a review arriving and reports the same context"
fi

# Sol's review of 5204bb8. A review that states two verdicts states none, and
# the same for the other three lines: the first match used to win.
run_case "two verdicts in one review state none" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve\nVerdict: changes requested"}]'
run_case "two heads in one review name none" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nHead SHA: '"$OTHER"'\nVerdict: approve"}]'

# Copilot's review of 5204bb8, three more ways past the rule.

# Dismissing a review is how a verdict is taken back. GitHub keeps it in the
# list with state DISMISSED.
run_case "a dismissed approval authorises nothing" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"DISMISSED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'

# One review whose recorded head disagrees with its body must not poison the
# pull request for ever: a correct review of the same head clears it.
run_case "a sound review clears a mistyped one on the same head" 0 \
  '[{"id":7,"state":"COMMENTED","commit_id":"'"$OTHER"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"},{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T02:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'

# Sol's review of f0adde7: the one-line-each rule read the first match on a
# line and ignored the rest of it.
run_case "two heads on one line name none" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"' Head SHA: '"$OTHER"'\nVerdict: approve"}]'
run_case "two verdicts on one line state none" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve Verdict: changes requested"}]'

# Sol's review of 7bb8ffb. A review nobody has posted is not evidence, and a
# review whose approving fields are hidden in an HTML comment says one thing to
# a person and another to a parser.
run_case "a pending review is not a review of record" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"PENDING","commit_id":"'"$HEAD"'","submitted_at":null,"body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'
run_case "approving fields hidden in a comment are not a verdict" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"This change is not approved.\n<!--\nReviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve\n-->"}]'

# Sol's review of 008c965: GitHub treats an unterminated `<!--` as a comment to
# the end of the text, and only the closed form was stripped. Four characters
# hid a whole body.
run_case "an unclosed comment hides a review's verdict too" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"This change is not approved.\n<!--\nReviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'

# Sol's review of f695941: a fenced block is an example, not a statement.
# Stripping a fenced `<!--` deleted the refusal that followed it, and a fenced
# example supplied a verdict while the visible text refused.
run_case "a fenced example is not a verdict" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"I cannot approve this.\n```\nReviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve\n```"}]'
run_case "a fenced comment opener deletes no refusal" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve\n```\n<!--\n```\nVerdict: changes requested"}]'

# Copilot's review of b830375. A review GitHub bound to nothing is bound to
# nothing, and a reviewer's own findings must not invalidate its verdict.
run_case "a review bound to no revision is not evidence" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'
run_case "a finding that mentions a label does not discard its refusal" 1 \
  '[{"id":8,"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 1\nFindings:\n  - a.ts:1 - the Verdict: label is parsed wrongly here"},{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T02:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'

# Sol's review of b830375: a fence closes on the same character and at least
# the same length. A four-backtick block showing a three-backtick example was
# being closed by the example.
run_case "a longer fence is not closed by a shorter one" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"I cannot approve this.\n````\n```\nReviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve\n```\n````"}]'

# Sol's review of cf31893: Markdown renders four-space indent as code, and a
# fence marker with an info string after it is content, not a closing fence.
run_case "an indented code example is not a verdict" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"I cannot approve this.\n\n    Reviewer: Sol (Codex)\n    Model: gpt-5.6-sol\n    Head SHA: '"$HEAD"'\n    Verdict: approve"}]'
run_case "a fence with an info string closes nothing" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"I cannot approve this.\n````\n````js\nReviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve\n````"}]'

# Sol's review of 69afe53 (CF-01). GitHub records the full commit a review was
# posted against, so that is what binds it. Seven characters in the body only
# say which head the reviewer meant; they cannot bind an approval of another
# commit that happens to share them.
SHARES_PREFIX=1111111222222222222222222222222222222222
run_case "a short body SHA binds no other full commit to this head" 1 \
  "$(review_of_record "$REVIEW_ID" "${HEAD:0:7}" "approve" "$SHARES_PREFIX")"
run_case "a short body SHA still binds the exact commit GitHub recorded" 0 \
  "$(review_of_record "$REVIEW_ID" "${HEAD:0:7}" "approve" "$HEAD")"

# And the head being merged is a full commit, or nothing: a one-character head
# was a prefix of every review's.
for bad_head in 1 1111111 "${HEAD}0" "zz${HEAD:2}"; do
  actual="$(HEAD_SHA="$bad_head" REVIEWS="$APPROVED" node "$CHECKER" >/dev/null 2>&1; echo $?)"
  [ "$actual" = "2" ] && pass "a malformed head ($bad_head) authorises nothing" \
    || fail "a malformed head ($bad_head) authorises nothing" "expected exit 2, got $actual"
done

# A fence opener inside a comment is part of the comment, and the comment ends
# where GitHub ends it. It used to open a fence that swallowed the visible
# refusal after it, leaving the approval above standing.
run_case "a fence hidden in a comment discards no visible refusal" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve\n<!--\n```\n-->\nVerdict: changes requested\nCriterion: 1"}]'
# From cf10160 a review holding a comment cannot approve at all (below), so
# this approval refuses too; the case keeps the shape on record.
run_case "a fence hidden in a comment approves nothing" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\n<!--\n```\n-->\nVerdict: approve"}]'

# The security review of 65dbe59: only a line that starts with `<!--` opens a
# comment that runs across lines. A `<!--` quoted in code or mid-paragraph is
# text, so it must not hide the fence after it and let the fenced example's
# verdict stand while the visible text refuses.
run_case "a quoted comment opener lets no fenced approval stand" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nFinding: `<!--` in prose.\n```text\n-->\nVerdict: approve\n```\nVerdict: changes requested\nCriterion: 2"}]'
run_case "a mid-paragraph comment opener lets no fenced approval stand" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nThe stripper treats a mid-line <!-- opener as a comment.\n```\n-->\nVerdict: approve\n```\nVerdict: changes requested\nCriterion: 2"}]'

# The security review of cf10160 found two more shapes the hand-written
# stripper misreads: a comment opening a list item, and `<!-->`, which is a
# whole comment. Markdown has more. A comment can only make a review
# stricter, so a body holding `<!--` anywhere still refuses but never
# approves; an approval has no need of one.
run_case "a comment opening a list item lets no fenced approval stand" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\n- <!--\n  ```\n  -->\nVerdict: changes requested\nCriterion: 2\n\n```\n-->\nVerdict: approve\n```"}]'
for opener in '<!-->' '<!--->'; do
  run_case "an empty comment $opener lets no fenced approval stand" 1 \
    '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\n'"$opener"'\n```text\n-->\nVerdict: approve\n```\nVerdict: changes requested\nCriterion: 2"}]'
done
run_saying "an approval holding a comment is refused, saying why" 1 "cannot approve" \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve\n<!-- a note -->"}]'
run_case "a refusal holding a comment still refuses" 1 \
  '[{"id":8,"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 1\n<!-- a note -->"},'"${APPROVED#[}"

# The security review of e9a1195 found the same flip with no comment at all: a
# fence opened on a list-marker line, a fence line inside an HTML block, and a
# backtick in a fence's info string, each of which GitHub shows differently
# from the stripper. A refusal stated anywhere in the body wins, whatever the
# stripper made of the lines around it.
run_case "a fence opened on a list item lets no approval stand over a refusal" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\n- ```\n  Verdict: approve\n  ```\n\nVerdict: changes requested\nCriterion: 2"}]'
for pair in '<pre>|</pre>' '<script>|</script>' '<div>|</div>' '<?x|?>'; do
  open=${pair%%|*} close=${pair#*|}
  run_case "a fence line inside $open lets no approval stand over a refusal" 1 \
    '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\n'"$open"'\n```\n'"$close"'\n\nVerdict: changes requested\nCriterion: 2\n\n```\nVerdict: approve\n```"}]'
done
run_case "a backtick in a fence's info string lets no approval stand over a refusal" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\n```a`b\n\nVerdict: changes requested\nCriterion: 2\n\n```\nVerdict: approve\n```"}]'
# And a later refusal the stripper cannot read still refuses: a quoted `<!--`
# above its verdict once left an earlier approval of the head standing.
run_saying "a refusal quoting a comment opener overrides an earlier approval" 1 "requests changes" \
  '[{"id":8,"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T02:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nFinding: `<!--` in x.mjs:3\nVerdict: changes requested\nCriterion: 2"},'"${APPROVED#[}"
run_saying "a refusal in a list-item fence overrides an earlier approval" 1 "requests changes" \
  '[{"id":8,"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T02:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\n- ```\n  x\n  ```\n\nVerdict: changes requested\nCriterion: 2\n\n```\nx"},'"${APPROVED#[}"
# Sol's review of 7790dc6: a visible criterion the fence stripper lost, and a
# fenced `Reviewer:` example read as a second real label, each discarded a
# refusal and left an earlier approval of the head standing. A refusal counts
# however its labels repeat, and against every head it names.
run_saying "a visible criterion after an HTML block still binds its refusal" 1 "requests changes" \
  '[{"id":8,"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T02:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: changes requested\n<pre>\n```\n</pre>\n\nCriterion: 2"},'"${APPROVED#[}"
run_saying "a fenced Reviewer example cannot discard a refusal" 1 "requests changes" \
  '[{"id":8,"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T02:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nFinding: `<!--` in x.mjs:3\nVerdict: changes requested\nCriterion: 2\n\n```\nReviewer: example\n```"},'"${APPROVED#[}"
run_saying "a quoted Head SHA cannot move a refusal off this head" 1 "requests changes" \
  '[{"id":8,"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T02:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\n```\nHead SHA: '"$OTHER"'\n```\nHead SHA: '"$HEAD"'\nFinding: `<!--` in x.mjs:3\nVerdict: changes requested\nCriterion: 2"},'"${APPROVED#[}"
# An approval that quotes a refusal it is not making is refused, saying why:
# the strict reading wins in both directions.
run_saying "an approval quoting a refusal is refused, saying why" 1 "any reading" \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve\n\n```\nVerdict: changes requested\nCriterion: 1\n```"}]'

# The security review of 1f75c37: a review the check knew refused was still
# dropped when one of its labels was off the strict line form, and an earlier
# approval of the head then stood. A refusal never drops out: it holds the
# commit GitHub recorded it on, whatever shape its lines take. The report's
# two repros come first, verbatim.
AH=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
AH_APPROVED='{"id":1,"state":"COMMENTED","commit_id":"'"$AH"'","submitted_at":"2026-10-02T00:00:00Z","body":"Reviewer: Sol\nModel: gpt-6.1-sol\nHead SHA: '"$AH"'\nVerdict: approve"}'
HEAD="$AH" run_saying "a bold verdict refusal holds over an earlier approval (repro)" 1 "requests changes" \
  '['"$AH_APPROVED"',{"id":2,"state":"COMMENTED","commit_id":"'"$AH"'","submitted_at":"2026-10-02T01:00:00Z","body":"Reviewer: Sol\nModel: gpt-6.1-sol\nHead SHA: '"$AH"'\n**Verdict:** changes requested\nCriterion: 2"}]'
HEAD="$AH" run_saying "a refusal with text after its Head SHA holds over an earlier approval (repro)" 1 "requests changes" \
  '['"$AH_APPROVED"',{"id":2,"state":"COMMENTED","commit_id":"'"$AH"'","submitted_at":"2026-10-02T01:00:00Z","body":"Reviewer: Sol\nModel: gpt-6.1-sol\nHead SHA: '"$AH"' (frozen)\nVerdict: changes requested\nCriterion: 2"}]'
# refusal_over_approval <body>: review 8 at this head, after the approval.
refusal_over_approval() {
  printf '[{"id":8,"state":"COMMENTED","commit_id":"%s","submitted_at":"2026-09-17T02:00:00Z","body":"%s"},%s' "$HEAD" "$1" "${APPROVED#[}"
}
WHO='Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\n'
run_saying "a refusal with a bold Head SHA holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval "$WHO"'**Head SHA:** '"$HEAD"'\nVerdict: changes requested\nCriterion: 2')"
run_saying "a refusal written as list items holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval '- Reviewer: Sol (Codex)\n- Model: gpt-5.6-sol\n- Head SHA: '"$HEAD"'\n- Verdict: changes requested\n- Criterion: 2')"
run_saying "a refusal in a blockquote holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval '> Reviewer: Sol (Codex)\n> Model: gpt-5.6-sol\n> Head SHA: '"$HEAD"'\n> Verdict: changes requested\n> Criterion: 2')"
run_saying "a refusal with two spaces in its Head SHA label holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval "$WHO"'Head  SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 2')"
run_saying "a refusal whose body names another head holds the head GitHub recorded" 1 "requests changes" \
  "$(refusal_over_approval "$WHO"'Head SHA: '"$OTHER"'\nVerdict: changes requested\nCriterion: 2')"
run_saying "a refusal whose first Reviewer line is blank holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval 'Reviewer: \nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 2')"
run_saying "a refusal with bold labels throughout holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval '**Reviewer:** Sol (Codex)\n**Model:** gpt-5.6-sol\n**Head SHA:** '"$HEAD"'\n**Verdict:** changes requested\n**Criterion:** 2')"
run_saying "a refusal in an odd shape, alone, still refuses" 1 "requests changes" \
  '[{"id":8,"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T02:00:00Z","body":"'"$WHO"'Head SHA: '"$HEAD"' (frozen)\n**Verdict:** changes requested\nCriterion: 2"}]'
# The same review's finding 3, carried from 7790dc6: a refusal whose label the
# refusal scan did not know, beside a list-item fence the stripper did not
# strip, let the fenced approval stand on one review. A refusal in a bold,
# table or tag label, or in the word reject, is a refusal.
LIST_FENCED_APPROVE='Reviewer: Sol\nModel: gpt-6.1-sol\nHead SHA: '"$HEAD"'\n- ```\n  Verdict: approve\n  ```\n\n'
one_review() {
  printf '[{"id":8,"state":"COMMENTED","commit_id":"%s","submitted_at":"2026-09-17T02:00:00Z","body":"%s"}]' "$HEAD" "$1"
}
run_saying "a refusal with the colon outside the bold lets no fenced approval stand (repro)" 1 "requests changes" \
  "$(one_review "$LIST_FENCED_APPROVE"'**Verdict**: changes requested\nCriterion: 2')"
run_saying "a refusal in a table row lets no fenced approval stand" 1 "requests changes" \
  "$(one_review "$LIST_FENCED_APPROVE"'| Field | Value |\n| --- | --- |\n| Verdict | changes requested |\n| Criterion | 2 |')"
run_saying "a refusal in tags, CRLF lines, lets no fenced approval stand" 1 "requests changes" \
  "$(one_review "$LIST_FENCED_APPROVE"'<b>Verdict</b>: changes requested\r\n<b>Criterion</b>: 2\r\n')"
run_saying "a refusal in upper case, tabbed table cells, lets no fenced approval stand" 1 "requests changes" \
  "$(one_review "$LIST_FENCED_APPROVE"'|\tVERDICT\t|\tCHANGES REQUESTED\t|')"
run_saying "a verdict of reject holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval "$LIST_FENCED_APPROVE"'Verdict: reject\nCriterion: 2')"
# Reject is not one of the two verdicts, so on its own line it still states
# none, which holds with or without a criterion.
run_saying "a verdict of reject with no criterion still holds over an approval" 1 "states no verdict" \
  "$(refusal_over_approval "$WHO"'Head SHA: '"$HEAD"'\nVerdict: reject')"
# And none of it blocks an approval that says approve.
run_case "an approval with fenced code passes" 0 \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\nFindings: none\n\n```js\nconst verdict = classify(value) || fallback;\n```')"
run_case "a fix-head approval that mentions the prior verdict in prose passes" 0 \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\nFindings: none. The prior verdict on 2222222 was changes requested on criterion 2, and this head fixes it.')"

# The security review of fc77d00, finding 1: a refusal worded outside the
# scan's words took the strict path, one off-shape field there dropped it, and
# an earlier approval of the same head stood. A verdict that starts with a
# refusal, or reads `not approved`, refuses; and a review with a verdict label
# is never dropped: short of a clean approval, it holds the head GitHub
# recorded it on. The report's two repros come first, verbatim.
HEAD="$AH" run_saying "a qualified refusal with text after its Head SHA holds over an earlier approval (repro)" 1 "criterion 2" \
  '['"$AH_APPROVED"',{"id":2,"state":"COMMENTED","commit_id":"'"$AH"'","submitted_at":"2026-10-02T01:00:00Z","body":"Reviewer: Sol\nModel: gpt-6.1-sol\nHead SHA: '"$AH"' (frozen)\nVerdict: changes requested (criterion 2)\nCriterion: 2"}]'
HEAD="$AH" run_saying "a bold not approved holds over an earlier approval (repro)" 1 "review 2 by" \
  '['"$AH_APPROVED"',{"id":2,"state":"COMMENTED","commit_id":"'"$AH"'","submitted_at":"2026-10-02T01:00:00Z","body":"**Reviewer:** Sol\n**Model:** gpt-6.1-sol\n**Head SHA:** '"$AH"' (frozen)\n**Verdict:** not approved\n**Criterion:** 2"}]'
for verdict in 'changes requested (criterion 2)' 'Request changes, see criterion 2' 'changes required' 'not approved'; do
  run_saying "a frozen-SHA review saying '$verdict' holds over an approval" 1 "review 8 by" \
    "$(refusal_over_approval "$WHO"'Head SHA: '"$HEAD"' (frozen)\nVerdict: '"$verdict"'\nCriterion: 2')"
  run_saying "a bold review saying '$verdict' holds over an approval" 1 "review 8 by" \
    "$(refusal_over_approval '**Reviewer:** Sol\n**Model:** gpt-6.1-sol\n**Head SHA:** '"$HEAD"'\n**Verdict:** '"$verdict"'\n**Criterion:** 2')"
  run_saying "a list-item review saying '$verdict' holds over an approval" 1 "review 8 by" \
    "$(refusal_over_approval '- Reviewer: Sol\n- Model: gpt-6.1-sol\n- Head SHA: '"$HEAD"'\n- Verdict: '"$verdict"'\n- Criterion: 2')"
done
# Hostile shapes of the same: case, CRLF, a tab, a tag label, a hyphen qualifier.
run_saying "an upper-case NOT APPROVED in bold CRLF lines holds over an approval" 1 "review 8 by" \
  "$(refusal_over_approval '**Reviewer:** Sol\r\n**Head SHA:** '"$HEAD"'\r\n**VERDICT:**  NOT  APPROVED\r\n**Criterion:** 2\r\n')"
run_saying "a tabbed list-item changes required holds over an approval" 1 "review 8 by" \
  "$(refusal_over_approval '-\tReviewer: Sol\n-\tVerdict:\tchanges required')"
run_saying "a tagged refusal with a hyphen qualifier holds over an approval" 1 "review 8 by" \
  "$(refusal_over_approval '<b>Head SHA</b>: '"$HEAD"'\n<b>Verdict</b>: changes requested - see criterion 2\n<b>Criterion</b>: 2')"
run_saying "a qualified refusal alone still refuses" 1 "review 8 by" \
  "$(one_review "$WHO"'Head SHA: '"$HEAD"' (frozen)\nVerdict: changes requested (criterion 2)\nCriterion: 2')"
# The second rule reaches only a verdict label at the start of a line, so a
# comment that mentions the label in prose, beside an approval, does not hold
# it. A table column headed Verdict is a label: Sol's review of 87a9f77 found
# a table of Head SHA, Verdict and Criterion columns, its verdict undecided,
# dropped beside an approval, because this rule never read down the columns.
run_case "a comment mentioning Verdict: in prose does not hold an approval" 0 \
  "$(refusal_over_approval '## Pull request overview\n\nThis tightens how the `Verdict:` label is read.')"
run_saying "an ambiguous labelled table cannot disappear beside an approval (repro)" 1 "states no verdict" \
  "$(refusal_over_approval '| Head SHA (final) | Verdict (final) | Criterion (final) |\n|---|---|---|\n| '"$HEAD"' | undecided | 2 |')"
# Sol PRV-cf-85-R1, criterion 2. Sol's reviews, as it wrote them.
# sol_review <id> <body>
sol_review() {
  printf '{"id":%s,"body":"%s","state":"COMMENTED","submitted_at":"2026-10-04T00:00:00Z","commit_id":"%s"}' "$1" "$2" "$HEAD"
}
SOL_APPROVAL='Reviewer: Sol\nModel: independent\nHead SHA: '"$HEAD"'\nVerdict: approve'
run_case "an undecided labelled table in a second review refuses beside an approval" 1 \
  "[$(sol_review 1 "$SOL_APPROVAL"),$(sol_review 2 '| Head SHA (final) | Verdict (final) | Criterion (final) |\n|---|---|---|\n| '"$HEAD"' | undecided | 2 |')]"
# Finding 2: f8158ec let a quoted JSON key read as a label. ca12530 made a
# quote mark before the colon no label, and the security review of ca12530
# found that hid a refusal GitHub shows as plain text (`"Verdict": changes
# requested`) under an earlier approval. A quoted key is a label again: an
# approval quoting one is refused, and told it quotes a refusal.
HEAD="$AH" run_saying "an approval with a fenced JSON verdict key is told it quotes a refusal (repro)" 1 "any reading" \
  '[{"id":1,"state":"COMMENTED","commit_id":"'"$AH"'","submitted_at":"2026-10-02T00:00:00Z","body":"Reviewer: Sol\nModel: gpt-6.1-sol\nHead SHA: '"$AH"'\nVerdict: approve\n\nFindings: none.\n```json\n{\"state\": \"COMMENTED\", \"verdict\": \"changes requested\"}\n```\n"}]'
run_saying "an approval quoting a JSON verdict key in prose is told it quotes a refusal" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\nFindings: none. The old head returned \"verdict\": \"changes requested\".')"
run_saying "an approval with a single-quoted verdict key is told it quotes a refusal" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\nFindings: none.\n```py\nr = {'"'"'verdict'"'"': '"'"'changes requested'"'"'}\n```')"
run_saying "a refusal with a quoted Verdict key holds over an approval (repro)" 1 "requests changes" \
  "$(refusal_over_approval "$WHO"'Head SHA: '"$HEAD"' (frozen)\n\"Verdict\": changes requested\nCriterion: 2')"
run_saying "a refusal with a bold quoted Verdict key holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval "$WHO"'Head SHA: '"$HEAD"' (frozen)\n**\"Verdict\":** changes requested\n\"Criterion\": 2')"
run_saying "a refusal with a single-quoted Verdict key holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval "$WHO"'Head SHA: '"$HEAD"' (frozen)\n'"'"'Verdict'"'"': changes requested\nCriterion: 2')"
# The same review: a bare carriage return opened no line for the verdict-line
# rule, so an off-vocabulary refusal with CR line endings dropped out.
run_case "a refusal with bare CR line endings holds over an approval" 1 \
  "$(refusal_over_approval '**Reviewer:** Sol (Codex)\r**Model:** gpt-5.6-sol\r**Head SHA:** '"$HEAD"'\r**Verdict:** changes required\r**Criterion:** 2')"
run_saying "a backticked Verdict label still refuses over an approval" 1 "requests changes" \
  "$(refusal_over_approval "$WHO"'Head SHA: '"$HEAD"'\n`Verdict`: changes requested\nCriterion: 2')"
# And an approval that still quotes a refusal, criterion or not, is told so.
run_saying "an approval quoting a criterionless refusal is told it quotes one" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\nFindings: none.\n```js\nconst r = { verdict: '"'"'changes requested'"'"' };\n```')"

# The review's own metadata is evidence too. GitHub sends one of five states
# and an ISO 8601 time on every submitted review; anything else did not come
# from GitHub's record of a posted review.
run_case "an unknown review state authorises nothing" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"NOT_A_REVIEW_STATE","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'
run_case "a review with no state authorises nothing" 1 \
  '[{"id":'"$REVIEW_ID"',"commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'
run_case "a submission time that is not a date authorises nothing" 1 \
  '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"not-a-date","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'
# Sol's review of 7790dc6: Date.parse rolls 31 February into March, so the
# form alone let an impossible date through. The date has to exist.
for when in 2026-02-31T00:00:00Z 2026-04-31T01:00:00Z 2026-09-17T24:00:00Z; do
  run_case "a submission time of $when authorises nothing" 1 \
    '[{"id":'"$REVIEW_ID"',"state":"COMMENTED","commit_id":"'"$HEAD"'","submitted_at":"'"$when"'","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'
done
run_case "an approval GitHub recorded as APPROVED still counts" 0 \
  '[{"id":'"$REVIEW_ID"',"state":"APPROVED","commit_id":"'"$HEAD"'","submitted_at":"2026-09-17T01:00:00.123Z","body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: '"$HEAD"'\nVerdict: approve"}]'

# Sol's review of eba3667. Three ways a refusal still dropped out under an
# approval of the same head.
#
# One: the scan took the rest of the line after the first `Verdict` label, so
# a second label on that line was never read, and a fenced line quoting
# `approve` then `changes requested` approved. Every label on a line is read.
run_saying "a second verdict on a fenced line still refuses (repro)" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n```\nVerdict: approve; Verdict: changes requested\nCriterion: 2\n```')"
run_saying "two verdict labels with nothing between them still refuse" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n```\nVerdict:Verdict: changes requested\n```')"
run_saying "a second verdict in a fenced table row still refuses" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n~~~\n| Verdict | approve | VERDICT | not approved |\n~~~')"
run_saying "a second verdict of reject on a fenced list line still refuses" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n```\n- Verdict: approve.\tVerdict: reject\n```')"
run_case "a fenced line that approves twice lets an approval stand" 0 \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n```\nVerdict: approve; Verdict: approve\n```')"
# Two: a refusal posted on another commit that names this head was filtered
# out with the approvals of other commits, though CONTRIBUTING.md step 4 says
# a refusal holds every head it names. The security reviews of 1f75c37 and
# fc77d00 checked the opposite by hand ("a refusal at X that names H does not
# block an approval of H"); no case here asserted it. That reading is
# reversed: the refusal holds H. An approval still binds only to the commit
# GitHub recorded it on.
# refusal_at <recorded commit> <body>: review 8, beside the approval of this head.
refusal_at() {
  printf '[{"id":8,"state":"COMMENTED","commit_id":"%s","submitted_at":"2026-09-17T02:00:00Z","body":"%s"},%s' "$1" "$2" "${APPROVED#[}"
}
run_saying "a refusal posted on another commit that names this head holds it (repro)" 1 "requests changes" \
  "$(refusal_at "$OTHER" "$WHO"'Head SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 2')"
run_saying "a refusal posted on another commit naming this head in bold holds it" 1 "requests changes" \
  "$(refusal_at "$OTHER" "$WHO"'**Head SHA:** '"$HEAD"'\nVerdict: changes requested\nCriterion: 2')"
run_saying "a refusal posted on another commit naming this head in a table holds it" 1 "requests changes" \
  "$(refusal_at "$OTHER" "$WHO"'| Head SHA | '"$HEAD"' |\n| Verdict | changes requested |\n| Criterion | 2 |')"
run_case "a refusal of another commit that names only that commit leaves this head's approval" 0 \
  "$(refusal_at "$OTHER" "$WHO"'Head SHA: '"$OTHER"'\nVerdict: changes requested\nCriterion: 2')"
# Sol's review of 8e3681d. Two more shapes a refusal dropped out in.
#
# One: a table laid out across put `Verdict` in a header cell and the refusal
# in the row below, so an approval of the same head stood. A cell under a
# Verdict, Head SHA or Criterion header reads as that label's value, in any
# column order and beside any other columns.
ACROSS='| Reviewer | Model | Head SHA | Verdict | Criterion |\n| --- | --- | --- | --- | --- |\n| Sol | gpt-6.1-sol | '"$HEAD"' | changes requested | 2 |'
run_saying "a refusal in a table laid out across holds over an approval (repro)" 1 "requests changes" \
  "$(refusal_over_approval "$ACROSS")"
run_saying "a table refusal with reordered and extra columns, no outer pipes, holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval 'Criterion | Notes | VERDICT | Head SHA\n:-- | --- | :-: | --:\n2 | see a.mjs:3 | not approved | '"$HEAD")"
run_saying "a refusal on a later row of a Verdict column, CRLF lines, holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval '| Round | Verdict | Criterion |\r\n|---|---|---|\r\n| 1 | approve | |\r\n| 2 | changes requested | 2 |')"
run_saying "a refusal in a quoted table with bold and tagged headers holds over an approval" 1 "requests changes" \
  "$(refusal_over_approval '> | **Verdict** | <b>Criterion</b> |\n> | --- | --- |\n> | reject | 2 |')"
run_saying "a refusal posted on another commit naming this head in a table column holds it" 1 "requests changes" \
  "$(refusal_at "$OTHER" "$ACROSS")"
run_saying "an approval whose table has a refusing Verdict column is told it quotes a refusal" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n\n| Round | Verdict |\n| --- | --- |\n| 1 | changes requested |')"
run_saying "a refusal in a table laid out across, alone, still refuses" 1 "requests changes" "$(one_review "$ACROSS")"
run_case "a table refusal of another commit naming only that commit leaves this head's approval" 0 \
  "$(refusal_at "$OTHER" '| Head SHA | Verdict | Criterion |\n|---|---|---|\n| '"$OTHER"' | changes requested | 2 |')"
run_case "an approval with a table and no Verdict column passes" 0 \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n\n| File | Result |\n| --- | --- |\n| a.mjs | changes requested last round |')"
# Sol's review of 87a9f77: CONTRIBUTING step 4 says an approval carries no
# earlier verdict and no per-finding Verdict column or line, and this case
# approved one. Any second Verdict label in an approval leaves it unreadable.
run_saying "an approval with a table whose Verdict column approves cannot be read" 1 "states no verdict" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n\n| Round | Verdict |\n| --- | --- |\n| 2 | approve |')"
run_saying "an approval carrying an earlier Verdict label is refused (repro)" 1 "states no verdict" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\nPrevious verdict: approve')"
# Sol PRV-cf-85-R1, criterion 1.
run_case "an approval that also states a previous verdict is refused" 1 \
  "[$(sol_review 1 "$SOL_APPROVAL"'\nPrevious verdict: approve')]"
# The security review of e50b855: an all-dash row inside a table was taken as
# a new delimiter row, which renamed the columns from the row above it, so the
# refusals below it went unread. GitHub shows `| - | - |` as a row.
run_saying "an approval whose Verdict column refuses below a dash row is told it quotes a refusal (repro)" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n\n| Verdict | Criterion |\n|---|---|\n| - | - |\n| changes requested | 2 |')"
run_saying "a refusal on another commit naming this head below a dash row holds it (repro)" 1 "requests changes" \
  "$(refusal_at "$OTHER" '| Head SHA | Verdict | Criterion |\n|---|---|---|\n| '"$OTHER"' | approve | 1 |\n| - | - | - |\n| '"$HEAD"' | changes requested | 2 |')"
run_saying "a refusing Verdict column below two aligned dash rows is still read" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n\n| Round | Verdict |\n| --- | --- |\n| 1 | approve |\n| :-: | :-: |\n| :-: | :-: |\n| 2 | not approved |')"
run_saying "a Verdict table after a heading that broke another table is still read" 1 "any reading" \
  "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n\n| File | Result |\n| --- | --- |\n| a.mjs | ok |\n## Notes\n| Verdict | Criterion |\n| --- | --- |\n| changes requested | 2 |')"
# The security review of 4d949e4: a line that only looks blank, an empty tag
# or a no-break space, ended the column reading, while GitHub keeps it in the
# table as a row. Only a line of spaces and tabs ends a table.
for sep in '<b></b>' '<i></i>' '<span></span>' '\u00a0' '\u3000'; do
  run_saying "an approval whose Verdict column refuses below a '$sep' row is told it quotes a refusal (repro)" 1 "any reading" \
    "$(review_of_record "$REVIEW_ID" "$HEAD" "approve" "$HEAD" '\n\n| Verdict | Criterion |\n|---|---|\n| approve | 1 |\n'"$sep"'\n| changes requested | 2 |')"
  run_saying "a refusal on another commit naming this head below a '$sep' row holds it (repro)" 1 "requests changes" \
    "$(refusal_at "$OTHER" '| Head SHA | Verdict | Criterion |\n|---|---|---|\n| '"$OTHER"' | approve | 1 |\n'"$sep"'\n| '"$HEAD"' | changes requested | 2 |')"
done
for blank in '' ' \t '; do
  run_case "a blank line of '$blank' still ends a refusal's table before unrelated text" 0 \
    "$(refusal_at "$OTHER" '| Head SHA | Verdict | Criterion |\n|---|---|---|\n| '"$OTHER"' | changes requested | 2 |\n'"$blank"'\n'"$HEAD"' | notes')"
done
# Two: Head and SHA had to be apart by whitespace alone, so a refusal posted
# on another commit naming this head as `**Head** **SHA**:` (the repro) held
# only the other commit. Markup between the two words binds as around them.
for label in '**Head** **SHA**' '__Head__ __SHA__' '<b>Head</b> SHA' '`Head` *SHA*'; do
  run_saying "a refusal posted on another commit naming this head as $label holds it" 1 "requests changes" \
    "$(refusal_at "$OTHER" "$WHO$label"': '"$HEAD"'\nVerdict: changes requested\nCriterion: 2')"
done
# The security review of e50b855, its second low: a label with words after
# it, `Verdict (final)` or `[Verdict](#v)`, heading a column or opening a
# line, was read as no label, while GitHub shows it as the label. It reads as
# the bare label, as one with words before it (`Previous verdict`) already did.
for shape in '%s (final)' '[%s](#x)' '[%s](https://example.test/r)'; do
  h="$(printf "$shape" 'Head SHA')" v="$(printf "$shape" Verdict)" c="$(printf "$shape" Criterion)"
  run_saying "a refusal on another commit naming this head under columns headed '$v' holds it (repro)" 1 "requests changes" \
    "$(refusal_at "$OTHER" '| '"$h"' | '"$v"' | '"$c"' |\n|---|---|---|\n| '"$HEAD"' | changes requested | 2 |')"
  run_saying "a refusal on another commit naming this head on lines labelled '$v' holds it (repro)" 1 "requests changes" \
    "$(refusal_at "$OTHER" "$WHO$h"': '"$HEAD"'\n'"$v"': changes requested\n'"$c"': 2')"
done
run_saying "a review whose 'Verdict (final):' line it cannot read holds its head" 1 "states no verdict" \
  "$(refusal_over_approval "$WHO"'Head SHA: '"$HEAD"'\nVerdict (final): undecided')"
# Three: a review whose state or submission time GitHub would not send was
# skipped, so a refusal carrying one disappeared beside a valid approval.
# Malformed evidence is refused, naming the review, never skipped. DISMISSED
# and PENDING are GitHub's own states and are still passed over.
run_saying "a refusal with an unknown state is refused as malformed, not skipped (repro)" 1 "review 8 carries a state" \
  "$(refusal_at "$HEAD" "$WHO"'Head SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 2' | sed 's/"state":"COMMENTED"/"state":"NOT_A_REVIEW_STATE"/')"
run_saying "a refusal with a submission time that is not a date is refused as malformed (repro)" 1 "review 8 carries a submission time" \
  "$(refusal_at "$HEAD" "$WHO"'Head SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 2' | sed 's/"submitted_at":"2026-09-17T02:00:00Z"/"submitted_at":"not-a-date"/')"
run_saying "a lower-case state beside an approval is refused as malformed" 1 "review 8 carries a state" \
  "$(refusal_at "$HEAD" "$WHO"'Head SHA: '"$HEAD"'\nVerdict: approve' | sed 's/"state":"COMMENTED"/"state":"commented"/')"
run_saying "a standing review with no submission time is refused as malformed" 1 "review 8 carries a submission time" \
  "$(refusal_at "$HEAD" "$WHO"'Head SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 2' | sed 's/"submitted_at":"2026-09-17T02:00:00Z",//')"
run_saying "an entry that is not a review beside an approval is refused as malformed" 1 "carries a state" \
  "[null,${APPROVED#[}"
run_case "a pending review with no submission time is passed over" 0 \
  "$(refusal_at "$HEAD" "$WHO"'Head SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 2' | sed 's/"state":"COMMENTED"/"state":"PENDING"/; s/"submitted_at":"2026-09-17T02:00:00Z",//')"
run_case "a dismissed refusal is passed over" 0 \
  "$(refusal_at "$HEAD" "$WHO"'Head SHA: '"$HEAD"'\nVerdict: changes requested\nCriterion: 2' | sed 's/"state":"COMMENTED"/"state":"DISMISSED"/')"

# Sol's review of 69afe53: every workflow case above stayed green with the
# evidence step replaced by `echo`. The context is only worth requiring if the
# job that reports it runs the checker over this head and these reviews, so
# the workflow is parsed, not searched, and the step is checked whole.
WORKFLOW="$REPO_ROOT/.github/workflows/review-evidence.yml"
ctx_dir="$(mktemp -d)"
trap 'rm -rf "$ctx_dir"' EXIT
# The script sits in a file because bash 3.2 cannot parse a heredoc inside $( ).
cat > "$ctx_dir/gate.mjs" <<'NODE'
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { parse } = createRequire(process.argv[3])('yaml');
const workflow = parse(readFileSync(process.argv[2], 'utf8'));
const jobs = Object.values(workflow?.jobs ?? {});
const job = jobs.find((j) => j?.name === 'review evidence for this revision');
if (job === undefined) throw new Error('no job reports review evidence for this revision');
const steps = Array.isArray(job.steps) ? job.steps : [];
const at = (run) => steps.findIndex((s) => String(s?.run ?? '').trim() === run);
const gate = steps[at('node scripts/review-evidence-check.mjs')];
if (gate === undefined) throw new Error('no step runs node scripts/review-evidence-check.mjs');
if (gate.env?.HEAD_SHA !== '${{ github.event.pull_request.head.sha }}')
  throw new Error('the checker is not given the pull request head');
if (gate.env?.REVIEWS_FILE !== 'reviews.json') throw new Error('the checker is not given the reviews');
// Sol's review of eba3667: a `shell:` that runs the checker and exits 0 left
// every case green. The default shell, the checkout's root, and these two
// variables, so nothing around the checker can change what it returns.
if (Object.keys(gate.env).length !== 2 || 'env' in job || 'env' in workflow)
  throw new Error('the checker is given more than the head and the reviews');
if ([gate, job.defaults?.run, workflow.defaults?.run].some((s) => s?.shell !== undefined || s?.['working-directory'] !== undefined))
  throw new Error('the checker runs in a shell or directory other than the default');
if ('continue-on-error' in gate || 'continue-on-error' in job || 'if' in gate)
  throw new Error('the checker can be skipped or ignored');
// Sol's review of 8e3681d: matching the fetch anywhere in a step accepted it
// in a shell comment beside a local approval. The step just before the
// checker is the fetch, whole: this command, this pull request, the job token.
const fetch = steps[steps.indexOf(gate) - 1];
const api = { GH_TOKEN: '${{ github.token }}', PR_NUMBER: '${{ github.event.pull_request.number }}', REPO: '${{ github.repository }}' };
if (String(fetch?.run ?? '').trim() !== 'gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate --slurp > reviews.json' ||
    Object.keys(fetch).sort().join() !== 'env,name,run' || JSON.stringify(fetch.env) !== JSON.stringify(api))
  throw new Error('the reviews the API returns are not what the checker reads');
// Sol's review of 7790dc6: every case here stayed green with the checkout
// moved to the base revision. The files the job runs are the head's, or the
// checker that passes is not the one under review.
const checkouts = steps.filter((s) => /^actions\/checkout@/u.test(String(s?.uses ?? '')));
if (checkouts.length !== 1 || checkouts[0].with?.ref !== '${{ github.event.pull_request.head.sha }}')
  throw new Error('the job does not check out the pull request head, and only it');
// The security review of 1f75c37: the checkout kept the job's token in
// .git/config while the install and the cases ran PR code.
if (checkouts[0].with?.['persist-credentials'] !== false)
  throw new Error('the checkout leaves the job token in .git/config');
// And the cases below need `yaml`, which a fresh checkout does not have, so
// the job installs before it runs them, unconditionally.
const install = steps.findIndex((s) => String(s?.run ?? '').trim() === 'pnpm install --frozen-lockfile');
const cases = at('bash tests/ci/review-evidence-cases.sh');
if (cases === -1 || install === -1 || install > cases || 'if' in steps[install] || 'continue-on-error' in steps[install])
  throw new Error('the job does not install its dependencies before running its own cases');
// The security review of e50b855: a step running the pull request's own code
// before the fetch can reach the job token through $GITHUB_ENV or $GITHUB_PATH.
// Only the checkout and setup actions come before it, and none installs: the
// security review of 4d949e4 found `run_install: true` passing.
if (steps.slice(0, steps.indexOf(fetch)).some((s) => !/^(?:actions\/(?:checkout|setup-[a-z]+)|pnpm\/action-setup)@/u.test(String(s?.uses ?? '')) ||
    s.run !== undefined || ![undefined, false].includes(s.with?.run_install)))
  throw new Error("the pull request's code runs before the fetch that holds the job token");
NODE
# gate_case <label> <workflow> [the one problem it must report]
gate_case() {
  local label="$1" problem
  problem="$(node "$ctx_dir/gate.mjs" "$2" "$REPO_ROOT/package.json" 2>&1 | grep -m1 '^Error')"
  if [ "$problem" = "${3:+Error: $3}" ]; then pass "$label"; else fail "$label" "expected '${3:-no problem}', got '${problem:-no problem}'"; fi
}
gate_case "the reported context runs the evidence checker over this head" "$WORKFLOW"
sed 's/ref: ${{ github.event.pull_request.head.sha }}/ref: ${{ github.event.pull_request.base.sha }}/' "$WORKFLOW" > "$ctx_dir/base-checkout.yml"
gate_case "a job that checks out the base revision is refused" "$ctx_dir/base-checkout.yml" \
  'the job does not check out the pull request head, and only it'
grep -v 'ref: ${{ github.event.pull_request.head.sha }}' "$WORKFLOW" > "$ctx_dir/default-checkout.yml"
gate_case "a job that checks out the default revision is refused" "$ctx_dir/default-checkout.yml" \
  'the job does not check out the pull request head, and only it'
grep -v 'persist-credentials: false' "$WORKFLOW" > "$ctx_dir/kept-token.yml"
gate_case "a checkout that keeps the job token is refused" "$ctx_dir/kept-token.yml" \
  'the checkout leaves the job token in .git/config'
grep -v '^      - run: pnpm install --frozen-lockfile$' "$WORKFLOW" > "$ctx_dir/no-install.yml"
gate_case "a job that runs its cases without installing is refused" "$ctx_dir/no-install.yml" \
  'the job does not install its dependencies before running its own cases'
# Sol's review of eba3667: every case here stayed green with the checker's
# step given `shell: bash -c 'bash "$0"; exit 0' {0}`, which runs the checker
# and reports success whatever it said. The checker runs in the default shell,
# from the checkout's root, with the head and the reviews and nothing more.
masked="        shell: bash -c 'bash \"\$0\"; exit 0' {0}"
awk -v line="$masked" '/^        run: node scripts\/review-evidence-check.mjs$/ { print line } { print }' "$WORKFLOW" > "$ctx_dir/masked.yml"
gate_case "a checker step with a shell that masks its failure is refused (repro)" "$ctx_dir/masked.yml" \
  'the checker runs in a shell or directory other than the default'
awk -v line="$masked" '{ print } /^    timeout-minutes: 10$/ { print "    defaults:\n      run:"; print line }' "$WORKFLOW" > "$ctx_dir/job-shell.yml"
gate_case "a job default shell that masks the checker is refused" "$ctx_dir/job-shell.yml" \
  'the checker runs in a shell or directory other than the default'
{ cat "$WORKFLOW"; printf 'defaults:\n  run:\n    shell: sh -c "sh $0; true" {0}\n'; } > "$ctx_dir/workflow-shell.yml"
gate_case "a workflow default shell that masks the checker is refused" "$ctx_dir/workflow-shell.yml" \
  'the checker runs in a shell or directory other than the default'
awk '/^        run: node scripts\/review-evidence-check.mjs$/ { print "        working-directory: .github" } { print }' "$WORKFLOW" > "$ctx_dir/elsewhere.yml"
gate_case "a checker step run from another directory is refused" "$ctx_dir/elsewhere.yml" \
  'the checker runs in a shell or directory other than the default'
awk '{ print } /^          REVIEWS_FILE: reviews.json$/ { print "          NODE_OPTIONS: --require ./pass.cjs" }' "$WORKFLOW" > "$ctx_dir/node-options.yml"
gate_case "a checker step given more than the head and the reviews is refused" "$ctx_dir/node-options.yml" \
  'the checker is given more than the head and the reviews'
awk '{ print } /^    timeout-minutes: 10$/ { print "    env:\n      NODE_OPTIONS: --require ./pass.cjs" }' "$WORKFLOW" > "$ctx_dir/job-env.yml"
gate_case "a job environment around the checker is refused" "$ctx_dir/job-env.yml" \
  'the checker is given more than the head and the reviews'
# Sol's review of 8e3681d: the fetch was matched anywhere in its step's text,
# so a made-up approval written to reviews.json, with the fetch kept in a
# shell comment, left every case here green. The step just before the checker
# is the fetch, whole, in the default shell, with the job token and this pull
# request.
fetch='          gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate --slurp > reviews.json'
not_fetched='the reviews the API returns are not what the checker reads'
awk -v f="$fetch" '$0 == f { print "          cp tests/approve.json reviews.json #" substr(f, 11); next } { print }' "$WORKFLOW" > "$ctx_dir/commented-fetch.yml"
gate_case "a fetch in a shell comment beside a local approval is refused (repro)" "$ctx_dir/commented-fetch.yml" "$not_fetched"
awk -v f="$fetch" '{ print } $0 == f { print "          cp tests/approve.json reviews.json" }' "$WORKFLOW" > "$ctx_dir/overwritten.yml"
gate_case "a fetch whose output is then overwritten is refused" "$ctx_dir/overwritten.yml" "$not_fetched"
awk '/^      - name: The review must cover the head being merged$/ { print "      - run: cp tests/approve.json reviews.json" } { print }' "$WORKFLOW" > "$ctx_dir/between.yml"
gate_case "a step between the fetch and the checker is refused" "$ctx_dir/between.yml" "$not_fetched"
sed 's|REPO: ${{ github.repository }}|REPO: someone/else|' "$WORKFLOW" > "$ctx_dir/other-repo.yml"
gate_case "a fetch of another repository's reviews is refused" "$ctx_dir/other-repo.yml" "$not_fetched"
awk '{ print } /^          REPO: \$\{\{ github.repository \}\}$/ { print "        continue-on-error: true" }' "$WORKFLOW" > "$ctx_dir/fetch-ignored.yml"
gate_case "a fetch whose failure is ignored is refused" "$ctx_dir/fetch-ignored.yml" "$not_fetched"
pr_code_first="the pull request's code runs before the fetch that holds the job token"
awk '/^      - name: The reviews of record on this pull request$/ { print "      - run: node scripts/sensitive-surface.mjs" } { print }' "$WORKFLOW" > "$ctx_dir/pr-code-first.yml"
gate_case "a step running the pull request's code before the fetch is refused (repro)" "$ctx_dir/pr-code-first.yml" "$pr_code_first"
awk '/^      - name: The reviews of record on this pull request$/ { print "      - uses: ./.github/actions/local" } { print }' "$WORKFLOW" > "$ctx_dir/local-action-first.yml"
gate_case "a local action before the fetch is refused" "$ctx_dir/local-action-first.yml" "$pr_code_first"
awk '/^      - name: The reviews of record on this pull request$/ { print "      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0" } { print }' "$WORKFLOW" > "$ctx_dir/setup-first.yml"
gate_case "a setup action before the fetch is allowed" "$ctx_dir/setup-first.yml"
# The security review of 4d949e4: the case read `uses` alone, so a pnpm setup
# that installs, and so runs the pull request's scripts, passed before the fetch.
for install in 'true' '[{ args: [--frozen-lockfile] }]'; do
  awk -v i="$install" '/^      - name: The reviews of record on this pull request$/ { print "      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413\n        with:\n          run_install: " i } { print }' "$WORKFLOW" > "$ctx_dir/install-first.yml"
  gate_case "a pnpm setup that installs ($install) before the fetch is refused (repro)" "$ctx_dir/install-first.yml" "$pr_code_first"
done
awk '/^      - name: The reviews of record on this pull request$/ { print "      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413\n        with:\n          run_install: false" } { print }' "$WORKFLOW" > "$ctx_dir/no-install-first.yml"
gate_case "a pnpm setup that does not install before the fetch is allowed" "$ctx_dir/no-install-first.yml"

# The record of required contexts and the workflow that reports this one must
# agree, which `.github/required-contexts.json` says this file proves. The
# workflow is read with a YAML parser: a line pattern took malformed YAML, or a
# job name quoted inside a string, as a job.
CONTEXTS_CHECK="$REPO_ROOT/scripts/required-contexts-check.mjs"
MANIFEST="$REPO_ROOT/.github/required-contexts.json"
contexts_case() {
  local label="$1" expect="$2" manifest="$3" workflow="$4" actual
  actual="$(node "$CONTEXTS_CHECK" "$manifest" "$workflow" >/dev/null 2>&1; echo $?)"
  if [ "$actual" = "$expect" ]; then pass "$label"; else fail "$label" "expected exit $expect, got $actual"; fi
}
contexts_case "the recorded contexts include the one the workflow reports" 0 "$MANIFEST" "$WORKFLOW"
printf 'jobs: [\n    name: review evidence for this revision\n' > "$ctx_dir/malformed.yml"
contexts_case "malformed workflow YAML reports no context" 1 "$MANIFEST" "$ctx_dir/malformed.yml"
printf 'env:\n  NOTE: |\n    name: review evidence for this revision\njobs:\n  other:\n    name: something else\n    runs-on: ubuntu-latest\n' > "$ctx_dir/quoted.yml"
contexts_case "a job name inside a string is not a job" 1 "$MANIFEST" "$ctx_dir/quoted.yml"
sed 's/name: review evidence for this revision/name: review evidence, renamed/' "$WORKFLOW" > "$ctx_dir/renamed.yml"
contexts_case "a renamed job leaves the record behind" 1 "$MANIFEST" "$ctx_dir/renamed.yml"
node -e 'const m=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); m.requiredChecks=m.requiredChecks.filter((c)=>c!=="review evidence for this revision"); console.log(JSON.stringify(m))' "$MANIFEST" > "$ctx_dir/dropped.json"
contexts_case "a record missing the reported context refuses" 1 "$ctx_dir/dropped.json" "$WORKFLOW"
printf 'jobs:\n  a:\n    name: review evidence for this revision\n    runs-on: ubuntu-latest\n  b:\n    name: another context\n    runs-on: ubuntu-latest\n' > "$ctx_dir/two-jobs.yml"
contexts_case "a workflow with a second job is not the one-job workflow recorded" 1 "$MANIFEST" "$ctx_dir/two-jobs.yml"
# The security review of 65dbe59: GitHub counts a skipped job as a passing
# required check, so a job that can be skipped, or a workflow no review
# arrival starts, reports nothing worth requiring.
awk '{ print } /^    name: review evidence for this revision$/ { print "    if: false" }' "$WORKFLOW" > "$ctx_dir/skipped.yml"
contexts_case "a job that can be skipped reports no context" 1 "$MANIFEST" "$ctx_dir/skipped.yml"
sed 's/^  pull_request_review:$/  workflow_dispatch:/' "$WORKFLOW" > "$ctx_dir/dispatch.yml"
contexts_case "a workflow no review starts reports no context" 1 "$MANIFEST" "$ctx_dir/dispatch.yml"
sed 's/types: \[submitted, edited, dismissed\]/types: [submitted]/' "$WORKFLOW" > "$ctx_dir/submitted-only.yml"
contexts_case "a workflow a dismissal does not start reports no context" 1 "$MANIFEST" "$ctx_dir/submitted-only.yml"

echo
echo "review evidence cases: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
