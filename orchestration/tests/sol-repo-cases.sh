#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Cases for #361 in a scratch home: reviewer/sol-pr-cf.sh reviews another repository's PR when given
# --repo OWNER/NAME and that repository's --setup hook. Code Factory stays the default, under its private name
# LaunchAstro/code-factory-private (#323); its old name is the public copy's, another repository like any other. The other
# repository's review reaches gh, the trust gate, its ledger, its proofs and its run lines under its own name, never
# code-factory's same-numbered PR, runs its own hook and not Code Factory's setup, and leaves no copy when it ends,
# fails or is killed by TERM or INT. Each review takes one Codex slot (#380) on a fake M5's pool, reached through a
# fake ssh, as codex-slot-cases.sh's are; no case reaches a real host or a real ~/.codex-slots. The stubs follow sol-copies-cases.sh; the rules gate and sol_rules.py are the
# real ones, so the ledger each review writes is real. Nothing here reads or removes anything outside the scratch folder.
#
#   bash orchestration/tests/sol-repo-cases.sh
set -uo pipefail

here=$(cd -- "$(dirname -- "$0")/.." && pwd)
sol=$here/reviewer/sol-pr-cf.sh
scratch=$(cd "$(mktemp -d)" && pwd -P)
cleanup() {
  for f in codex.pid hook.pid hookchild.pid; do [ -f "$scratch/mark/$f" ] && kill -KILL "$(cat "$scratch/mark/$f")" 2>/dev/null; done
  [ -f "$scratch/mark/wd.pid" ] && kill -KILL -- -"$(cat "$scratch/mark/wd.pid")" 2>/dev/null
  # A review left waiting for a slot: its own stop ends its slot holder.
  [ -f "$scratch/bgs" ] && while read -r p; do kill -TERM "$p" 2>/dev/null; done < "$scratch/bgs"
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
git config --global user.name repo-case; git config --global user.email repo@example.invalid
git config --global init.defaultBranch main; git config --global commit.gpgsign false
mkdir -p "$TMPDIR" "$scratch/bin" "$scratch/mark"

# ---- two repositories, each with its own PR of one number at a different head ----
N=987654
mkrepo() {  # mkrepo <name>: a bare origin whose refs/pull/$N/head is one commit past main
  git init -q "$scratch/seed-$1"; echo "$1" > "$scratch/seed-$1/a.txt"
  git -C "$scratch/seed-$1" add a.txt; git -C "$scratch/seed-$1" commit -qm one
  git clone -q --bare "$scratch/seed-$1" "$scratch/origin-$1.git"
  echo "$1 b" > "$scratch/seed-$1/b.txt"; git -C "$scratch/seed-$1" add b.txt; git -C "$scratch/seed-$1" commit -qm two
  git -C "$scratch/seed-$1" push -q "$scratch/origin-$1.git" HEAD:refs/pull/$N/head
  git -C "$scratch/seed-$1" rev-parse HEAD
}
# code-factory is the public copy, which took the old name (#323): its PR of the same number is at another head.
CF_HEAD=$(mkrepo code-factory-private); PUB_HEAD=$(mkrepo code-factory); TH_HEAD=$(mkrepo other-app)
CF7=${CF_HEAD:0:7}; TH7=${TH_HEAD:0:7}
export N CF_HEAD PUB_HEAD TH_HEAD FAKE_MARK="$scratch/mark" FAKE_SCRATCH="$scratch" GH_LOG="$scratch/gh.log" TG_LOG="$scratch/tg.log"

# gh: every call is logged. A repository's PR, clone, comment and status calls answer for that repository only.
cat > "$scratch/bin/gh" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$GH_LOG"
lc() { printf '%s' "$1" | tr A-Z a-z; }
head_of() { case $(lc "$1") in launchastro/code-factory-private) echo "$CF_HEAD" ;; launchastro/code-factory) echo "$PUB_HEAD" ;; launchastro/other-app) echo "$TH_HEAD" ;; *) exit 1 ;; esac; }
repo=; prev=; for a in "$@"; do [ "$prev" = -R ] && repo=$a; prev=$a; done
case "$1 $2" in
  "pr view") h=$(head_of "$repo") || exit 1; case "$*" in
      *headRefOid*) echo "$h" ;;
      *headRefName*) echo fix-branch ;;
      *closingIssuesReferences*) ;;
      *title,body*) printf '   a title\n   **Why:** a case\n' ;;
      *"--json body"*) echo "a body" ;;
    esac ;;
  "repo clone") case $(lc "$3") in launchastro/code-factory-private|launchastro/code-factory|launchastro/other-app) exec git clone -q "$FAKE_SCRATCH/origin-${3#*/}.git" "$4" ;; esac; exit 1 ;;
  "api user") echo sol-bot ;;
  "api "*) p=${2%%\?*}; o=${p#repos/}; o=${o%%/issues*}; o=${o%%/statuses*}; h=$(head_of "$o") || exit 1
    case $p in
      */issues/$N/comments) echo 7 ;;
      */issues/comments/7) printf 'Open findings: 0 (none)\nOpen disputes: 0 (none)\nReviewer: Sol (Codex)\nModel: gpt-6.1-sol\nHead SHA: %s\nVerdict: approve\nCode review: no findings\n' "$h" ;;
    esac ;;
  *) exit 0 ;;
