#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only AND MIT
# Cases for orchestration/trust-gate/trust-gate.sh, against a stand-in gh that
# answers from fixtures/trust-gate. Every outside body carries MARKER-OUTSIDE;
# none may reach the output. No case reaches GitHub.
#
#   bash orchestration/tests/trust-gate-cases.sh
#
# The stand-in gh, and its check that the query asks for every field a fixture
# holds, are adapted from 37signals house-skills test/address-pr-reviews/run
# (commit 927adb4d9e617c1e21f366254f69da8184e479b6). That part is under this
# notice:
#
# MIT License
#
# Copyright (c) 2026 37signals LLC
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
set -uo pipefail

here=$(cd -- "$(dirname -- "$0")" && pwd)
gate=$here/../trust-gate/trust-gate.sh
fixtures=$here/fixtures/trust-gate
scratch=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$scratch"' EXIT
fails=0
ok() { printf '  PASS  %s\n' "$1"; }
no() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; fails=$((fails + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "got $2, want $3"; fi; }

mkdir "$scratch/bin"
# Answers the org member read and the three GraphQL reads; anything else is a
# read the gate shouldn't make. Each fixture is the pages gh returns with
# --paginate --slurp. Every key a fixture holds must be named in the query, so
# a fixture can't carry a field the real query never asks for. FX_FAIL names
# one read (members, comments, reviews, reviewThreads) or "all" to fail.
cat > "$scratch/bin/gh" <<'STUB'
#!/usr/bin/env bash
paginate='' slurp='' query=''
for arg in "$@"; do
  case "$arg" in
    --paginate) paginate=1 ;;
    --slurp) slurp=1 ;;
    query=*) query=${arg#query=} ;;
  esac
done
if [ "${1:-}" = api ] && [[ ${2:-} == orgs/test-org/members* ]]; then kind=members file=$FX/members.json
elif [ "${1:-} ${2:-}" = "api graphql" ]; then
  case "$query" in
    *"reviewThreads(first"*) kind=reviewThreads file=$FX/threads.json ;;
    *"reviews(first"*) kind=reviews file=$FX/reviews.json ;;
    *"comments(first"*) kind=comments file=$FX/comments.json ;;
    *) echo "stub gh: unknown query" >&2; exit 1 ;;
  esac
else echo "stub gh: not a read the gate makes: $*" >&2; exit 1
fi
echo "$kind" >> "$FX_CALLS"
case "${FX_FAIL:-}" in all | "$kind") echo "stub gh: simulated failure" >&2; exit 1 ;; esac
[ -n "$paginate" ] && [ -n "$slurp" ] || { echo "stub gh: $kind read without --paginate --slurp" >&2; exit 1; }
if [ "$kind" != members ]; then
  [[ $query == *'after: $endCursor'* ]] || { echo "stub gh: --paginate without \$endCursor" >&2; exit 1; }
  for key in $(jq -r '[.. | objects | keys[]] | unique[] | select(. != "data" and . != "errors" and . != "message")' "$file"); do
    grep -qw -- "$key" <<<"$query" || { echo "stub gh: the query doesn't ask for $key" >&2; exit 1; }
  done
fi
cat "$file"
STUB
chmod +x "$scratch/bin/gh"

