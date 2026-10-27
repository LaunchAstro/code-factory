#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cases for orchestration/m5/lane-sweep.sh in a scratch home: which copies move to the Bin, which stay,
# what is archived, and that nothing outside the copies (tools, mirrors, the Bin's own contents) changes.
# No case reads or moves anything under the real home.
#
#   bash orchestration/tests/lane-sweep-cases.sh
set -uo pipefail

sweep=$(cd -- "$(dirname -- "$0")/.." && pwd)/m5/lane-sweep.sh
scratch=$(cd "$(mktemp -d)" && pwd -P)
holder_pid=
trap '[ -n "$holder_pid" ] && kill "$holder_pid" 2>/dev/null; [ -n "${KEEP_SCRATCH:-}" ] && echo "$scratch" || rm -rf "$scratch"' EXIT
fails=0
ok() { printf '  PASS  %s\n' "$1"; }
no() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else no "$1" "$2"; fi; }

export HOME="$scratch/home" GIT_CONFIG_GLOBAL="$scratch/gitconfig"
git config --global user.name sweep-case; git config --global user.email sweep@example.invalid
git config --global init.defaultBranch main; git config --global commit.gpgsign false
export LANE_ROOT=$HOME/lanes-root LANE_ARCHIVE_ROOT=$HOME/lanes-archive
L=$LANE_ROOT; day=$(date +%F); BIN=$HOME/.Trash/lane-sweep-$day; ARCH=$LANE_ARCHIVE_ROOT/$day
mkdir -p "$L"/{bin,logs,wt,lanes,sol,ds-wt,slice1} "$HOME/.Trash" "$HOME/vault/Orchestration" "$HOME/Library/LaunchAgents"
echo tool > "$L/bin/m5wt.sh"; echo round > "$L/slice1/notes.md"; echo owners > "$HOME/.Trash/already-here.txt"
old() { find "$1" -exec touch -h -t 202601010000 {} +; }

# origin on "GitHub", and the M5's bare mirror of it with a pushed m5/ branch
git init -q "$scratch/seed"; echo a > "$scratch/seed/a.txt"; git -C "$scratch/seed" add a.txt
git -C "$scratch/seed" commit -qm one
git clone -q --bare "$scratch/seed" "$scratch/origin.git"
git clone -q --bare "$scratch/origin.git" "$L/ops-astro.git"
git -C "$L/ops-astro.git" branch -q m5/run1 main