esac
EOF
# codex: answers --version with FAKE_CODEX_VERSION (a build that runs gpt-6.1-sol by default); a review notes which
# binary ran, the head of the copy it was given and the slots the fake M5 holds, then ends (ok), fails (fail), runs
# until stopped (hang) or runs until the case writes mark/release (hold).
cat > "$scratch/bin/codex" <<'EOF'
#!/bin/bash
[ "${1:-}" = --version ] && { echo "${FAKE_CODEX_VERSION-codex-cli 0.164.0}"; exit "${FAKE_VERSION_RC:-0}"; }
printf '%s\n' "$0" > "$FAKE_MARK/codex-bin"
p=$(cat); wt=$(printf '%s\n' "$p" | sed -n 's/^Worktree: \(.*\) (at that head)$/\1/p')
[ -d "$wt" ] && { printf '%s\n' "$wt" > "$FAKE_MARK/seen"; git -C "$wt" rev-parse HEAD > "$FAKE_MARK/seen-head"; }
echo "codex log line"
ls "$M5/.codex-slots/slots" | wc -l | tr -d ' ' > "$FAKE_MARK/slots-in-run"
case $FAKE_CODEX in
  ok) echo proof > "$wt/proof.txt"; exit 0 ;;
  fail) exit 3 ;;
  hang) echo $$ > "$FAKE_MARK/codex.pid"; exec /bin/sleep 120 ;;
  hold) echo $$ > "$FAKE_MARK/codex.pid"; until [ -e "$FAKE_MARK/release" ]; do /bin/sleep 0.05; done; exit 0 ;;
esac
EOF
# The fake M5, the lock host for Codex slots (#352), reached as `ssh m5` through a fake ssh that runs the command in
# the fake M5's home. No fallback pool: a review that can't reach it waits, never runs unlimited.
M5=$scratch/m5; mkdir -p "$M5/.codex-slots"; : > "$M5/.codex-slots/LOCK-HOST"
cat > "$scratch/bin/ssh-fake" <<'EOF'
#!/bin/sh
while [ "$1" = -o ]; do shift 2; done
[ "$1" = m5 ] || exit 255; shift
cd "$M5" && HOME="$M5" CODEX_SLOT_ME=m5 exec sh -c "$*"
EOF
# perl: notes the deadline watchdog's pid (its group), then runs as itself.
cat > "$scratch/bin/perl" <<'EOF'
#!/bin/bash
case $2 in *'codex-shim watchdog'*) echo $$ > "$FAKE_MARK/wd.pid" ;; esac
exec /usr/bin/perl "$@"
EOF
chmod +x "$scratch/bin/gh" "$scratch/bin/codex" "$scratch/bin/ssh-fake" "$scratch/bin/perl"
export PATH="$scratch/bin:$PATH" M5
unset CODEX_SLOTS CODEX_SLOT_HELD CODEX_SLOT_DIR CODEX_SLOT_LABEL
export CODEX_SLOT_HOST=m5 CODEX_SLOT_SSH="$scratch/bin/ssh-fake" CODEX_SLOT_ME=laptop CODEX_SLOT_FALLBACK=0 \
  CODEX_SLOT_POLL=0.1 CODEX_SLOT_BEAT=0.2 CODEX_SLOT_TTL=60
m5_held() { ls "$M5/.codex-slots/slots" 2>/dev/null | wc -l | tr -d ' '; }
# This scratch home's slot holders and waiters still running: pids only, matched by the scratch path in their
# arguments, never printed (HQSEC).
slot_procs() { { pgrep -f "$scratch/.*slot\.pl holder"; pgrep -f "sol-slot $scratch/"; } | wc -l | tr -d ' '; }

R=$scratch/round; export SOL_RL_ROOT=$R
mkdir -p "$R/polish" "$R/tools-orch/reviewer" "$HOME/.cache/code-factory/orchestration/trust-gate" "$HOME/.claude/skills/build-review"
# The round's own copy of the shim: this repository's, noting each deadline's seconds and the slots the fake M5 holds
# as it starts. FAKE_SHIM=old takes codex_slot out, as a round copy from before #356 has none.
cat > "$R/tools-orch/reviewer/codex-shim.sh" <<EOF
source "$here/reviewer/codex-shim.sh"
[ "\${FAKE_SHIM:-}" = old ] && unset -f codex_slot codex
functions -c run_with_deadline case_deadline
run_with_deadline() { echo "\$1 \$(ls "\$M5/.codex-slots/slots" | wc -l | tr -d ' ')" >> "\$FAKE_MARK/deadline"; case_deadline "\$@"; }
EOF
ln -s "$here/reviewer" "$HOME/.cache/code-factory/orchestration/reviewer"
ln -s "$here/reviewer/sol_rules.py" "$R/tools-orch/sol_rules.py"
ln -s "$here/reviewer/sol-rl-gate.sh" "$R/tools-orch/sol-rl-gate.sh"
# The trust gate: logs what it was asked for and answers with that repository's comment for its own head.
cat > "$HOME/.cache/code-factory/orchestration/trust-gate/trust-gate.sh" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$TG_LOG"
case $(printf '%s' "$1" | tr A-Z a-z) in launchastro/code-factory-private) h=$CF_HEAD ;; launchastro/code-factory) h=$PUB_HEAD ;; launchastro/other-app) h=$TH_HEAD ;; *) exit 3 ;; esac
printf '{"comments":[{"body":"Head SHA: %s\\nVerdict: approve","url":"https://example.invalid/%s"}]}\n' "$h" "${1#*/}"
EOF
chmod +x "$HOME/.cache/code-factory/orchestration/trust-gate/trust-gate.sh"
echo "Always blocks." > "$HOME/.claude/skills/build-review/ALWAYS-BLOCKS.md"
echo "Reviewer." > "$HOME/.claude/skills/build-review/REVIEWER.md"
SW=$HOME/Desktop/Projects/code-factory-sol
TP=$R/polish/launchastro/other-app

