#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# handoff.sh: a single-mode agent hands its work to a fresh session before
# Claude Code's automatic summary drops its pull request heads, worktrees and
# Sol rounds (owner, 17 October 2026, #182). Three commands:
#
#   handoff.sh ctx [PANE]
#     Reads this pane's context gauge and prints one line, exit code beside it
#     (owner, 17 October 2026):
#       CTX <n> GO        0  under 45: carry on
#       CTX <n> WRAP     10  45 to 49: start nothing new; finish the task in hand, then hand off
#       CTX <n> HANDOFF  20  50 to 69: hand off now, the usual cut-off
#       CTX <n> HARD     30  70 and over: hand off now, no exception
#       CTX ? WRAP       10  no reading, twice: treated as 45
#       CTX ? NO-PANE     2  not in a herdr pane, so nothing to read or dispatch to
#       CTX ? NO-READER   2  the orchestrator skill's ctx.sh is not installed
#     The number comes from the orchestrator skill's ctx.sh, which reads the
#     statusline's context bar off the pane. The three lines live here only.
#
#   handoff.sh note <owner/repo> [--clone DIR] [--out FILE] [PR ...]
#     Writes the hand-off note's skeleton: each named pull request read live
#     (state, branch, worktree, head, labels, Sol rounds, Sol's last verdict and
#     its status on the head), with <fill> where the agent writes what no command
#     can read. Worktrees are looked up in DIR (default: here), a clone of
#     <owner/repo>. Prints the file's path. Exit 1 when a pull request could not
#     be read: its line is then a <fill>.
#
#   handoff.sh dispatch <note> --cwd DIR --label LABEL --seat SEAT [--model MODEL] [--effort EFFORT] [--dry-run]
#     Refuses a note with a <fill> left or without its HANDOFF-END line, then
#     hands the note, whole, to herdr-dispatch as a fresh Claude session's first
#     message, on the required seat's launcher ($HOME/bin/claude-<SEAT>), at
#     --effort (default high; the owner may set another for an effort).
#     --dry-run writes and checks the spec, prints what would run, and launches nothing.
set -uo pipefail

