#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cases for #328 in a scratch home: a Sol review (reviewer/sol-pr-cf.sh) leaves no copy behind when it ends,
# fails or is killed by TERM or INT, and copy-sweep.sh removes only old, unused copies: under its cf-sol prefix, and
# sol* folders directly inside /private/tmp (here a fixture, CF_SWEEP_TMP) and $TMPDIR.
# Cases for #369: Sol runs with $TMPDIR inside its copy, so the sol* folders it makes there go with the copy, their
# proof files saved first; any proof that can't be saved keeps the copy, marked KEPT.
# GitHub, codex and the trust gate are stubs; git, the codex shim and the prompt renderer are the real ones.
# Nothing here reads or removes anything outside the scratch folder.
#
#   bash orchestration/tests/sol-copies-cases.sh
set -uo pipefail

here=$(cd -- "$(dirname -- "$0")/.." && pwd)
sol=$here/reviewer/sol-pr-cf.sh
sweep=$here/copy-sweep.sh
scratch=$(cd "$(mktemp -d)" && pwd -P)
holder_pid=; queued_pid=
cleanup() {
  [ -n "$holder_pid" ] && kill "$holder_pid" 2>/dev/null
  [ -n "$queued_pid" ] && kill "$queued_pid" 2>/dev/null
  [ -f "$scratch/mark/codex.pid" ] && kill "$(cat "$scratch/mark/codex.pid")" 2>/dev/null
  [ -n "${KEEP_SCRATCH:-}" ] && echo "$scratch" || rm -rf "$scratch"
}
trap cleanup EXIT
fails=0
ok() { printf '  PASS  %s\n' "$1"; }
no() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else no "$1" "$2"; fi; }
# Polls a condition for up to 60 seconds; no fixed waits.
until_true() { local i=0; until eval "$1"; do i=$((i + 1)); [ $i -ge 600 ] && return 1; /bin/sleep 0.1; done; }

export HOME="$scratch/home" GIT_CONFIG_GLOBAL="$scratch/gitconfig" TMPDIR="$scratch/tmp"
export CF_SWEEP_TMP="$scratch/ptmp"   # every sweep here reads this fixture, never the live /private/tmp
git config --global user.name copies-case; git config --global user.email copies@example.invalid
git config --global init.defaultBranch main; git config --global commit.gpgsign false
mkdir -p "$TMPDIR" "$CF_SWEEP_TMP" "$scratch/bin" "$scratch/mark"

# ---- the review: a fixture origin with a pull request head, and stubs for everything remote ----
N=987654
git init -q "$scratch/seed"; echo a > "$scratch/seed/a.txt"; git -C "$scratch/seed" add a.txt; git -C "$scratch/seed" commit -qm one
git clone -q --bare "$scratch/seed" "$scratch/origin.git"
echo b > "$scratch/seed/b.txt"; git -C "$scratch/seed" add b.txt; git -C "$scratch/seed" commit -qm two
git -C "$scratch/seed" push -q "$scratch/origin.git" HEAD:refs/pull/$N/head
export FAKE_HEAD=$(git -C "$scratch/seed" rev-parse HEAD) FAKE_ORIGIN="$scratch/origin.git" FAKE_MARK="$scratch/mark" FAKE_PR=$N
H7=${FAKE_HEAD:0:7}

cat > "$scratch/bin/gh" <<'EOF'
#!/bin/bash
case "$1 $2" in
  "pr view") case "$*" in
      *headRefOid*) echo "$FAKE_HEAD" ;;
      *headRefName*) echo fix-branch ;;
      *closingIssuesReferences*) ;;
      *title,body*) printf '   a title\n   **Why:** a case\n' ;;
      *"--json body"*) echo "a body" ;;
    esac ;;
  "repo clone") exec git clone -q "$FAKE_ORIGIN" "$4" ;;
  # Open PRs are the private repository's (#323). The old name is the public copy's, whose open PRs are other heads.
  "pr list") [ -n "${FAKE_GH_FAIL:-}" ] && exit 1
    repo=; prev=; for a in "$@"; do [ "$prev" = -R ] && repo=$a; prev=$a; done
    [ "$(printf '%s' "$repo" | tr A-Z a-z)" = launchastro/code-factory-private ] && printf '%s\n' ${FAKE_OPEN_HEADS:-}; exit 0 ;;
  *) exit 0 ;;