# The theme's setup hook: notes where and with what it ran, then prints its environment text (FAKE_HOOK=fail fails
# it, hang runs it until stopped, with a child of its own; stubborn does so ignoring TERM; failchild and okchild
# leave a child behind and fail or succeed).
hook=$scratch/theme-setup.sh
cat > "$hook" <<'EOF'
#!/bin/bash
printf '%s|%s|%s|%s|%s\n' "$PWD" "$1" "$SOL_REPO" "$SOL_PR" "$SOL_HEAD" > "$FAKE_MARK/hook"
case ${FAKE_HOOK:-} in
  fail) exit 4 ;;
  # leave a worker behind, then fail or succeed: detached from the hook's output and ignoring HUP, as a nohup
  # worker is, so neither a closed pipe nor zsh's HUP to its jobs on exit can stand in for the script stopping it
  failchild) trap '' HUP; /bin/sleep 120 < /dev/null > /dev/null 2>&1 & echo $! > "$FAKE_MARK/hookchild.pid"; exit 4 ;;
  okchild) trap '' HUP; /bin/sleep 120 < /dev/null > /dev/null 2>&1 & echo $! > "$FAKE_MARK/hookchild.pid" ;;
  hang) echo $$ > "$FAKE_MARK/hook.pid"; /bin/sleep 120 & echo $! > "$FAKE_MARK/hookchild.pid"; wait ;;
  # ignores TERM, and so does its child, which inherits that
  stubborn) trap '' TERM; echo $$ > "$FAKE_MARK/hook.pid"; /bin/sleep 120 & echo $! > "$FAKE_MARK/hookchild.pid"; wait ;;
esac
echo "Environment: the theme's own review setup ran."
EOF
chmod +x "$hook"

no_copy() {  # no_copy <mirror>: nothing under the prefix and no review worktree left in that mirror
  [ -z "$(ls -A "$TMPDIR/cf-sol" 2>/dev/null)" ] && [ "$(git -C "$1" worktree list --porcelain | grep -c '^worktree ')" = 1 ]
}
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
review() {  # review <codex mode> [sol-pr-cf.sh options]: starts one review; sets out, rc and bg (the run's pid)
  local mode=$1; shift
  rm -f "$scratch/mark/"*; : > "$R/events.log"; : > "$GH_LOG"; : > "$TG_LOG"
  out=$(FAKE_CODEX=$mode zsh "$sol" "$@" $N case 2>&1); rc=$?
  bg=$(printf '%s\n' "$out" | sed -n 's/^OK pid \([0-9]*\) .*/\1/p')
  [ -n "$bg" ] && echo "$bg" >> "$scratch/bgs"
}
CF_ENV='Environment: dependencies are already installed in this worktree on this Mac.'

echo "the default repository is code-factory-private"
review ok
check "it dispatched" '[ $rc = 0 ] && [ -n "$bg" ]'
until_true '! alive $bg'
check "gh is asked about code-factory-private only" 'grep -q -- "-R LaunchAstro/code-factory-private" "$GH_LOG" && ! grep -qiE "other-app|code-factory([ /]|$)" "$GH_LOG"'
check "codex reviewed code-factory-private's head, not the public copy's" '[ "$(cat "$scratch/mark/seen-head" 2>/dev/null)" = "$CF_HEAD" ]'
check "the trust gate is read for code-factory-private" '[ "$(sort -u "$TG_LOG")" = "LaunchAstro/code-factory-private $N" ]'
check "the checks list carries Code Factory's environment" 'grep -qF "$CF_ENV" "$R/polish/checks-$N.md"'
check "the prompt and checks stay in polish/" '[ -s "$R/polish/sol-pr-$N-$CF7.txt" ] && [ -s "$R/polish/criteria-$N-$CF7.md" ]'
check "the ledger is code-factory-private's" '[ -s "$R/polish/launchastro/code-factory-private/sol-ledger-$N.json" ] && [ ! -e "$R/polish/sol-ledger-$N.json" ] && [ ! -e "$R/polish/launchastro/code-factory" ]'
check "the rules gate logs code-factory-private's line" 'grep -q "SOL-RULES launchastro/code-factory-private#$N head=${CF_HEAD:0:10} PASS" "$R/events.log"'
check "the proofs are saved under sol-proofs/pr-<pr>-<sha7>" '[ -f "$R/handbacks/sol-proofs/pr-$N-$CF7/proof.txt" ]'
check "the run lines name cf<pr>" 'grep -q "SOL-PR cf$N DISPATCHED" "$R/events.log" && grep -q "SOL-PR cf$N RUN-END lane=case head=${CF_HEAD:0:10} Verdict: approve .* rules=PASS" "$R/events.log"'
check "the run log and mirror are where they were" '[ -s "$SW/run-pr-$N-$CF7.log" ] && [ -d "$SW/mirror/.git" ]'
check "no copy is left" 'no_copy "$SW/mirror"'

