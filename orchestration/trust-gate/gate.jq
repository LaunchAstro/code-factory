# SPDX-License-Identifier: AGPL-3.0-only AND MIT
# Judges a PR's comments, reviews and review comments for trust-gate.sh. An
# item is kept only when its author and everyone who ever edited it are
# inside; everything else is dropped and counted, never passed on.
#
# Inside means: a User whose id and login are on the member list of an org the
# allowlist names, a User the allowlist names by id and login, or a Bot the
# allowlist names by id, on a repo one of those orgs owns. A User can't be
# typed Bot, so a bot is matched on type and id; its login differs between REST
# and GraphQL and is only a label. On anyone else's repo a listed bot posts what
# that repo's workflows and apps write, so there it is outside. The owner is
# the one GitHub reports in every page of the answer, never the path asked
# for: repository() follows renames and transfers, so an old org path can
# answer for a repo another org now owns.
# Anyone else is outside: an outside collaborator, a contributor, a deleted
# account (author or editor null), a mannequin, a bot off the list.
#
# Edits: anyone with write access can edit a comment, so a member's comment can
# carry an outsider's text. Every editor in the edit history must be inside, the
# history must have been read whole (totalCount equal to what came back), and
# an edit with no editor (a deleted account) drops the item.
#
# Adapted from 37signals house-skills,
# plugins/dev/skills/address-pr-reviews/scripts/gate.jq
# (commit 927adb4d9e617c1e21f366254f69da8184e479b6): the inside test by type
# and id, the Unicode tag strip, and the item shape. Those parts are under
# this notice:
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

def allow: $allow[0];
def our_repo: [$comments[0][], $reviews[0][], $threads[0][] | .data.repository.owner.login] | unique
  | length == 1 and (.[0] | type) == "string" and (.[0] | ascii_downcase) as $o | any(allow.orgs[]; ascii_downcase == $o);
def same_login($a): (.login | ascii_downcase) == ($a.login | ascii_downcase);
def named_user($a): any(allow.users[], $members[0][]; .id == $a.databaseId and same_login($a));
def inside($a): ($a | type) == "object" and ($a.databaseId | type) == "number" and ($a.login | type) == "string"
  and (if $a.__typename == "User" then named_user($a)
    elif $a.__typename == "Bot" then our_repo and any(allow.bots[]; .id == $a.databaseId)
    else false end);
def edits_inside: (.userContentEdits.totalCount | type) == "number"
  and .userContentEdits.totalCount == (.userContentEdits.nodes | length)
  and all(.userContentEdits.nodes[]; inside(.editor))
  and ((.lastEditedAt == null and .editor == null) or inside(.editor));
def trusted: inside(.author) and edits_inside;

# Unicode tag characters (U+E0000-U+E007F) render as nothing on GitHub, so a
# member who pastes them from an outsider's text can't see what they pass on.
def keep: {id, url, login: .author.login, body: ((.body // "") | gsub("[\\x{E0000}-\\x{E007F}]+"; ""))};

# Every page must be a whole answer for this PR: no GraphQL errors, the PR
# there, and the connection's nodes an array. Anything else refuses the read.
def nodes($pages; $conn):
  if ($pages | type) != "array" or ($pages | length) == 0
    or any($pages[]; has("errors") or (.data.repository.pullRequest[$conn].nodes | type) != "array")
  then error("the \($conn) read came back incomplete or with errors")
  else [$pages[].data.repository.pullRequest[$conn].nodes[]] end;

nodes($comments[0]; "comments") as $c
| nodes($reviews[0]; "reviews") as $r
| nodes($threads[0]; "reviewThreads") as $t
| [$t[] | . as $thread | .comments.nodes[] | . + {thread: $thread.id, resolved: $thread.isResolved}] as $rc
# Review comments a thread holds past what was read are never seen, so they
# count as dropped.
| ([$t[] | (.comments.totalCount // 0) - (.comments.nodes | length) | select(. > 0)] | add // 0) as $unseen
| {
    comments: [$c[] | select(trusted) | keep + {createdAt}],
    reviews: [$r[] | select(trusted) | keep + {state, commit: .commit.oid}],
    review_comments: [$rc[] | select(trusted) | keep + {thread, resolved, path, line}]
  }
| .kept = (.comments + .reviews + .review_comments | length)
| .dropped = ($c + $r + $rc | length) - .kept + $unseen
