#!/usr/bin/env bash
# Cases for orchestration/archive/factory.sh: one per MISSING line, the placeholder
# and template refusals, the round lock, the round label, the stage ceilings,
# publication from the checked commit, a fault or crash while publishing, the
# checked commit's skill verifier, the seat token kept out of output and --dry-run. Stubs herdr, gh and node on a fake
# PATH under a scratch root. No case boots a real seat.
set -uo pipefail

src=$(cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
fails=0
seat=testseat
real_node=$(command -v node)

commit_push() {                 # everything in the clone committed and pushed
  git -C "${clone:?}" add -A
  git -C "$clone" -c user.email=t@t -c user.name=t -c commit.gpgsign=false \
      commit --quiet -m "$1"
  git -C "$clone" push --quiet origin main
}

setup() {                       # a pristine scratch: remote, clone, root, stubs, HOME
  rm -rf "$scratch"/*
  root="$scratch/root"; clone="$scratch/clone"; bin="$scratch/bin"; home="$scratch/home"
  mkdir -p "$root/.local/lanes" "$bin" "$home/bin" "$home/tokens"
  git init --quiet --bare "$scratch/remote.git"
  git init --quiet -b main "$clone"
  mkdir -p "$clone/orchestration/skills" "$clone/orchestration/archive"
  cp -R "$src/seats" "$src/README.md" "$clone/orchestration/"
  cp -R "$src/archive/briefs" "$src/archive/boot" "$clone/orchestration/archive/"
  cp "$src/archive/factory.sh" "$src/archive/factory.example.json" "$src/archive/stages.json" "$clone/orchestration/archive/"
  cp "$src/skills/fetch.mjs" "$src/skills/SOURCES.json" "$clone/orchestration/skills/"
  printf 'orchestration/archive/factory.json\norchestration/skills/*/\n' > "$clone/.gitignore"
  sed -e "s|\"clone\": \"[^\"]*\"|\"clone\": \"$clone\"|" \
      -e "s|\"orchestrationRoot\": \"[^\"]*\"|\"orchestrationRoot\": \"$root\"|" \
      -e "s|\"seat\": \"[^\"]*\"|\"seat\": \"$seat\"|" \
      -e "s|\"ghAccount\": \"[^\"]*\"|\"ghAccount\": \"Tester\"|" \
      "$src/archive/factory.example.json" > "$clone/orchestration/archive/factory.json"
  git -C "$clone" remote add origin "$scratch/remote.git"
  commit_push init
  printf '#!/bin/sh\nexit 0\n' > "$bin/herdr"
  printf '#!/bin/sh\ncase "$1" in auth) echo "  x Logged in to github.com account Tester"; echo "  - Active account: true";; issue) case "$2" in view) [ "$3" = 26 ] && printf "OPEN\\tA real ticket\\n" || { printf "CLOSED\\tshut\\n"; exit 0; };; esac;;\n  api) case "$2" in *contents/skill?ref=*) echo %s;; *contents/?ref=*) echo %s;; *git/trees/*) echo %s;; *) echo %s;; esac;; esac\nexit 0\n' \
    "'[{\"type\":\"file\",\"name\":\"SKILL.md\",\"path\":\"skill/SKILL.md\"}]'" \
    "'[{\"type\":\"dir\",\"name\":\"skill\",\"path\":\"skill\",\"sha\":\"cccccccccccccccccccccccccccccccccccccccc\"}]'" \
    "'{\"truncated\":false,\"tree\":[{\"path\":\"SKILL.md\",\"mode\":\"100644\",\"type\":\"blob\"}]}'" \
    "'{\"content\":\"IyBwaW5uZWQgc2tpbGwK\"}'" > "$bin/gh"
  printf '#!/bin/sh\nexit 0\n' > "$bin/node"
  chmod +x "$bin"/*
  touch "$home/bin/claude-$seat"; chmod +x "$home/bin/claude-$seat"
  printf 'not-a-real-token\n' > "$home/tokens/$seat.token"
}

run() {                         # run factory.sh from $where with the stubs in front
  local where=${where:-$root}
  ( cd "$where" && PATH="$bin:$PATH" HOME="$home" CLAUDE_SEAT_TOKEN_DIR="$home/tokens" \
    bash "$clone/orchestration/archive/factory.sh" --config "$clone/orchestration/archive/factory.json" "$@" ) 2>&1
}

case_is() {                     # case_is <name> <expected exit> <expected text> -- args...
  local name=$1 want_code=$2 want_text=$3; shift 4
  local out code
  out=$(run "$@"); code=$?
  local left; left=$(ls -A "$root/.local/lanes" 2>/dev/null | wc -l | tr -d ' ')
  if [[ $code -eq $want_code && $out == *"$want_text"* && ( $want_code -eq 0 || $left -eq 0 ) ]]; then
    printf 'pass  %s\n' "$name"
  else
    printf 'FAIL  %s (exit %s, wanted %s, %s left; looked for %s)\n%s\n' "$name" "$code" "$want_code" "$left" "$want_text" "$out"
    fails=$((fails + 1))
  fi
}

setup; where=$scratch
case_is "MISSING orchestration root" 2 "MISSING  run from the orchestration root" -- --verbatim w 26
unset where
setup; printf '#!/bin/sh\nexit 1\n' > "$bin/herdr"; chmod +x "$bin/herdr"
case_is "MISSING herdr" 2 "MISSING  herdr answering" -- --verbatim w 26
setup; printf '#!/bin/sh\necho "  x Logged in to github.com account Other"; echo "  - Active account: true"; echo "  x Logged in to github.com account Tester"; echo "  - Active account: false"\n' > "$bin/gh"; chmod +x "$bin/gh"
case_is "MISSING gh account not active" 2 'gh auth switch -u Tester' -- --verbatim w 26
setup; chmod -x "$home/bin/claude-$seat"
case_is "MISSING seat launcher" 2 "MISSING  seat launcher" -- --verbatim w 26
setup; rm "$home/tokens/$seat.token"
case_is "MISSING seat token" 2 "MISSING  seat token" -- --verbatim w 26
setup; touch "$clone/left-behind.txt"
case_is "MISSING clean clone" 2 "working tree dirty" -- --verbatim w 26
setup; git -C "$clone" checkout --quiet -b sidetrack
case_is "MISSING clone not on main" 2 "not on main" -- --verbatim w 26
setup; git -C "$clone" -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit --quiet --allow-empty -m ahead
case_is "MISSING clone ahead of origin/main" 2 "main is not at origin/main" -- --verbatim w 26
setup; printf '#!/bin/sh\nexit 1\n' > "$bin/node"; chmod +x "$bin/node"
case_is "MISSING pinned skills" 2 "MISSING  pinned skills clean" -- --verbatim w 26
setup
case_is "MISSING open ticket" 2 "MISSING  ticket 99 open" -- --verbatim w 99
setup; python3 -c "import json,sys;p=sys.argv[1];c=json.load(open(p));c.pop('reviewer');json.dump(c,open(p,'w'))" "$clone/orchestration/archive/factory.json"
case_is "MISSING config key" 2 "MISSING  factory.json key reviewer" -- --verbatim w 26
setup; case_is "usage without --verbatim" 2 "usage: orchestration/archive/factory.sh" -- 26
case_is "usage with --verbatim last and no value" 2 "usage: orchestration/archive/factory.sh" -- 26 --verbatim
setup; printf '\nA stray <MYSTERY> nobody fills.\n' >> "$clone/orchestration/archive/briefs/BRIEF-CLEAN-TEMPLATE.md"
commit_push stray
case_is "placeholder refusal" 1 "still carries <MYSTERY>" -- --verbatim w 26
setup; printf '\nA stray <a mystery nobody fills>.\n' >> "$clone/orchestration/archive/briefs/BRIEF-CLEAN-TEMPLATE.md"
commit_push lower
case_is "lower-case phrase refusal" 1 "still carries <a mystery nobody fills>" -- --verbatim w 26
setup; touch "$root/.local/lanes/BRIEF-OLD-R7-2026-01-01.md"
case_is "round label one past the highest" 0 "BRIEF-BUILD-R8-" -- --dry-run --verbatim w 26
setup
case_is "dry run stops before the boot" 0 "dry run  would boot seat $seat" -- --dry-run --verbatim w 26
setup
out=$(run --dry-run --verbatim "sharpen the launch" 26)
n=$(printf '%s\n' "$out" | grep -c '^wrote    ')
boot=$(printf '%s\n' "$out" | sed -n 's/^wrote    \(.*ORCHESTRATOR-BOOT-.*\)$/\1/p')
if [[ $n -eq 9 ]] && grep -q 'sharpen the launch' "$boot" \
   && ! grep -qE '<[A-Z]|<what this round|<N\+1>' "$boot"; then
  printf 'pass  nine files, and the boot file carries no unfilled placeholder\n'
else printf 'FAIL  nine files and a filled boot file (wrote %s, wanted 9)\n%s\n' "$n" "$out"; fails=$((fails + 1)); fi

# Sol r1 on PR 295, finding 1: after the first kit moved under
# orchestration/archive/, the REVIEW briefs still sent lanes to example prompts
# at their old paths. Every repository path a generated round names exists.
named=$(grep -rhoE 'orchestration/[A-Za-z0-9_./-]*[A-Za-z0-9_]' "$root/.local/lanes" | sort -u)
gone=$(while IFS= read -r p; do [ -z "$p" ] || [ -e "$src/../$p" ] || printf '%s ' "$p"; done <<< "$named")
if [[ $n -eq 9 && $(printf '%s\n' "$named" | grep -c .) -gt 0 && -z $gone ]]; then
  printf 'pass  every repository path a generated round names exists\n'
else printf 'FAIL  every repository path a generated round names exists (missing: %s)\n' "${gone:-none named}"; fails=$((fails + 1)); fi

# Sol r2 on PR 295, the same kind: a generated brief located the moved example
# prompts by a bare name "beside" the shim. Every mention of a file the move put
# under orchestration/archive/ carries that archive path.
bare=$(python3 - "$root/.local/lanes" <<'PY'
import pathlib, re, sys
home = {'stages.json': '', 'stages.mjs': '', 'factory.sh': '', 'factory.example.json': '',
        'REVIEW-R7.md': 'reviewer/handbacks/', 'opus-review-prompt-example.txt': 'reviewer/',
        'sol-review-prompt-first-head-example.txt': 'reviewer/',
        'sol-review-prompt-fix-head-example.txt': 'reviewer/', 'sol-review-prompt-*-example.txt': 'reviewer/',
        'ORCHESTRATOR-BOOT-TEMPLATE.md': 'boot/', 'ORCHESTRATOR-STATE-TEMPLATE.md': 'boot/'}
for stage in ('BUILD', 'CLEAN', 'DESLOP', 'FIX', 'PLAN-CHECK', 'REVIEW', 'REVIEW-FIXHEAD', 'SCORE'):
    home[f'BRIEF-{stage}-TEMPLATE.md'] = 'briefs/'
for path in sorted(pathlib.Path(sys.argv[1]).rglob('*')):
    if not path.is_file():
        continue
    text = path.read_text()
    for name, folder in home.items():
        for hit in re.finditer(r'(?<![\w.*-])' + re.escape(name), text):
            if not text[:hit.start()].endswith('orchestration/archive/' + folder):
                print(f'{path.name}:{name}', end=' ')
PY
)
if [[ $n -eq 9 && -z $bare ]]; then
  printf 'pass  a generated round names every moved file by its archive path\n'
else printf 'FAIL  a generated round names every moved file by its archive path (bare: %s)\n' "$bare"; fails=$((fails + 1)); fi

# Sol r1 on PR 295, finding 2: a clone set up before the move keeps its config
# at orchestration/factory.json. With the repository's own ignore rules it
# stays clean, and the launcher, pointed at the moved copy, still runs.
setup; cp "$src/../.gitignore" "$clone/.gitignore"; commit_push ignores
cp "$clone/orchestration/archive/factory.json" "$clone/orchestration/factory.json"
if [[ -z $(git -C "$clone" status --porcelain --untracked-files=all) ]]; then
  case_is "an old-path config leaves the clone clean and the dry run runs" 0 "dry run  would boot seat $seat" -- --dry-run --verbatim w 26
else printf 'FAIL  an old-path config leaves the clone clean (git status: %s)\n' "$(git -C "$clone" status --porcelain --untracked-files=all | tr '\n' ' ')"; fails=$((fails + 1)); fi

setup; python3 -c "import json,sys;p=sys.argv[1];c=json.load(open(p));c['model']='opus; touch '+sys.argv[2];json.dump(c,open(p,'w'))" \
  "$clone/orchestration/archive/factory.json" "$scratch/injected"
case_is "MISSING model not one plain token" 2 "MISSING  model is one plain token" -- --dry-run --verbatim w 26
setup; git -C "$clone" remote set-url origin "$scratch/unreachable.git"
case_is "MISSING origin unreachable" 2 "cannot fetch origin main" -- --dry-run --verbatim w 26
setup; git -C "$clone" rm --quiet orchestration/archive/briefs/BRIEF-BUILD-TEMPLATE.md; commit_push nobuild
case_is "missing BUILD template refused before any brief is written" 1 "BRIEF-BUILD-TEMPLATE.md is not there" -- --dry-run --verbatim w 26
setup                           # another run holds the round lock while this one starts
python3 -c "import fcntl,sys,time;f=open(sys.argv[1],'a');fcntl.flock(f,fcntl.LOCK_EX);open(sys.argv[2],'w').close();time.sleep(60)" \
  "$root/.local/factory.lock" "$scratch/held" &
holder=$!
until [[ -e $scratch/held ]]; do sleep 0.05; done
case_is "a second round while one is being written is refused" 2 "another factory run holds" -- --dry-run --verbatim w 26
kill -9 "$holder"; wait "$holder" 2>/dev/null; rm -rf "$root/.local/lanes"/*
case_is "a crashed run's lock does not hold the next round" 0 "BRIEF-BUILD-R1-" -- --dry-run --verbatim w 26
setup; python3 -c "import json,sys;p=sys.argv[1];s=json.load(open(p));[r.update(wall=90) for r in s if r['stage']=='BUILD'];json.dump(s,open(p,'w'),indent=2)" \
  "$clone/orchestration/archive/stages.json"
commit_push wall90
out=$(run --dry-run --verbatim w 26)
build=$(printf '%s\n' "$out" | sed -n 's/^wrote    \(.*BRIEF-BUILD-.*\)$/\1/p')
if [[ -n $build ]] && grep -q 'Wall 90 minutes' "$build" && ! grep -q 'Wall 75 minutes' "$build"; then
  printf 'pass  the BUILD brief takes its wall from stages.json\n'
else printf 'FAIL  the BUILD brief takes its wall from stages.json (wrote %s)\n%s\n' "${build:-nothing}" "$out"; fails=$((fails + 1)); fi

setup; python3 -c "import json,sys;p=sys.argv[1];c=json.load(open(p));c['seat']='testseat; touch '+sys.argv[2];json.dump(c,open(p,'w'))" \
  "$clone/orchestration/archive/factory.json" "$scratch/injected"
case_is "MISSING seat not one plain token" 2 "MISSING  seat is one plain token" -- --dry-run --verbatim w 26
setup                           # the fetch succeeds but its refspec leaves origin/main where it was
git -C "$clone" config remote.origin.fetch '+refs/heads/main:refs/remotes/origin/elsewhere'
git clone --quiet -b main "$scratch/remote.git" "$scratch/ahead"
git -C "$scratch/ahead" -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit --quiet --allow-empty -m ahead
git -C "$scratch/ahead" push --quiet origin main
case_is "a fetch that leaves origin/main stale is refused" 2 "main is not at origin/main" -- --dry-run --verbatim w 26
setup                           # the template changes after the clean-clone check, before publication
printf '#!/bin/sh\nprintf "\\nUNCHECKED LINE\\n" >> "%s"\nexit 0\n' "$clone/orchestration/archive/briefs/BRIEF-BUILD-TEMPLATE.md" > "$bin/node"
out=$(run --dry-run --verbatim w 26); code=$?
build=$(printf '%s\n' "$out" | sed -n 's/^wrote    \(.*BRIEF-BUILD-.*\)$/\1/p')
if [[ $code -eq 0 && -n $build ]] && ! grep -q 'UNCHECKED LINE' "$build"; then
  printf 'pass  a template changed after the clean-clone check is not published\n'
else printf 'FAIL  a template changed after the clean-clone check is not published (exit %s, wrote %s)\n%s\n' "$code" "${build:-nothing}" "$out"; fails=$((fails + 1)); fi
setup; mkdir -p "$scratch/py"       # python's second move into .local/lanes fails
printf 'import shutil\n_move, calls = shutil.move, []\ndef move(*a, **k):\n    calls.append(1)\n    if len(calls) == 2:\n        raise OSError("publication fault")\n    return _move(*a, **k)\nshutil.move = move\n' > "$scratch/py/sitecustomize.py"
PYTHONPATH=$scratch/py case_is "a publication fault leaves no partial round" 1 "publication fault" -- --dry-run --verbatim w 26
setup; mkdir -p "$scratch/py"       # at the first move, another open of the lock file tries it
printf 'import fcntl, os, shutil\n_move = shutil.move\ndef move(*a, **k):\n    if not os.path.exists(os.environ["PROBE"]):\n        with open(os.environ["LOCK"], "a") as f:\n            try:\n                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB); state = "free"\n            except BlockingIOError:\n                state = "held"\n        open(os.environ["PROBE"], "w").write(state)\n    return _move(*a, **k)\nshutil.move = move\n' > "$scratch/py/sitecustomize.py"
out=$(PYTHONPATH=$scratch/py LOCK=$root/.local/factory.lock PROBE=$scratch/probe run --dry-run --verbatim w 26); code=$?
if [[ $code -eq 0 && $(cat "$scratch/probe" 2>/dev/null) == held ]]; then
  printf 'pass  the round lock is held while the files are published\n'
else printf 'FAIL  the round lock is held while the files are published (exit %s, lock %s)\n%s\n' "$code" "$(cat "$scratch/probe" 2>/dev/null || echo untried)" "$out"; fails=$((fails + 1)); fi
setup; python3 -c "import json,sys;p=sys.argv[1];s=json.load(open(p));v={'REVIEW':('reviews',8),'BUILD':('pushes',3),'PLAN-CHECK':('reviews',2),'SCORE':('pullRequests',2)};[r.update({v[r['stage']][0]:v[r['stage']][1]}) for r in s if r['stage'] in v];json.dump(s,open(p,'w'),indent=2)" \
  "$clone/orchestration/archive/stages.json"
commit_push counts
out=$(run --dry-run --verbatim w 26)
review=$(printf '%s\n' "$out" | sed -n 's/^wrote    \(.*BRIEF-REVIEW-R.*\)$/\1/p')
stale=$(printf '%s\n' "$out" | sed -n 's/^wrote    //p' | tr '\n' '\0' | xargs -0 grep -niE 'six sessions|two pushes|pushes at two|one session|one pull request to|second push|no third' 2>&1)
if [[ -n $review ]] && grep -q 'at most 8 sessions' "$review" && [[ -z $stale ]]; then
  printf 'pass  changed ceilings leave no stale count in the briefs\n'
else printf 'FAIL  changed ceilings leave no stale count in the briefs (REVIEW brief %s)\n%s\n' "${review:-not written}" "$stale"; fails=$((fails + 1)); fi

setup; mkdir -p "$scratch/py"       # move two crosses filesystems, and its copy fails after writing
printf 'import errno, os, shutil\n_rename, _copy, calls = os.rename, shutil.copyfile, []\ndef rename(src, dst, *a, **k):\n    if str(dst).endswith(".md") and "/.local/lanes/" in str(dst):\n        calls.append(dst)\n        if len(calls) == 2:\n            raise OSError(errno.EXDEV, "cross-device move")\n    return _rename(src, dst, *a, **k)\ndef copyfile(src, dst, *a, **k):\n    if "/.local/lanes/" in str(dst):\n        open(dst, "w").write("half a brief\\n")\n        raise OSError(errno.ENOSPC, "partial-copy fault")\n    return _copy(src, dst, *a, **k)\nos.rename, shutil.copyfile = rename, copyfile\n' > "$scratch/py/sitecustomize.py"
PYTHONPATH=$scratch/py case_is "a failed cross-filesystem move leaves no partial brief" 1 "partial-copy fault" -- --dry-run --verbatim w 26
crash_case() {                  # crash_case <move> <python run at that move> [<name>]
  setup; mkdir -p "$scratch/py"     # the process moving the files in dies, or is told to, at one move
  printf 'import os, shutil, signal, time\n_move, calls = shutil.move, []\ndef move(*a, **k):\n    calls.append(1)\n    if len(calls) == %s:\n        %s\n    return _move(*a, **k)\nshutil.move = move\n' "$1" "$2" > "$scratch/py/sitecustomize.py"
  out=$(PYTHONPATH=$scratch/py run --dry-run --verbatim w 26)
  local name="${3:-$2 at move $1} leaves the whole round or none"
  n=$(ls -A "$root/.local/lanes" | grep -c '\.md$')
  if [[ $n -eq 0 || $n -eq 9 ]]; then printf 'pass  %s\n' "$name"
  else printf 'FAIL  %s (%s briefs left)\n%s\n' "$name" "$n" "$out"; fails=$((fails + 1)); fi
}
crash_case 2 'os._exit(77)'
crash_case 9 'os.kill(os.getpid(), signal.SIGKILL)'
crash_case 3 'os.kill(os.getppid(), signal.SIGTERM); os.kill(os.getpid(), signal.SIGTERM)'
# Only the parent is killed: the shell exits under a mover still moving, which
# must finish the round, or take back what it moved when a later move fails.
crash_case 2 'os.kill(os.getppid(), signal.SIGKILL); time.sleep(1)' 'killing only the publishing parent at move 2'
crash_case 3 'os.kill(os.getppid(), signal.SIGKILL); time.sleep(1); raise OSError("publication fault")' \
  'a move that fails after only the publishing parent was killed'
setup; printf 'a handover\n' > "$root/.local/lanes/ORCHESTRATOR-BOOT-$(date +%F)-r1.md"
out=$(run --dry-run --verbatim w 26); code=$?
if [[ $code -eq 1 && $out == *"already in"* && $(cat "$root/.local/lanes/ORCHESTRATOR-BOOT-$(date +%F)-r1.md") == 'a handover' \
      && $(ls -A "$root/.local/lanes" | wc -l | tr -d ' ') -eq 1 ]]; then
  printf 'pass  a round never replaces a file already in lanes\n'
else printf 'FAIL  a round never replaces a file already in lanes (exit %s)\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi
setup                           # the verifier changes after the clean-clone check
printf "console.log('skills:pinned clean');\n" > "$scratch/clean.mjs"
printf '#!/bin/sh\ncp "%s" "%s"\nexec "%s" "$@"\n' "$scratch/clean.mjs" "$clone/orchestration/skills/fetch.mjs" "$real_node" > "$bin/node"
case_is "the pinned-skills check runs the checked commit's verifier" 2 "MISSING  pinned skills clean" -- --dry-run --verbatim w 26
setup                           # the pins change after the clean-clone check, to one the installed copy matches
mkdir -p "$clone/orchestration/skills/orchestrator"; printf '# pinned skill\n' > "$clone/orchestration/skills/orchestrator/SKILL.md"
python3 -c "import hashlib,json,sys;json.dump({'skills':[{'name':'orchestrator','repository':'fixture/repo','path':'skill','commit':'a'*40,'sha256':hashlib.sha256(b'# pinned skill\n').hexdigest()}],'prerequisites':[]},open(sys.argv[1],'w'))" "$scratch/pins.json"
printf '#!/bin/sh\ncp "%s" "%s"\nexec "%s" "$@"\n' "$scratch/pins.json" "$clone/orchestration/skills/SOURCES.json" "$real_node" > "$bin/node"
case_is "the pinned-skills check reads the checked commit's pins" 2 "MISSING  pinned skills clean" -- --dry-run --verbatim w 26
setup                           # the seat script changes after the clean-clone check, before the boot
printf '#!/bin/sh\necho committed > "%s"\necho "booted pane p1"\n' "$scratch/ran" > "$clone/orchestration/seats/claude-seat-up"
commit_push seatup
printf '#!/bin/sh\necho working-tree > "%s"\necho "booted pane p1"\n' "$scratch/ran" > "$scratch/seat-up"
printf '#!/bin/sh\ncp "%s" "%s"\nexit 0\n' "$scratch/seat-up" "$clone/orchestration/seats/claude-seat-up" > "$bin/node"
out=$(run --verbatim w 26)
if [[ $(cat "$scratch/ran" 2>/dev/null) == committed ]]; then
  printf 'pass  the seat script that boots the orchestrator is the checked commit'"'"'s\n'
else printf 'FAIL  the seat script that boots the orchestrator is the checked commit'"'"'s (ran %s)\n%s\n' "$(cat "$scratch/ran" 2>/dev/null || echo nothing)" "$out"; fails=$((fails + 1)); fi
setup                           # Sol's review of 11bb360: the installed skill changes after the verifier passed
skill=$clone/orchestration/skills/orchestrator/SKILL.md
mkdir -p "${skill%/*}"; printf '# pinned skill\n' > "$skill"
python3 -c "import hashlib,json,sys;json.dump({'skills':[{'name':'orchestrator','repository':'fixture/repo','path':'skill','commit':'a'*40,'sha256':hashlib.sha256(b'# pinned skill\n').hexdigest()}],'prerequisites':[]},open(sys.argv[1],'w'))" "$clone/orchestration/skills/SOURCES.json"
printf '#!/bin/sh\ncp "%s" "%s"\necho "booted pane p1"\n' "$skill" "$scratch/observed" > "$clone/orchestration/seats/claude-seat-up"
commit_push pinned
printf '#!/bin/sh\n"%s" "$@" || exit $?\nprintf "# altered after verification\\n" > "%s"\n' "$real_node" "$skill" > "$bin/node"
out=$(run --verbatim w 26)
if [[ $out == *"ok       pinned skills clean"* ]] && [[ ! -e $scratch/observed || $(cat "$scratch/observed") == '# pinned skill' ]]; then
  printf 'pass  the orchestrator boots only on the skills as verified\n'
else printf 'FAIL  the orchestrator boots only on the skills as verified (it saw: %s)\n%s\n' "$(cat "$scratch/observed" 2>/dev/null || echo nothing)" "$out"; fails=$((fails + 1)); fi
# Sol PRV-cf-85-R1, criterion 4.
setup                           # the skill changes after the final verification, as the seat script is read
mkdir -p "${skill%/*}"; printf '# pinned skill\n' > "$skill"
python3 -c "import hashlib,json,sys;json.dump({'skills':[{'name':'orchestrator','repository':'fixture/repo','path':'skill','commit':'a'*40,'sha256':hashlib.sha256(b'# pinned skill\n').hexdigest()}],'prerequisites':[]},open(sys.argv[1],'w'))" "$clone/orchestration/skills/SOURCES.json"
printf '#!/bin/sh\ncp "%s" "%s"\necho "booted pane p1"\n' "$skill" "$scratch/observed" > "$clone/orchestration/seats/claude-seat-up"
commit_push pinned
printf '#!/bin/sh\nexec "%s" "$@"\n' "$real_node" > "$bin/node"
printf '#!/bin/sh\ncase "$*" in *cat-file*seats/claude-seat-up*) printf "# altered after final verification\\n" > "%s";; esac\nexec "%s" "$@"\n' "$skill" "$(command -v git)" > "$bin/git"
chmod +x "$bin/git"
out=$(run --verbatim w 26)
# Sol's review of d27f711: a preflight refusal never reaches the boundary, so
# the case needs the verifier's pass first.
if [[ $out == *"ok       pinned skills clean"* ]] && [[ ! -e $scratch/observed || $(cat "$scratch/observed") == '# pinned skill' ]]; then
  printf 'pass  nothing runs between the last skill verification and the boot\n'
else printf 'FAIL  nothing runs between the last skill verification and the boot (it saw: %s)\n%s\n' "$(cat "$scratch/observed")" "$out"; fails=$((fails + 1)); fi
setup                           # the same review: BUILD names another brief, and the original says 75
cp "$clone/orchestration/archive/briefs/BRIEF-BUILD-TEMPLATE.md" "$clone/orchestration/archive/briefs/BRIEF-BUILD-ALTERNATE.md"
python3 -c "import json,sys;p=sys.argv[1];s=json.load(open(p));[r.update(brief='orchestration/archive/briefs/BRIEF-BUILD-ALTERNATE.md',wall=90) for r in s if r['stage']=='BUILD'];json.dump(s,open(p,'w'),indent=2)" \
  "$clone/orchestration/archive/stages.json"
sed -i.bak 's/<BUILD-WALL>/75/' "$clone/orchestration/archive/briefs/BRIEF-BUILD-TEMPLATE.md"; rm "$clone/orchestration/archive/briefs/BRIEF-BUILD-TEMPLATE.md.bak"
commit_push alternate
out=$(run --dry-run --verbatim w 26)
build=$(printf '%s\n' "$out" | sed -n 's/^wrote    \(.*BRIEF-BUILD-.*\)$/\1/p')
stale=$(printf '%s\n' "$out" | sed -n 's/^wrote    //p' | tr '\n' '\0' | xargs -0 grep -l 'Wall 75 minutes' 2>/dev/null)
# Sol's review of 87a9f77: it was published as BRIEF-BUILD--R1, the name cut
# short by the -TEMPLATE.md every other template ends in.
if [[ $build == */BRIEF-BUILD-ALTERNATE-R1-* ]] && grep -q 'Wall 90 minutes' "$build" && [[ -z $stale ]]; then
  printf 'pass  the BUILD brief published is the one stages.json names, under its own name\n'