echo "a kit review takes one Codex slot on the fake M5 while codex runs (#380)"
review hold
check "it dispatched" '[ $rc = 0 ] && [ -n "$bg" ]'
until_true '[ -s "$scratch/mark/codex.pid" ]'
check "codex runs holding one slot on the fake M5's pool, granted under the review's own label" \
  '[ "$(cat "$scratch/mark/slots-in-run")" = 1 ] && [ "$(m5_held)" = 1 ] && grep -q " grant .* label=sol-cf$N 1/5$" "$M5/.codex-slots/log"'
check "the deadline started with the slot already held" '[ "$(cat "$scratch/mark/deadline")" = "1800 1" ]'
: > "$scratch/mark/release"; until_true '! alive $bg'
check "the slot is given back when the run ends" 'until_true "[ \$(m5_held) = 0 ]" && grep -q " release " "$M5/.codex-slots/log"'
check "the review ends as before" 'grep -q "SOL-PR cf$N RUN-END lane=case head=${CF_HEAD:0:10} Verdict: approve .* rules=PASS" "$R/events.log" && no_copy "$SW/mirror"'

echo "with all 5 slots held a kit review waits, and its deadline starts only once it has one"
mkdir -p "$M5/.codex-slots/slots"
for i in 1 2 3 4 5; do printf 'host=elsewhere\npid=1\nstart=\nlabel=held\n' > "$M5/.codex-slots/slots/held-$i"; done
review hold
until_true 'grep -qs "codex-slot: waiting for a Codex slot (5/5 held on m5)" "$TMPDIR"/cf-sol/*/codex.log'
check "it waits with codex not started and no deadline running" '[ $rc = 0 ] && alive $bg && [ ! -e "$scratch/mark/codex.pid" ] && [ ! -e "$scratch/mark/deadline" ]'
rm "$M5/.codex-slots/slots/held-1"
until_true '[ -s "$scratch/mark/codex.pid" ]'
check "it starts once a slot frees, its deadline starting then" '[ "$(cat "$scratch/mark/slots-in-run")" = 5 ] && [ "$(cat "$scratch/mark/deadline")" = "1800 5" ]'
: > "$scratch/mark/release"; until_true '! alive $bg'
check "its slot is given back, the 4 others still held" 'until_true "[ \$(m5_held) = 4 ]"'
check "the run log carries one waiting line" '[ "$(grep -c "waiting for a Codex slot" "$SW/run-pr-$N-$CF7.log")" = 1 ]'
rm -f "$M5/.codex-slots/slots/held-"*

echo "a review killed by TERM while it waits for a slot"
for i in 1 2 3 4 5; do printf 'host=elsewhere\npid=1\nstart=\nlabel=held\n' > "$M5/.codex-slots/slots/held-$i"; done
review hold
until_true 'grep -qs "codex-slot: waiting for a Codex slot" "$TMPDIR"/cf-sol/*/codex.log'
check "its slot waiter is seen while it waits" '[ "$(slot_procs)" -ge 1 ]'
kill -TERM "$bg"; until_true '! alive $bg'
rm "$M5/.codex-slots/slots/held-1"
check "no copy is left" 'no_copy "$SW/mirror"'
check "its slot waiter is stopped too, so it can never take the freed slot" \
  'until_true "[ \$(slot_procs) = 0 ]" && [ "$(m5_held)" = 4 ] && [ ! -e "$scratch/mark/codex.pid" ]'
rm -f "$M5/.codex-slots/slots/held-"*