esac
EOF
# codex: answers --version as a build that runs gpt-6.1-sol (#372); a review notes where its copy was while it ran,
# then ends (ok), fails (fail) or runs until stopped (hang).
cat > "$scratch/bin/codex" <<'EOF'
#!/bin/bash
[ "${1:-}" = --version ] && { echo "codex-cli 0.164.0"; exit 0; }
p=$(cat); wt=$(printf '%s\n' "$p" | sed -n 's/^Worktree: \(.*\) (at that head)$/\1/p')
patch=$(printf '%s\n' "$p" | sed -n 's/^Diff file: //p')
[ -d "$wt" ] && [ -f "$patch" ] && printf '%s\n' "$wt" > "$FAKE_MARK/seen"
# Sol's own temp folder (#369) in its $TMPDIR, named for this run, with a proof.
printf '%s\n' "$TMPDIR" > "$FAKE_MARK/tmpdir"; echo $$ > "$FAKE_MARK/sol.pid"
mkdir -p "${TMPDIR%/}/sol$FAKE_PR-t$$" && echo proof > "${TMPDIR%/}/sol$FAKE_PR-t$$/p.txt"
# With FAKE_BIG, that folder also holds build output and a file over 20 MB, which are not proofs.
[ -n "${FAKE_BIG:-}" ] && mkdir -p "${TMPDIR%/}/sol$FAKE_PR-t$$/target/debug" && echo out > "${TMPDIR%/}/sol$FAKE_PR-t$$/target/debug/x" \
  && dd if=/dev/zero of="${TMPDIR%/}/sol$FAKE_PR-t$$/big.bin" bs=1048576 count=21 2>/dev/null
echo "codex log line"
case $FAKE_CODEX in
  ok) echo proof > "$wt/proof.txt"; exit 0 ;;
  fail) exit 3 ;;
  hang) echo $$ > "$FAKE_MARK/codex.pid"; exec /bin/sleep 120 ;;
  badproof) echo proof > "$wt/proof.txt"; chmod 000 "$wt/proof.txt"; exit 0 ;;   # its worktree proof can't be read
  proofhang) echo proof > "$wt/proof.txt"; echo $$ > "$FAKE_MARK/codex.pid"; exec /bin/sleep 120 ;;
  # slow to stop: half a second after TERM it still writes into its copy (mkdir -p would remake a removed one)
  slow) trap '/bin/sleep 0.5; mkdir -p "$wt/late"; echo late > "$wt/late/x"; exit 0' TERM
        echo $$ > "$FAKE_MARK/codex.pid"; /bin/sleep 120 & wait ;;
esac
EOF
cat > "$scratch/bin/perl" <<'EOF'
#!/bin/bash
case $2 in *'codex-shim watchdog'*) echo $$ > "$FAKE_MARK/wd.pid" ;; esac
case $2 in *'my $go'*) [ -n "${FAKE_PERL_HOLD:-}" ] && { echo $$ > "$FAKE_MARK/perl.pid"; read -t 150 <> "$FAKE_MARK/hold"; } ;; esac
exec /usr/bin/perl "$@"
EOF
# Each review takes a Codex slot (#380) from a fake M5 in the scratch folder, through a fake ssh, never the real one.
M5=$scratch/m5; mkdir -p "$M5/.codex-slots"; : > "$M5/.codex-slots/LOCK-HOST"
printf '#!/bin/sh\nwhile [ "$1" = -o ]; do shift 2; done\nshift\ncd "%s" && HOME="%s" CODEX_SLOT_ME=m5 exec sh -c "$*"\n' "$M5" "$M5" > "$scratch/bin/ssh-fake"
chmod +x "$scratch/bin/gh" "$scratch/bin/codex" "$scratch/bin/perl" "$scratch/bin/ssh-fake"
export PATH="$scratch/bin:$PATH"
unset CODEX_SLOTS CODEX_SLOT_HELD CODEX_SLOT_DIR
export CODEX_SLOT_HOST=m5 CODEX_SLOT_SSH="$scratch/bin/ssh-fake" CODEX_SLOT_ME=laptop CODEX_SLOT_FALLBACK=0 CODEX_SLOT_POLL=0.1

