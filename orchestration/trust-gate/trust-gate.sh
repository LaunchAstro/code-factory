#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# trust-gate.sh OWNER/REPO NUMBER
#
# The one way a round reads a PR's comments, reviews and review comments for
# a lane or for Sol. Prints them as JSON, keeping only text written (and only
# ever edited) by people inside: members of the orgs allow.json names, the
# users it names, and its bots on those orgs' repos. gate.jq says who is inside. Everything else is
# dropped and counted; the count goes to stderr and into the JSON.
#
# Fails closed. A gh error, an empty member list, a malformed allowlist or an
# answer that isn't whole all print a refusal with every list empty and exit
# 3, so a caller piping the output into jq gets no text at all.
#
# TRUST_GATE_ALLOW points at another allowlist. Set it yourself; never to a
# file in the repo under review, which the PR itself could change. For the
# same reason, run this from a checkout of main, never from the PR's worktree.
#
# Output: {comments, reviews, review_comments, kept, dropped}; each kept item
# has id, url, login and body, plus createdAt (comments), state and commit
# (reviews), or thread, resolved, path and line (review comments).
set -euo pipefail

usage() { echo "usage: trust-gate.sh OWNER/REPO NUMBER" >&2; exit 2; }
command -v jq >/dev/null || { echo "trust-gate.sh needs jq" >&2; exit 2; }
[ "$#" -eq 2 ] || usage
repo=$1 number=$2
[[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || usage
[[ $number =~ ^[1-9][0-9]*$ ]] || usage

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
allow=${TRUST_GATE_ALLOW:-$here/allow.json}
tmp=$(mktemp -d)
reason="trust-gate.sh stopped early"
finish() {
  local status=$?
  rm -rf "$tmp"
  if [ "$status" -ne 0 ]; then
    jq -nc --arg why "$reason" '{refused: $why, comments: [], reviews: [], review_comments: [], kept: 0, dropped: "all"}'
    echo "trust-gate: refused, dropped all: $reason" >&2
    exit 3
  fi
}
trap finish EXIT

# Exactly one document: jq -e answers for the last, gate.jq reads the first.
reason="the allowlist $allow is missing or malformed"
jq -e -s 'length == 1 and (.[0] | (.orgs | type) == "array" and (.orgs | length) > 0
  and all(.orgs[]; type == "string" and test("^[A-Za-z0-9-]+$"))
  and all(.users[], .bots[]; (.login | type) == "string" and (.id | type) == "number"))' "$allow" >/dev/null

# Members of each org, by id and login. An org's members API lists concealed
# members only to a member, so another token's list is short and those members'
# text is dropped, not passed.
for org in $(jq -r '.orgs[]' "$allow"); do
  reason="the member list of $org could not be read"
  gh api "orgs/$org/members?per_page=100" --paginate --slurp > "$tmp/members-$org.json"
  reason="the member list of $org came back empty or without ids"
  jq -e 'add // [] | length > 0 and all(.[]; (.login | type) == "string" and (.id | type) == "number")' \
    "$tmp/members-$org.json" >/dev/null
done
jq -s '[.[] | add[] | {login, id}]' "$tmp"/members-*.json > "$tmp/members.json"

actor='__typename login ... on User { databaseId } ... on Bot { databaseId }'
# 20 edits a comment: a longer history isn't read whole, so gate.jq drops it.
item="id url body lastEditedAt author { $actor } editor { $actor }
  userContentEdits(first: 20) { totalCount nodes { editor { $actor } } }"
page() {
  reason="the PR's $1 could not be read"
  gh api graphql --paginate --slurp -f owner="${repo%%/*}" -f name="${repo#*/}" -F number="$number" \
    -f query="query(\$owner: String!, \$name: String!, \$number: Int!, \$endCursor: String) {
      repository(owner: \$owner, name: \$name) { owner { login } pullRequest(number: \$number) {
        $1(first: $2, after: \$endCursor) { pageInfo { hasNextPage endCursor } nodes { $3 } } } } }" \
    > "$tmp/$1.json"
}
page comments 100 "$item createdAt"
page reviews 100 "$item state commit { oid }"
# 50 threads by 50 comments by 20 edits stays inside GitHub's node limit.
page reviewThreads 50 "id isResolved comments(first: 50) { totalCount nodes { $item path line } }"

reason="what GitHub returned could not be judged"
jq -n -f "$here/gate.jq" --slurpfile allow "$allow" --slurpfile members "$tmp/members.json" \
  --slurpfile comments "$tmp/comments.json" --slurpfile reviews "$tmp/reviews.json" \
  --slurpfile threads "$tmp/reviewThreads.json" > "$tmp/out.json"
jq -r '"trust-gate: kept \(.kept), dropped \(.dropped)"' "$tmp/out.json" >&2
cat "$tmp/out.json"
