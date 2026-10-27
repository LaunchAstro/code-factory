#!/bin/bash
# usage: checks.sh <worktree> <outdir>  -- runs Code Factory's own checks, one log per step, summary.tsv
W="$1"; O="$2"; mkdir -p "$O"; : > "$O/summary.tsv"
cd "$W" || exit 2
# Same head already checked all green on this machine: reuse that run (one green run per SHA).
sha=$(git rev-parse HEAD 2>/dev/null)
d=$(bash ~/Desktop/Agents/repos/code-factory/green-run.sh "$sha")
if [ -n "$d" ] && [ "$d" != "$O" ]; then cp -p "$d"/* "$O"/ && echo "$d" > "$O/reused-from.txt" && exit 0; fi
step() { local name="$1"; shift; local t0=$(date +%s); ( "$@" ) > "$O/$name.log" 2>&1; local rc=$?; local t1=$(date +%s); printf '%s\t%s\t%ss\n' "$name" "$rc" "$((t1-t0))" >> "$O/summary.tsv"; }
step node-test node --test orchestration/tests/
step stages-check bash -c 'if [ -f orchestration/archive/stages.mjs ]; then node orchestration/archive/stages.mjs --check; else node orchestration/stages.mjs --check; fi'
for f in orchestration/tests/*.sh; do step "sh-$(basename "$f" .sh)" bash "$f"; done
for f in orchestration/tests/*.py; do step "py-$(basename "$f" .py)" python3 "$f"; done
step tpl-install bash -c 'cd template && pnpm install --frozen-lockfile'
step tpl-check bash -c 'cd template && pnpm check'
echo DONE >> "$O/summary.tsv"
