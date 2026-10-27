#!/bin/zsh
# SPDX-License-Identifier: AGPL-3.0-only
# sol-pr-cf.sh [--repo OWNER/NAME] [--setup FILE] PR LANE [FIX_URL FINDINGS_FILE PREV_HEAD]
# Sol's review with ralph-lisa's review rules (register 45 d, OA-SolRules) for a PR of OWNER/NAME (default
# LaunchAstro/code-factory-private): stable finding ids S<PR>-<n> kept in polish/<owner>/<name>/sol-ledger-<PR>.json (lower
# case), builder disputes from disputes-<PR>.md beside it (snapshotted per head, fed to Sol), open finding and dispute
# counts in the verdict comment, and sol-rl-gate.sh --repo OWNER/NAME after the run, which fails closed.
# Another repository (#361) keeps its mirror and run logs, prompt files and proofs in folders named <owner>/<name>,
# and tags its events.log lines <owner>/<name>#<PR> in place of cf<PR>, so it never meets code-factory's
# same-numbered PR. It needs --setup FILE: an executable run in the review copy, in its own process group, with
# SOL_REPO, SOL_PR and SOL_HEAD set and the copy's path as its argument, that prepares the review (installs, a
# database) and prints the environment text Sol is given, naming where a secret is, never the secret (the text goes
# into the prompt and polish/). A hook that fails or prints nothing stops the review.
# Sol's review of record for one PR, run in the background on the laptop. Root: SOL_RL_ROOT, else the
# folder above this script's folder: the round folder for a round's tools-orch copy, but orchestration/ when run from
# this repository, so set SOL_RL_ROOT there.
# Prompt: code-factory make_sol_prompt.py (criteria = the issues the PR closes/fixes/is part of, plus the PR's "## Criteria").
# Code Factory variant (DIRCF219): REPO code-factory, no setup run, Code Factory's environment text, effort high.
# Identity: posts through the active gh login (SOL-PROMPT.md); no reviewer token file exists (#1683 open), so
# run_with_deadline is used, with run_sol_review's exact codex flags. Logs SOL-PR <PR> DISPATCHED / RUN-END to events.log.
usage() { echo "usage: sol-pr-cf.sh [--repo OWNER/NAME] [--setup FILE] PR LANE [FIX_URL FINDINGS_FILE PREV_HEAD]"; exit 2; }
REPO=LaunchAstro/code-factory-private; SETUP=
while [[ $1 == --(repo|setup) ]]; do (( $# >= 2 )) || usage; [[ $1 == --repo ]] && REPO=$2 || SETUP=$2; shift 2; done
R=${SOL_RL_ROOT:-${0:A:h:h}}; N=$1; LANE=$2; FIXURL=$3; FIXF=$4; PREV=$5
EFF=${SOL_EFFORT:-high}
[[ -z $N || -z $LANE ]] && usage
[[ $N =~ '^[0-9]+$' && $REPO =~ '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$' && $REPO != */.* ]] || usage
L=${(L)REPO}
# Code Factory is the private repository (#323). Its old name, launchastro/code-factory, is the public copy's: another
# repository, with its own folders and tag, so it needs its own --setup like any other.
if [[ $L == launchastro/code-factory-private ]]; then SUB=; TAG=cf$N; else SUB=/$L; TAG=$L#$N; fi
[[ -n $SUB && -z $SETUP ]] && { echo "sol-pr-cf.sh: $REPO needs its own --setup FILE; Code Factory's review setup is for Code Factory only"; exit 2; }
[[ -z $SETUP || ( -f $SETUP && -x $SETUP ) ]] || { echo "sol-pr-cf.sh: --setup $SETUP is not an executable file"; exit 2; }
[[ -n $SETUP ]] && SETUP=${SETUP:A}
# Codex (#372): prefer the standalone build, then ~/.local/bin, then PATH.
# Require Codex 0.162.1 or later and a readable version before making a review copy.
SOL_CODEX=; for c in $HOME/.codex/packages/standalone/current/bin/codex $HOME/.local/bin/codex ${commands[codex]}; do
  [[ -f $c && -x $c ]] && { SOL_CODEX=$c; break; }; done
[[ -n $SOL_CODEX ]] || { echo "sol-pr-cf.sh: no codex found (standalone build, ~/.local/bin or PATH); gpt-6.1-sol needs codex 0.162.1 or later"; exit 1; }
CV=; CO=$($SOL_CODEX --version < /dev/null 2>/dev/null) && [[ $CO =~ '([0-9]+)\.([0-9]+)\.([0-9]+)(-[0-9A-Za-z.]+)?' ]] && CV=$MATCH
# 0.162.1 itself passes; a pre-release of it does not.
[[ -n $CV ]] && { (( match[1] * 10**12 + match[2] * 10**6 + match[3] > 162000001 )) || [[ $CV == 0.162.1 ]] } \
  || { echo "sol-pr-cf.sh: $SOL_CODEX reports ${CV:-no version}; gpt-6.1-sol needs codex 0.162.1 or later (older builds get 400 model_not_found)"; exit 1; }
CF=$HOME/.cache/code-factory/orchestration/reviewer
# Codex slot (#380): the review takes one of #352's login-wide slots through the kit's codex_slot, not the round's
# shim copy, which may predate #356. A kit without it stops here, before any copy, so no review skips the limiter.
SOL_SLOT=$CF/codex-shim.sh
zsh -c 'source "$1" && (( $+functions[codex_slot] ))' sol-slot $SOL_SLOT > /dev/null 2>&1 \
  || { echo "sol-pr-cf.sh: $SOL_SLOT has no codex_slot (#352), so this review would take no Codex slot; pull the kit: git -C ~/.cache/code-factory pull --ff-only"; exit 1; }
H=$(gh pr view $N -R $REPO --json headRefOid -q .headRefOid) || exit 1
BR=$(gh pr view $N -R $REPO --json headRefName -q .headRefName)
# This review's copy (its worktree, patch and codex's full log) lives under the one prefix copy-sweep.sh reads (#328)
# and goes when the review ends, fails or is killed by INT or TERM. Kept: the verdict comment, the prompt and criteria
# in polish/, the last 40 lines of codex's log as $SW/run-pr-<PR>-<sha7>.log, Sol's proof files and the RUN-END line.
# Sol runs with $TMPDIR inside the copy, so its temp folders go with it, their proof files saved first (#369).
SW=$HOME/Desktop/Projects/code-factory-sol$SUB; mkdir -p $SW; T=${TMPDIR:-/tmp}; D=${T%/}/cf-sol/$N-${H:0:7}-$$; W=$D/wt
LOG=$SW/run-pr-$N-${H:0:7}.log; PD=$R/handbacks/sol-proofs$SUB/pr-$N-${H:0:7}
trap 'git -C "$SW/mirror" worktree remove --force "$W" 2>/dev/null; rm -rf "$D"; git -C "$SW/mirror" worktree prune 2>/dev/null' EXIT
trap 'exit 130' INT; trap 'exit 143' TERM
[ -d $SW/mirror ] || gh repo clone $REPO $SW/mirror -- -q
# A mirror cloned under another GitHub name (Code Factory's old one, now the public copy's, #323) is pointed at $REPO.
o=$(git -C $SW/mirror config --get remote.origin.url) || exit 1
[[ ${(L)o} == (https://github.com/|git@github.com:)* && ${${${${(L)o}%/}%.git}#*github.com[/:]} != $L ]] &&
  { git -C $SW/mirror remote set-url origin https://github.com/$REPO.git || exit 1; }
git -C $SW/mirror fetch -q origin main "pull/$N/head" || exit 1
mkdir -p $D && git -C $SW/mirror worktree add -q --detach $W $H || exit 1
[ -n "$BASEPR" ] && git -C $SW/mirror fetch -q origin "pull/$BASEPR/head"
B=${BASE:-$(git -C $W merge-base origin/main $H)}
# Review environment (ORCH 01:40Z): Code Factory's text below, unless a --setup hook prepares the copy and prints its own.
# The hook runs in its own process group. Whatever is left in that group when the hook ends, or when a kill stops it,
# is stopped before the review goes on or the copy goes: TERM, three seconds' grace, then KILL, as the codex run is
# stopped below. A service the review needs runs outside it (a container, as Code Factory's Postgres is).
ENVT="Environment: dependencies are already installed in this worktree on this Mac. Run tests on the host with ./node_modules/.bin/vitest run <files>; never inside Docker or a Linux container, never through a network-disabled sandbox, and never re-run pnpm install. A Postgres for this review is already up on loopback; its URLs are in <REVIEW-DATABASE-ENV-FILE> in this worktree, which the test harness reads (export them with set -a; source <REVIEW-DATABASE-ENV-FILE>; set +a if a suite asks). Never stop or remove that container."
if [[ -n $SETUP ]]; then
  (cd $W && SOL_REPO=$REPO SOL_PR=$N SOL_HEAD=$H exec /usr/bin/perl -e 'setpgrp(0, 0); exec @ARGV or exit 127' $SETUP $W) < /dev/null > $D/setup.txt & sp=$!
  # pid: the hook is still unreaped, so its pid is still its own and is signalled too, in case setpgrp hasn't run.
  stop_setup() {
    kill -TERM -- -$sp || { [[ -n $1 ]] && kill -TERM $sp; }
    for t in {1..15}; do kill -0 -- -$sp || { [[ -n $1 ]] && kill -0 $sp; } || break; /bin/sleep 0.2; done
    kill -KILL -- -$sp || { [[ -n $1 ]] && kill -KILL $sp; }
  } 2>/dev/null
  trap 'stop_setup pid; exit 130' INT; trap 'stop_setup pid; exit 143' TERM
  wait $sp; s=$?
  trap 'stop_setup; exit 130' INT; trap 'stop_setup; exit 143' TERM
  stop_setup
  trap 'exit 130' INT; trap 'exit 143' TERM
  (( s )) && { echo "setup hook failed (exit $s): $SETUP"; exit 1; }
  ENVT=$(<$D/setup.txt); [[ -n ${ENVT//[[:space:]]/} ]] || { echo "setup hook printed no environment text: $SETUP"; exit 1; }
fi
mkdir -p $R/polish$SUB
C=$R/polish$SUB/criteria-$N-${H:0:7}.md; K=$R/polish$SUB/checks-$N.md; P=$R/polish$SUB/sol-pr-$N-${H:0:7}.txt
ISS=$(gh pr view $N -R $REPO --json closingIssuesReferences -q '.closingIssuesReferences[]|"\(.repository.owner.login)/\(.repository.name)#\(.number)"' | sort -u)
# A stacked PR (base not main) has no GitHub closing links: fall back to its description's own "Closes #n" lines.
[ -z "$ISS" ] && ISS=$(gh pr view $N -R $REPO --json body -q .body | grep -iE '^closes:? +#[0-9]+' | grep -oE '[0-9]+' | sort -u | sed "s|^|$REPO#|")
{
  i=0; for ref in ${=ISS}; do n=${ref##*#}; rr=${ref%#*}; i=$((i+1)); echo "$i. Issue $ref is met as its body states, with its proof test failing before the change and passing after:"; gh issue view $n -R $rr --json title,body -q '"   " + .title + "\n" + .body' | sed 's/^/   /'; done
  [ $i -eq 0 ] && { i=1; echo "1. The PR does what its title and Why line state, with its named proof tests failing before the change and passing after:"; gh pr view $N -R $REPO --json title,body -q '"   " + .title + "\n   " + ((.body|split("\n")|map(select(startswith("**Why:**")))|.[0]) // "")'; }
  CRIT=$(gh pr view $N -R $REPO --json body -q .body | awk '/^## Criteria/{f=1;next} f&&/^## /{exit} f&&/^[0-9]+\. /{sub(/^[0-9]+\. /,"");print}')
  [ -n "$CRIT" ] && while IFS= read -r c; do i=$((i+1)); echo "$i. (the PR's stated criterion) $c"; done <<< "$CRIT"
  echo "$((i+1)). The change introduces no new defect in the five classes that always block."
} > $C
cat > $K <<EOF
Ceilings: context 40 percent, wall 15 minutes per session (raise to 30 minutes for a diff over 800 lines and say so in Coverage).
$ENVT
Checks: run every test file this diff adds or changes, database suites included, and your own proofs. Do not start whole-repository suites; CI runs them on this head. When a criterion itself requires whole-suite or repeated full runs, judge the builder's attached logs for this head (PR body or comments) instead of running them; missing or stale logs are the coverage gap, not your unrun suite. A criterion that only says CI or required checks are green is enforced by the merge gate on this exact head: note its current state under Notes, never as a finding or coverage hold.
Before-fix runs: in this same worktree, git checkout <merge base> -- <the non-test files the diff changes>, run the changed tests (each must fail for the reason its criterion names), then git checkout <head> -- <those files> and confirm git status shows only your own proof files. When the diff adds a new module that the tests import, failing at import before the change is the expected red for those tests, not a coverage gap; judge red-first by your own proofs on the head instead.
Verdict rule: a finding whose proof also fails on the merge base in code this diff does not change is pre-existing; one outside the numbered criteria is out of scope. List both under "Pre-existing or out of scope (for issues)"; they do not make the verdict changes requested, EXCEPT a real defect in an always-blocks class (correctness, business/client/person separation, sign-in, money, data loss) that this diff reaches: that blocks even outside the numbered criteria, and you say which class.
Separation: name each separation the diff touches (business, client, person) and prove it holds, or say none is touched.
Project method: AGENTS.md in the worktree.
EOF
# Review state for this repository only, where sol-rl-gate.sh --repo keeps it: never another repository's same-numbered PR.
LD=$R/polish/$L/sol-ledger-$N.json; [[ $L == launchastro/ops-astro ]] && LD=$R/polish/sol-ledger-$N.json; DS=${LD:h}/disputes-$N.md; DSNAP=""
[ -f $DS ] && { DSNAP=${LD:h}/disputes-$N-${H:0:7}.md; cp $DS $DSNAP; }
python3 $R/tools-orch/sol_rules.py prompt --pr $N --ledger $LD ${DSNAP:+--disputes} ${DSNAP:+$DSNAP} >> $K || { echo "rules prompt refused (dispute file or ledger): see stderr"; exit 1; }
if [[ -n $FIXURL ]]; then
  python3 $CF/make_sol_prompt.py $N $BR $B $H $W $C $FIXURL $FIXF $PREV --repo $REPO --checks $K --policy-root $HOME/.claude/skills --artifacts $D > $P || exit 1
else
  python3 $CF/make_sol_prompt.py $N $BR $B $H $W $C --repo $REPO --checks $K --policy-root $HOME/.claude/skills --artifacts $D > $P || exit 1
fi
# From here the background run owns the copy. A kill between this line and its launch leaves the copy to the sweep.
# It reads every value from its environment, quoted, never as pasted shell text: a path with a space must not
# split into two rm arguments, and a lane's text must not run as a command (#358).
trap - EXIT INT TERM
SOL_D=$D SOL_W=$W SOL_SW=$SW SOL_PD=$PD SOL_LOG=$LOG SOL_R=$R SOL_P=$P SOL_EFF=$EFF SOL_REPO=$REPO SOL_PR=$N \
  SOL_HEAD=$H SOL_DSNAP=$DSNAP SOL_SUB=$SUB SOL_TAG=$TAG SOL_LANE=$LANE SOL_CODEX=$SOL_CODEX SOL_SLOT=$SOL_SLOT nohup zsh -c "
# save FOLDER DEST: Sol's proof files in FOLDER go to DEST: a git worktree's untracked files, else every file up to
# 20 MB but node_modules, .git and build output (target, dist, build, .next), since nothing sweeps the proofs folder.
# No subshell: in zsh's EXIT trap after an exit, a subshell's status reads 0.
save() {
  setopt localoptions pipefail; local r
  mkdir -p \"\$2\" && cd \"\$1\" || { cd /; return 1; }
  if [ -e .git ]; then git ls-files --others --exclude-standard -z | xargs -0 -I{} rsync -R {} \"\$2/\"
  else rsync -a --max-size=20m --exclude node_modules --exclude .git --exclude target --exclude dist --exclude build \\
    --exclude .next ./ \"\$2/\"; fi
  r=\$?; cd /; return \$r
}
# Sol's proof files are saved, from the worktree and its sol* temp folders, before the copy goes. If any save fails,
# the copy stays, marked KEPT (copy-sweep.sh leaves it), and the run log says where.
drop() {
  (( dropped )) && return; dropped=1; setopt localoptions pipefail
  [ -f \"\$SOL_D/codex.log\" ] && tail -n 40 \"\$SOL_D/codex.log\" | cut -c1-400 > \"\$SOL_LOG\"
  s=0; [ -d \"\$SOL_W\" ] && { save \"\$SOL_W\" \"\$SOL_PD\" || s=1; }
  for f in \"\$SOL_D\"/tmp/sol*(N/); do save \"\$f\" \"\$SOL_PD/tmpdir/\${f:t}\" || s=1; done
  (( s )) && { echo \"proofs not saved to \$SOL_PD; copy kept: \$SOL_D\" | tee \"\$SOL_D/KEPT\" >> \"\$SOL_LOG\"; return 1; }
  git -C \"\$SOL_SW/mirror\" worktree remove --force \"\$SOL_W\" 2>/dev/null; rm -rf \"\$SOL_D\"; git -C \"\$SOL_SW/mirror\" worktree prune
}
# A kill stops the codex run as well, before its copy goes: cmd_pgid and wd_pgid are run_with_deadline's process
# groups (codex-shim.sh), in scope while it waits. Each is signalled by pid too, as the shim does, since a child
# that has not reached its setpgrp has no group yet. TERM, three seconds' grace, then KILL to both: the watchdog
# holds TERM until its command starts. Then the slot's group gets TERM, on which its holder gives the slot back.
stop() {
  for g in \$wd_pgid \$cmd_pgid; do kill -TERM -- -\$g || kill -TERM \$g; done
  if [[ -n \$cmd_pgid ]]; then
    for t in {1..15}; do kill -0 -- -\$cmd_pgid || kill -0 \$cmd_pgid || break; /bin/sleep 0.2; done
  fi
  for g in \$wd_pgid \$cmd_pgid; do kill -KILL -- -\$g || kill -KILL \$g; done
  free_slot; exit \$1
} 2>/dev/null
free_slot() { [[ -n \$sg ]] && { kill -TERM -- -\$sg || kill -TERM \$sg; }; } 2>/dev/null
trap drop EXIT; trap 'stop 130' INT; trap 'stop 143' TERM
source \"\$SOL_R/tools-orch/reviewer/codex-shim.sh\"
E=\$(sol_review_effort \"\$SOL_EFF\")
mkdir -p \"\$SOL_D/tmp\"; export TMPDIR=\"\$SOL_D/tmp/\"
# The slot is taken before the deadline starts, as run_sol_review does, so a wait never counts against it. Run inside
# codex_slot, run_with_deadline would sit in its subshell, out of stop()'s reach, so codex_slot holds a lease instead,
# in a process group of its own: a sh that says go once the slot is granted, then reads a pipe whose write end (fd 7)
# this shell opens and the run inherits. The slot goes back when the run ends (free_slot) or stop() runs; if this shell
# is killed any other way (KILL), only when codex and its deadline's watchdog have closed that pipe too (S381-1).
# A lane's own CODEX_SLOT_HELD is not this review's: Sol is a session of its own.
mkfifo \"\$SOL_D/slot-go\" \"\$SOL_D/slot-in\"
CODEX_SLOT_HELD= CODEX_SLOT_LABEL=sol-\$SOL_TAG /usr/bin/perl -e 'setpgrp(0, 0); exec @ARGV or exit 127' zsh -c 'source \"\$1\" && codex_slot /bin/sh -c \"echo go; exec cat > /dev/null\"' sol-slot \"\$SOL_SLOT\" < \"\$SOL_D/slot-in\" > \"\$SOL_D/slot-go\" 2>> \"\$SOL_D/codex.log\" & sg=\$!
exec 7> \"\$SOL_D/slot-in\"
read -r said < \"\$SOL_D/slot-go\"
[[ \$said == go ]] && run_with_deadline 1800 /bin/sh -c 'exec \"\$SOL_CODEX\" exec --dangerously-bypass-approvals-and-sandbox -m gpt-6.1-sol -c \"model_reasoning_effort=\$1\" - < \"\$2\"' sol-review \$E \"\$SOL_P\" >> \"\$SOL_D/codex.log\" 2>&1
free_slot
tg=\"\$HOME/.cache/code-factory/orchestration/trust-gate/trust-gate.sh\"; hs=\"Head SHA: \$SOL_HEAD\"
for t in 1 2 3; do v=\$(\"\$tg\" \"\$SOL_REPO\" \"\$SOL_PR\" 2>/dev/null | jq -r --arg h \"\$hs\" '.comments[]|select(.body|contains(\$h))|.body' | grep -oE '^Verdict: .*' | tail -1); [ -n \"\$v\" ] && break; sleep 20; done
u=\$(\"\$tg\" \"\$SOL_REPO\" \"\$SOL_PR\" 2>/dev/null | jq -r --arg h \"\$hs\" '.comments[]|select(.body|contains(\$h))|.url' | tail -1)
g=\$(\"\$SOL_R/tools-orch/sol-rl-gate.sh\" --repo \"\$SOL_REPO\" \"\$SOL_PR\" \"\$SOL_HEAD\" \"\$u\" \${SOL_DSNAP:+\"\$SOL_DSNAP\"})
[[ \$g == (PASS|HOLD)* ]] || gh api \"repos/\$SOL_REPO/statuses/\$SOL_HEAD\" -f context=\"Sol verdict\" -f state=failure -f description=\"Sol rules gate failed closed\" >/dev/null 2>&1
# /tmp/sol-<PR>-* names no repository, so only Code Factory's own review takes those files.
drop; [ -n \"\$SOL_SUB\" ] || cp /tmp/sol-\${SOL_PR}-* /tmp/sol*\${SOL_PR}*.log \"\$SOL_PD/\" 2>/dev/null
echo \"\$(date -u +%Y-%m-%dT%H:%M:%SZ) SOL-PR \$SOL_TAG RUN-END lane=\$SOL_LANE head=\${SOL_HEAD:0:10} \${v:-Verdict: none} \$u rules=\${g%% *}\" >> \"\$SOL_R/events.log\"
" > $SW/nohup-pr-$N.out 2>&1 &
echo "OK pid $! head ${H:0:10}"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) SOL-PR $TAG DISPATCHED lane=$LANE head=${H:0:10} gpt-6.1-sol $EFF rules=ralph-lisa pid=$! (issues: ${ISS//$'\n'/ }; prompt polish$SUB/${P:t})" >> $R/events.log