R="$scratch/round root"; export SOL_RL_ROOT=$R
mkdir -p "$R/polish" "$R/tools-orch" "$HOME/.cache/code-factory/orchestration/trust-gate" "$HOME/.claude/skills/build-review"
ln -s "$here/reviewer" "$R/tools-orch/reviewer"
ln -s "$here/reviewer" "$HOME/.cache/code-factory/orchestration/reviewer"
printf '#!/usr/bin/env python3\nprint("Rules: none open.")\n' > "$R/tools-orch/sol_rules.py"
printf '#!/bin/zsh\necho "HOLD case"\n' > "$R/tools-orch/sol-rl-gate.sh"
cat > "$HOME/.cache/code-factory/orchestration/trust-gate/trust-gate.sh" <<'EOF'
#!/bin/bash
printf '{"comments":[{"body":"Head SHA: %s\\nVerdict: approve","url":"https://example.invalid/c1"}]}\n' "$FAKE_HEAD"
EOF
chmod +x "$R/tools-orch/sol-rl-gate.sh" "$HOME/.cache/code-factory/orchestration/trust-gate/trust-gate.sh"
echo "Always blocks." > "$HOME/.claude/skills/build-review/ALWAYS-BLOCKS.md"
echo "Reviewer." > "$HOME/.claude/skills/build-review/REVIEWER.md"
SW=$HOME/Desktop/Projects/code-factory-sol
PD=$R/handbacks/sol-proofs/pr-$N-$H7