else printf 'FAIL  the BUILD brief published is the one stages.json names, under its own name (wrote %s, 75 in %s)\n%s\n' "${build:-nothing}" "${stale:-nothing}" "$out"; fails=$((fails + 1)); fi
# Sol PRV-cf-85-R1, criterion 1.
setup
cp "$clone/orchestration/archive/briefs/BRIEF-BUILD-TEMPLATE.md" "$clone/orchestration/archive/briefs/BRIEF-BUILD-ALTERNATE.md"
python3 -c "import json,sys;p=sys.argv[1];s=json.load(open(p));[r.update(brief='orchestration/archive/briefs/BRIEF-BUILD-ALTERNATE.md') for r in s if r['stage']=='BUILD'];json.dump(s,open(p,'w'))" "$clone/orchestration/archive/stages.json"
commit_push alternate
out=$(run --dry-run --verbatim w 26); code=$?
if [[ $code -eq 0 && $out == *BRIEF-BUILD-ALTERNATE-R1-* ]]; then
  printf 'pass  an alternate BUILD brief is published under its full name\n'
else printf 'FAIL  an alternate BUILD brief is published under its full name (exit %s)\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi
for wall in '"15"' 15.5 true -1; do
  setup; python3 -c "import json,sys;p=sys.argv[1];s=json.load(open(p));[r.update(wall=json.loads(sys.argv[2])) for r in s if r['stage']=='REVIEW'];json.dump(s,open(p,'w'),indent=2)" \
    "$clone/orchestration/archive/stages.json" "$wall"
  commit_push "wall $wall"
  case_is "a REVIEW wall of $wall is refused before any brief is written" 1 "not a whole number" -- --dry-run --verbatim w 26
