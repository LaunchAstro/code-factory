#!/bin/zsh
# SPDX-License-Identifier: AGPL-3.0-only
# lane-sweep.sh: the M5's weekly safety sweep of lane work copies (owner, 21 October 2026).
# Lanes and Sol runs remove their own copies when their work is pushed (close-out); this catches the rest.
# It grew from the hand clean-up of 21 October, which moved 3,188 copies after two months with no tidy step.
#
# A candidate is a git copy (a folder whose own root holds .git) at the top of $LANE_ROOT or directly inside
# one of its holders (wt, lanes, sol, ds-wt), never a protected name. It stays when a process has it open, a
# LaunchAgent names it, a file outside node_modules and .git changed in the last 7 days (or its HEAD moved),
# it has no remote (nothing else may hold its commits), it is a locked worktree, it has a stash, or it is a
# clone with a live worktree outside itself. Otherwise its unpushed commits (a verified bundle), uncommitted
# edits and small untracked files go to $LANE_ARCHIVE_ROOT/<date>/<path>/; if any of that fails, the copy
# stays. Then the copy is MOVED to the Bin, ~/.Trash/lane-sweep-<date>/<path>, and a worktree's own record in
# its repository beside it as <path>.git-admin (moving both back restores it). Nothing is deleted or pruned:
# the Bin is the owner's to empty, never this script's. The report (checked, moved, kept, archived) is added
# to the vault's Orchestration/Lane Sweep/<date>.md ($LANE_ROOT/logs/lane-sweep-reports/ if there is
# no vault), the per-copy log to $LANE_ROOT/logs/lane-sweep-<date>.log.
#
# Usage: lane-sweep.sh [--dry-run] [--limit N]
#   --dry-run  moves and saves nothing; prints each copy it would move and the report, and writes only the log
#   --limit N  stops after N candidates checked
setopt null_glob extended_glob
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"
dry=0; limit=0
while (( $# )); do
  case $1 in
    --dry-run) dry=1; shift;;
    --limit) [[ $2 == <1-> ]] || { print -u2 "lane-sweep: --limit needs a number"; exit 2; }; limit=$2; shift 2;;
    *) print -u2 "usage: ${0:t} [--dry-run] [--limit N]"; exit 2;;
  esac
done
day=$(date +%F)
L=${LANE_ROOT:?set LANE_ROOT to the lanes folder}
ARCH=${LANE_ARCHIVE_ROOT:?set LANE_ARCHIVE_ROOT to the archive folder}/$day
BIN=$HOME/.Trash/lane-sweep-$day
LOG=$L/logs/lane-sweep-$day.log
REPORT_DIR="$HOME/vault/Orchestration/Lane Sweep"
[[ -d "$HOME/vault/Orchestration" ]] || REPORT_DIR=$L/logs/lane-sweep-reports   # no vault here
mkdir -p "$L/logs"; (( dry )) || mkdir -p "$REPORT_DIR"
print -r -- "--- $( (( dry )) && print 'dry ')run $(date '+%F %T %Z')" >> $LOG
# Never these, whatever they hold: the tools, the bare mirrors, Node, browser and npm caches, the round
# folders' shared parts, and the Sol mirror every Sol copy is a worktree of.
protect='^(bin|node-v.*|node2[0-9]|.*\.git|ms-playwright|ds-ms-playwright.*|ds-npm-cache|ds-m5-runner|dispatch|logs|gate-snap|mirror|skills-copy)$'

# Every path a process of ours has open (its folder or a file) under $LANE_ROOT, each ending in /.
busy=$(lsof -n -Fn -u "$USER" 2>/dev/null | sed -n "s#^n\($L/.*\)#\1/#p" | sort -u)