echo "a review whose shell is killed by KILL while codex runs keeps its slot while the run does (S381-1)"
review hold
until_true '[ -s "$scratch/mark/codex.pid" ] && [ -s "$scratch/mark/wd.pid" ]'; cpid=$(cat "$scratch/mark/codex.pid"); wd=$(cat "$scratch/mark/wd.pid")
kill -KILL "$bg"; until_true '! alive $bg'
# A real wait, bounded: a lease that followed the shell alone gave the slot back within its one-second poll.
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25; do [ "$(m5_held)" = 1 ] || break; /bin/sleep 0.1; done
check "codex runs on, still holding its slot, 2.5 seconds on" 'alive $cpid && [ "$(m5_held)" = 1 ]'
: > "$scratch/mark/release"; until_true '! alive $cpid'
check "with codex ended, its deadline's watchdog still holds the slot" '[ "$(m5_held)" = 1 ]'
kill -KILL -- -"$wd"
check "once the watchdog ends too, the slot goes back" 'until_true "[ \$(m5_held) = 0 ]"'
rm -rf "$TMPDIR"/cf-sol/*; git -C "$SW/mirror" worktree prune

echo "a round's shim copy with no codex_slot (from before #356) still takes the kit's slot"
FAKE_SHIM=old review hold
until_true '[ -s "$scratch/mark/codex.pid" ]'
check "codex runs holding one slot on the fake M5" '[ "$(cat "$scratch/mark/slots-in-run")" = 1 ] && [ "$(m5_held)" = 1 ]'
: > "$scratch/mark/release"; until_true '! alive $bg'
check "the slot is given back" 'until_true "[ \$(m5_held) = 0 ]"'

echo "a kit shim with no codex_slot refuses before any copy"
kit=$HOME/.cache/code-factory/orchestration/reviewer; rm "$kit"; mkdir "$kit"
sed '/^codex_slot() {/,/^}/d' "$here/reviewer/codex-shim.sh" > "$kit/codex-shim.sh"
review ok
check "one line names the shim and the pull, exit 1, nothing asked of GitHub or copied" \
  '[ $rc = 1 ] && [ -z "$bg" ] && [ "$(printf "%s\n" "$out" | wc -l | tr -d " ")" = 1 ] && grep -qF "$kit/codex-shim.sh has no codex_slot" <<< "$out" && [ ! -s "$GH_LOG" ] && [ ! -e "$scratch/mark/seen" ] && no_copy "$SW/mirror"'
rm -r "$kit"; ln -s "$here/reviewer" "$kit"

echo "--repo given as the default name works the same"
review ok --repo LaunchAstro/code-factory-private
until_true '! alive $bg'
check "codex reviewed code-factory's head" '[ $rc = 0 ] && [ "$(cat "$scratch/mark/seen-head" 2>/dev/null)" = "$CF_HEAD" ]'
check "the run line names cf<pr>" 'grep -q "SOL-PR cf$N RUN-END" "$R/events.log"'

echo "the default name in another case is still Code Factory, with no hook needed"
review ok --repo launchastro/Code-Factory-Private
until_true '! alive $bg'
check "it reviews code-factory's head under cf<pr>" '[ $rc = 0 ] && [ "$(cat "$scratch/mark/seen-head" 2>/dev/null)" = "$CF_HEAD" ] && grep -q "SOL-PR cf$N RUN-END" "$R/events.log"'
check "its state stays in Code Factory's folders" '[ -s "$R/polish/sol-pr-$N-$CF7.txt" ] && [ -d "$SW/mirror/.git" ] && [ ! -e "$SW/launchastro" ]'
cf_ledger=$(cat "$R/polish/launchastro/code-factory-private/sol-ledger-$N.json")

for old in LaunchAstro/code-factory launchastro/Code-Factory; do
  echo "the old name, $old, is the public copy's: refused without its own hook (#323)"
  review ok --repo $old
  check "it refuses, naming the missing hook" '[ $rc = 2 ] && [ -z "$bg" ] && grep -q "needs its own --setup FILE" <<< "$out"'
  check "nothing is asked of GitHub, run or logged" '[ ! -s "$GH_LOG" ] && [ ! -s "$TG_LOG" ] && [ ! -s "$R/events.log" ] && [ ! -e "$scratch/mark/seen" ]'
  check "no folder of its own is made" '[ ! -e "$SW/launchastro/code-factory" ] && [ ! -e "$R/polish/launchastro/code-factory" ]'
done

echo "a second repository, with its own setup hook"
review ok --repo LaunchAstro/other-app --setup "$hook"
check "it dispatched" '[ $rc = 0 ] && [ -n "$bg" ]'
until_true '! alive $bg'
check "every gh call names the theme, never code-factory" '[ -s "$GH_LOG" ] && ! grep -qi "launchastro/code-factory" "$GH_LOG" && grep -q -- "-R LaunchAstro/other-app" "$GH_LOG"'
check "codex reviewed the theme's head, not code-factory's same-numbered PR" '[ "$(cat "$scratch/mark/seen-head" 2>/dev/null)" = "$TH_HEAD" ]'
check "the theme's hook ran in the review copy, told the repository, PR and head" \
  '[ "$(cat "$scratch/mark/hook" 2>/dev/null)" = "$(cat "$scratch/mark/seen")|$(cat "$scratch/mark/seen")|LaunchAstro/other-app|$N|$TH_HEAD" ]'
check "the checks list carries the hook's environment, not Code Factory's" \
  'grep -qx "Environment: the theme'"'"'s own review setup ran." "$TP/checks-$N.md" && ! grep -qE "vitest|REVIEW-DATABASE-ENV-FILE" "$TP/checks-$N.md" "$TP/sol-pr-$N-$TH7.txt"'
check "its prompt names the theme" 'grep -q "repository LaunchAstro/other-app" "$TP/sol-pr-$N-$TH7.txt" && [ -s "$TP/criteria-$N-$TH7.md" ]'
check "the trust gate is read for the theme only" '[ "$(sort -u "$TG_LOG")" = "LaunchAstro/other-app $N" ]'
check "the theme's own ledger is written" '[ -s "$TP/sol-ledger-$N.json" ]'
check "code-factory-private's ledger is untouched" '[ "$(cat "$R/polish/launchastro/code-factory-private/sol-ledger-$N.json")" = "$cf_ledger" ]'
check "its proofs are saved under the theme's folder" '[ -f "$R/handbacks/sol-proofs/launchastro/other-app/pr-$N-$TH7/proof.txt" ] && [ ! -e "$R/handbacks/sol-proofs/pr-$N-$TH7" ]'
check "its run lines name the theme, never cf<pr>" \
  'grep -q "SOL-PR launchastro/other-app#$N DISPATCHED" "$R/events.log" && grep -q "SOL-PR launchastro/other-app#$N RUN-END .*Verdict: approve .*rules=PASS" "$R/events.log" && ! grep -q "SOL-PR cf$N" "$R/events.log"'
check "the rules gate logs the theme's line" 'grep -q "SOL-RULES launchastro/other-app#$N head=${TH_HEAD:0:10} PASS" "$R/events.log"'
check "its own mirror and run log" '[ -d "$SW/launchastro/other-app/mirror/.git" ] && [ -s "$SW/launchastro/other-app/run-pr-$N-$TH7.log" ]'
check "no copy is left" 'no_copy "$SW/launchastro/other-app/mirror"'

echo "a second repository whose codex run fails"
review fail --repo LaunchAstro/other-app --setup "$hook"
until_true '! alive $bg'
check "codex ran against the theme's copy" '[ "$(cat "$scratch/mark/seen-head" 2>/dev/null)" = "$TH_HEAD" ]'
check "no copy is left" 'no_copy "$SW/launchastro/other-app/mirror"'
check "no slot is left held" 'until_true "[ \$(m5_held) = 0 ]"'
check "the run line is in events.log" 'grep -q "SOL-PR launchastro/other-app#$N RUN-END" "$R/events.log"'

for sig in TERM INT; do
  echo "a second repository's review killed by $sig while codex runs"
  review hang --repo LaunchAstro/other-app --setup "$hook"
  until_true '[ -s "$scratch/mark/codex.pid" ]'; cpid=$(cat "$scratch/mark/codex.pid")
  check "codex runs holding one slot, under the review's label" '[ "$(m5_held)" = 1 ] && grep -q " grant .* label=sol-launchastro-other-app-$N " "$M5/.codex-slots/log"'
  kill -$sig "$bg"; until_true '! alive $bg'
  check "no copy is left" 'no_copy "$SW/launchastro/other-app/mirror"'
  check "the codex run it started is stopped" '[ -n "$cpid" ] && until_true "! alive $cpid"'
  check "no slot is left held" 'until_true "[ \$(m5_held) = 0 ]"'
done

for sig in TERM INT; do for hmode in hang stubborn; do
  echo "a second repository's review killed by $sig while its setup hook runs ($hmode)"
  rm -f "$scratch/mark/"*
  # perl gives the run INT back: bash starts a background command with INT ignored.
  FAKE_HOOK=$hmode FAKE_CODEX=ok /usr/bin/perl -e '$SIG{INT} = "DEFAULT"; exec @ARGV' zsh "$sol" --repo LaunchAstro/other-app --setup "$hook" $N case > "$scratch/out.txt" 2>&1 & fg=$!
  until_true '[ -s "$scratch/mark/hookchild.pid" ]'; hpid=$(cat "$scratch/mark/hook.pid"); hcpid=$(cat "$scratch/mark/hookchild.pid")
  kill -$sig $fg; until_true '! alive $fg'; wait $fg; frc=$?
  check "it exits non-zero, with no review started" '[ $frc != 0 ] && ! grep -q "^OK pid" "$scratch/out.txt" && [ ! -e "$scratch/mark/seen" ]'
  check "the hook and its child are stopped" '[ -n "$hpid" ] && [ -n "$hcpid" ] && until_true "! alive $hpid && ! alive $hcpid"'
  check "no copy is left" 'no_copy "$SW/launchastro/other-app/mirror"'
done; done

echo "a second repository whose setup hook fails"
FAKE_HOOK=fail review ok --repo LaunchAstro/other-app --setup "$hook"
check "it refuses, naming the hook" '[ $rc != 0 ] && [ -z "$bg" ] && grep -q "setup hook failed" <<< "$out"'
check "codex never ran" '[ ! -e "$scratch/mark/seen" ]'
check "no copy is left" 'no_copy "$SW/launchastro/other-app/mirror"'

echo "a hook that fails leaving a child behind"
FAKE_HOOK=failchild review ok --repo LaunchAstro/other-app --setup "$hook"
hcpid=$(cat "$scratch/mark/hookchild.pid" 2>/dev/null)
check "it refuses, naming the hook" '[ $rc != 0 ] && [ -z "$bg" ] && grep -q "setup hook failed (exit 4)" <<< "$out"'
check "the child it left is stopped" '[ -n "$hcpid" ] && until_true "! alive $hcpid"'
check "no copy is left" 'no_copy "$SW/launchastro/other-app/mirror"'

echo "a hook that succeeds leaving a child behind"
FAKE_HOOK=okchild review ok --repo LaunchAstro/other-app --setup "$hook"
hcpid=$(cat "$scratch/mark/hookchild.pid" 2>/dev/null)
check "the review starts" '[ $rc = 0 ] && [ -n "$bg" ]'
check "the child is stopped before the review starts" '[ -n "$hcpid" ] && ! alive $hcpid'
until_true '! alive $bg'
check "no copy is left" 'no_copy "$SW/launchastro/other-app/mirror"'

echo "a hook that prints no environment text"
printf '#!/bin/sh\nexit 0\n' > "$scratch/quiet.sh"; chmod +x "$scratch/quiet.sh"
review ok --repo LaunchAstro/other-app --setup "$scratch/quiet.sh"
check "it refuses before codex" '[ $rc != 0 ] && [ -z "$bg" ] && [ ! -e "$scratch/mark/seen" ] && no_copy "$SW/launchastro/other-app/mirror"'

echo "the default repository given a hook runs the hook, not Code Factory's setup"
review ok --setup "$hook"
until_true '! alive $bg'
check "the hook's text replaces Code Factory's" 'grep -qx "Environment: the theme'"'"'s own review setup ran." "$R/polish/checks-$N.md" && ! grep -qF "$CF_ENV" "$R/polish/checks-$N.md"'

echo "a mirror cloned under the old name follows the rename (#323, Sol S378-2)"
# The mirror's origin is a GitHub URL, as gh repo clone makes it; git maps each URL to its scratch repository.
git config --global url."$scratch/origin-code-factory.git".insteadOf https://github.com/LaunchAstro/code-factory.git
git config --global url."$scratch/origin-code-factory-private.git".insteadOf https://github.com/LaunchAstro/code-factory-private.git
git config --global --add url."$scratch/origin-code-factory-private.git".insteadOf git@github.com:launchastro/code-factory-private.git
rm -rf "$SW/mirror"; git clone -q https://github.com/LaunchAstro/code-factory.git "$SW/mirror"
review ok
check "it dispatched" '[ $rc = 0 ] && [ -n "$bg" ]'
until_true '! alive $bg'
check "codex reviewed code-factory-private's head, not the public copy's" '[ "$(cat "$scratch/mark/seen-head" 2>/dev/null)" = "$CF_HEAD" ]'
check "the mirror's origin names code-factory-private" '[ "$(git -C "$SW/mirror" config --get remote.origin.url)" = https://github.com/LaunchAstro/code-factory-private.git ]'
git -C "$SW/mirror" remote set-url origin git@github.com:launchastro/code-factory-private.git
review ok
until_true '! alive $bg'
check "a mirror already on the right repository, in another form, is left as it is" \
  '[ $rc = 0 ] && [ "$(cat "$scratch/mark/seen-head" 2>/dev/null)" = "$CF_HEAD" ] && [ "$(git -C "$SW/mirror" config --get remote.origin.url)" = git@github.com:launchastro/code-factory-private.git ]'

echo "a round folder, home, setup hook and lane with spaces (#358)"
# The prompt, dispute snapshot, events.log, tools-orch and trust gate all sit under those paths. A word split
# points the run line at "$R" and runs the lane's text; the lane names a marker that must never appear.
R2="$scratch/round two"; H2="$scratch/home two"; hook2="$scratch/hook dir/theme setup.sh"
lane2="two words \"q\" \$(touch $scratch/mark/ran)"
ln -s "$scratch/home" "$H2"; mkdir -p "$R2/polish/launchastro/other-app" "${hook2%/*}"; cp "$hook" "$hook2"
cp -R "$R/tools-orch" "$R2/tools-orch"; : > "$R2/polish/launchastro/other-app/disputes-$N.md"
# The rules gate notes its arguments, one a line, then runs as itself.
rm "$R2/tools-orch/sol-rl-gate.sh"
printf '#!/bin/bash\nprintf "%%s\\n" "$@" > "$FAKE_MARK/gate-args"\nexec "%s" "$@"\n' "$here/reviewer/sol-rl-gate.sh" > "$R2/tools-orch/sol-rl-gate.sh"
chmod +x "$R2/tools-orch/sol-rl-gate.sh"
# The standalone build under that home, so the binary handed to the run sits at a path with a space too (#372).
sa=$HOME/.codex/packages/standalone/current/bin; mkdir -p "$sa"; cp "$scratch/bin/codex" "$sa/codex"
rm -f "$scratch/mark/"*; : > "$R/events.log"; : > "$TG_LOG"
out=$(HOME=$H2 SOL_RL_ROOT=$R2 FAKE_CODEX=ok zsh "$sol" --repo LaunchAstro/other-app --setup "$hook2" $N "$lane2" 2>&1); rc=$?
bg=$(printf '%s\n' "$out" | sed -n 's/^OK pid \([0-9]*\) .*/\1/p')
check "it dispatched" '[ $rc = 0 ] && [ -n "$bg" ]'
until_true '! alive $bg'
check "the hook at a path with a space ran" '[ "$(cut -d"|" -f5 "$scratch/mark/hook" 2>/dev/null)" = "$TH_HEAD" ]'
check "codex was given the prompt from the round with a space" '[ "$(cat "$scratch/mark/seen-head" 2>/dev/null)" = "$TH_HEAD" ]'
check "the trust gate under the home with a space was read" '[ "$(sort -u "$TG_LOG")" = "LaunchAstro/other-app $N" ]'
check "the RUN-END line lands in that round's events.log, lane as given, rules gate given the snapshot" \
  'grep -qF "SOL-PR launchastro/other-app#$N RUN-END lane=$lane2 head=${TH_HEAD:0:10} Verdict: approve " "$R2/events.log" && grep -q "RUN-END .*rules=PASS$" "$R2/events.log"'
