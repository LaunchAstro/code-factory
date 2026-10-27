#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# copy-sweep.sh: removes the review and check copies a run left behind (#328). A Sol review removes its own copy
# when it ends, fails or is killed (reviewer/sol-pr-cf.sh); this catches the rest, such as a host that stopped
# mid-review.
#
# Candidates, and nothing else: each folder directly inside the cf-sol folder ($CF_SOL_DIR, else $TMPDIR/cf-sol,
# which must be named cf-sol), each sol* folder directly inside /private/tmp ($CF_SWEEP_TMP, for tests) and $TMPDIR
# (other rounds' own Sol scripts copy there; a temp folder that is a link is not read) and, with --checks DIR, each
# out-* and chk-* folder directly inside DIR (the M5's checks results and check worktrees,
# ~/Desktop/Agents/repos/code-factory there). A candidate stays when:
#   - anything in it changed in the last 6 hours (or it can't be read to tell);
#   - its review marked it KEPT (a KEPT file at its top: Sol's proof files could not be saved);
#   - a running process names it on its command line, by its given or its physical path, or on macOS by the short
#     form of a /private path (/tmp/..., /var/...) (a check waiting for the M5's lock, a review's own shell);
#   - a process has it or anything in it open (lsof +D), or lsof can't tell: unused needs lsof's exit 1 with
#     nothing on stdout or stderr (-w mutes warnings; lsof also exits 1 on an error, and says so on stderr);
#   - it is out-<sha>-* and the newest all-green run of an open PR's head, the one green-run.sh reuses. When the
#     open PRs can't be read (gh), the newest all-green run of every commit stays.
# Symbolic links are never followed or removed. Otherwise the folder is deleted, and DIR/main's worktree records
# are pruned after a chk-* goes.
#
# Usage: copy-sweep.sh [--dry-run] [--checks DIR] [--repo OWNER/NAME]
#   --dry-run  deletes nothing; prints WOULD-REMOVE for each folder a sweep would delete
#   --repo     whose open PRs protect their green runs (default LaunchAstro/code-factory-private)
# Output: REMOVED <path>, WOULD-REMOVE <path> or KEPT <path> (<reason>) per candidate, then a total. Exit 2 on a
# usage error, a missing lsof, no process list, or a cf-sol or checks folder that is not a real folder of that name.
set -uo pipefail
shopt -s nullglob; unset CDPATH
# bare NAME PATH sets NAME to PATH with every trailing slash off, so a link given as link/ or link// still tests as
# a link ("/" stays "/"). It sets the variable in place: $(...) would also drop trailing newlines from the path.
bare() { local _b=$2; while [[ $_b == ?*/ ]]; do _b=${_b%/}; done; printf -v "$1" '%s' "$_b"; }
# abs NAME DIR [-P] sets NAME to DIR's absolute (with -P, physical) path, keeping a newline that ends its name.
abs() { local _a; _a=$(cd "$2" && pwd ${3:-} && echo .) || return 1; printf -v "$1" '%s' "${_a%$'\n.'}"; }
usage() { echo "usage: ${0##*/} [--dry-run] [--checks DIR] [--repo OWNER/NAME]" >&2; exit 2; }
dry=0; checks=; repo=LaunchAstro/code-factory-private
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) dry=1; shift ;;
    --checks) [ -n "${2:-}" ] || usage; bare checks "$2"; shift 2 ;;
    --repo) [ -n "${2:-}" ] || usage; repo=$2; shift 2 ;;
    *) usage ;;
  esac
done
command -v lsof > /dev/null || { echo "copy-sweep: no lsof, so no copy can be shown unused; nothing removed" >&2; exit 2; }
bare t "${TMPDIR:-/tmp}"; bare sol "${CF_SOL_DIR:-$t/cf-sol}"
[ "${sol##*/}" = cf-sol ] || { echo "copy-sweep: $sol is not a cf-sol folder; nothing removed" >&2; exit 2; }
[ -L "$sol" ] && { echo "copy-sweep: $sol is a link; nothing removed" >&2; exit 2; }
[ -z "$checks" ] || { [ -d "$checks" ] && [ ! -L "$checks" ] && abs checks "$checks"; } \
  || { echo "copy-sweep: $checks is not a folder; nothing removed" >&2; exit 2; }