# wt/: worktrees of the mirror, as m5wt.sh makes them
git -C "$L/ops-astro.git" worktree add -q --detach "$L/wt/clean" m5/run1
git -C "$L/ops-astro.git" worktree add -q --detach "$L/wt/dirty" m5/run1; echo edit >> "$L/wt/dirty/a.txt"
git -C "$L/ops-astro.git" worktree add -q --detach "$L/wt/unpushed" m5/run1
echo b > "$L/wt/unpushed/b.txt"; git -C "$L/wt/unpushed" add b.txt; git -C "$L/wt/unpushed" commit -qm "made here only"
mkdir -p "$L/wt/clean/node_modules/x"; echo dep > "$L/wt/clean/node_modules/x/i.js"
# lanes/: clones, as a lane boot makes them
git clone -q "$scratch/origin.git" "$L/lanes/pushed"
git clone -q "$scratch/origin.git" "$L/lanes/branch-unpushed"
git -C "$L/lanes/branch-unpushed" checkout -qb lane/x; echo c > "$L/lanes/branch-unpushed/c.txt"
git -C "$L/lanes/branch-unpushed" add c.txt; git -C "$L/lanes/branch-unpushed" commit -qm "lane work, never pushed"
git -C "$L/lanes/branch-unpushed" checkout -q main
git clone -q "$scratch/origin.git" "$L/lanes/recent"
git clone -q "$scratch/origin.git" "$L/lanes/busy"
git init -q "$L/lanes/no-remote"; echo d > "$L/lanes/no-remote/d.txt"
git clone -q "$scratch/origin.git" "$L/lanes/wt-elsewhere"; git -C "$L/lanes/wt-elsewhere" worktree add -q --detach "$HOME/elsewhere" main
git clone -q "$scratch/origin.git" "$L/lanes/wt-inside"; git -C "$L/lanes/wt-inside" worktree add -q --detach "$L/lanes/wt-inside/.worktrees/r1" main
echo e >> "$L/lanes/wt-inside/.worktrees/r1/a.txt"
mkdir -p "$L/lanes/not-git"; echo f > "$L/lanes/not-git/f.txt"
# sol/: the Sol mirror (a clone every Sol copy is a worktree of) and one review copy
git clone -q "$scratch/origin.git" "$L/sol/mirror"
git -C "$L/sol/mirror" worktree add -q --detach "$L/sol/pr-1-abc" main
# top level: one old clone; the bare mirror and the tools are never candidates
git clone -q "$scratch/origin.git" "$L/oa-old"
# review findings (PR #264): a deep edit, a locked worktree, a stash, a service's copy, a hand-moved worktree
git clone -q "$scratch/origin.git" "$L/lanes/deep-edit"; mkdir -p "$L/lanes/deep-edit/apps/web/src"; echo v1 > "$L/lanes/deep-edit/apps/web/src/page.tsx"
git -C "$L/ops-astro.git" worktree add -q --detach "$L/wt/locked" m5/run1; git -C "$L/ops-astro.git" worktree lock "$L/wt/locked"
git clone -q "$scratch/origin.git" "$L/lanes/stashed"; echo s >> "$L/lanes/stashed/a.txt"; git -C "$L/lanes/stashed" stash -q
git clone -q "$scratch/origin.git" "$L/lanes/service"
printf '<plist><string>cd %s/lanes/service && exec ./run.sh</string></plist>\n' "$L" > "$HOME/Library/LaunchAgents/demo.plist"
git clone -q "$scratch/origin.git" "$L/lanes/serv"   # a name the service's path starts with: not named by it
git -C "$L/ops-astro.git" worktree add -q --detach "$L/wt/stash-a" m5/run1; echo t >> "$L/wt/stash-a/a.txt"; git -C "$L/wt/stash-a" stash -q
echo bin > "$L/wt/dirty/logo.png"; printf '\x00\x01' >> "$L/wt/dirty/logo.png"; git -C "$L/ops-astro.git" --work-tree="$L/wt/dirty" status >/dev/null
echo n > "$L/wt/dirty/caf\xc3\xa9.md"
git -C "$L/ops-astro.git" worktree add -q --detach "$L/wt/hand" m5/run1
echo h > "$L/wt/hand/h.txt"; git -C "$L/wt/hand" add h.txt; git -C "$L/wt/hand" commit -qm "only in the hand-moved copy"
mkdir -p "$HOME/.Trash/hand"; mv "$L/wt/hand" "$HOME/.Trash/hand/"
for c in "$L"/wt/* "$L"/lanes/* "$L"/sol/* "$L/oa-old" "$HOME/elsewhere" "$L/ops-astro.git/worktrees" "$L/sol/mirror/.git/worktrees"; do old "$c"; done
echo v2 >> "$L/lanes/deep-edit/apps/web/src/page.tsx"   # an existing file at depth 4, edited today
echo fresh > "$L/lanes/recent/fresh.txt"
git -C "$L/lanes/pushed" status >/dev/null; touch "$L/lanes/pushed/.git/FETCH_HEAD"   # an audit's git read is not activity
(cd "$L/lanes/busy" && exec sleep 120) & holder_pid=$!; disown
sleep 1

echo "dry run"
out=$(zsh "$sweep" --dry-run 2>&1); rc=$?
check "dry run exits 0" '[ $rc = 0 ]'
check "dry run names a copy it would move" '[[ $out == *"would move: wt/clean"* ]]'
check "dry run moves nothing" '[ -d "$L/wt/clean" ] && [ ! -e "$BIN" ]'
check "dry run archives nothing" '[ ! -e "$ARCH" ]'
check "dry run writes no report to the vault" '[ ! -e "$HOME/vault/Orchestration/Lane Sweep" ]'
check "dry run prints the report" '[[ $out == *"# Lane sweep, $day "*"(dry run)"* ]]'

echo "limit"
out=$(zsh "$sweep" --limit 3 2>&1); rc=$?
check "limit 3 checks 3" '[[ $out == *"checked: 3 "* ]]'
check "bad limit is refused" '! zsh "$sweep" --limit x >/dev/null 2>&1'

echo "full run"
out=$(zsh "$sweep" 2>&1); rc=$?
check "run exits 0" '[ $rc = 0 ]'
for c in wt/clean wt/dirty wt/unpushed wt/stash-a lanes/serv lanes/pushed lanes/branch-unpushed lanes/wt-inside sol/pr-1-abc oa-old; do
  check "moved to the Bin: $c" '[ ! -e "$L/$c" ] && [ -e "$BIN/$c/.git" ]'
done
for c in lanes/recent lanes/busy lanes/no-remote lanes/wt-elsewhere lanes/deep-edit wt/locked lanes/stashed lanes/service; do
  check "kept: $c" '[ -e "$L/$c/.git" ] && [ ! -e "$BIN/$c" ]'
done
check "the log says why each stayed" 'grep -q "KEPT recent lanes/recent" "$L/logs/lane-sweep-$day.log" && grep -q "KEPT busy lanes/busy" "$L/logs/lane-sweep-$day.log" && grep -q "KEPT no-remote lanes/no-remote" "$L/logs/lane-sweep-$day.log" && grep -q "KEPT worktree-elsewhere lanes/wt-elsewhere" "$L/logs/lane-sweep-$day.log"'
check "not a git copy: untouched" '[ -f "$L/lanes/not-git/f.txt" ]'
check "the Sol mirror is never moved" '[ -d "$L/sol/mirror/.git" ]'
check "tools, bare mirror and round folder untouched" '[ -f "$L/bin/m5wt.sh" ] && [ -d "$L/ops-astro.git" ] && [ -f "$L/slice1/notes.md" ]'
check "the Bin's own contents untouched" '[ -f "$HOME/.Trash/already-here.txt" ]'
check "a worktree's commit made only there is bundled" 'git -C "$scratch/origin.git" bundle verify -q "$ARCH/wt/unpushed/unpushed.bundle" 2>/dev/null'
check "a clone's unpushed lane branch is bundled" 'git -C "$scratch/origin.git" bundle verify -q "$ARCH/lanes/branch-unpushed/unpushed.bundle" 2>/dev/null && git -C "$scratch/origin.git" bundle list-heads "$ARCH/lanes/branch-unpushed/unpushed.bundle" | grep -q refs/heads/lane/x'
check "an uncommitted edit is saved as a patch" 'grep -q "^+edit" "$ARCH/wt/dirty/changes.patch"'
check "an untracked non-ASCII name is archived" 'tar -tzf "$ARCH/wt/dirty/untracked.tgz" | grep -q "caf"'
check "an inner worktree's edit is saved too" 'grep -q "^+e" "$ARCH/lanes/wt-inside/.worktrees/r1/changes.patch"'
check "a clean pushed copy's archive holds only where it came from" '[ "$(ls "$ARCH/wt/clean")" = info.txt ] && [ "$(ls "$ARCH/lanes/pushed")" = info.txt ]'
check "the mirror's moved worktrees leave its list, their record kept in the Bin" '! git -C "$L/ops-astro.git" worktree list | grep -q "wt/clean" && [ -f "$BIN/wt/clean.git-admin/HEAD" ]'
check "nothing is pruned: a hand-moved worktree's record stays" '[ -f "$L/ops-astro.git/worktrees/hand/HEAD" ] && git -C "$HOME/.Trash/hand/hand" log -1 --format=%s | grep -q "only in the hand-moved copy"'
check "a deep edit, a lock, a stash and a service each keep a copy" 'grep -q "KEPT recent lanes/deep-edit" "$L/logs/lane-sweep-$day.log" && grep -q "KEPT locked wt/locked" "$L/logs/lane-sweep-$day.log" && grep -q "KEPT stash lanes/stashed" "$L/logs/lane-sweep-$day.log" && grep -q "KEPT launch-agent lanes/service" "$L/logs/lane-sweep-$day.log"'
check "the Sol mirror's moved worktree leaves its list" '! git -C "$L/sol/mirror" worktree list | grep -q pr-1-abc && [ -f "$BIN/sol/pr-1-abc.git-admin/HEAD" ]'
r="$HOME/vault/Orchestration/Lane Sweep/$day.md"
check "the report is written" '[ -f "$r" ]'
# lanes/ sorts first: the limit run checks branch-unpushed (moved), busy and deep-edit (kept); the full run the other 15.
check "the report counts each run" 'grep -q "^- Checked: 3$" "$r" && grep -q "^- Moved: 1," "$r" && grep -q "^- Checked: 17$" "$r" && grep -q "^- Moved: 9," "$r" && grep -q "^- Kept: 8 (busy 1, launch-agent 1, locked 1, no-remote 1, recent 2, stash 1, worktree-elsewhere 1)$" "$r"'
check "the report names copies with unpushed commits" 'grep -q "lanes/branch-unpushed" "$r" && grep -q "wt/unpushed" "$r"'

echo "second run the same day"
out=$(zsh "$sweep" 2>&1); rc=$?
check "a rerun moves nothing more and still exits 0" '[ $rc = 0 ] && [[ $out == *"moved: 0 "* ]]'
check "a rerun leaves the first run's Bin folder whole" '[ -e "$BIN/wt/clean/.git" ]'
check "a rerun adds to the day's report" '[ "$(grep -c "^# Lane sweep, $day" "$r")" = 3 ]'

echo "an archive that can't be written"
git clone -q "$scratch/origin.git" "$L/lanes/late"; echo x >> "$L/lanes/late/a.txt"; old "$L/lanes/late"
chmod 555 "$ARCH/lanes"
out=$(zsh "$sweep" 2>&1); rc=$?
chmod 755 "$ARCH/lanes"
check "a failed archive keeps the copy and the run fails" '[ -d "$L/lanes/late/.git" ] && [ $rc != 0 ] && grep -q "KEPT archive-failed lanes/late" "$L/logs/lane-sweep-$day.log"'

if [ "$fails" -eq 0 ]; then echo "lane-sweep: all cases pass"; else echo "lane-sweep: $fails failing"; exit 1; fi
