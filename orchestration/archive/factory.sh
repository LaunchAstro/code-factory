#!/usr/bin/env bash
# One command from a clean clone: preflight, write the round's briefs, boot the
# orchestrator pane. Run from the orchestration root, the directory owning
# .local/lanes/, with the code clone beside it. Ticket 26.
#   orchestration/archive/factory.sh [--dry-run] [--config <file>] --verbatim "<words>" <ticket>...
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd)
config="$here/factory.json"
dry_run=0
verbatim=""
tickets=()
while (( $# )); do
  case $1 in
    --dry-run) dry_run=1 ;;
    --verbatim) verbatim=${2-}; shift ;;
    --config) config=${2-}; shift ;;
    -*) printf 'unknown option %s\n' "$1" >&2; exit 2 ;;
    *) tickets+=("$1") ;;
  esac
  shift || break                # --verbatim last, with no value, ends here
done
if (( ${#tickets[@]} == 0 )) || [[ -z $verbatim ]]; then
  printf 'usage: orchestration/archive/factory.sh [--dry-run] [--config <file>] --verbatim "<words>" <ticket>...\n' >&2
  exit 2
fi

# --- config ---------------------------------------------------------------
cfg=$(python3 - "$config" "$here/factory.example.json" <<'PY'
import json, shlex, sys
keys = list(json.load(open(sys.argv[2])))   # the example file is the list of keys
path = sys.argv[1]
try:
    conf = json.load(open(path))
except FileNotFoundError:
    sys.exit(f"MISSING  {path}: copy orchestration/archive/factory.example.json to it and fill it in")
except json.JSONDecodeError as err:
    sys.exit(f"MISSING  {path}: not valid JSON ({err})")
absent = [k for k in keys if str(conf.get(k, "")).strip() == ""]
for k in absent:
    print(f"MISSING  factory.json key {k}: add it, factory.example.json shows the shape",
          file=sys.stderr)
if absent:
    sys.exit(2)
for k in keys:
    print(f"cfg_{k}={shlex.quote(str(conf[k]))}")
PY
) || exit 2
set -a; eval "$cfg"; set +a
lanes="$cfg_orchestrationRoot/.local/lanes"

# --- preflight ------------------------------------------------------------
missing=0
ok()   { printf 'ok       %s\n' "$1"; }
miss() { printf 'MISSING  %s: %s\n' "$1" "$2"; missing=1; }
try()  { local what=$1 fix=$2; shift 2
         if "$@" >/dev/null 2>&1; then ok "$what"; else miss "$what" "$fix"; fi; }
# orchestration/seats/claude-seat-up types its arguments into a pane's shell
# (each one quoted since Sol's review of 69afe53); the seat and model stay one
# plain token each, so they name a launcher and a model and nothing more.
for k in seat model; do
  v=cfg_$k
  if [[ ${!v} =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then ok "$k is one plain token"
  else miss "$k is one plain token" "set factory.json $k to letters, digits, dot, underscore and hyphen only"; fi
done
if [[ $(pwd -P) == "$(cd -- "$cfg_orchestrationRoot" 2>/dev/null && pwd -P)" ]]; then
  ok "run from the orchestration root ($cfg_orchestrationRoot)"
else
  miss "run from the orchestration root ($cfg_orchestrationRoot)" \
       "cd there first; it is the directory owning .local/lanes/, with the clone beside it"
fi
try "herdr answering" "start herdr, then \`herdr workspace list\` must exit 0" \
    herdr workspace list
# Signed in is not enough: every gh call in the round goes out as the active one.
gh_state=$(gh auth status 2>&1 | awk -v a="$cfg_ghAccount" '/Logged in to/ {n = $0; sub(/.*account /, "", n); sub(/ .*/, "", n)} /Active account:/ {if (n == a) print ($0 ~ /true/ ? "active" : "signed in but not the active account")}' || true)
if [[ $gh_state == active ]]; then
  ok "gh active account is $cfg_ghAccount"
else
  miss "gh active account is $cfg_ghAccount" \
       "${gh_state:-not signed in as that account}; run \`gh auth switch -u $cfg_ghAccount\` or \`gh auth login\` yourself, never from a lane"
fi
launcher="$HOME/bin/claude-$cfg_seat"
try "seat launcher $launcher" \
    "copy the launcher template from orchestration/skills/claude-subscription-switch/, chmod +x" \
    test -x "$launcher"
token="${CLAUDE_SEAT_TOKEN_DIR:-<CLAUDE_SEAT_TOKEN_DIR unset>}/$cfg_seat.token"
try "seat token $token readable" "set CLAUDE_SEAT_TOKEN_DIR and write the seat's token there; nothing here ever reads it" \
    test -r "$token"
tmp=$(mktemp -d)                         # the ticket list, the written list, the checked verifier
# The process moving the round in holds $tmp/mover until it ends, so staging
# is never removed under it, whatever ended this shell. Nothing interrupts the wait.
cleanup() {
  trap '' INT TERM HUP
  [[ -e $tmp/mover ]] && python3 -c 'import fcntl, sys; fcntl.flock(open(sys.argv[1]), fcntl.LOCK_EX)' "$tmp/mover" || true
  rm -rf "$tmp" ${staged:+"$staged"}
}
trap cleanup EXIT
clone_state() {
  git -C "$cfg_clone" rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git clone"; return 1; }
  [[ -z $(git -C "$cfg_clone" status --porcelain) ]] || { echo "working tree dirty"; return 1; }
  [[ $(git -C "$cfg_clone" rev-parse --abbrev-ref HEAD) == main ]] || { echo "not on main"; return 1; }
  git -C "$cfg_clone" fetch --quiet origin main 2>/dev/null \
    || { echo "cannot fetch origin main, so its head is unknown"; return 1; }
  # FETCH_HEAD is what this fetch found; origin/main moves only if the refspec says so.
  local head; head=$(git -C "$cfg_clone" rev-parse HEAD)
  [[ $head == $(git -C "$cfg_clone" rev-parse FETCH_HEAD) ]] || { echo "main is not at origin/main"; return 1; }
  echo "$head"
}
# The round's files are read from this commit, never from the working tree,
# which can change after it was checked.
if checked=$(clone_state); then
  ok "clone clean on main at origin/main ($cfg_clone)"
else
  miss "clone clean on main at origin/main ($cfg_clone)" "$checked"
fi
# The verifier and its pins come from that commit too; only the installed
# skills it compares are the working tree's, where fetch.mjs puts them.
pinned_clean() {
  local f
  for f in fetch.mjs SOURCES.json; do
    git -C "$cfg_clone" cat-file blob "$checked:orchestration/skills/$f" > "$tmp/$f" || return 1
  done
  node "$tmp/fetch.mjs" --check --installed "$cfg_clone/orchestration/skills"
}
try "pinned skills clean" "run \`node orchestration/skills/fetch.mjs\` in $cfg_clone" pinned_clean
ticket_tsv=$tmp/tickets
list_file=$tmp/written
for t in "${tickets[@]}"; do
  line=$(gh issue view "$t" --repo "$cfg_owner/$cfg_repo" --json state,title \
         -q '.state + "\t" + .title' 2>/dev/null || true)
  if [[ $line == OPEN*  ]]; then
    ok "ticket $t open"
    printf '%s\t%s\n' "$t" "${line#OPEN$'\t'}" >> "$ticket_tsv"
  else
    miss "ticket $t open" "open issue $t on $cfg_owner/$cfg_repo (it reads: ${line%%$'\t'*})"
  fi
done
if (( missing )); then
  printf 'refused: a preflight item is missing, nothing written\n' >&2
  exit 2
fi

# --- the round's files ----------------------------------------------------
mkdir -p "$lanes"
staged=$(mktemp -d "$cfg_orchestrationRoot/.local/.factory-staging.XXXXXX")   # beside lanes, so a move is a rename
export f_verbatim="$verbatim" f_lanes="$lanes" f_tickets="$ticket_tsv" \
       f_staged="$staged" f_count="${#tickets[@]}" f_head="$checked" f_mover="$tmp/mover"
python3 - > "$list_file" <<'PY'
import fcntl, json, os, pathlib, re, shutil, signal, subprocess, sys
E = os.environ
lanes = pathlib.Path(E["f_lanes"])
staged = pathlib.Path(E["f_staged"])
date = __import__("datetime").date.today().isoformat()
clone = pathlib.Path(E["cfg_clone"])
def committed(path):
    """The file as the checked commit holds it, or None."""
    got = subprocess.run(["git", "-C", str(clone), "cat-file", "blob", f"{E['f_head']}:{path}"],
                         capture_output=True)
    return got.stdout.decode() if got.returncode == 0 else None
# Every template a round writes, so a missing one refuses rather than shrinking
# the round. A stage's brief is the one its orchestration/archive/stages.json
# row names, the path orchestration/archive/stages.mjs checks (Sol's review of
# 11bb360 found a second, hard-coded one).
rows = json.loads(committed("orchestration/archive/stages.json") or "[]")
briefs = {row.get("stage"): row.get("brief") for row in rows}
staged_stages = ("PLAN-CHECK", "BUILD", "DE-SLOP", "REVIEW", "FIX", "SCORE")
unnamed = [s for s in staged_stages if not isinstance(briefs.get(s), str)]
templates = [briefs[s] for s in staged_stages if s not in unnamed]
templates += ["orchestration/archive/briefs/BRIEF-CLEAN-TEMPLATE.md",
              "orchestration/archive/briefs/BRIEF-REVIEW-FIXHEAD-TEMPLATE.md",
              "orchestration/archive/boot/ORCHESTRATOR-BOOT-TEMPLATE.md"]
texts = {p: committed(p) for p in templates + ["orchestration/archive/stages.json", "orchestration/README.md"]}
absent = [f"refused: stages.json names no {s} brief" for s in unnamed]
absent += [f"refused: {p} is not there" for p, text in texts.items() if text is None]
if absent:
    print("\n".join(absent), file=sys.stderr)
    sys.exit(1)
# Allocation, rendering and publication hold one lock, so two runs never take
# the same round. flock lets go when the process ends, however it ends.
lock = open(lanes.parent / "factory.lock", "a")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print(f"refused: another factory run holds {lock.name}, nothing written", file=sys.stderr)
    sys.exit(2)
n = 1 + max((int(m.group(1)) for m in (re.match(r"BRIEF-.*-R(\d+)-", p.name)
                                       for p in lanes.iterdir()) if m), default=0)
events = lanes / "events.log"
bound = sum(1 for _ in events.open()) + 1 if events.exists() else 1
listed = re.search(r"knows them from this list:(.*?)\.\n\n", texts["orchestration/README.md"], re.S)
meta = set(re.findall(r"`(<[^<>`]+>)`", listed.group(1) if listed else ""))
table = {
    "PROJECT": E["cfg_project"], "ROUND": f"R{n}", "N": str(n), "DATE": date,
    "T": E["f_count"], "VERBATIM": E["f_verbatim"],
    "ORCHESTRATION-ROOT": E["cfg_orchestrationRoot"], "CLONE": str(clone),
    "OWNER": E["cfg_owner"], "REPO": E["cfg_repo"], "UPSTREAM-OWNER": E["cfg_upstreamOwner"],
    "ORCHESTRATION-REPO": E["cfg_orchestrationRepo"], "REPORT-DIR": E["cfg_reportDir"],
    "GH-ACCOUNT": E["cfg_ghAccount"], "SEAT": E["cfg_seat"], "MODEL": E["cfg_model"],
    "PREFIX": E["cfg_branchPrefix"], "REVIEWER": E["cfg_reviewer"],
    "REVIEWER-ACCOUNT": E["cfg_reviewerAccount"], "PASSES-GRANTED": E["cfg_passesGranted"],
    "KEEP-OPEN": E["cfg_keepOpen"], "SEAT-TRANSCRIPT-DIR": E["cfg_seatTranscriptDir"],
    "K": E["cfg_orchestratorNumber"], "K-1": str(int(E["cfg_orchestratorNumber"]) - 1),
    "PRIOR": f"R{n - 1}", "ARCHIVE-DIR": f"{date[:7]}-r{n - 1}", "CUTOFF-DATE": date,
    "KEEP-FROM-ROUND": f"R{n}", "ROUND-BOUND-LINE": str(bound), "TAB": "\t",
    # the boot template's two written-out fillers, the owner's words and the next round
    "what this round is for, one sentence": E["f_verbatim"], "N+1": str(n + 1),
    # filled at dispatch, by the orchestrator, so they go out as metavariables
    "PR": "<n>", "BRANCH": "<branch>", "HEAD": "<head>", "REVIEW-ID": "<id>",
    "PASS": "<pass>", "PROOF-FILE": "<proof-file>", "HEAD-1": "<head-1>",
    "HEAD-2": "<head-2>", "REVIEW-ID-1": "<id-1>", "REVIEW-ID-2": "<id-2>",
}
# Each stage's ceilings, from the one source: <BUILD-WALL>, <REVIEW-REVIEWS> and so on.
ceilings = {"context": "CONTEXT", "wall": "WALL", "pushes": "PUSHES", "reviews": "REVIEWS",
            "reviewsPerPullRequest": "REVIEWS-PER-PULL-REQUEST", "pullRequests": "PULL-REQUESTS"}
refusals = []
for row in rows:
    for field, name in ceilings.items():
        value = row.get(field)
        if value is None:
            continue
        if type(value) is not int or value < 0:     # "15" * 60 is a 120-digit deadline
            refusals.append(f"refused: stages.json {row['stage']} {field} is {json.dumps(value)}, not a whole number")
            continue
        table[f"{row['stage'].upper()}-{name}"] = str(value)
        if field == "wall":
            table[f"{row['stage'].upper()}-WALL-SECONDS"] = str(value * 60)
if refusals:
    print("\n".join(refusals), file=sys.stderr)
    sys.exit(1)
per_dispatch = {briefs.get("FIX"), briefs.get("DE-SLOP"), "orchestration/archive/briefs/BRIEF-REVIEW-FIXHEAD-TEMPLATE.md"}
tickets = [l.rstrip("\n").split("\t", 1)
           for l in open(E["f_tickets"])] if os.path.exists(E["f_tickets"]) else []
def build_list(text):
    """The BUILD template's three example entries become one per real ticket."""
    entry = re.compile(r"^\d+\. `<file>.*$")
    out, done = [], False
    for line in text.splitlines():
        if entry.match(line):
            if not done:
                done = True
                for i, (num, title) in enumerate(tickets, 1):
                    out.append(f"{i}. Ticket #{num}, {title}. `<file>:<line or symbol>`. "
                               "`<reproduction command>` does `<wrong behaviour>`. "
                               "It must `<right behaviour>`, exit `<code>`.")
            continue
        out.append(line)
    return "\n".join(out) + "\n"
names = []
for src in templates:
    name = pathlib.PurePath(src).name
    # The template's own name, less "-TEMPLATE.md" or, for one an
    # orchestration/archive/stages.json row names otherwise, ".md" (Sol's
    # review of 87a9f77 found BRIEF-BUILD--R1).
    stage = re.sub(r"(-TEMPLATE)?\.md$", "", name[len("BRIEF-"):]) if name.startswith("BRIEF-") else None
    if stage is None:
        out = staged / f"ORCHESTRATOR-BOOT-{date}-r{n}.md"
    elif src in per_dispatch:
        out = staged / f"BRIEF-{stage}-R{n}-TEMPLATE-{date}.md"
    else:
        out = staged / f"BRIEF-{stage}-R{n}-{date}.md"
    text = re.sub(r"<([^<>\n]+)>",
                  lambda m: table.get(m.group(1), m.group(0)), texts[src])
    if src == briefs.get("BUILD"):
        text = build_list(text)
        if E["f_count"] == "1":
            text = text.replace("1 real tickets", "1 real ticket").replace(
                "1 draft pull requests", "1 draft pull request")
    for left in sorted({p for p in re.findall(r"<[^<>\n]+>", text) if p not in meta}):
        refusals.append(f"refused: {out.name} still carries {left}")
    names.append(out)
    out.write_text(text)
taken = [f"refused: {out.name} is already in {lanes}" for out in names if (lanes / out.name).exists()]
if refusals or taken:
    print("\n".join(refusals + taken), file=sys.stderr)
    sys.exit(1)
# Nothing reaches .local/lanes/ until here, and then all of the round or none
# of it: a child moves the files in and takes them back if a move fails, and
# this process, which holds the lock, takes every one back unless the child
# finishes, however it ends. Neither stops for an interrupt, a hang-up or a
# terminate meanwhile, and the shell waits on the child's hold of f_mover.
for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(sig, signal.SIG_IGN)
def take_back():
    for out in names:
        (lanes / out.name).unlink(missing_ok=True)
mover = open(E["f_mover"], "w")
fcntl.flock(mover, fcntl.LOCK_EX)   # shared with the child from the fork on
sys.stderr.flush()
if (child := os.fork()) == 0:
    code = 1
    try:
        for out in names:
            shutil.move(str(out), lanes / out.name)
        code = 0
    except Exception as err:
        take_back()
        print(f"refused: publishing the round failed ({err})", file=sys.stderr)
    finally:
        sys.stderr.flush()
        os._exit(code)
code = os.waitstatus_to_exitcode(os.waitpid(child, 0)[1])
if code != 0:
    take_back()
    print(f"refused: the round was not published whole, nothing left in {lanes}", file=sys.stderr)
    sys.exit(code if code > 0 else 128 - code)
print("\n".join(str(lanes / out.name) for out in names))
PY
written=$(cat "$list_file"); mkdir -p "$lanes/loop" "$lanes/handbacks"
printf '%s\n' "$written" | sed 's/^/wrote    /'
boot_file=$(printf '%s\n' "$written" | grep 'ORCHESTRATOR-BOOT-')
tail_phrase="ORCH-$cfg_orchestratorNumber-BOOT-TAIL"
message="Read and follow $boot_file in full. It is your whole boot. Orchestrator boot ends here. $tail_phrase"
if (( dry_run )); then
  printf 'dry run  would boot seat %s on %s and send: %s\n' "$cfg_seat" "$cfg_model" "$message"
  exit 0
fi

# --- boot the orchestrator pane -------------------------------------------
git -C "$cfg_clone" cat-file blob "$checked:orchestration/seats/claude-seat-up" > "$tmp/claude-seat-up"
chmod +x "$tmp/claude-seat-up"                # the checked commit's, as every file above
# Sol's reviews of 11bb360 and 87a9f77: the installed skills could change after
# the preflight verified them, or while the seat script was read after the
# second check, so that check is the last thing run before the boot.
pinned_clean >/dev/null 2>&1 || {
  printf 'refused: the installed skills changed after the preflight; run `node orchestration/skills/fetch.mjs` in %s, not booting\n' "$cfg_clone" >&2
  exit 1
}
booted=$("$tmp/claude-seat-up" "$cfg_seat" --model "$cfg_model")
pane=${booted##* }
printf 'booted   %s\n' "$booted"
herdr wait agent-status "$pane" --status idle --timeout 240000 >/dev/null
sleep 3
backspaces=(); for _ in $(seq 30); do backspaces+=(Backspace); done
herdr pane send-keys "$pane" Escape
herdr pane send-keys "$pane" "${backspaces[@]}"
herdr pane send-text "$pane" "$message"
sleep 2
if ! herdr pane read "$pane" --source visible --lines 80 \
     | grep -qE "$tail_phrase|Pasted text|paste again to expand"; then
  herdr pane read "$pane" --source visible --lines 40 >&2
  printf 'refused: the boot line did not land in %s, not re-sending\n' "$pane" >&2
  exit 1
fi
herdr pane send-keys "$pane" Enter
herdr wait agent-status "$pane" --status working --timeout 45000 >/dev/null \
  || { printf 'refused: %s took the boot line but never went working\n' "$pane" >&2; exit 1; }
printf 'ok       orchestrator working in %s on %s\n' "$pane" "$boot_file"