WRAP=45
HANDOFF=50
HARD=70

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# need FLAG COUNT: a flag given as the last argument has no value.
need() { [ "$2" -ge 2 ] || { echo "handoff.sh: $1 needs a value" >&2; exit 2; }; }
usage() { sed -n '3,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

reader() {
  local c
  # The last place is where orchestration/skills/fetch.mjs installs it in a clone.
  for c in "${CTX_SH:-}" "$HOME/.claude/skills/orchestrator/ctx.sh" "$ROOT/orchestration/skills/orchestrator/ctx.sh"; do
    [ -n "$c" ] && [ -f "$c" ] && [ -r "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

cmd_ctx() {
  local pane="${1:-${HERDR_PANE_ID:-}}" r n="" try
  [ -z "$pane" ] && { echo "CTX ? NO-PANE"; return 2; }
  r=$(reader) || { echo "CTX ? NO-READER (orchestrator ctx.sh not found)"; return 2; }
  # The bar can be off screen for a moment (a sub-agent panel, a redraw), so
  # one miss is read again before it counts.
  for try in 1 2; do
    n=$(bash "$r" "$pane" 2>/dev/null | sed -nE 's/^CTX ([0-9]+) .*/\1/p' | head -1)
    [ -n "$n" ] && break
    [ "$try" = 1 ] && sleep "${CTX_RETRY_SECONDS:-3}"
  done
  [ -z "$n" ] && { echo "CTX ? WRAP (no gauge reading)"; return 10; }
  [ "$n" -ge "$HARD" ] && { echo "CTX $n HARD"; return 30; }
  [ "$n" -ge "$HANDOFF" ] && { echo "CTX $n HANDOFF"; return 20; }
  [ "$n" -ge "$WRAP" ] && { echo "CTX $n WRAP"; return 10; }
  echo "CTX $n GO"
}

# One line per pull request, read live. Sol's rounds are its review comments,
# each ending in the footer the single-agent REVIEW.md prompt asks for; its
# verdict of record is the `Sol verdict` status the merge script reads.
# Its creator identifies Sol; SOL_REVIEWER_LOGIN or the active gh login is
# used when that head has no verdict yet. Foreign comments are not reviews. The
# worktree is looked up only in a clone of <owner/repo>, and named with a
# warning when its checkout is not the pull request's head.
pr_line() {
  local repo=$1 n=$2 clone=$3 json head status origin repo_lower reviewer same=0 py
  if ! json=$(gh pr view "$n" -R "$repo" --json number,state,headRefName,headRefOid,labels,comments 2>/dev/null); then
    echo "- #$n <fill: gh pr view failed at $(utc); read it live and write its line>"
    return 1
  fi
  head=$(printf '%s' "$json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["headRefOid"])')
  status=$(gh api "repos/$repo/commits/$head/statuses" \
    -q '[.[] | select(.context | ascii_downcase == "sol verdict")][0] | {state: (.state // "none"), reviewer: .creator.login}' 2>/dev/null) || status='{"state":"unknown"}'
  reviewer=${SOL_REVIEWER_LOGIN:-$(gh api user -q .login 2>/dev/null)}
  origin=$(git -C "$clone" remote get-url origin 2>/dev/null | sed -E 's#\.git$##' | tr '[:upper:]' '[:lower:]')
  repo_lower=$(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]')
  case $origin in
    "https://github.com/$repo_lower"|"git@github.com:$repo_lower"|"ssh://git@github.com/$repo_lower") same=1 ;;
  esac
  IFS= read -r -d '' py <<'PY'
import json, re, sys
pr = json.load(sys.stdin)
clone, same, porcelain = sys.argv[1], sys.argv[2] == "1", sys.argv[3]
try:
    verdict_status = json.loads(sys.argv[4])
    if not isinstance(verdict_status, dict):
        verdict_status = {"state": "unknown"}
except ValueError:
    verdict_status = {"state": "unknown"}
status = verdict_status.get("state", "unknown")
reviewer = verdict_status.get("reviewer") or sys.argv[5]
head, branch = pr["headRefOid"], pr["headRefName"]
if not same:
    wt = f"<fill: {clone} is not a clone of this repository; give the worktree path, or none>"
else:
    wt = f"none among {clone}'s worktrees"
    for block in porcelain.strip().split("\n\n"):
        f = dict(line.split(" ", 1) for line in block.splitlines() if " " in line)
        if f.get("branch") == f"refs/heads/{branch}":
            wt = f["worktree"]
            if f.get("HEAD") != head:
                wt += f" (checked out at {f.get('HEAD', '?')[:7]}, not the PR head)"
            break
labels = ",".join(l["name"] for l in pr["labels"]) or "none"
def footer(body):
    return "Reviewer: Sol (Codex)" in [l.strip() for l in body.strip().splitlines()[-5:]]
sol = [c["body"] for c in pr["comments"]
       if reviewer and c.get("author", {}).get("login", "").lower() == reviewer.lower()
       and footer(c["body"])
       and re.search(r"^Verdict:\s*(approve|changes requested)\s*$", c["body"], re.M)]
if sol:
    verdict = re.findall(r"^Verdict:\s*(approve|changes requested)\s*$", sol[-1], re.M)
    seen = re.findall(r"^Head SHA:\s*([0-9a-f]{7,40})", sol[-1], re.M)
    on = seen[-1][:7] if seen else "unknown head"
    where = "this head" if seen and head.startswith(seen[-1]) else "an older head"
    last = f"{verdict[-1] if verdict else 'no verdict line'} on {on} ({where})"
else:
    last = "none"
print(f"- #{pr['number']} state={pr['state']} branch={branch} worktree={wt} head={head} labels={labels} "
      f"sol-rounds={len(sol)} sol-last={last} sol-status-on-head={status}")
PY
  printf '%s' "$json" | python3 -c "$py" "$clone" "$same" "$(git -C "$clone" worktree list --porcelain 2>/dev/null)" "$status" "$reviewer"
}

cmd_note() {
  local repo="${1:-}" out="" clone="$PWD" prs=() rc=0 line ctxline n
  [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "handoff.sh note: give <owner/repo> first" >&2; return 2; }
  shift
  while [ $# -gt 0 ]; do
    case $1 in
      --out) need --out $#; out=$2; shift 2 ;;
      --clone) need --clone $#; clone=$2; shift 2 ;;
      *) [[ "$1" =~ ^#?[0-9]+$ ]] || { echo "handoff.sh note: '$1' is not a pull request number" >&2; return 2; }
         prs+=("${1#\#}"); shift ;;
    esac
  done
  [ -n "$out" ] || out=$(mktemp "${TMPDIR:-/tmp}/single-handoff-${repo#*/}.XXXXXX") || return 2
  ctxline=$(cmd_ctx)
  {
    echo "# Single-agent hand-off: $repo"
    echo
    echo "Load the \`single-agent\` skill and follow it; this note is your whole brief. You take over $repo from pane ${HERDR_PANE_ID:-unknown} ($ctxline), written $(utc). Re-read each pull request's head and checks live before acting on it: the lines below are what was seen when this was written."
    echo
    echo "## The job"
    echo "- Area and job: <fill>"
    echo "- Owner's standing authority beyond the skill: <fill, or none>"
    echo
    echo "## Open pull requests"
    if [ ${#prs[@]} -eq 0 ]; then echo "- none"; fi
    for n in ${prs[@]+"${prs[@]}"}; do
      if ! line=$(pr_line "$repo" "$n" "$clone"); then
        rc=1
        [[ "$line" == *"<fill:"* ]] || line="- #$n <fill: PR metadata could not be rendered at $(utc); read it live and write its line>"
      fi
      echo "$line"
    done
    echo "- In hand when the line was reached: <fill: #n and the step it stopped at (pushed, Sol round, fix round), or none>"
    echo
    echo "## Tickets left, in order"
    echo "- <fill>"
    echo
    echo "## Live install state"
    echo "- <fill: what runs or is deployed from this work, where, at which commit; or none>"
    echo
    echo "## Owner's words not yet in a ticket"
    echo "- <fill: verbatim, with the date; or none>"
    echo
    echo "Take each pull request on through \`single-agent\`, hand off again at the line, and finish with \`close-out\`."
    echo
    echo "HANDOFF-END"
  } > "$out" || { echo "handoff.sh note: cannot write $out" >&2; return 2; }
  echo "$out"
  [ $rc -ne 0 ] && echo "NOTE-INCOMPLETE: a pull request could not be read; its line is a <fill>" >&2
  return $rc
}

cmd_dispatch() {
  local note="${1:-}" cwd="" label="" seat="" model=opus effort=high dry=0 agent spec dispatcher
  [ -f "$note" ] || { echo "handoff.sh dispatch: note '$note' not found" >&2; return 2; }
  shift
  while [ $# -gt 0 ]; do
    case $1 in
      --cwd) need --cwd $#; cwd=$2; shift 2 ;;
      --label) need --label $#; label=$2; shift 2 ;;
      --seat) need --seat $#; seat=$2; shift 2 ;;
      --model) need --model $#; model=$2; shift 2 ;;
      --effort) need --effort $#; effort=$2; shift 2 ;;
      --dry-run) dry=1; shift ;;
      *) echo "handoff.sh dispatch: unknown option '$1'" >&2; return 2 ;;
    esac
  done
  [ -n "$cwd" ] || { echo "handoff.sh dispatch: --cwd is required" >&2; return 2; }
  cwd=$(cd "$cwd" 2>/dev/null && pwd -P) || { echo "handoff.sh dispatch: --cwd must be a folder" >&2; return 2; }
  [[ "$cwd" == *"'"* ]] && { echo "handoff.sh dispatch: --cwd must not contain a quote ('), which herdr-dispatch cannot pass on" >&2; return 2; }
  [[ "$label" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "handoff.sh dispatch: --label is letters, digits, '.', '_' and '-'" >&2; return 2; }
  [[ "$model" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "handoff.sh dispatch: --model is letters, digits, '.', '_' and '-'" >&2; return 2; }
  [[ "$effort" =~ ^(low|medium|high|xhigh|max)$ ]] || { echo "handoff.sh dispatch: --effort is low, medium, high, xhigh or max" >&2; return 2; }
  if grep -n '<fill' "$note" >&2; then echo "DISPATCH-REFUSED: the note still has <fill> on the lines above" >&2; return 3; fi
  [ "$(grep -v '^[[:space:]]*$' "$note" | tail -n 1)" = HANDOFF-END ] || { echo "DISPATCH-REFUSED: the note's last line is not HANDOFF-END" >&2; return 3; }
  [ -n "$seat" ] || { echo "handoff.sh dispatch: --seat is required" >&2; return 2; }
  [[ "$seat" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "handoff.sh dispatch: --seat is letters, digits, '.', '_' and '-'" >&2; return 2; }
  [ "$seat" != seat-up ] || { echo "handoff.sh dispatch: seat-up is a helper, not a seat" >&2; return 2; }
  [ -x "$HOME/bin/claude-$seat" ] || { echo "BLOCKED: no launcher for seat $seat" >&2; return 2; }
  agent="$HOME/bin/claude-$seat"
  agent="$agent --dangerously-skip-permissions --model $model --effort $effort"
  # A private directory keeps another dispatch, even a dry run, from replacing this brief.
  spec=$(mktemp -d "${TMPDIR:-/tmp}/single-dispatch.XXXXXX") || return 2
  spec="$spec/dispatch.json"
  python3 - "$note" "$label" "$agent" "$cwd" "$spec" <<'PY' || { echo "handoff.sh dispatch: cannot write the spec" >&2; return 2; }
import json, sys
note, label, agent, cwd, spec = sys.argv[1:6]
with open(note, encoding="utf-8") as f:
    prompt = f.read()
with open(spec, "w", encoding="utf-8") as f:
    json.dump({"task": f"Single-agent hand-off {label}", "slug": label, "backend": "claude",
               "agent": agent, "cwd": cwd, "prompt": prompt, "wait": False}, f)
PY
  dispatcher=${HERDR_DISPATCH:-$(command -v herdr-dispatch || echo "$HOME/.claude/skills/dispatch/herdr-dispatch")}
  if [ $dry = 1 ]; then
    echo "DRY-RUN spec=$spec"
    echo "DRY-RUN agent=$agent"
    echo "DRY-RUN would run: $dispatcher $spec"
    return 0
  fi
  [ "${HERDR_ENV:-}" = 1 ] || { echo "BLOCKED: not inside herdr; hand the owner the note at $note" >&2; return 3; }
  [ -x "$dispatcher" ] || { echo "BLOCKED: herdr-dispatch not installed (dispatch skill step 1)" >&2; return 2; }
  "$dispatcher" "$spec"
}

case "${1:-}" in
  ctx) shift; cmd_ctx "$@" ;;
  note) shift; cmd_note "$@" ;;
  dispatch) shift; cmd_dispatch "$@" ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