cands=()
for d in $L/*(/N); do
  b=${d:t}
  [[ $b =~ $protect ]] && continue
  if [[ -e $d/.git ]]; then cands+=$d
  elif [[ $b == (wt|lanes|sol|ds-wt) ]]; then
    for c in $d/*(/N); do [[ ${c:t} =~ $protect ]] || [[ ! -e $c/.git ]] || cands+=$c; done
  fi
done

# save COPY DEST: what only this copy may hold. A mirror's own branches count as pushed; a clone's only
# its remote-tracking refs and tags do. Fails (and the copy stays) if any part can't be written or checked.
save() {
  local p=$1 a=$2 common revs
  mkdir -p "$a" || return 1
  common=$(git -C "$p" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  { print "path: $p"; print "head: $(git -C "$p" rev-parse HEAD 2>/dev/null)"
    print "branch: $(git -C "$p" rev-parse --abbrev-ref HEAD 2>/dev/null)"; print "repo: $common"
    print "remote: $(git -C "$p" remote get-url origin 2>/dev/null)"; } > "$a/info.txt" || return 1
  if [[ $(git --git-dir="$common" rev-parse --is-bare-repository 2>/dev/null) == true ]]; then
    revs=(HEAD --not --branches --tags --remotes)
  else
    revs=(HEAD --branches --not --remotes --tags)
  fi
  if [[ -n $(git -C "$p" rev-list $revs 2>/dev/null | head -1) ]]; then
    git -C "$p" bundle create "$a/unpushed.bundle" $revs >/dev/null 2>&1 || return 1
    git -C "$p" bundle verify -q "$a/unpushed.bundle" >/dev/null 2>&1 || return 1
  fi
  git -C "$p" diff --binary HEAD > "$a/changes.patch" 2>/dev/null || return 1
  [[ -s $a/changes.patch ]] || rm -f "$a/changes.patch"
  # NUL-separated, so any file name survives; untracked.txt is the readable list
  git -C "$p" ls-files -z --others --exclude-standard 2>/dev/null \
    | grep -z -v -E '(^|/)(node_modules|\.next|dist|build|coverage|\.turbo|playwright-report|test-results|\.cache)/' \
    | grep -z -v -E '(^|/)\.env|\.env$' > "$a/untracked.lst"
  tr '\0' '\n' < "$a/untracked.lst" > "$a/untracked.txt" || return 1
  if [[ -s $a/untracked.txt ]]; then
    (cd "$p" && tar -czf "$a/untracked.tgz" --null -T "$a/untracked.lst" 2>/dev/null) || return 1
    [[ $(stat -f %z "$a/untracked.tgz") -gt 20971520 ]] && { rm -f "$a/untracked.tgz"; print "untracked over 20MB, list only" >> "$a/info.txt"; }
  else rm -f "$a/untracked.txt"; fi
  rm -f "$a/untracked.lst"
  return 0
}
held() { [[ -e $1/unpushed.bundle || -e $1/changes.patch || -e $1/untracked.txt ]]; }
isbusy() { lsof -n -Fn -u "$USER" 2>/dev/null | sed -n "s#^n\($L/.*\)#\1/#p" | grep -q -F -- "$1/"; }

# Every LaunchAgent's text: a copy a service runs from stays, whether or not the service is up.
agents=$(for f in $HOME/Library/LaunchAgents/*.plist(N); do plutil -convert xml1 -o - "$f" 2>/dev/null || cat "$f"; done)
n=0; moved=0; kept=0; failed=0; archived=0; unpushed=(); typeset -A why
keep() { print -r -- "KEPT $1 $rel" >> $LOG; kept=$((kept+1)); why[$1]=$(( ${why[$1]:-0} + 1 )); }
for p in $cands; do
  (( limit > 0 && n >= limit )) && break
  n=$((n+1))
  rel=${p#$L/}
  gd=$(git -C "$p" rev-parse --path-format=absolute --git-dir 2>/dev/null)
  if print -r -- "$busy" | grep -q -F -- "$p/"; then keep busy; continue; fi
  # the copy's path, then anything that can't continue a folder name
  if print -r -- "$agents" | grep -q -E -- "$(print -r -- "$p" | sed 's/[][\.*^$+?(){}|]/\\&/g')([^-_.A-Za-z0-9]|$)"; then keep launch-agent; continue; fi
  # Any file changed in 7 days, at any depth, outside node_modules and git's own folder (a read-only git
  # command such as an audit's status or fetch touches that); a commit or checkout shows in HEAD's log.
  if [[ -n $(find "$p" \( -name node_modules -o -path "$p/.git" \) -prune -o -newermt '-7 days' -print 2>/dev/null | head -1) ]] \
     || [[ -n $gd && -n $(find "$gd/HEAD" "$gd/logs/HEAD" -newermt '-7 days' 2>/dev/null) ]]; then
    keep recent; continue
  fi
  if [[ -z $(git -C "$p" remote 2>/dev/null) ]]; then keep no-remote; continue; fi
  if [[ -e $gd/locked ]]; then keep locked; continue; fi
  # a clone's own stash (a mirror's stash is shared by all its worktrees, and stays in the mirror anyway)
  if [[ -d $p/.git ]] && git -C "$p" rev-parse -q --verify refs/stash >/dev/null 2>&1; then keep stash; continue; fi
  if [[ -d $p/.git ]]; then
    outside=0
    for w in ${(f)"$(git -C "$p" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | tail -n +2)"}; do
      [[ -e $w && $w != $p/* ]] && outside=1
    done
    (( outside )) && { keep worktree-elsewhere; continue; }
  fi
  if (( dry )); then print -r -- "would move: $rel"; print -r -- "WOULD-MOVE $rel" >> $LOG; moved=$((moved+1)); continue; fi
  if [[ -e $BIN/$rel || -e $ARCH/$rel ]]; then keep moved-today; continue; fi
  ok=1
  save "$p" "$ARCH/$rel" || ok=0
  # A linked worktree inside the copy moves with it: save what it holds too.
  if (( ok )) && [[ -d $p/.git ]]; then
    for w in ${(f)"$(git -C "$p" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | tail -n +2)"}; do
      [[ -e $w && $w == $p/* ]] || continue
      save "$w" "$ARCH/$rel/${w#$p/}" || ok=0
    done
  fi
  if (( ! ok )); then print -r -- "KEPT archive-failed $rel (archive left in $ARCH/$rel)" >> $LOG; kept=$((kept+1)); failed=$((failed+1)); continue; fi
  held "$ARCH/$rel" && { archived=$((archived+1)); [[ -e $ARCH/$rel/unpushed.bundle ]] && unpushed+=$rel; }
  if isbusy "$p"; then keep busy; continue; fi
  mkdir -p "$BIN/${rel:h}"
  if err=$(mv "$p" "$BIN/$rel" 2>&1); then
    print -r -- "MOVED $rel" >> $LOG; moved=$((moved+1))
    # A worktree's own record in its repository (HEAD, its history) goes to the Bin beside it, never pruned.
    if [[ -f $BIN/$rel/.git && $gd == */worktrees/* && -d $gd ]]; then
      mv "$gd" "$BIN/$rel.git-admin" 2>/dev/null || print -r -- "ADMIN-LEFT $rel $gd" >> $LOG
    fi
  else print -r -- "FAILED $rel: $err" >> $LOG; failed=$((failed+1)); fi
done

word=moved; (( dry )) && word="would move"
reasons=(); for k in ${(ko)why}; do reasons+="$k ${why[$k]}"; done
report() {
  print -r -- "# Lane sweep, $day $(date +%H:%M)$( (( dry )) && print ' (dry run)')"
  print
  print -r -- "M5 lanes folder, copies idle 7 days or more. Script: Code Factory \`orchestration/m5/lane-sweep.sh\`."
  print
  print -r -- "- Checked: $n"
  print -r -- "- ${(C)word}: $moved, to \`$BIN\`. Nothing is deleted; only the owner empties the Bin."
  print -r -- "- Kept: $kept${reasons:+ (${(j:, :)reasons})}"
  print -r -- "- Archived: $archived, in \`$ARCH\` (unpushed commits, uncommitted edits, small untracked files)"
  (( ${#unpushed} )) && print -r -- "- With unpushed commits, saved as \`unpushed.bundle\`: ${(j:, :)unpushed}"
  (( failed )) && print -r -- "- Failed to move: $failed (see the log)"
  print -r -- "- Log: \`$LOG\`"
}
if (( dry )); then report; print -r -- "checked: $n  would move: $moved  kept: $kept  (log: $LOG)"; exit 0; fi
r="$REPORT_DIR/$day.md"
{ [[ -s $r ]] && print; report; } >> "$r"
print -r -- "checked: $n  moved: $moved  kept: $kept  archived: $archived  failed: $failed  (report: $r)"
(( failed == 0 ))