check "the rules gate is given the dispute snapshot as one argument" \
  '[ "$(cat "$scratch/mark/gate-args" 2>/dev/null)" = "$(printf "%s\n" --repo LaunchAstro/other-app $N $TH_HEAD https://example.invalid/other-app "$R2/polish/launchastro/other-app/disputes-$N-$TH7.md")" ]'
check "the lane's text is not run as a command" '[ ! -e "$scratch/mark/ran" ]'
check "nothing lands in the folder a split word names" '[ ! -s "$R/events.log" ]'
check "its proofs are saved in that round" '[ -f "$R2/handbacks/sol-proofs/launchastro/other-app/pr-$N-$TH7/proof.txt" ]'
check "no copy is left" 'no_copy "$SW/launchastro/other-app/mirror"'
check "the standalone build at the home with a space ran, handed over whole" '[ "$(cat "$scratch/mark/codex-bin" 2>/dev/null)" = "$H2/.codex/packages/standalone/current/bin/codex" ]'
rm "$sa/codex"

echo "which codex runs (#372)"
# Prefer the standalone build, then ~/.local/bin, then PATH. The fake PATH binary reports an unsupported alpha version; bare contains no Codex binary.
lb=$HOME/.local/bin; brew=$scratch/brew; mkdir -p "$lb" "$brew" "$scratch/nocodex"
cat > "$brew/codex" <<'EOF'
#!/bin/bash
[ "${1:-}" = --version ] && { echo "codex-cli 0.140.0-alpha.19"; exit 0; }
printf '%s\n' "$0" > "$FAKE_MARK/codex-bin"
echo "ERROR: 400 model_not_found"; exit 1
EOF
chmod +x "$brew/codex"; ln -s "$scratch/bin/gh" "$scratch/nocodex/gh"
bare=$scratch/nocodex; IFS=: read -ra dirs <<< "$PATH"; for d in "${dirs[@]}"; do [ -x "$d/codex" ] || bare=$bare:$d; done
refused() {  # refused <text>: one line naming <text>, exit 1, and nothing asked of GitHub, run or copied
  [ $rc = 1 ] && [ -z "$bg" ] && [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" = 1 ] && grep -qF -- "$1" <<< "$out" \
    && [ ! -s "$GH_LOG" ] && [ ! -s "$R/events.log" ] && [ ! -e "$scratch/mark/codex-bin" ] && no_copy "$SW/mirror"
}
cp "$scratch/bin/codex" "$sa/codex"
FAKE_CODEX_VERSION='codex-cli 0.162.1' PATH=$brew:$PATH review ok
until_true '! alive $bg'
check "the standalone build is picked over a Homebrew alpha ahead of it on PATH" \
  '[ $rc = 0 ] && [ "$(cat "$scratch/mark/codex-bin" 2>/dev/null)" = "$sa/codex" ] && [ "$(cat "$scratch/mark/seen-head" 2>/dev/null)" = "$CF_HEAD" ]'
check "its review ends as before" 'grep -q "SOL-PR cf$N RUN-END lane=case head=${CF_HEAD:0:10} Verdict: approve .* rules=PASS" "$R/events.log" && no_copy "$SW/mirror"'
PATH=$bare review ok
until_true '! alive $bg'
check "the standalone build is found when Codex is absent from PATH" '[ $rc = 0 ] && [ "$(cat "$scratch/mark/codex-bin" 2>/dev/null)" = "$sa/codex" ]'
for v in '0.162.0|0.162.0' '0.162.1-alpha.2|0.162.1-alpha.2' '0.99.9|0.99.9' 'codex-cli|no version' '|no version'; do
  FAKE_CODEX_VERSION="codex-cli ${v%%|*}" PATH=$bare review ok
  check "a standalone build reporting '${v%%|*}' refuses before any copy" 'refused "$sa/codex reports ${v#*|}"'
done
FAKE_VERSION_RC=1 PATH=$bare review ok
check "a codex whose --version fails refuses before any copy" 'refused "$sa/codex reports no version"'
rm "$sa/codex"; cp "$scratch/bin/codex" "$lb/codex"
PATH=$brew:$PATH review ok
until_true '! alive $bg'
check "~/.local/bin/codex is picked over a Homebrew alpha ahead of it on PATH" '[ $rc = 0 ] && [ "$(cat "$scratch/mark/codex-bin" 2>/dev/null)" = "$lb/codex" ]'
PATH=$lb:$bare review ok
until_true '! alive $bg'
check "a ~/.local/bin/codex-only layout runs as before" \
  '[ $rc = 0 ] && [ "$(cat "$scratch/mark/codex-bin" 2>/dev/null)" = "$lb/codex" ] && grep -q "SOL-PR cf$N RUN-END lane=case .*Verdict: approve .* rules=PASS" "$R/events.log"'
rm "$lb/codex"
PATH=$brew:$bare review ok
check "an alpha-only machine refuses loudly, naming the binary and its version, with no review copy made" \
  'refused "$brew/codex reports 0.140.0-alpha.19" && grep -q "0.162.1" <<< "$out"'
PATH=$bare review ok
check "a machine with no codex refuses before any copy" 'refused "no codex found"'

echo "the arguments are checked before anything runs"
review ok --repo LaunchAstro/other-app
check "another repository with no --setup is refused" '[ $rc = 2 ] && grep -q -- "--setup" <<< "$out" && [ ! -s "$GH_LOG" ]'
review ok --repo 'bad name' --setup "$hook"
check "a malformed --repo is refused" '[ $rc = 2 ] && grep -q "usage:" <<< "$out" && [ ! -s "$GH_LOG" ]'
review ok --repo LaunchAstro/other-app --setup "$scratch/missing.sh"
check "a --setup that is not an executable file is refused" '[ $rc = 2 ] && [ ! -s "$GH_LOG" ]'
out=$(zsh "$sol" --repo 2>&1); rc=$?
check "--repo with no value is refused" '[ $rc = 2 ] && grep -q "usage:" <<< "$out"'
out=$(zsh "$sol" 2>&1); rc=$?
check "no PR prints the usage with both options" '[ $rc = 2 ] && grep -q "usage: sol-pr-cf.sh \[--repo OWNER/NAME\] \[--setup FILE\] PR LANE" <<< "$out"'

echo
[ $fails -eq 0 ] && echo "all sol-repo cases pass" || { echo "$fails sol-repo case(s) failed"; exit 1; }