done
setup; python3 -c "import json,sys;p=sys.argv[1];s=json.load(open(p));[r.update(reviewsPerPullRequest=3) for r in s if r['stage']=='REVIEW'];json.dump(s,open(p,'w'),indent=2)" \
  "$clone/orchestration/archive/stages.json"
commit_push cap3
out=$(run --dry-run --verbatim w 26)
boot=$(printf '%s\n' "$out" | sed -n 's/^wrote    \(.*ORCHESTRATOR-BOOT-.*\)$/\1/p')
if [[ -n $boot ]] && grep -q 'any count at 3 with the head red' "$boot" && ! grep -q 'count at 2' "$boot"; then
  printf 'pass  the boot holds a pull request at the REVIEW row'"'"'s per-pull-request ceiling\n'
else printf 'FAIL  the boot holds a pull request at the REVIEW row'"'"'s per-pull-request ceiling (boot %s)\n%s\n' "${boot:-not written}" "$out"; fails=$((fails + 1)); fi
fixhead=$(printf '%s\n' "$out" | sed -n 's/^wrote    \(.*BRIEF-REVIEW-FIXHEAD-.*\)$/\1/p')
if [[ -n $fixhead ]] && grep -q "REVIEW row's 3 reviews per pull request" "$fixhead" && ! grep -qiE 'third session|three sessions' "$fixhead"; then
  printf 'pass  the fix-head brief judges pass line 4 at the REVIEW row'"'"'s per-pull-request ceiling\n'