# run [FIXTURE-DIR] [ENV=VALUE...]: the gate on PR 1 of $GATE_REPO (test-org/r). Leaves stdout in $out,
# stderr in $err, the exit status in $rc and the reads made in $calls.
run() {
  local fx=$fixtures
  if [ -n "${1:-}" ] && [ -d "$1" ]; then fx=$1; shift; fi
  : > "$scratch/calls"
  env PATH="$scratch/bin:$PATH" FX="$fx" FX_CALLS="$scratch/calls" TRUST_GATE_ALLOW="$fx/allow.json" "$@" \
    "$gate" "${GATE_REPO:-test-org/r}" 1 > "$scratch/out" 2> "$scratch/err"
  rc=$?
  out=$(cat "$scratch/out") err=$(cat "$scratch/err") calls=$(paste -sd, "$scratch/calls")
}
# variant NAME FILE JQ-FILTER: a copy of the fixtures with FILE changed by the filter.
variant() {
  mkdir -p "$scratch/$1"; cp "$fixtures"/*.json "$scratch/$1/"
  jq "$3" "$fixtures/$2" > "$scratch/$1/$2"
  echo "$scratch/$1"
}
# refused NAME WHY: the run refused for WHY, and nothing it read reached stdout.
refused() {
  check "$1: exits 3" "$rc" 3
  check "$1: refusal says why" "$(jq -r --arg why "$2" '.refused | contains($why)' <<<"$out")" true
  check "$1: no text kept" "$(jq -c '[.comments, .reviews, .review_comments] | map(length)' <<<"$out")" '[0,0,0]'
  check "$1: no text read reaches stdout" "$(grep -cE 'MARKER-OUTSIDE|member comment|listed bot' <<<"$out")" 0
  check "$1: stderr says all were dropped" "$(grep -c 'refused, dropped all' <<<"$err")" 1
}

echo "a PR with inside and outside text"
run
check "exits 0" "$rc" 0
check "no outside text reaches stdout" "$(grep -c MARKER-OUTSIDE <<<"$out")" 0
check "members, the listed user and the listed bot are kept; members' comments edited by members too" \
  "$(jq -c '[.comments[].id]' <<<"$out")" '["c1","c3","c4","c12","c14","c17"]'
check "a member's and the listed bot's reviews are kept" "$(jq -c '[.reviews[].id]' <<<"$out")" '["r1","r4"]'
check "members' review comments are kept, resolved threads included" \
  "$(jq -c '[.review_comments[].id]' <<<"$out")" '["tc1","tc3"]'
check "the dropped count covers outside items and review comments past what was read" \
  "$(jq -c '[.kept, .dropped]' <<<"$out")" '[10,18]'
check "stderr prints the dropped count" "$(grep -c 'trust-gate: kept 10, dropped 18' <<<"$err")" 1
check "a kept comment carries its url, login and body" \
  "$(jq -c '.comments[0] | [.url, .login, .body]' <<<"$out")" '["https://x/c1","member-a","member comment c1"]'
check "a kept review carries its state and commit" "$(jq -c '.reviews[0] | [.state, .commit]' <<<"$out")" '["APPROVED","abc"]'
check "a kept review comment carries its thread, path and line" \
  "$(jq -c '.review_comments[0] | [.thread, .path, .line, .resolved]' <<<"$out")" '["t1","a.js",3,false]'
check "Unicode tag characters are stripped" "$(jq -r '.comments[] | select(.id == "c14") | .body' <<<"$out")" tagshere
check "reads only the org's members and the PR's three connections" "$calls" members,comments,reviews,reviewThreads

# owned NAME OWNER...: a copy of the fixtures whose comments, reviews and threads
# pages GitHub reports as owned by each OWNER in turn ("null" for none).
owned() {
  local dir; dir=$(variant "$1" allow.json .); shift
  for f in comments reviews threads; do
    jq --argjson o "$1" '[.[] | .data.repository.owner = (if $o == null then null else {login: $o} end)]' \
      "$fixtures/$f.json" > "$dir/$f.json"
    [ "$#" -gt 1 ] && shift
  done
  echo "$dir"
}
bots_dropped() {
  check "$1: members' text is still kept" "$(jq -c '[.comments[].id]' <<<"$out")" '["c1","c3","c12","c14","c17"]'
  check "$1: a listed bot's comment and review are dropped" "$(jq -c '[.reviews[].id], .dropped' <<<"$out" | paste -sd' ' -)" '["r1"] 20'
}
echo "another org's repo"
run "$(owned other-org '"other-org"')"; bots_dropped "GitHub reports another owner"
GATE_REPO=other-org/r run "$(owned redirected '"other-org"')"; bots_dropped "asked for another org's path"
# GitHub follows renames and transfers: an old test-org path can answer for a repo another org now owns.
run "$(owned transferred '"outside-org"')"; bots_dropped "an old org path that now answers for an outside repo"
run "$(owned mixed '"test-org"' '"outside-org"' '"test-org"')"; bots_dropped "pages that disagree on the owner"
run "$(owned no-owner null)"; bots_dropped "no owner in the answer"

echo "gh fails"
run FX_FAIL=all; refused "every read fails" "member list of test-org could not be read"
run FX_FAIL=reviewThreads; refused "the last read fails after the others passed" "reviewThreads could not be read"
run FX_FAIL=members; refused "the member read fails" "member list of test-org could not be read"
check "the member read failing stops before any PR text is read" "$calls" members

echo "membership"
run "$(variant empty-members members.json '[[]]')"; refused "an empty member answer" "came back empty or without ids"
run "$(variant odd-members members.json '[[{login: "member-a"}]]')"; refused "a member answer without ids" "came back empty or without ids"

echo "what came back"
run "$(variant null-pr comments.json '.[0].data.repository.pullRequest = null')"; refused "a PR GitHub didn't return" "could not be judged"
run "$(variant gql-errors reviews.json '.[0].errors = [{message: "partial"}]')"; refused "a page carrying GraphQL errors" "could not be judged"
run "$(variant no-pages threads.json '[]')"; refused "no pages at all" "could not be judged"

echo "allowlist"
run "$(variant bad-allow allow.json '.bots[0].id = "3001"')"; refused "an allowlist with a bot id that isn't a number" "missing or malformed"
run "$(variant no-orgs allow.json '.orgs = []')"; refused "an allowlist naming no org" "missing or malformed"
run TRUST_GATE_ALLOW="$scratch/missing.json"; refused "a missing allowlist" "missing or malformed"
mkdir -p "$scratch/two-docs"; cp "$fixtures"/*.json "$scratch/two-docs/"
{ jq -c '.orgs = [] | .users = [{login: "outsider", id: 9001}]' "$fixtures/allow.json"; cat "$fixtures/allow.json"; } > "$scratch/two-docs/allow.json"
run "$scratch/two-docs"; refused "an allowlist of two documents, a bad one first" "missing or malformed"

echo "usage"
run_usage() { env PATH="$scratch/bin:$PATH" FX="$fixtures" FX_CALLS="$scratch/calls" "$gate" "$@" > "$scratch/out" 2>/dev/null; rc=$?; out=$(cat "$scratch/out"); }
run_usage 'o/r;x' 1; check "a repo with odd characters: exits 2" "$rc" 2; check "  and prints nothing" "$out" ""
run_usage o/r 1a; check "a PR number that isn't one: exits 2" "$rc" 2; check "  and prints nothing" "$out" ""

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