# No copy anywhere: nothing under the prefix, no review worktree left in the mirror, no patch left in polish/.
no_copy() {
  [ -z "$(ls -A "$TMPDIR/cf-sol" 2>/dev/null)" ] && [ -z "$(ls -d "$SW"/pr-* 2>/dev/null)" ] \
    && [ -z "$(ls -d "$R"/polish/sol-pr*/ 2>/dev/null)" ] \
    && [ "$(git -C "$SW/mirror" worktree list --porcelain | grep -c '^worktree ')" = 1 ]
}
alive() { kill -0 "$1" 2>/dev/null; }
# Sol's temp folder (#369) of the last codex run: its $TMPDIR was inside its copy, and the folder's proof is saved.
temps_gone() {
  [[ $(cat "$scratch/mark/tmpdir") == "$TMPDIR"/cf-sol/* ]] && [ -f "$PD/tmpdir/sol$N-t$(cat "$scratch/mark/sol.pid")/p.txt" ]
}
old() { find "$1" -exec touch -h -t 202601010000 {} +; }
review() {  # review <codex mode>: starts one review; sets bg to the background run's pid
  rm -f "$scratch/mark/"*; : > "$R/events.log"
  out=$(FAKE_CODEX=$1 zsh "$sol" $N case 2>&1); rc=$?
  bg=$(printf '%s\n' "$out" | sed -n 's/^OK pid \([0-9]*\) .*/\1/p')
}

echo "a review that ends"
FAKE_BIG=1 review ok
check "it dispatched" '[ $rc = 0 ] && [ -n "$bg" ]'
until_true '! alive $bg'
check "codex's \$TMPDIR was inside its copy; its temp folder's proof is saved" 'temps_gone'
check "its build output and a file over 20 MB are not saved" '[ ! -e "$PD/tmpdir/sol$N-t$(cat "$scratch/mark/sol.pid")/target" ] && [ ! -e "$PD/tmpdir/sol$N-t$(cat "$scratch/mark/sol.pid")/big.bin" ]'
check "codex saw its copy under \$TMPDIR/cf-sol while it ran" '[[ $(cat "$scratch/mark/seen" 2>/dev/null) == "$TMPDIR"/cf-sol/* ]]'
check "no copy is left" 'no_copy'
check "the run line is in events.log" 'grep -q "SOL-PR cf$N RUN-END lane=case" "$R/events.log"'
check "the prompt stays" '[ -s "$R/polish/sol-pr-$N-$H7.txt" ]'
check "a short run log stays" '[ -s "$SW/run-pr-$N-$H7.log" ] && [ $(wc -c < "$SW/run-pr-$N-$H7.log") -lt 20000 ]'
check "Sol's proof files are saved" '[ -f "$R/handbacks/sol-proofs/pr-$N-$H7/proof.txt" ]'

echo "a review whose codex run fails"
review fail
until_true '! alive $bg'
check "codex ran against the copy" '[ -s "$scratch/mark/seen" ]'
check "no copy is left" 'no_copy'
check "its temp folder went with the copy, its proof saved" 'temps_gone'
check "the run line is in events.log" 'grep -q "SOL-PR cf$N RUN-END" "$R/events.log"'

echo "a review that fails before codex starts (no policy files)"
mv "$HOME/.claude/skills/build-review" "$scratch/policies-away"
review ok
check "it refuses" '[ $rc != 0 ] && [ -z "$bg" ]'
check "no copy is left" 'no_copy'
mv "$scratch/policies-away" "$HOME/.claude/skills/build-review"

for sig in TERM INT; do for mode in hang slow; do
  echo "a review killed by $sig while codex runs ($mode to stop)"
  review $mode
  until_true '[ -s "$scratch/mark/codex.pid" ]'
  cpid=$(cat "$scratch/mark/codex.pid")
  kill -$sig "$bg"
  until_true '! alive $bg'
  check "no copy is left" 'no_copy'
  check "the codex run it started is stopped" 'until_true "! alive $cpid"'
  check "its deadline watchdog is stopped" 'until_true "! alive $(cat "$scratch/mark/wd.pid")"'
  check "a short run log stays" '[ -s "$SW/run-pr-$N-$H7.log" ]'
  check "its temp folder went with the copy, its proof saved" 'temps_gone'
done; done

echo "a review killed before its codex child has a process group of its own"
rm -f "$scratch/mark/"*; mkfifo "$scratch/mark/hold"; : > "$R/events.log"
out=$(FAKE_PERL_HOLD=1 FAKE_CODEX=ok zsh "$sol" $N case 2>&1); bg=$(printf '%s\n' "$out" | sed -n 's/^OK pid \([0-9]*\) .*/\1/p')
until_true '[ -s "$scratch/mark/perl.pid" ]'; ppid_=$(cat "$scratch/mark/perl.pid")
kill -TERM "$bg"; until_true '! alive $bg'
check "the held child is stopped" 'until_true "! alive $ppid_"'
check "its deadline watchdog is stopped" '[ ! -s "$scratch/mark/wd.pid" ] || until_true "! alive $(cat "$scratch/mark/wd.pid")"'
check "no copy is left" 'no_copy'
kill "$ppid_" 2>/dev/null

echo "a review one of whose proofs can't be saved, though the next ones can"
review badproof; until_true '! alive $bg'
kept=$(ls -d "$TMPDIR"/cf-sol/*/ 2>/dev/null | head -1); kept=${kept%/}
check "the copy stays, marked KEPT" '[ -n "$kept" ] && [ -e "$kept/wt/proof.txt" ] && [ -s "$kept/KEPT" ]'
rm -rf "$kept"; git -C "$SW/mirror" worktree prune

echo "a review killed when Sol's proof files can't be saved"
mv "$R/handbacks" "$scratch/handbacks-away"; echo "not a folder" > "$R/handbacks"
review proofhang
until_true '[ -s "$scratch/mark/codex.pid" ]'; kill -TERM "$bg"; until_true '! alive $bg'
kept=$(ls -d "$TMPDIR"/cf-sol/*/ 2>/dev/null | head -1); kept=${kept%/}
check "the copy stays, with the unsaved proof" '[ -f "$kept/wt/proof.txt" ]'
check "it is marked KEPT" '[ -s "$kept/KEPT" ]'
check "the run log says so" 'grep -q "proofs not saved" "$SW/run-pr-$N-$H7.log"'
old "$kept"; CF_SOL_DIR=$TMPDIR/cf-sol bash "$sweep" > "$scratch/kept.txt" 2>&1
check "the sweep leaves a copy marked KEPT" '[ -f "$kept/wt/proof.txt" ] && grep -q "KEPT $kept (marked KEPT" "$scratch/kept.txt"'
rm "$R/handbacks"; mv "$scratch/handbacks-away" "$R/handbacks"
rm -rf "$kept"; git -C "$SW/mirror" worktree prune

echo "a temp folder with a space in its path: cleanup removes only the copy"
mkdir -p "$scratch/Review" "$scratch/Review Copies"; echo keep > "$scratch/Review/keep.txt"
mkdir -p "$scratch/Copies/cf-sol"; echo keep > "$scratch/Copies/cf-sol/keep.txt"
TMPDIR_WAS=$TMPDIR; export TMPDIR="$scratch/Review Copies"
mv "$HOME/.claude/skills/build-review" "$scratch/policies-away"
review ok
check "a failure before dispatch leaves no copy" '[ $rc != 0 ] && no_copy'
mv "$scratch/policies-away" "$HOME/.claude/skills/build-review"
review hang
until_true '[ -s "$scratch/mark/codex.pid" ]'; kill -TERM "$bg"; until_true '! alive $bg'
check "a killed review leaves no copy" 'no_copy'
review ok
until_true '! alive $bg'
check "a review that ends leaves no copy, and saves its proofs" 'no_copy && [ -f "$R/handbacks/sol-proofs/pr-$N-$H7/proof.txt" ]'
check "the folders its split words would name are untouched" '[ -f "$scratch/Review/keep.txt" ] && [ -f "$scratch/Copies/cf-sol/keep.txt" ]'
export TMPDIR=$TMPDIR_WAS

echo "the prompt renderer's default patch folder is under the prefix"
git -C "$scratch/seed" checkout -q --detach "$FAKE_HEAD"; echo "1. a criterion" > "$scratch/crit.md"; echo checks > "$scratch/checks.md"
p=$(python3 "$here/reviewer/make_sol_prompt.py" $N b "$(git -C "$scratch/seed" rev-parse HEAD~1)" "$FAKE_HEAD" "$scratch/seed" \
  "$scratch/crit.md" --repo o/r --checks "$scratch/checks.md" --policy-root "$HOME/.claude/skills" | sed -n 's/^Diff file: //p')
check "the patch is under \$TMPDIR/cf-sol" '[[ $p == "$TMPDIR"/cf-sol/* ]] && [ -f "$p" ]'
rm -rf "$TMPDIR/cf-sol"

# ---- the sweep: fixtures only, under the scratch folder ----
C=$TMPDIR/cf-sol
mkcopy() { mkdir -p "$1/sub"; echo x > "$1/sub/f.txt"; }

echo "the sweep of the cf-sol prefix"
mkcopy "$C/old"; old "$C/old"
mkcopy "$C/old two"; mkcopy "$scratch/target"; ln -s "$scratch/target" "$C/old two/out"; old "$C/old two"; old "$scratch/target"
mkcopy "$C/young"
mkcopy "$C/busy"; old "$C/busy"
mkcopy "$scratch/outside"; old "$scratch/outside"; ln -s "$scratch/outside" "$C/link"
mkcopy "$TMPDIR/pr1-abc-legacy"; old "$TMPDIR/pr1-abc-legacy"
mkdir -p "$SW"; echo kept > "$SW/run-pr-1-abc.log"; old "$SW/run-pr-1-abc.log"
(cd "$C/busy/sub" && exec /bin/sleep 120) & holder_pid=$!
until_true '[ -n "$(lsof -t +D "$C/busy" 2>/dev/null)" ]'   # lsof exits 1 even when it finds one

dry=$(bash "$sweep" --dry-run 2>&1); drc=$?
check "a dry run exits 0" '[ $drc = 0 ]'
check "a dry run lists the old copy" 'grep -qx "WOULD-REMOVE $C/old" <<< "$dry"'
check "a dry run removes nothing" '[ -d "$C/old" ] && [ -d "$C/young" ] && [ -d "$C/busy" ]'
live=$(bash "$sweep" 2>&1); lrc=$?
check "a sweep exits 0" '[ $lrc = 0 ]'
check "an old unused copy is removed" '[ ! -e "$C/old" ] && grep -qx "REMOVED $C/old" <<< "$live"'
check "a copy younger than 6 hours is kept" '[ -f "$C/young/sub/f.txt" ] && grep -q "KEPT $C/young (changed" <<< "$live"'
check "a copy a process has open is kept" '[ -f "$C/busy/sub/f.txt" ] && grep -q "KEPT $C/busy (open" <<< "$live"'
check "an old copy named with a space is removed" '[ ! -e "$C/old two" ] && grep -qx "REMOVED $C/old two" <<< "$live"'
check "a link inside a removed copy is not followed" '[ -f "$scratch/target/sub/f.txt" ]'
check "a link under the prefix is not followed or removed" '[ -L "$C/link" ] && [ -f "$scratch/outside/sub/f.txt" ]'
check "a folder outside the candidates is never touched" '[ -f "$TMPDIR/pr1-abc-legacy/sub/f.txt" ]'
check "the run log a lane keeps survives" '[ -f "$SW/run-pr-1-abc.log" ]'
kill $holder_pid 2>/dev/null; wait $holder_pid 2>/dev/null; holder_pid=

echo "the sweep keeps a copy when lsof can't tell"
mkdir -p "$scratch/lsofbin"; printf '#!/bin/sh\nexit 2\n' > "$scratch/lsofbin/lsof"; chmod +x "$scratch/lsofbin/lsof"
mkcopy "$C/unread"; old "$C/unread"
un=$(PATH="$scratch/lsofbin:$PATH" bash "$sweep" 2>&1)
check "an old copy lsof fails on is kept" '[ -d "$C/unread" ] && grep -q "KEPT $C/unread (open files unreadable" <<< "$un"'
printf '#!/bin/sh\necho "lsof: WARNING: cannot stat some file system" >&2\nexit 1\n' > "$scratch/lsofbin/lsof"
un=$(PATH="$scratch/lsofbin:$PATH" bash "$sweep" 2>&1)
check "an old copy lsof reports an error on (exit 1, nothing found) is kept" '[ -d "$C/unread" ] && grep -q "KEPT $C/unread (open files unreadable" <<< "$un"'
rm -rf "$C/unread"

echo "the sweep refuses a folder that is not the prefix"
CF_SOL_DIR=$scratch bash "$sweep" > /dev/null 2>&1; rrc=$?
check "CF_SOL_DIR not named cf-sol exits 2" '[ $rrc = 2 ] && [ -d "$scratch/outside" ]'

echo "the sweep of sol* folders in /private/tmp and \$TMPDIR"
P=$CF_SWEEP_TMP
mkcopy "$P/sol164-review.old"; old "$P/sol164-review.old"
mkcopy "$TMPDIR/sol149-old"; old "$TMPDIR/sol149-old"
mkcopy "$P/sol-young"
mkcopy "$P/sol-busy"; old "$P/sol-busy"
mkcopy "$P/sol-kept"; touch "$P/sol-kept/KEPT"; old "$P/sol-kept"
mkcopy "$P/sol-named"; old "$P/sol-named"
for n in notsol-x x-sol Sol-upper; do mkcopy "$P/$n"; old "$P/$n"; done
mkcopy "$TMPDIR/pr2-neighbour"; old "$TMPDIR/pr2-neighbour"
echo log > "$P/sol-151-build.log"; old "$P/sol-151-build.log"
mkcopy "$scratch/solout"; old "$scratch/solout"; ln -s "$scratch/solout" "$P/sol-link"
mkcopy "$TMPDIR/cf-sol/sol-inner"   # young, inside the cf-sol prefix: the cf-sol rules, not a sol* of $TMPDIR
(cd "$P/sol-busy/sub" && exec /bin/sleep 120) & holder_pid=$!
until_true '[ -n "$(lsof -t +D "$P/sol-busy" 2>/dev/null)" ]'
# On macOS a process may name /private/... by its short path (/tmp/..., /var/...): that still keeps it.
named=$P/sol-named; [[ $named == /private/* ]] && named=${named#/private}
/usr/bin/perl -e 'sleep 120' "$named" & queued_pid=$!
dry=$(bash "$sweep" --dry-run 2>&1); drc=$?
check "a dry run exits 0 and lists the old sol* folders" '[ $drc = 0 ] && grep -qx "WOULD-REMOVE $P/sol164-review.old" <<< "$dry" && grep -qx "WOULD-REMOVE $TMPDIR/sol149-old" <<< "$dry"'
check "a dry run removes no sol* folder" '[ -d "$P/sol164-review.old" ] && [ -d "$TMPDIR/sol149-old" ]'
live=$(bash "$sweep" 2>&1); lrc=$?
check "a sweep of the temp folders exits 0" '[ $lrc = 0 ]'
check "an old unused sol* in /private/tmp goes" '[ ! -e "$P/sol164-review.old" ] && grep -qx "REMOVED $P/sol164-review.old" <<< "$live"'
check "an old unused sol* in \$TMPDIR goes" '[ ! -e "$TMPDIR/sol149-old" ] && grep -qx "REMOVED $TMPDIR/sol149-old" <<< "$live"'
check "a young sol* is kept" '[ -f "$P/sol-young/sub/f.txt" ] && grep -q "KEPT $P/sol-young (changed" <<< "$live"'
check "a sol* a process has open is kept" '[ -f "$P/sol-busy/sub/f.txt" ] && grep -q "KEPT $P/sol-busy (open" <<< "$live"'
check "a sol* its review marked KEPT is kept" '[ -f "$P/sol-kept/sub/f.txt" ] && grep -q "KEPT $P/sol-kept (marked KEPT" <<< "$live"'
check "a sol* a process names by its short path is kept" '[ -f "$P/sol-named/sub/f.txt" ] && grep -q "KEPT $P/sol-named (named by a running process" <<< "$live"'
check "a non-sol* neighbour is never touched or listed" '[ -f "$P/notsol-x/sub/f.txt" ] && [ -f "$P/x-sol/sub/f.txt" ] && [ -f "$P/Sol-upper/sub/f.txt" ] && [ -f "$TMPDIR/pr2-neighbour/sub/f.txt" ] && ! grep -q -e notsol -e x-sol -e Sol-upper -e pr2-neighbour <<< "$live"'
check "a sol* file is never touched or listed" '[ -f "$P/sol-151-build.log" ] && ! grep -q sol-151 <<< "$live"'
check "a sol* link is not followed or removed" '[ -L "$P/sol-link" ] && [ -f "$scratch/solout/sub/f.txt" ] && grep -q "KEPT $P/sol-link (not a folder" <<< "$live"'
check "the cf-sol prefix is swept once, by its own rules" '[ -d "$TMPDIR/cf-sol/sol-inner" ] && [ "$(grep -c "sol-inner" <<< "$live")" = 1 ]'
kill $holder_pid $queued_pid 2>/dev/null; wait $holder_pid $queued_pid 2>/dev/null; holder_pid=; queued_pid=
mkdir -p "$scratch/ptmp-real"; mkcopy "$scratch/ptmp-real/sol-far"; old "$scratch/ptmp-real/sol-far"; ln -s "$scratch/ptmp-real" "$scratch/ptmp-link"
lk=$(CF_SWEEP_TMP=$scratch/ptmp-link bash "$sweep" 2>&1); lkrc=$?
check "a temp folder that is a link is not followed" '[ $lkrc = 0 ] && [ -d "$scratch/ptmp-real/sol-far" ] && grep -q "ptmp-link is a link" <<< "$lk"'
lk=$(CF_SWEEP_TMP=$scratch/ptmp-link// bash "$sweep" 2>&1); lkrc=$?
lk2=$(TMPDIR=$scratch/ptmp-link/// bash "$sweep" 2>&1); lk2rc=$?
check "a temp folder that is a link is not followed when given with trailing slashes" '[ $lkrc = 0 ] && [ $lk2rc = 0 ] && [ -d "$scratch/ptmp-real/sol-far" ] && ! grep -q sol-far <<< "$lk$lk2" && grep -q "ptmp-link is a link" <<< "$lk" && grep -q "ptmp-link is a link" <<< "$lk2"'
nlt=$(CF_SWEEP_TMP="$scratch/ptmp-real"$'\n' bash "$sweep" 2>&1); nltrc=$?
nlt2=$(TMPDIR="$scratch/ptmp-real"$'\n' bash "$sweep" 2>&1); nlt2rc=$?
check "a temp folder named with a trailing newline is not read as the folder without it" '[ $nltrc = 0 ] && [ $nlt2rc = 0 ] && [ -d "$scratch/ptmp-real/sol-far" ] && ! grep -q sol-far <<< "$nlt$nlt2"'
mkdir -p "$scratch/ptmp-real"$'\n'
nlr=$(CF_SWEEP_TMP="$scratch/ptmp-real"$'\n' bash "$sweep" 2>&1); nlrrc=$?
check "a temp folder whose name ends in a newline is read as itself, not as its neighbour" '[ $nlrrc = 0 ] && [ -d "$scratch/ptmp-real/sol-far" ] && ! grep -q sol-far <<< "$nlr"'
rm -rf "$scratch/ptmp-real"$'\n'
mkcopy "$TMPDIR/cf-sol/sol-nl"; old "$TMPDIR/cf-sol/sol-nl"
CF_SOL_DIR="$TMPDIR/cf-sol"$'\n' bash "$sweep" > /dev/null 2>&1; nlsrc=$?
check "CF_SOL_DIR with a trailing newline exits 2 and removes nothing" '[ $nlsrc = 2 ] && [ -d "$TMPDIR/cf-sol/sol-nl" ]'
rm -rf "$TMPDIR/cf-sol/sol-nl"
mkcopy "$TMPDIR/sol-twice"; old "$TMPDIR/sol-twice"
same=$(CF_SWEEP_TMP=$TMPDIR bash "$sweep" --dry-run 2>&1)
check "a temp folder given twice is read once" '[ "$(grep -c "sol-twice" <<< "$same")" = 1 ] && [ -d "$TMPDIR/sol-twice" ]'
rm -rf "$P"/sol-* "$TMPDIR/sol-twice" "$TMPDIR/cf-sol/sol-inner"

echo "the sweep of the M5's checks folder"
K=$scratch/m5; mkdir -p "$K"
git clone -q "$scratch/origin.git" "$K/main"
SHA_OPEN=$(printf 'a%.0s' $(seq 40)); SHA_SHUT=$(printf 'b%.0s' $(seq 40))
green() { mkdir -p "$K/$1"; printf 'node-test\t0\t10\nDONE\t0\t0\n' > "$K/$1/summary.tsv"; old "$K/$1"; }
green out-$SHA_OPEN-1; touch -h -t 202601010100 "$K/out-$SHA_OPEN-1"        # the newer green run of an open PR
green out-$SHA_OPEN-2                                                        # an older green run of it
mkdir -p "$K/out-$SHA_OPEN-3"; printf 'node-test\t1\t10\nDONE\t0\t0\n' > "$K/out-$SHA_OPEN-3/summary.tsv"
touch -h -t 202601010200 "$K/out-$SHA_OPEN-3/summary.tsv" "$K/out-$SHA_OPEN-3"  # the newest run of it, red
green out-$SHA_SHUT-1                                                        # a green run of a closed PR
git -C "$K/main" worktree add -q --detach "$K/chk-old" HEAD; old "$K/chk-old"
git -C "$K/main" worktree add -q --detach "$K/chk-queued" HEAD; old "$K/chk-queued"   # its check waits for the lock
/usr/bin/perl -e 'sleep 120' "$K/chk-queued" & queued_pid=$!
mkcopy "$K/out-young"
mkcopy "$K/red-out-x"; old "$K/red-out-x"
echo tool > "$K/green-run.sh"; old "$K/green-run.sh"

git -C "$K/main" worktree add -q --detach "$K/chk-rel" HEAD; old "$K/chk-rel"
/usr/bin/perl -e 'sleep 120' "$K/chk-rel" & rel_pid=$!
rel=$(cd "$K" && FAKE_GH_FAIL=1 bash "$sweep" --dry-run --checks . 2>&1)
ln -s "$K" "$scratch/m5-link"
FAKE_GH_FAIL=1 bash "$sweep" --dry-run --checks "$scratch/m5-link//" > /dev/null 2>&1; klrc=$?
check "--checks given a link, even with trailing slashes, exits 2" '[ $klrc = 2 ]'
FAKE_GH_FAIL=1 bash "$sweep" --checks "$K"$'\n' > /dev/null 2>&1; knrc=$?
check "--checks naming a missing folder by a trailing newline exits 2 and removes nothing" '[ $knrc = 2 ] && [ -d "$K/chk-old" ] && [ -d "$K/out-$SHA_SHUT-1" ]'
mkdir -p "$K"$'\n'
FAKE_GH_FAIL=1 bash "$sweep" --checks "$K"$'\n' > /dev/null 2>&1
check "--checks naming a folder whose name ends in a newline reads that folder, not its neighbour" '[ -d "$K/chk-old" ] && [ -d "$K/out-$SHA_SHUT-1" ]'
rm -rf "$K"$'\n'
check "--checks given as a relative path still keeps a check its waiting process names" 'grep -q "KEPT $K/chk-rel (named by a running process" <<< "$rel"'
kill $rel_pid 2>/dev/null; wait $rel_pid 2>/dev/null
FAKE_GH_FAIL=1 bash "$sweep" --checks "$K" > "$scratch/m5-closed.txt" 2>&1
check "open PRs unreadable: every commit's newest green run is kept" '[ -d "$K/out-$SHA_OPEN-1" ] && [ -d "$K/out-$SHA_SHUT-1" ]'
check "open PRs unreadable: an older green run still goes" '[ ! -e "$K/out-$SHA_OPEN-2" ]'
FAKE_OPEN_HEADS=$SHA_OPEN bash "$sweep" --checks "$K" > "$scratch/m5.txt" 2>&1; mrc=$?
check "the M5 sweep exits 0" '[ $mrc = 0 ]'
check "the newest green run of an open PR of code-factory-private, the default, is kept" '[ -f "$K/out-$SHA_OPEN-1/summary.tsv" ]'
check "a red run is removed" '[ ! -e "$K/out-$SHA_OPEN-3" ]'
check "a closed PR's green run is removed" '[ ! -e "$K/out-$SHA_SHUT-1" ]'
check "an old check worktree is removed and pruned" '[ ! -e "$K/chk-old" ] && ! git -C "$K/main" worktree list --porcelain | grep -q "chk-old"'
check "a check worktree a waiting process names is kept" '[ -d "$K/chk-queued" ] && grep -q "KEPT $K/chk-queued (named by a running process" "$scratch/m5.txt"'
kill $queued_pid 2>/dev/null; wait $queued_pid 2>/dev/null
check "a young out- folder is kept" '[ -d "$K/out-young" ]'
check "red-out-, main and the tools are never touched" '[ -d "$K/red-out-x" ] && [ -d "$K/main/.git" ] && [ -f "$K/green-run.sh" ]'
check "green-run.sh's pick is still there" '[ "$(ls -d "$K"/out-$SHA_OPEN-*)" = "$K/out-$SHA_OPEN-1" ]'

echo
[ $fails -eq 0 ] && echo "all sol-copies cases pass" || { echo "$fails sol-copies case(s) failed"; exit 1; }