else printf 'FAIL  the fix-head brief judges pass line 4 at the REVIEW row'"'"'s per-pull-request ceiling (brief %s)\n%s\n' "${fixhead:-not written}" "$(grep -niE 'third session|three sessions' "${fixhead:-/dev/null}")"; fails=$((fails + 1)); fi
setup                           # a full dry run and a refused run, both through the preflight
out=$(run --dry-run --verbatim w 26; run --verbatim w 99)
marks=$(printf '%s\n' "$out" | grep -c 'not-a-real-token')
if [[ $out == *"dry run  would boot"* && $out == *"MISSING  ticket 99 open"* && $marks -eq 0 ]]; then
  printf 'pass  the seat token never reaches the output\n'
else printf 'FAIL  the seat token never reaches the output (it is on %s line(s), not shown)\n' "$marks"; fails=$((fails + 1)); fi

# Sol PRV-cf-85-R1, criterion 5. factory.sh boots every seat through
# claude-seat-up, so its suite checks that the seat cases catch a focus failure
# reported as success: on a copy whose focus guard is cut, seat-up-cases.sh
# must fail, and finish inside 30 seconds.
rm -rf "$scratch"/*
cp -R "$src/seats" "$src/tests" "$scratch/"
guarded='herdr workspace focus "$ws" >/dev/null || { print -u2 "seat-$seat: focus failed"; return 1 }'
if ! python3 -c "import sys;p,g=sys.argv[1:];t=open(p).read();g in t or sys.exit(1);open(p,'w').write(t.replace(g,'herdr workspace focus \"\$ws\" >/dev/null || true',1))" \
     "$scratch/seats/claude-seat-up" "$guarded"; then
  printf 'FAIL  the seat cases catch a failed focus reported as success (the focus guard is not in claude-seat-up)\n'; fails=$((fails + 1))
else
  status=$(python3 -c "import subprocess,sys
try: print(subprocess.run(['bash',sys.argv[1]],capture_output=True,timeout=30).returncode)
except subprocess.TimeoutExpired: print('timed out')" "$scratch/tests/seat-up-cases.sh")
  if [[ $status =~ ^[1-9][0-9]*$ ]]; then
    printf 'pass  the seat cases catch a failed focus reported as success\n'
  else printf 'FAIL  the seat cases catch a failed focus reported as success (seat-up-cases.sh: %s)\n' "$status"; fails=$((fails + 1)); fi
fi

printf '\n%s case(s) failed\n' "$fails"
[[ $fails -eq 0 ]]
