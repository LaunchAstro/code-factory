#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Negative tests for the contamination gate.
#
# Each case builds a throwaway git repository in a temporary directory, drops
# the gate in, and asserts the gate catches something it must catch. These
# are the cases the sweep of 6 September proved the first version missed, so
# they stay here as regression tests: if any of them stops failing the way it
# should, the gate has lost coverage again.
#
# Usage:  tests/gate/gate-cases.sh [path-to-gate-dir]
# Default gate dir is scripts/gate beside this repository.
#
# Exit 0 when every case passes, 1 when any case fails.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE_DIR="${1:-$REPO_ROOT/scripts/gate}"
GATE_DIR="$(cd "$GATE_DIR" && pwd)"

PASSED=0
FAILED=0

pass() { printf '  PASS  %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '  FAIL  %s\n' "$1"; printf '        %s\n' "$2"; FAILED=$((FAILED + 1)); }

# A throwaway repository with the gate installed. Never the real one.
new_repo() {
  local dir="${1:-$(mktemp -d)}"
  mkdir -p "$dir/scripts/gate" "$dir/tests/gate"
  cp "$GATE_DIR"/* "$dir/scripts/gate/" 2>/dev/null
  cp "$REPO_ROOT/tests/gate/canary.txt" "$dir/tests/gate/" 2>/dev/null
  cp "$REPO_ROOT/tests/gate/shape-canary.txt" "$dir/tests/gate/" 2>/dev/null
  git -C "$dir" init -q -b main
  git -C "$dir" config user.name "Gate Test"
  git -C "$dir" config user.email "gate-test@example.invalid"
  git -C "$dir" config commit.gpgsign false
  echo "$dir"
}

run_gate() {
  local dir="$1"; shift
  ( cd "$dir" && python3 scripts/gate/sweep.py "$@" 2>&1 )
}

gate_status() {
  local dir="$1"; shift
  ( cd "$dir" && python3 scripts/gate/sweep.py "$@" >/dev/null 2>&1; echo $? )
}

# The canary term, read from the fixture rather than typed here, so this file
# never becomes a second place a denied term lives.
CANARY="$(grep -oE '[Kk]wathorne [A-Za-z]+ [A-Za-z]+' "$REPO_ROOT/tests/gate/canary.txt" | head -1)"
if [ -z "$CANARY" ]; then
  echo "harness: cannot read the canary term from tests/gate/canary.txt" >&2
  exit 1
fi

echo "gate cases, against $GATE_DIR"
echo

# ---------------------------------------------------------------------------
echo "A. a contaminated blob that is staged but not in the working tree"
# Stage the bad content, then clean the working copy without staging the
# cleanup. A scanner that reads the working tree sees nothing.
dir="$(new_repo)"
printf 'harmless first commit\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
printf 'a note about %s\n' "$CANARY" > "$dir/notes.txt"
git -C "$dir" add notes.txt >/dev/null
printf 'a note about nothing at all\n' > "$dir/notes.txt"
status="$(gate_status "$dir" --staged)"
if [ "$status" = "1" ]; then
  pass "staged blob contents are scanned (exit 1)"
else
  fail "staged blob contents are scanned" "expected exit 1, got $status; the scanner read the working tree, not the index"
fi
rm -rf "$dir"

# ---------------------------------------------------------------------------
echo "B. a contaminated file added and then deleted in history"
dir="$(new_repo)"
printf 'harmless first commit\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
printf 'a note about %s\n' "$CANARY" > "$dir/leak.txt"
git -C "$dir" add leak.txt >/dev/null && git -C "$dir" commit -qm "add"
git -C "$dir" rm -q leak.txt && git -C "$dir" commit -qm "delete"
status="$(gate_status "$dir" --range)"
if [ "$status" = "1" ]; then
  pass "the outgoing commit range is scanned, deletions included (exit 1)"
else
  fail "the outgoing commit range is scanned" "expected exit 1, got $status; the deleted blob survives in history unchecked"
fi
# and prove the working-tree sweep alone does not see it, which is the point
tree_status="$(gate_status "$dir")"
if [ "$tree_status" = "0" ]; then
  pass "the working-tree sweep alone reports clean, which is why B is needed"
else
  fail "the working-tree sweep alone reports clean" "expected exit 0, got $tree_status"
fi
rm -rf "$dir"

# ---------------------------------------------------------------------------
echo "C. a denied path inside a directory the content scan excludes"
dir="$(new_repo)"
printf 'harmless first commit\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
printf 'SECRET_KEY=notreal\n' > "$dir/tests/gate/.env"
git -C "$dir" add -f tests/gate/.env >/dev/null
status="$(gate_status "$dir" --staged)"
if [ "$status" = "1" ]; then
  pass "path checks run before content exclusions (exit 1)"
else
  fail "path checks run before content exclusions" "expected exit 1, got $status; the excluded directory hid a denied path"
fi
rm -rf "$dir"

# ---------------------------------------------------------------------------
echo "D. a file the scanner cannot read"
dir="$(new_repo)"
printf 'harmless first commit\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
printf 'text \000 with a null byte and no declared reason\n' > "$dir/opaque.dat"
git -C "$dir" add opaque.dat >/dev/null
status="$(gate_status "$dir" --staged)"
if [ "$status" = "1" ]; then
  pass "unreadable or binary content fails closed (exit 1)"
else
  fail "unreadable or binary content fails closed" "expected exit 1, got $status; the scanner skipped what it could not read"
fi
rm -rf "$dir"

# ---------------------------------------------------------------------------
echo "E. a four-word denied phrase"
dir="$(new_repo)"
printf 'harmless first commit\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
FOUR="$(grep -oE '[Kk]wathorne [A-Za-z]+ [A-Za-z]+ [A-Za-z]+' "$REPO_ROOT/tests/gate/canary.txt" | head -1)"
if [ -z "$FOUR" ]; then
  fail "a four-word phrase can match" "no four-word canary in tests/gate/canary.txt to test with"
else
  printf 'a note about %s\n' "$FOUR" > "$dir/four.txt"
  git -C "$dir" add four.txt >/dev/null
  # The canary's shorter phrases are denied too, so exit 1 alone proves
  # nothing about four words. The four-word phrase's own fingerprint must be
  # among the findings.
  four_norm="$(printf '%s' "$FOUR" | tr '[:upper:]' '[:lower:]')"
  four_print="$(printf '%s' "$four_norm" | shasum -a 256 | cut -c1-8)/${#four_norm}"
  out="$(run_gate "$dir" --staged)"
  status="$(gate_status "$dir" --staged)"
  if [ "$status" = "1" ] && printf '%s' "$out" | grep -qF "$four_print"; then
    pass "a four-word denied phrase matches as four words (exit 1, its fingerprint)"
  else
    fail "a four-word denied phrase matches" "expected exit 1 with fingerprint $four_print, got $status; the phrase cap is below four words"
  fi
fi
rm -rf "$dir"

# ---------------------------------------------------------------------------
echo "F. the shape rules fire on synthetic personal and machine data"
dir="$(new_repo)"
printf 'harmless first commit\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
if [ -f "$REPO_ROOT/tests/gate/shape-canary.txt" ]; then
  cp "$REPO_ROOT/tests/gate/shape-canary.txt" "$dir/copied-shapes.txt"
  git -C "$dir" add copied-shapes.txt >/dev/null
  status="$(gate_status "$dir" --staged)"
  if [ "$status" = "1" ]; then
    pass "shape rules fire outside the fixture (exit 1)"
  else
    fail "shape rules fire outside the fixture" "expected exit 1, got $status; the promised shape rules are absent"
  fi
else
  fail "shape rules fire outside the fixture" "tests/gate/shape-canary.txt does not exist"
fi
rm -rf "$dir"

# ---------------------------------------------------------------------------
echo "G. the self-test proves the gate, and exit 2 means the private list is absent"
dir="$(new_repo)"
printf 'harmless first commit\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
status="$(gate_status "$dir" --self-test)"
if [ "$status" = "0" ]; then
  pass "the self-test passes on an intact gate (exit 0)"
else
  fail "the self-test passes on an intact gate" "expected exit 0, got $status"
fi
status="$( cd "$dir" && HUB_GATE_TERMS=/nowhere/at/all.txt python3 scripts/gate/sweep.py --literal >/dev/null 2>&1; echo $? )"
if [ "$status" = "2" ]; then
  pass "a missing private list is exit 2, never a clean pass"
else
  fail "a missing private list is exit 2" "expected exit 2, got $status"
fi
rm -rf "$dir"

# ---------------------------------------------------------------------------
# Round four, 7 September. Four ways past the gate that the pass two version
# did not close. Every one of these is a negative test: it must fail, and it
# must keep failing.

echo "H. contamination appended inside an exempt file"
# The content exclusions name four files whose whole job is to contain the
# thing the gate looks for. Exempting the path exempts whatever anyone later
# puts in it. The exemption has to be of the approved bytes, not the name.
dir="$(new_repo)"
printf 'harmless first commit\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
printf '\nAppended later: a note about %s\n' "$CANARY" >> "$dir/tests/gate/canary.txt"
git -C "$dir" add -f tests/gate/canary.txt >/dev/null
status="$(gate_status "$dir" --staged)"
if [ "$status" = "1" ]; then
  pass "an exempt file with changed contents is scanned (exit 1)"
else
  fail "an exempt file with changed contents is scanned" "expected exit 1, got $status; the exemption is by path, so anything can hide in that file"
fi
rm -rf "$dir"

echo "I. contamination force-added under a path the scanner skips"
dir="$(new_repo)"
printf 'harmless first commit\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
mkdir -p "$dir/node_modules/evil"
printf 'a note about %s\n' "$CANARY" > "$dir/node_modules/evil/notes.txt"
git -C "$dir" add -f node_modules/evil/notes.txt >/dev/null
status="$(gate_status "$dir" --staged)"
if [ "$status" = "1" ]; then
  pass "a force-added file under a skipped prefix is scanned (exit 1)"
else
  fail "a force-added file under a skipped prefix is scanned" "expected exit 1, got $status; deliberately committing under node_modules/ bypassed the content scan"
fi
rm -rf "$dir"

echo "J. contamination introduced only by a merge resolution"
# A value that exists on neither parent, created while resolving a conflict.
# `git diff-tree` prints nothing for a merge commit unless it is asked to
# traverse each parent, so this content is in the published history and in no
# diff the range scanner ever reads.
#
# Note which case this is. If an ordinary commit later touches that file, the
# pre-image side of *that* commit carries the bytes and the scanner already
# catches it. The hole is content introduced by a merge and left alone.
dir="$(new_repo)"
printf 'base\n' > "$dir/shared.txt"
git -C "$dir" add shared.txt >/dev/null && git -C "$dir" commit -qm "seed"
git -C "$dir" switch -q -c side
printf 'side\n' > "$dir/shared.txt"
git -C "$dir" commit -qam "feat: side"
git -C "$dir" switch -q main
printf 'main\n' > "$dir/shared.txt"
git -C "$dir" commit -qam "feat: main"
git -C "$dir" merge side -q >/dev/null 2>&1
# Resolve with content that is on neither parent.
printf 'resolved with a note about %s\n' "$CANARY" > "$dir/shared.txt"
git -C "$dir" add shared.txt >/dev/null
git -C "$dir" commit -q --no-edit
status="$(gate_status "$dir" --range)"
if [ "$status" = "1" ]; then
  pass "merge-only content is scanned (exit 1)"
else
  fail "merge-only content is scanned" "expected exit 1, got $status; a value created while resolving a merge appears in no diff the range scanner reads"
fi
rm -rf "$dir"

echo "K. gitleaks exclusions are anchored"
# The allowlist entries are regexes matched against the whole path. An
# unanchored LICENSE also matches src/LICENSE-private-config.json, which is a
# perfectly good place to hide a credential.
unanchored="$(
  awk '/^paths = \[/{inside=1; next} inside && /^\]/{inside=0} inside' "$REPO_ROOT/.gitleaks.toml" \
    | tr -d "'" \
    | sed -E 's/^[[:space:]]*//; s/,[[:space:]]*$//' \
    | grep -v '^[[:space:]]*$' \
    | grep -vE '^\^.*\$$' || true
)"
if [ -z "$unanchored" ]; then
  pass "every gitleaks path exclusion is anchored"
else
  fail "every gitleaks path exclusion is anchored" "unanchored: $(printf '%s' "$unanchored" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# Sol's CF-02 review, 3 October. Each case below is a way the gate passed
# without the evidence it claims, or printed what it promises to withhold.

expect_status() {
  local label="$1" want="$2" got="$3" why="$4"
  if [ "$got" = "$want" ]; then
    pass "$label (exit $want)"
  else
    fail "$label" "expected exit $want, got $got; $why"
  fi
}

seeded_repo() {
  local dir
  dir="$(new_repo)"
  printf 'harmless first commit\n' > "$dir/seed.txt"
  git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
  echo "$dir"
}

echo "L. an empty scan set is absent evidence, never a clean pass"
dir="$(new_repo)"
expect_status "nothing staged refuses" 3 "$(gate_status "$dir" --staged)" "an empty index was certified clean"
mv "$dir/tests" "$dir/.tests-aside"
expect_status "no tracked files refuses" 3 "$(gate_status "$dir")" "an empty tracked set was certified clean"
mv "$dir/.tests-aside" "$dir/tests"
printf 'harmless\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt >/dev/null && git -C "$dir" commit -qm "seed"
head="$(git -C "$dir" rev-parse HEAD)"
expect_status "an empty explicit range refuses" 3 "$(gate_status "$dir" --range "$head..$head")" "a range with no commits was certified clean"
mkdir "$dir/.empty-dir"
expect_status "an empty directory refuses" 3 "$(gate_status "$dir" --path "$dir/.empty-dir")" "a directory with no files was certified clean"
printf 'synthetic forbidden value\n' > "$dir/.private-terms"
expect_status "an empty literal range refuses" 3 \
  "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal "$head..$head" >/dev/null 2>&1; echo $? )" \
  "a literal sweep of no commits was certified clean"
git -C "$dir" rm -q seed.txt
expect_status "a deletion-only commit is still scanned evidence" 0 "$(gate_status "$dir" --staged)" "a staged deletion publishes nothing new"
rm -rf "$dir"

echo "M. an empty path denylist is a broken gate"
dir="$(seeded_repo)"
printf '# empty policy\n' > "$dir/scripts/gate/path-denylist.txt"
expect_status "the self-test fails with no path rules" 3 "$(gate_status "$dir" --self-test)" "an empty path policy passed the self-test"
printf 'harmless\n' > "$dir/.env"
git -C "$dir" add .env >/dev/null
expect_status "a staged .env is refused with no path rules" 3 "$(gate_status "$dir" --staged)" "an empty path policy let a denied path through"
rm -rf "$dir"

echo "N. a private list with no searchable term"
dir="$(seeded_repo)"
printf -- '---\n...\n' > "$dir/.private-terms"
expect_status "a punctuation-only private list refuses" 3 \
  "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal HEAD >/dev/null 2>&1; echo $? )" \
  "a list that normalises to nothing reported a clean sweep"
rm -rf "$dir"

echo "O. a shallow checkout is not the whole history"
dir="$(seeded_repo)"
printf 'a note about %s\n' "$CANARY" > "$dir/leak.txt"
git -C "$dir" add leak.txt >/dev/null && git -C "$dir" commit -qm "add"
git -C "$dir" rm -q leak.txt && git -C "$dir" commit -qm "delete"
shallow="$(mktemp -d)/shallow"
git clone -q --depth=1 "file://$dir" "$shallow"
cp -R "$dir/scripts" "$dir/tests" "$shallow/"
expect_status "a shallow history refuses a range scan" 3 "$(gate_status "$shallow" --range HEAD)" "commits past the shallow boundary went unscanned"
rm -rf "$dir" "$(dirname "$shallow")"

echo "P. a binary allowlist entry does not approve missing bytes"
dir="$(seeded_repo)"
printf '\000\377' > "$dir/opaque.dat"
git -C "$dir" add opaque.dat >/dev/null
printf 'opaque.dat\n' > "$dir/scripts/gate/binary-allowlist.txt"
rm "$dir/opaque.dat"
expect_status "an allowlisted file the gate cannot read fails" 1 "$(gate_status "$dir")" "an unread file passed because its name is on the binary allowlist"
rm -rf "$dir"

echo "Q. a replacement ref cannot hide a published commit"
dir="$(seeded_repo)"
printf 'a note about %s\n' "$CANARY" > "$dir/seed.txt"
git -C "$dir" commit -qam "contaminated"
bad="$(git -C "$dir" rev-parse HEAD)"
printf 'harmless\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt
clean="$(git -C "$dir" commit-tree "$(git -C "$dir" write-tree)" -m "replacement")"
git -C "$dir" replace "$bad" "$clean"
expect_status "the original bytes are scanned through a replacement" 1 "$(gate_status "$dir" --range "$bad")" "a replacement object stood in for what the push publishes"
rm -rf "$dir"

echo "R. a revision cannot carry a rev-list option"
dir="$(seeded_repo)"
expect_status "an option-shaped revision refuses" 3 "$(gate_status "$dir" --range -- --max-count=1 HEAD)" "a revision limited what the scan read"
rm -rf "$dir"

echo "S. commit messages are published, so they are scanned"
dir="$(seeded_repo)"
printf 'more\n' >> "$dir/seed.txt"
git -C "$dir" commit -qam "a note about $CANARY"
expect_status "a denied term in a commit message is caught" 1 "$(gate_status "$dir" --range HEAD)" "the message went out unscanned"
rm -rf "$dir"

echo "T. the literal sweep reads identities, messages and paths"
dir="$(seeded_repo)"
printf 'synthetic private identity sentinel\n' > "$dir/.private-terms"
printf 'more\n' >> "$dir/seed.txt"
git -C "$dir" add seed.txt
GIT_AUTHOR_NAME='synthetic private identity sentinel' git -C "$dir" commit -qm "change"
expect_status "a private term in an author name is caught" 1 \
  "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal HEAD^..HEAD >/dev/null 2>&1; echo $? )" \
  "the literal sweep never read the author"
printf 'harmless\n' > "$dir/synthetic-private-identity-sentinel.txt"
git -C "$dir" add synthetic-private-identity-sentinel.txt && git -C "$dir" commit -qm "plain"
expect_status "a private term in a published path is caught" 1 \
  "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal HEAD^..HEAD >/dev/null 2>&1; echo $? )" \
  "the literal sweep never read the path"
# Sol CF-02-FIX1: the message and the committer each count on their own.
git -C "$dir" commit -q --allow-empty -m "a note about synthetic private identity sentinel"
expect_status "a private term in a commit message is caught by --literal" 1 \
  "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal HEAD^..HEAD >/dev/null 2>&1; echo $? )" \
  "the literal sweep never read the message"
GIT_COMMITTER_NAME='synthetic private identity sentinel' git -C "$dir" commit -q --allow-empty -m "plain"
expect_status "a private term in the committer alone is caught by --literal" 1 \
  "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal HEAD^..HEAD >/dev/null 2>&1; echo $? )" \
  "the literal sweep never read the committer"
rm -rf "$dir"

echo "U. client-data is denied at the root as well"
dir="$(seeded_repo)"
mkdir -p "$dir/client-data"
printf 'synthetic\n' > "$dir/client-data/records.txt"
git -C "$dir" add client-data/records.txt >/dev/null
expect_status "a root client-data directory is refused" 1 "$(gate_status "$dir" --staged)" "the glob only matched below the root"
rm -rf "$dir"

echo "V. a denied term in a path is caught by the hashed scan"
dir="$(seeded_repo)"
printf 'harmless\n' > "$dir/$CANARY.txt"
git -C "$dir" add "$CANARY.txt" >/dev/null && git -C "$dir" commit -qm "plain"
expect_status "a denied term in a published filename is caught" 1 "$(gate_status "$dir" --range HEAD^..HEAD)" "paths only met the glob rules"
rm -rf "$dir"

echo "W. path mode reads a directory symlink's target"
dir="$(seeded_repo)"
scan="$(mktemp -d)"
printf 'harmless\n' > "$scan/clean.txt"
target="$(mktemp -d)/$CANARY-target"
mkdir -p "$target"
printf 'harmless\n' > "$target/ordinary.txt"
ln -s "$target" "$scan/directory-link"
expect_status "a directory link with a denied target is caught" 1 "$(gate_status "$dir" --path "$scan")" "os.walk listed the link as a directory and nobody read it"
# Sol's CF-02-FIX3: the root itself is a link too, read as the blob git stores.
expect_status "a directory link given as the root is read as its link" 1 "$(gate_status "$dir" --path "$scan/directory-link")" "the root link was followed to harmless files"
rm -rf "$dir" "$scan" "$(dirname "$target")"

echo "X. the index cannot change between listing and reading"
dir="$(seeded_repo)"
printf 'harmless\n' >> "$dir/seed.txt"
git -C "$dir" add seed.txt
printf 'synthetic\n' > "$dir/.env"
shim="$(mktemp -d)"
cat > "$shim/git" <<SHIM
#!/bin/sh
"$(command -v git)" "\$@"
code=\$?
if [ "\$1" = diff ] && [ "\$2" = --cached ]; then "$(command -v git)" add .env >/dev/null 2>&1; fi
exit \$code
SHIM
chmod +x "$shim/git"
expect_status "an index change during the scan refuses" 3 \
  "$( cd "$dir" && PATH="$shim:$PATH" python3 scripts/gate/sweep.py --staged >/dev/null 2>&1; echo $? )" \
  "the gate certified a path list the index no longer held"
rm -rf "$dir" "$shim"

echo "Y. withheld means withheld: paths, policy lines and CI"
TOKEN="eyJ$(printf 'S%.0s' $(seq 24)).$(printf 'T%.0s' $(seq 24))"
dir="$(seeded_repo)"
printf 'harmless\n' > "$dir/$TOKEN.pem"
git -C "$dir" add "$TOKEN.pem" >/dev/null
out="$(run_gate "$dir" --staged)"
if printf '%s' "$out" | grep -qF "$TOKEN"; then
  fail "a credential in a filename is withheld" "the path was printed verbatim"
else
  pass "a credential in a filename is withheld"
fi
git -C "$dir" rm -q --cached "$TOKEN.pem"
printf '%s\n' "$TOKEN" > "$dir/seed.txt"
git -C "$dir" add seed.txt
out="$( cd "$dir" && CI=true python3 scripts/gate/sweep.py --staged --reveal 2>&1; echo "exit=$?" )"
if printf '%s' "$out" | grep -qF "$TOKEN" || ! printf '%s' "$out" | grep -q 'exit=3'; then
  fail "--reveal is refused in CI" "the matched text reached CI output, or --reveal was accepted"
else
  pass "--reveal is refused in CI (exit 3)"
fi
printf '%s\n' "$TOKEN" > "$dir/scripts/gate/denylist.sha256"
out="$(run_gate "$dir" --self-test)"
if printf '%s' "$out" | grep -qF "$TOKEN"; then
  fail "a malformed policy line is not echoed" "the raw line reached stderr"
else
  pass "a malformed policy line is not echoed"
fi
rm -rf "$dir"

echo "Z. the self-test runs the real missing-list branch"
dir="$(seeded_repo)"
python3 - "$dir/scripts/gate/sweep.py" <<'MUTATE'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
old = "        return 2\n    terms = [\n"
assert s.count(old) == 1, "the missing-list branch moved; update this case"
p.write_text(s.replace(old, "        return 0\n    terms = [\n"))
MUTATE
expect_status "a self-test over a broken missing-list branch fails" 1 "$(gate_status "$dir" --self-test)" "the self-test checked a helper, not the branch"
rm -rf "$dir"

echo "AA. approving a fixture once keeps both checkers in step"
dir="$(seeded_repo)"
cp "$REPO_ROOT/scripts/public-content-check.mjs" "$REPO_ROOT/scripts/candidate-snapshot.mjs" "$REPO_ROOT/scripts/main-module.mjs" "$dir/scripts/"
printf '\nSynthetic fixture maintenance.\n' >> "$dir/tests/gate/shape-canary.txt"
printf '%s  tests/gate/shape-canary.txt\n' "$(shasum -a 256 "$dir/tests/gate/shape-canary.txt" | cut -d' ' -f1)" >> "$dir/scripts/gate/approved-exemptions.sha256"
git -C "$dir" add tests/gate/shape-canary.txt scripts/gate/approved-exemptions.sha256 >/dev/null
git -C "$dir" commit -qm "approved fixture maintenance"
expect_status "the gate accepts the approved fixture" 0 "$(gate_status "$dir" --range HEAD^..HEAD)" "the documented approval did not take"
expect_status "the public-content check accepts it too" 0 \
  "$( cd "$dir" && node scripts/public-content-check.mjs --repo "$dir" --range HEAD^..HEAD >/dev/null 2>&1; echo $? )" \
  "a second copy of the digest disagreed with the manifest"
rm -rf "$dir"

echo "AB. a commit that stages nothing new: the index matches HEAD"
# Security review of 045c22b: an amend that only rewords the message, an empty
# commit and a merge resolved to ours publish no new blob, and the message is
# scanned at pre-push. An index identical to HEAD's tree is evidence; an empty
# index with no HEAD is not (case L).
dir="$(seeded_repo)"
expect_status "an index identical to HEAD passes" 0 "$(gate_status "$dir" --staged)" "a message-only amend was refused"
rm -rf "$dir"

echo "AC. a path holding a private term is withheld by every sweep"
dir="$(seeded_repo)"
printf 'zorbquix\n' > "$dir/.private-terms"
mkdir -p "$dir/notes"
printf 'harmless\n' > "$dir/notes/zorbquix-board.bak"
git -C "$dir" add -f notes/zorbquix-board.bak >/dev/null && git -C "$dir" commit -qm "plain"
out="$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --range HEAD^..HEAD 2>&1 )"
if printf '%s' "$out" | grep -q zorbquix; then
  fail "a path with a private-list term is withheld in --range" "the path was printed in clear"
else
  pass "a path with a private-list term is withheld in --range"
fi
rm -rf "$dir"

echo "AD. a merged signed tag's text is published, so it is scanned"
# Security review of 64d47c8: merging a signed tag stores the whole tag,
# message included, in a mergetag header of the merge commit. The merge
# message can be clean while the header names a client.
if ! command -v ssh-keygen >/dev/null 2>&1; then
  fail "a merged signed tag is scanned" "harness: ssh-keygen is needed to sign the tag"
else
  dir="$(seeded_repo)"
  keys="$(mktemp -d)"
  ssh-keygen -q -t ed25519 -N '' -C gate-case -f "$keys/key"
  git -C "$dir" config gpg.format ssh
  git -C "$dir" config user.signingkey "$keys/key"
  printf 'zorbquix\n' > "$dir/.private-terms"
  base="$(git -C "$dir" rev-parse HEAD)"
  git -C "$dir" checkout -qb release
  printf 'release\n' > "$dir/release.txt"
  git -C "$dir" add release.txt && git -C "$dir" commit -qm "release work"
  git -C "$dir" tag -s clean-notes -m "release notes, nothing private"
  git -C "$dir" tag -s private-notes -m "release notes for $CANARY and zorbquix"
  git -C "$dir" checkout -q main
  printf 'main\n' > "$dir/main.txt"
  git -C "$dir" add main.txt && git -C "$dir" commit -qm "main work"
  git -C "$dir" merge -q -m "Merge release" clean-notes
  expect_status "a merged signed tag with clean notes passes --range" 0 \
    "$(gate_status "$dir" --range "$base..HEAD")" "the signature or a header tripped a rule"
  expect_status "a merged signed tag with clean notes passes --literal" 0 \
    "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal "$base..HEAD" >/dev/null 2>&1; echo $? )" \
    "a header tripped the private list"
  # ORCH74 69B: a signature is text like any other. A term that turns up in
  # its base64 by chance is a hit, cleared by a reviewed approval of the
  # commit's exact bytes in approved-exemptions.sha256.
  git -C "$dir" cat-file commit HEAD | sed -n '/BEGIN SSH SIGNATURE/{n;p;}' \
    | tr -cd 'A-Za-z0-9' | cut -c1-8 | tr 'A-Z' 'a-z' >> "$dir/.private-terms"
  expect_status "a private term by chance in a real signature is caught by --literal" 1 \
    "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal "$base..HEAD" >/dev/null 2>&1; echo $? )" \
    "signature lines met whole-word matching only"
  merge="$(git -C "$dir" rev-parse HEAD)"
  printf '%s  commit-%s-metadata\n' "$(printf '%064d' 0)" "$merge" >> "$dir/scripts/gate/approved-exemptions.sha256"
  expect_status "an approval of other bytes for that commit clears nothing" 1 \
    "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal "$base..HEAD" >/dev/null 2>&1; echo $? )" \
    "an approval cleared bytes nobody approved"
  printf '%s  commit-%s-metadata\n' "$(git -C "$dir" cat-file commit HEAD | shasum -a 256 | cut -d' ' -f1)" "$merge" >> "$dir/scripts/gate/approved-exemptions.sha256"
  expect_status "an approved signature hit passes --literal" 0 \
    "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal "$base..HEAD" >/dev/null 2>&1; echo $? )" \
    "the documented approval of a commit's bytes did not take"
  expect_status "the self-test accepts a commit's approval" 0 "$(gate_status "$dir" --self-test)" "a commit approval read as a missing fixture"
  git -C "$dir" reset -q --hard HEAD^
  git -C "$dir" merge -q -m "Merge release" private-notes
  if [ "$(git -C "$dir" cat-file commit HEAD | grep -c '^mergetag ')" != 1 ]; then
    fail "a merged signed tag is scanned" "harness: the merge recorded no mergetag header"
  else
    expect_status "a denied term in a merged tag's notes is caught by --range" 1 \
      "$(gate_status "$dir" --range "$base..HEAD")" "the mergetag header went out unscanned"
    expect_status "a private term in a merged tag's notes is caught by --literal" 1 \
      "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal "$base..HEAD" >/dev/null 2>&1; echo $? )" \
      "the mergetag header went out unscanned"
  fi
  rm -rf "$dir" "$keys"
fi

# ---------------------------------------------------------------------------
# Sol's CF-02-FIX1 review and the security review of 17d360f, 3 October.

literal_status() {
  local dir="$1"; shift
  ( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal "$@" >/dev/null 2>&1; echo $? )
}

# A commit object made by hand from HEAD's headers, with extra header lines and
# a message given as printf %b text. Prints its id; git fsck --strict accepts
# every object made here unless a fourth argument (--literally) is given.
raw_commit() {
  local dir="$1" extra="$2" body="$3"
  { git -C "$dir" cat-file commit HEAD | sed -n '1,/^$/p' | sed '$d'
    printf '%b\n%b' "$extra" "$body"
  } | git -C "$dir" hash-object -t commit -w ${4:+"$4"} --stdin
}

echo "AE. text in a signature-shaped block is published, so it is scanned"
dir="$(seeded_repo)"
printf 'zorbquix\n' > "$dir/.private-terms"
joined="$(printf '%s' "$CANARY" | tr ' ' '+')"
sha="$(raw_commit "$dir" "review-note -----BEGIN NOTES-----\n $joined\n -----END NOTES-----\n" 'plain\n')"
expect_status "a denied term in a made-up header block is caught by --range" 1 "$(gate_status "$dir" --range "$sha")" "a BEGIN line hid the header text"
sha="$(raw_commit "$dir" "review-note -----BEGIN NOTES-----\n zorbquix\n -----END NOTES-----\n" 'plain\n')"
expect_status "a private term in a made-up header block is caught by --literal" 1 "$(literal_status "$dir" "$sha")" "a BEGIN line hid the header text"
mobile='04''12345678'  # split, so this file never holds the shape itself
sha="$(raw_commit "$dir" "gpgsig -----BEGIN SSH SIGNATURE-----\n $mobile\n -----END SSH SIGNATURE-----\n" 'plain\n')"
expect_status "a mobile number inside a fake signature is caught by --range" 1 "$(gate_status "$dir" --range "$sha")" "signature-shaped lines were dropped unread"
sha="$(raw_commit "$dir" "gpgsig -----BEGIN SSH SIGNATURE-----\n zorbquix\n -----END SSH SIGNATURE-----\n" 'plain\n')"
expect_status "a private word inside a fake signature is caught by --literal" 1 "$(literal_status "$dir" "$sha")" "signature-shaped lines were dropped unread"
tag="mergetag object $(git -C "$dir" rev-parse HEAD)\n type commit\n tag notes\n tagger Gate Test <gate-test@example.invalid> 1700000000 +0000\n \n release notes\n -----BEGIN RELEASE MANIFEST-----\n zorbquix\n -----END RELEASE MANIFEST-----\n"
sha="$(raw_commit "$dir" "$tag" 'Merge release\n')"
expect_status "a private word after a BEGIN line in a merged tag's notes is caught by --literal" 1 "$(literal_status "$dir" "$sha")" "the tag author's BEGIN line hid the next lines"
rm -rf "$dir"

echo "AF. an accented private name is searched, and a line too short to search is refused"
dir="$(seeded_repo)"
printf 'Zo\303\253\nunrelated private sentinel\n' > "$dir/.private-terms"
expect_status "a clean range passes with an accented name on the list" 0 "$(literal_status "$dir" HEAD)" "the clean control failed"
printf 'a note for Zo\303\253\n' > "$dir/seed.txt"
git -C "$dir" commit -qam "plain"
expect_status "an accented three-letter private name is caught by --literal" 1 "$(literal_status "$dir" HEAD^..HEAD)" "normalising the list dropped the name"
printf 'Zo\nunrelated private sentinel\n' > "$dir/.private-terms"
expect_status "a private-list line too short to search is refused, not dropped" 3 "$(literal_status "$dir" HEAD)" "a list line was dropped without a word"
rm -rf "$dir"

echo "AG. commit text is read in the bytes it holds, and bytes that are not text are refused"
dir="$(seeded_repo)"
printf 'zorbquix\n' > "$dir/.private-terms"
sha="$(raw_commit "$dir" '' 'harmless note \0377\n')"
expect_status "a commit message that is not text refuses --range" 3 "$(gate_status "$dir" --range "$sha")" "replacement characters were certified clean"
expect_status "a commit message that is not text refuses --literal" 3 "$(literal_status "$dir" "$sha")" "replacement characters were certified clean"
sha="$(raw_commit "$dir" '' 'harmless note\0000 more\n' --literally)"
[ -n "$sha" ] || fail "a commit message holding a NUL byte refuses --range" "harness: git wrote no object"
expect_status "a commit message holding a NUL byte refuses --range" 3 "$(gate_status "$dir" --range "$sha")" "a NUL byte was read as text"
sha="$(raw_commit "$dir" 'encoding ISO-8859-1\n' 'caf\0351 notes\n')"
expect_status "a message in its declared encoding is read, not refused" 0 "$(gate_status "$dir" --range "$sha")" "a declared encoding was not honoured"
git -C "$dir" -c i18n.commitEncoding=UTF-16 commit -q --allow-empty -m "notes about $CANARY"
expect_status "a message labelled UTF-16 is still read as written, by --range" 1 "$(gate_status "$dir" --range HEAD^..HEAD)" "the label turned the message into other text"
git -C "$dir" -c i18n.commitEncoding=punycode commit -q --allow-empty -m "notes about zorbquix"
expect_status "a message labelled punycode is still read as written, by --literal" 1 "$(literal_status "$dir" HEAD^..HEAD)" "the label turned the message into other text"
rm -rf "$dir"

echo "AH. only the leading tree and parent ids are skipped"
dir="$(seeded_repo)"
printf 'zorbquix\n' > "$dir/.private-terms"
sha="$(raw_commit "$dir" "tree $CANARY\n" 'plain\n')"
expect_status "a later tree header is caught by --range" 1 "$(gate_status "$dir" --range "$sha")" "a header named tree was skipped by its name"
sha="$(raw_commit "$dir" 'parent zorbquix\n' 'plain\n')"
expect_status "a later parent header is caught by --literal" 1 "$(literal_status "$dir" "$sha")" "a header named parent was skipped by its name"
rm -rf "$dir"

echo "AI. an unresolved index is not evidence"
dir="$(seeded_repo)"
git -C "$dir" checkout -qb side
printf 'side\n' > "$dir/seed.txt" && git -C "$dir" commit -qam "side"
git -C "$dir" checkout -q main
printf 'main\n' > "$dir/seed.txt" && git -C "$dir" commit -qam "main"
git -C "$dir" merge -q side >/dev/null 2>&1
expect_status "a conflicted index refuses --staged" 3 "$(gate_status "$dir" --staged)" "the conflict was counted as a deletion and passed"
rm -rf "$dir"

TOKEN="eyJ$(printf 'S%.0s' $(seq 24)).$(printf 'T%.0s' $(seq 24))"
public_check() {
  ( cd "$1" && node scripts/public-content-check.mjs --repo "$1" --range "$2" 2>&1; echo "exit=$?" )
}
# label, output ending in exit=N, the value that must not appear, the exit wanted
withheld_case() {
  local code printed=no
  code="$(printf '%s\n' "$2" | sed -n 's/^exit=//p' | tail -1)"
  printf '%s' "$2" | grep -qF -- "$3" && printed=yes
  if [ "$code" = "$4" ] && [ "$printed" = no ]; then
    pass "$1 (exit $4)"
  else
    fail "$1" "expected exit $4 with the value withheld, got exit $code, value printed: $printed"
  fi
}

echo "AJ. the public-content check never prints a path"
policy="funding"' round'  # split, so this file never holds the phrase itself
dir="$(seeded_repo)"
cp "$REPO_ROOT/scripts/public-content-check.mjs" "$REPO_ROOT/scripts/candidate-snapshot.mjs" "$REPO_ROOT/scripts/main-module.mjs" "$dir/scripts/"
printf '%s\n' "$policy" > "$dir/$TOKEN.txt"
git -C "$dir" add "$TOKEN.txt" && git -C "$dir" commit -qm "plain"
withheld_case "a credential-shaped path its own rules miss is withheld by public-content" "$(public_check "$dir" HEAD^..HEAD)" "$TOKEN" 1
printf '%s\n' "$policy" > "$dir/zorbquix-board.txt"
git -C "$dir" add zorbquix-board.txt && git -C "$dir" commit -qm "plain"
withheld_case "a private-term path its own rules miss is withheld by public-content" "$(public_check "$dir" HEAD^..HEAD)" zorbquix 1
rm -rf "$dir"

echo "AK. a missing rule file never prints the checkout path"
base="$(mktemp -d)"
dir="$base/$TOKEN"
new_repo "$dir" >/dev/null
printf 'harmless\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt && git -C "$dir" commit -qm "seed"
cp "$REPO_ROOT/scripts/public-content-check.mjs" "$REPO_ROOT/scripts/candidate-snapshot.mjs" "$REPO_ROOT/scripts/main-module.mjs" "$dir/scripts/"
rm "$dir/scripts/gate/approved-exemptions.sha256"
withheld_case "a missing manifest is refused by public-content without the path" "$(public_check "$dir" HEAD)" "$TOKEN" 1
printf '\377\n' > "$dir/scripts/gate/denylist.sha256"
withheld_case "an undecodable denylist is refused by the gate without the path" "$(run_gate "$dir" --self-test; echo "exit=$?")" "$TOKEN" 3
rm "$dir/scripts/gate/denylist.sha256"
withheld_case "a missing denylist is refused by the gate without the path" "$(run_gate "$dir" --self-test; echo "exit=$?")" "$TOKEN" 3
rm -rf "$base"

echo "AL. a failed git call echoes nothing it was given"
dir="$(seeded_repo)"
printf 'zorbquix\n' > "$dir/.private-terms"
for mode in --range --literal; do
  withheld_case "an unknown revision is refused by $mode without echoing it" \
    "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py "$mode" "HEAD..$TOKEN" 2>&1; echo "exit=$?" )" "$TOKEN" 3
done
rm -rf "$dir"

# ---------------------------------------------------------------------------
# Sol's CF-02-FIX2 review, decided in ORCH74 69B, 4 October.

echo "AM. a signature marker never narrows private matching"
dir="$(seeded_repo)"
printf 'zorbquix\n' > "$dir/.private-terms"
for marker in 'PGP SIGNATURE' 'SSH SIGNATURE' 'PGP MESSAGE' 'SIGNED MESSAGE'; do
  sha="$(raw_commit "$dir" "review-note -----BEGIN $marker-----\n azorbquixb\n -----END $marker-----\n" 'plain\n')"
  expect_status "a private substring under a forged $marker marker is caught by --literal" 1 "$(literal_status "$dir" "$sha")" "the marker turned matching to whole words"
done
sha="$(raw_commit "$dir" "gpgsig -----BEGIN SSH SIGNATURE-----\n U1NIazorbquixbU0lH\n -----END SSH SIGNATURE-----\n" 'plain\n')"
expect_status "a private substring inside a gpgsig header is caught by --literal" 1 "$(literal_status "$dir" "$sha")" "signature base64 met whole-word matching only"
tag="mergetag object $(git -C "$dir" rev-parse HEAD)\n type commit\n tag notes\n tagger Gate Test <gate-test@example.invalid> 1700000000 +0000\n \n release notes\n -----BEGIN PGP SIGNATURE-----\n azorbquixb\n -----END PGP SIGNATURE-----\n"
sha="$(raw_commit "$dir" "$tag" 'Merge release\n')"
expect_status "a private substring in an unsigned tag's fake signature is caught by --literal" 1 "$(literal_status "$dir" "$sha")" "a merged tag's notes ended in a forged signature"
rm -rf "$dir"

echo "AN. no path reaches a diagnostic, whatever the rules know of it"
# A credential-shaped name no rule knows, built here so this file never holds
# the shape itself, under a denied extension so every scan finds something.
marker="ghp_$(printf 'Q7%.0s' $(seq 18))"
leak="deploy/$marker.pem"
withheld_form="<withheld-path $(printf '%s' "$leak" | shasum -a 256 | cut -c1-8)/${#leak}>"
dir="$(seeded_repo)"
cp "$REPO_ROOT/scripts/public-content-check.mjs" "$REPO_ROOT/scripts/candidate-snapshot.mjs" "$REPO_ROOT/scripts/main-module.mjs" "$dir/scripts/"
mkdir -p "$dir/deploy" "$dir/.husky"
cp "$REPO_ROOT/.husky/pre-push" "$dir/.husky/"
printf 'unrelated private sentinel\n' > "$dir/.private-terms"
printf 'harmless\n' > "$dir/$leak"
git -C "$dir" add "$leak"
out="$(run_gate "$dir" --staged; echo "exit=$?")"
withheld_case "an unknown credential filename is withheld by --staged" "$out" "$marker" 1
if printf '%s' "$out" | grep -qF "$withheld_form"; then
  pass "a withheld path takes public-content's form"
else
  fail "a withheld path takes public-content's form" "expected $withheld_form in the output"
fi
git -C "$dir" commit -qm "plain"
withheld_case "an unknown credential filename is withheld by --range" "$(run_gate "$dir" --range HEAD^..HEAD; echo "exit=$?")" "$marker" 1
withheld_case "an unknown credential filename is withheld by --literal" \
  "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal HEAD^..HEAD 2>&1; echo "exit=$?" )" "$marker" 1
withheld_case "an unknown credential filename is withheld by the pre-push hook" \
  "$( cd "$dir" && printf 'refs/heads/main %s refs/heads/main %s\n' "$(git rev-parse HEAD)" "$(git rev-parse HEAD^)" \
    | HUB_GATE_TERMS="$dir/.private-terms" sh -e .husky/pre-push origin none 2>&1; echo "exit=$?" )" "$marker" 1
rm -rf "$dir"
# Finding 5: .txt is no denied extension, so only the path's shape scan can
# refuse this name.
dir="$(seeded_repo)"
printf 'harmless\n' > "$dir/$TOKEN.txt"
git -C "$dir" add "$TOKEN.txt"
withheld_case "a credential-shaped .txt filename is refused by --staged" "$(run_gate "$dir" --staged; echo "exit=$?")" "$TOKEN" 1
rm -rf "$dir"

echo "AO. the approval manifest is read strictly by both checkers"
base="$(mktemp -d)"
dir="$base/$TOKEN"
new_repo "$dir" >/dev/null
printf 'harmless\n' > "$dir/seed.txt"
git -C "$dir" add seed.txt && git -C "$dir" commit -qm "seed"
cp "$REPO_ROOT/scripts/public-content-check.mjs" "$REPO_ROOT/scripts/candidate-snapshot.mjs" "$REPO_ROOT/scripts/main-module.mjs" "$dir/scripts/"
manifest="$dir/scripts/gate/approved-exemptions.sha256"
cp "$manifest" "$base/manifest"
withheld_case "public-content accepts the shipped manifest" "$(public_check "$dir" HEAD)" "$TOKEN" 0
fixture='tests/gate/shape-canary.txt'
: > "$manifest"
withheld_case "public-content refuses an empty manifest" "$(public_check "$dir" HEAD)" "$TOKEN" 1
printf '# comments only\n' > "$manifest"
withheld_case "public-content refuses a manifest with no record" "$(public_check "$dir" HEAD)" "$TOKEN" 1
labels=(a\ non-digest\ record a\ non-hex\ digest a\ digest\ with\ no\ path undecodable\ text)
records=("not-a-digest  $fixture" "$(printf 'Z%.0s' $(seq 64))  $fixture" "$(printf '%064d' 0)" $'\377')
for i in 0 1 2 3; do
  { cat "$base/manifest"; printf '%s\n' "${records[$i]}"; } > "$manifest"
  withheld_case "public-content refuses a manifest holding ${labels[$i]}" "$(public_check "$dir" HEAD)" "$TOKEN" 1
done
{ cat "$base/manifest"; printf '%s\n' "${records[1]}"; } > "$manifest"
withheld_case "the gate refuses a non-hex digest" "$(run_gate "$dir" --self-test; echo "exit=$?")" "$TOKEN" 3
# Sol's CF-02-FIX3: the two readers split lines alike only while the manifest is
# printable ASCII and LF, so any other byte, in a comment too, is refused by both.
labels=(a\ line\ separator\ in\ a\ comment a\ tab\ in\ a\ comment)
records=("# comment$(printf '\342\200\250')not-a-digest  $fixture" "# a tab$(printf '\t')in a comment")
for i in 0 1; do
  { cat "$base/manifest"; printf '%s\n' "${records[$i]}"; } > "$manifest"
  withheld_case "public-content refuses ${labels[$i]}" "$(public_check "$dir" HEAD)" "$TOKEN" 1
  withheld_case "the gate refuses ${labels[$i]}" "$(run_gate "$dir" --self-test; echo "exit=$?")" "$TOKEN" 3
done
rm -rf "$base"

# ---------------------------------------------------------------------------
# Sol's CF-02-FIX3 review, decided in ORCH75 69R.

echo "AP. a header name, an exemption path and an identity timestamp"
marker="ghp_$(printf 'Q7%.0s' $(seq 18))"
dir="$(seeded_repo)"
printf 'zorbquixclient\n' > "$dir/.private-terms"
sha="$(raw_commit "$dir" "$TOKEN ordinary\n" 'plain\n')"
withheld_case "a credential as a header name is caught by --range, never printed" "$(run_gate "$dir" --range "$sha"; echo "exit=$?")" "$TOKEN" 1
sha="$(raw_commit "$dir" 'zorbquixclient ordinary\n' 'plain\n')"
withheld_case "a private term as a header name is caught by --literal, never printed" \
  "$( cd "$dir" && HUB_GATE_TERMS="$dir/.private-terms" python3 scripts/gate/sweep.py --literal "$sha" 2>&1; echo "exit=$?" )" zorbquixclient 1
printf '1700000000\n' > "$dir/.private-terms"
sha="$(git -C "$dir" cat-file commit HEAD | sed 's/^\(author .*>\) [0-9]* /\1 1700000000 /' | git -C "$dir" hash-object -t commit -w --stdin)"
expect_status "a private term in an identity timestamp is caught by --literal" 1 "$(literal_status "$dir" "$sha")" "the timestamp was stripped before matching"
printf '%064d  deploy/%s.pem\n' 0 "$marker" >> "$dir/scripts/gate/approved-exemptions.sha256"
withheld_case "a missing exempt path fails the self-test, never printed" "$(run_gate "$dir" --self-test; echo "exit=$?")" "$marker" 1
rm -rf "$dir"

echo "AQ. approving a commit's metadata never approves its files"
dir="$(seeded_repo)"
base="$(git -C "$dir" rev-parse HEAD)"
printf '%s\n' "$CANARY" > "$dir/.private-terms"
printf 'a note about %s\n' "$CANARY" > "$dir/seed.txt"
git -C "$dir" commit -qam "plain"
sha="$(git -C "$dir" rev-parse HEAD)"
printf '%s  commit-%s-metadata\n' "$(git -C "$dir" cat-file commit HEAD | shasum -a 256 | cut -d' ' -f1)" "$sha" >> "$dir/scripts/gate/approved-exemptions.sha256"
expect_status "a denied term in an approved commit's file is caught by --range" 1 "$(gate_status "$dir" --range "$base..$sha")" "the approval exempted the commit's files"
expect_status "a private term in an approved commit's file is caught by --literal" 1 "$(literal_status "$dir" "$base..$sha")" "the approval exempted the commit's files"
rm -rf "$dir"

echo
echo "gate cases: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
