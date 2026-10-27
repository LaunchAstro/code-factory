# SPDX-License-Identifier: AGPL-3.0-only
# The shared world the runner's cases run in.
#
# Sourced by `runner-cases.sh`, which is the one entry point, and which
# sources the hold and refusal cases after it.
#
# Every case is named for the line it proves in the "Definition of
# implemented" list in Code Factory's docs/rounds/RUNNER-SPEC-2026-09-18.md.
# Nothing here calls a real model or a real GitHub: `gh` is a stub on PATH,
# its reviews are fixtures, and the status table is a temporary file. A case
# that needed a network would not be run, and a check nobody runs does not
# exist.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${1:-$REPO_ROOT/scripts/runner/runner.mjs}"

PASSED=0
FAILED=0
pass() { printf '  PASS  %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '  FAIL  %s\n' "$1"; printf '        %s\n' "$2"; FAILED=$((FAILED + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
PATH="$WORK/bin:$PATH"
export PATH

# The stub. It answers the calls the runner makes and records every
# invocation, so a case can assert that the label and the comment happened
# rather than that the exit code was convenient.
#
# A list fixture is a list of pages, or one page when it is a plain list, and
# the stub serves it the way gh does: every page as one array under
# --paginate --slurp, the pages back to back under --paginate alone, only the
# first page without either, and a refusal for --slurp without --paginate.
# Serving every page whatever the flags let a runner that dropped --paginate
# pass the two-page case (Sol, CF-03).
cat > "$WORK/bin/gh-pages.mjs" <<'PAGES'
import { readFileSync } from 'node:fs';
const [file, ...args] = process.argv.slice(2);
const list = JSON.parse(readFileSync(file, 'utf8'));
const pages = list.length > 0 && list.every(Array.isArray) ? list : [list];
const paginate = args.includes('--paginate');
const slurp = args.includes('--slurp');
if (slurp && !paginate) {
  console.error('the `--slurp` option is only supported with `--paginate`');
  process.exit(1);
}
if (paginate && slurp) process.stdout.write(JSON.stringify(pages));
else if (paginate) process.stdout.write(pages.map((page) => JSON.stringify(page)).join(''));
else process.stdout.write(JSON.stringify(pages[0]));
PAGES
cat > "$WORK/bin/gh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_LOG"
PAGES="$(dirname "$0")/gh-pages.mjs"
case "$*" in
  # The account gh is signed in as, which a hold comment must be posted by.
  "api user"*) printf '%s\n' "$FAKE_LOGIN" ;;
  "pr comment"*)
    if [ -n "${FAKE_COMMENT_FAIL:-}" ]; then printf '%s\n' "$FAKE_COMMENT_FAIL" >&2; exit 1; fi
    # A posted comment is kept, so a later read finds it. A lost response is
    # a comment GitHub posted whose answer never came back.
    node -e 'const fs = require("node:fs"), [file, body] = process.argv.slice(1);
      const list = JSON.parse(fs.readFileSync(file, "utf8"));
      const user = { login: process.env.FAKE_LOGIN };
      fs.writeFileSync(file, JSON.stringify([...list, { id: list.length + 1, user, body }]));' "$FAKE_COMMENTS" "$7"
    if [ -n "${FAKE_COMMENT_LOST:-}" ]; then printf '%s\n' "$FAKE_COMMENT_LOST" >&2; exit 1; fi ;;
  *"/comments"*) node "$PAGES" "$FAKE_COMMENTS" "$@" ;;
  *"pulls?state=open"*) node "$PAGES" "$FAKE_OPEN" "$@" ;;
  *"/reviews"*)
    if [ -n "${FAKE_REVIEWS_FAIL:-}" ]; then printf '%s\n' "$FAKE_REVIEWS_FAIL" >&2; exit 1; fi
    # The answer exactly as given, for a shape the page fixture cannot make.
    if [ -n "${FAKE_REVIEWS_RAW:-}" ]; then printf '%s' "$FAKE_REVIEWS_RAW"; exit 0; fi
    node "$PAGES" "$FAKE_REVIEWS" "$@" ;;
  *"issues?"*)
    # The query is read the way GitHub reads it: one label, decoded, and a
    # comma is two labels. Any other label is a list with nothing on it.
    if ! node -e 'const labels = new URL(process.argv[1], "https://api.github.com/").searchParams.get("labels");
      process.exit(labels === process.env.FAKE_LABEL_NAME && !labels.includes(",") ? 0 : 1);' "$2"; then
      node "$PAGES" "$(dirname "$0")/empty.json" "$@"
    # Either a fixture, or the labels this stub was actually asked to set. The
    # second is what stops a case asserting agreement it arranged by hand.
    elif [ -n "${FAKE_HELD_FROM_LABELS:-}" ]; then
      { printf '['; SEP=''
        while read -r N; do printf '%s{"number":%s,"pull_request":{}}' "$SEP" "$N"; SEP=','; done < "$FAKE_LABELLED"
        printf ']'; } > "$FAKE_LABELLED.json"
      node "$PAGES" "$FAKE_LABELLED.json" "$@"
    else node "$PAGES" "$FAKE_HELD" "$@"; fi ;;
  *"--add-label"*)
    if [ -n "${FAKE_LABEL_FAIL:-}" ]; then printf '%s\n' "$FAKE_LABEL_FAIL" >&2; exit 1; fi
    grep -qx "$3" "$FAKE_LABELLED" 2>/dev/null || printf '%s\n' "$3" >> "$FAKE_LABELLED" ;;
  *"--remove-label"*)
    if [ -n "${FAKE_REMOVE_FAIL:-}" ]; then printf '%s\n' "$FAKE_REMOVE_FAIL" >&2; exit 1; fi
    grep -vx "$3" "$FAKE_LABELLED" > "$FAKE_LABELLED.next" 2>/dev/null || :
    mv "$FAKE_LABELLED.next" "$FAKE_LABELLED" ;;
  *)             : ;;