# Absolute, so a candidate's path matches a command line that names it absolutely.
[ -d "$sol" ] && abs sol "$sol"

procs=$(ps -axww -o command=) && [ -n "$procs" ] \
  || { echo "copy-sweep: can't list processes, so no copy can be shown unused; nothing removed" >&2; exit 2; }
removed=0; kept=0; pruned=0
nl=$'\n'
young() { local out; out=$(find "$1" -mmin -360 -print 2>/dev/null) || return 0; [ -n "$out" ]; }
# green-run.sh's test of a finished, all-green run.
green() { awk '$1=="DONE"{d=1} $1!="DONE" && $2!=0 {b=1} END{exit !(d && !b)}' "$1/summary.tsv" 2>/dev/null; }
newest_green() {
  local d best=
  for d in "$checks"/out-"$1"-*; do
    [ -L "$d" ] && continue
    green "$d" && { [ -z "$best" ] || [ "$d" -nt "$best" ]; } && best=$d
  done
  [ -z "$best" ] || printf '%s\n' "$best"
}

protected=; why=
if [ -n "$checks" ]; then
  if heads=$(gh pr list -R "$repo" --state open --limit 1000 --json headRefOid -q '.[].headRefOid' 2>/dev/null); then
    why="newest green run of an open PR's head"
  else
    why="newest green run of its commit; open PRs unreadable"
    heads=$(for d in "$checks"/out-*; do s=${d##*/out-}; printf '%s\n' "${s%%-*}"; done | sort -u)
  fi
  for s in $heads; do
    [[ $s =~ ^[0-9a-f]{40}$ ]] && protected="$protected$(newest_green "$s")$nl"
  done
fi

one() {
  local d=$1 reason= phys= open rc
  if [ -L "$d" ] || [ ! -d "$d" ]; then reason="not a folder"
  elif [[ "$nl$protected" == *"$nl$d$nl"* ]]; then reason=$why
  elif [ -e "$d/KEPT" ]; then reason="marked KEPT by its review"
  elif young "$d"; then reason="changed in the last 6 hours"
  elif abs phys "$d" -P && [[ $procs == *"$d"* || $procs == *"$phys"* \
    || ( $phys == /private/* && $procs == *"${phys#/private}"* ) ]]; then reason="named by a running process"
  elif [ -z "$phys" ]; then reason="path unreadable"
  else
    open=$(lsof -w -t +D "$d" 2>&1); rc=$?
    if [[ $nl$open == *$nl[0-9]* ]]; then reason="open by a process"
    elif [ $rc != 1 ] || [ -n "$open" ]; then reason="open files unreadable"; fi
  fi
  if [ -n "$reason" ]; then echo "KEPT $d ($reason)"; kept=$((kept + 1))
  elif [ $dry = 1 ]; then echo "WOULD-REMOVE $d"; removed=$((removed + 1))
  elif rm -rf -- "$d"; then echo "REMOVED $d"; removed=$((removed + 1)); [[ ${d##*/} == chk-* ]] && pruned=1
  else echo "KEPT $d (removal failed)"; kept=$((kept + 1))
  fi
}

[ -d "$sol" ] && for d in "$sol"/*; do one "$d"; done
seen=$nl
for r in "${CF_SWEEP_TMP:-/private/tmp}" "$t"; do
  bare r "$r"
  if [ -L "$r" ]; then echo "copy-sweep: $r is a link; its sol* folders were not swept" >&2; continue; fi
  [ -d "$r" ] && abs p "$r" -P && [[ $seen != *"$nl$p$nl"* ]] || continue   # a folder given twice is read once
  seen="$seen$p$nl"; abs r "$r" || continue
  for d in "$r"/sol*; do { [ -d "$d" ] || [ -L "$d" ]; } && one "$d"; done   # a sol* file is not a copy
done
[ -n "$checks" ] && for d in "$checks"/out-* "$checks"/chk-*; do one "$d"; done
[ $pruned = 1 ] && [ -d "$checks/main" ] && git -C "$checks/main" worktree prune
echo "copy-sweep: $( [ $dry = 1 ] && echo 'would remove' || echo removed ) $removed, kept $kept"