esac
STUB
chmod +x "$WORK/bin/gh"
printf '[]' > "$WORK/bin/empty.json"

# A review of record in the CONTRIBUTING.md step 4 shape, and a Copilot one.
reviews() {
  local sol="$1" copilot="$2" out='[' first=1 i
  for ((i = 0; i < sol; i++)); do
    [ "$first" = 1 ] || out+=','
    out+='{"id":'$((9100 + i))',"user":{"login":"reviewer-account"},"body":"Reviewer: Sol (Codex)\nModel: gpt-5.6-sol\nHead SHA: abc\nVerdict: approve"}'
    first=0
  done
  for ((i = 0; i < copilot; i++)); do
    [ "$first" = 1 ] || out+=','
    out+='{"id":'$((9200 + i))',"user":{"login":"copilot-pull-request-reviewer[bot]"},"body":"a comment"}'
    first=0
  done
  printf '%s]' "$out"
}

# One config per case, so a case that lowers a ceiling cannot leak into the
# next. Every number the runner obeys comes from here and nowhere else.
config() {
  local dir="$1" sol="${2:-2}" copilot_run="${3:-20}" copilot_pr="${4:-2}"
  mkdir -p "$dir"
  cat > "$dir/runner.json" <<CFG
{
  "repository": "LaunchAstro/stub",
  "launcher": { "template": "\$HOME/bin/claude-<seat>", "model": "claude-opus-5" },
  "reviewOfRecord": { "reviewer": "Sol (Codex)", "model": "gpt-5.6-sol" },
  "copilotLogin": "copilot-pull-request-reviewer[bot]",
  "minutes": { "plan": 45, "build": 90, "review": 15, "fix": 45 },
  "perPullRequest": { "opus": 2, "sol": $sol, "copilot": $copilot_pr },
  "perRun": { "opus": 20, "sol": 20, "copilot": $copilot_run },
  "heldLabel": "held",
  "statusPath": "STATUS.md",
  "budgetPath": "budget.json"
}
CFG
  printf '%s' "$dir/runner.json"
}

# Every pull request the cases name is open, because a closed one is not part
# of the run and the agreement check must not compare over it.
ALL_OPEN="$(printf '[')"
for n in $(seq 30 99); do ALL_OPEN+="{\"number\":$n,\"pull_request\":{}},"; done
ALL_OPEN="${ALL_OPEN%,}]"

# stage <dir> <sol reviews> <copilot reviews> [sol ceiling] [copilot run
# ceiling] [copilot per-pull-request ceiling]: one case's world, so a case
# that lowers a ceiling or breaks a stub cannot leak into the next.
stage() {
  DIR="$1"; CFG="$(config "$DIR" "${4:-2}" "${5:-20}" "${6:-2}")"
  FAKE_LOG="$DIR/gh.log"; : > "$FAKE_LOG"
  FAKE_REVIEWS="$DIR/reviews.json"; reviews "$2" "$3" > "$FAKE_REVIEWS"
  FAKE_HELD="$DIR/held.json"; printf '[]' > "$FAKE_HELD"
  FAKE_OPEN="$DIR/open.json"; printf '%s' "$ALL_OPEN" > "$FAKE_OPEN"
  FAKE_LABELLED="$DIR/labelled"; : > "$FAKE_LABELLED"
  FAKE_COMMENTS="$DIR/comments.json"; printf '[]' > "$FAKE_COMMENTS"
  FAKE_LABEL_NAME=held; FAKE_LOGIN=runner-account
  export FAKE_LOG FAKE_REVIEWS FAKE_HELD FAKE_OPEN FAKE_LABELLED FAKE_COMMENTS FAKE_LABEL_NAME FAKE_LOGIN
  unset FAKE_REVIEWS_FAIL FAKE_REVIEWS_RAW FAKE_LABEL_FAIL FAKE_HELD_FROM_LABELS FAKE_COMMENT_FAIL FAKE_COMMENT_LOST FAKE_REMOVE_FAIL
  # A run has begun on this machine before, so the status table exists. The
  # budget is each case's own to begin or to leave absent.
  node "$RUNNER" --config "$CFG" begin --new-history --reason "a fresh case world" > /dev/null 2>&1
  rm -f "$DIR/budget.json"; : > "$FAKE_LOG"
}

# case <label> <expected exit> <sol reviews on the pr> <args...>
CASE_N=0
run_case() {
  local label="$1" expect="$2" sol="$3"; shift 3
  CASE_N=$((CASE_N + 1))
  stage "$WORK/case$CASE_N" "$sol" 0
  OUT="$(node "$RUNNER" --config "$CFG" "$@" 2>&1)"
  local actual=$?
  if [ "$actual" = "$expect" ]; then pass "$label"; else fail "$label" "expected exit $expect, got $actual: $(printf '%s' "$OUT" | head -2)"; fi
}

echo "runner cases, against $RUNNER"
