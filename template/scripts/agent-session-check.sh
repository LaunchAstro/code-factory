#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# The first thing a fresh session runs.
#
# Finding 6 of the sweep of 6 September: nobody had shown that a fresh Claude
# Code or Codex session loads the intended router, resolves its skill
# references and applies the auto-memory policy. The scope boundary that keeps
# another project's instructions out of this one rested on asking the agent
# who it thought it was, which is not evidence.
#
# This prints what the session is actually working with, and fails if
# anything that must be present is missing. Run it before doing anything else.
#
#   bash scripts/agent-session-check.sh
#
# Exit 0 when the environment is what this repository expects, 1 when it is
# not. It reads; it changes nothing.

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2
ROOT="$(pwd)"

PROBLEMS=0
note()  { printf '  %-22s %s\n' "$1" "$2"; }
bad()   { printf '  PROBLEM  %s\n' "$1"; PROBLEMS=$((PROBLEMS + 1)); }
warn()  { printf '  note     %s\n' "$1"; }

need_file() {
  if [ -f "$ROOT/$1" ]; then note "$2" "$1"; else bad "$1  ($2)"; fi
}

# Git runs with only what localGitEnv in scripts/main-module.mjs keeps, so a
# command the repository has Git run, such as core.fsmonitor, gets no token.
# Node reads that one rule; when it cannot, Git does not run at all.
GIT_ENV=()
while IFS= read -r -d '' pair; do GIT_ENV+=("$pair"); done < <(
  node --input-type=module -e 'const { localGitEnv } = await import(process.argv[1]);
for (const [name, value] of Object.entries(localGitEnv())) process.stdout.write(`${name}=${value}\0`);' \
    "$ROOT/scripts/main-module.mjs" 2>/dev/null
)
[ "${#GIT_ENV[@]}" -gt 0 ] || bad "scripts/main-module.mjs did not give the Git environment rule, so Git was not run"
git_env() { [ "${#GIT_ENV[@]}" -gt 0 ] && env -i "${GIT_ENV[@]}" "$@"; }
local_git() { git_env git -C "$ROOT" "$@"; }

# The value of autoMemoryEnabled in .claude/settings.json, read with a JSON
# parser: "false", or why it is not. A repeated member is refused rather than
# resolved last-wins, and only the top level counts. Python also reads NaN and
# Infinity, which are not JSON, so those are refused too. Nothing else in the
# file is printed, because it can hold credentials in its env block.
claude_memory() {
  python3 - "$ROOT/.claude/settings.json" <<'PY' 2>/dev/null || echo "unreadable"
import json, sys
def unique(pairs):
    if len({key for key, _ in pairs}) != len(pairs):
        raise ValueError("repeated member")
    return dict(pairs)
def constant(name):
    raise ValueError(name + " is not JSON")
try:
    with open(sys.argv[1], encoding="utf-8") as settings:
        policy = json.load(settings, object_pairs_hook=unique, parse_constant=constant)
except OSError:
    print("not set, the file is missing")
    sys.exit(0)
except ValueError:
    print("not valid JSON, or a member is repeated")
    sys.exit(0)
value = policy.get("autoMemoryEnabled") if isinstance(policy, dict) else None
print("false" if value is False else "not false")
PY
}

# The owner's own global instructions are the CLAUDE.md of each of the
# owner's seats and Codex's global AGENTS.md by design, and they name the
# owner's pre-prompt (#308). The file is recognised by its SHA-256, listed in
# the owner's home folder, so this repository holds neither its text nor its
# path. Exit 0 when the file's hash starts a line of the list; a changed copy,
# or anyone else's file, is read as any other global file is.
OWNER_LIST="$HOME/.config/code-factory/owner-instructions.sha256"
owner_instructions() {
  python3 - "$1" "$OWNER_LIST" <<'PY' 2>/dev/null
import hashlib, re, sys
try:
    digest = hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest()
    listed = {m.group(1).lower() for line in open(sys.argv[2], encoding="utf-8")
              if (m := re.match(r"([0-9A-Fa-f]{64})(?:\s|$)", line))}
except (OSError, ValueError):
    sys.exit(1)
sys.exit(0 if digest in listed else 1)
PY
}

# --expect prints the facts a fresh session must be able to state back, so a
# person can compare what the session says it loaded against what is here.
# An agent is the least reliable witness to its own context: a Codex session
# on 7 September listed another project's pre-prompt among its loaded files
# and, in the next line, said it was not carrying another project's
# instructions. Both statements were sincere. Only one was checkable.
if [ "${1:-}" = "--expect" ]; then
  echo "Ask a fresh session these, and compare its answers with the right column."
  echo
  printf '  %-46s %s\n' "Which instruction files did you load?" "AGENTS.md at the repository root"
  printf '  %-46s %s\n' "Which router does this repository declare?" \
    "$(grep -m1 'follows Code Factory' AGENTS.md 2>/dev/null || echo '(AGENTS.md missing)')"
  printf '  %-46s %s\n' "How many project skills can you invoke?" \
    "$(find .claude/skills -maxdepth 2 -name SKILL.md 2>/dev/null | xargs grep -L 'user-invocable: false' 2>/dev/null | wc -l | tr -d ' ') of $(find .claude/skills -maxdepth 1 -mindepth 1 -type d ! -name '_*' 2>/dev/null | wc -l | tr -d ' ') (the rest are principle leaves)"
  printf '  %-46s %s\n' "What memory policy do Claude settings set?" \
    "autoMemoryEnabled $(claude_memory) in .claude/settings.json; nothing else in it is printed"
  printf '  %-46s %s\n' "How many merge questions are there?" \
    "$(grep -o 'on seven questions' AGENTS.md >/dev/null 2>&1 && echo seven || echo '(not seven; check AGENTS.md)')"
  printf '  %-46s %s\n' "What may you never do without asking?" \
    "Spend, send outward, delete, or touch production"
  printf '  %-46s %s\n' "What may you do without asking?" \
    "Reversible work inside this repository, then present it"
  printf '  %-46s %s\n' "Which permission mode are you running in?" \
    "Whatever it is, you must be able to say. A session that cannot is not ready"
  printf '  %-46s %s\n' "Are you carrying another project's rules?" "No. If yes, stop and say so"
  printf '  %-46s %s\n' "Does anything tell you to push?" "No. Nothing here pushes without a human"
  echo
  echo "A session that cannot state these did not load them, whatever it says."
  exit 0
fi

echo "Session check"
echo

# --- where am I ------------------------------------------------------------
echo "Repository"
if ! local_git rev-parse --git-dir >/dev/null 2>&1; then
  bad "this is not a git repository"
else
  note "path" "$ROOT"
  note "branch" "$(local_git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  note "head" "$(local_git rev-parse --short HEAD 2>/dev/null)"
  remotes="$(local_git remote 2>/dev/null | tr '\n' ' ')"
  note "remotes" "${remotes:-none yet}"
  note "signing" "$(local_git config commit.gpgsign 2>/dev/null || echo 'not set')"
fi
echo

# --- what am I meant to have read -----------------------------------------
echo "Instructions"
need_file "AGENTS.md" "the law"
need_file "CONTEXT.md" "the vocabulary"
need_file "docs/agents/model-roles.md" "roles, fresh context, handoff"
need_file "docs/agents/review-checkpoint.md" "when a review is valid"
need_file "docs/agents/session-check.md" "this procedure"
need_file "docs/agents/issue-tracker.md" "the tracker"
if [ -f "$ROOT/AGENTS.md" ]; then
  words=$(wc -w < "$ROOT/AGENTS.md" | tr -d ' ')
  if [ "$words" -le 300 ]; then
    note "AGENTS.md length" "$words words, under the 300 cap"
  else
    bad "AGENTS.md is $words words, over the 300 cap"
  fi
fi
echo

# --- what each runtime will actually load ----------------------------------
#
# File existence is not the question. The question is what reaches the model
# before it reads anything, and that is decided outside this repository, by
# each runtime's own configuration. Round four was right that checking for
# files proves nothing about the loaded context, so this section reports the
# configuration that decides it, and --expect prints the ground truth a fresh
# session must be able to state back.
echo "What each runtime loads"
claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
note "claude config dir" "$claude_dir"
if [ -f "$ROOT/CLAUDE.md" ]; then
  note "claude entry" "CLAUDE.md, then AGENTS.md through it"
else
  note "claude entry" "AGENTS.md, read natively; no CLAUDE.md needed"
fi
if [ -f "$claude_dir/settings.json" ] && grep -q '"SessionStart"' "$claude_dir/settings.json" 2>/dev/null; then
  warn "this Claude seat has a SessionStart hook; check it does not match this directory"
else
  note "claude session hook" "none in this seat"
fi
if [ -f "$claude_dir/CLAUDE.md" ] && owner_instructions "$claude_dir/CLAUDE.md"; then
  note "claude user law" "the owner's global instructions, by a hash listed in $OWNER_LIST"
elif [ -f "$claude_dir/CLAUDE.md" ]; then
  bad "$claude_dir/CLAUDE.md applies to every session in this seat. Read it before"
  printf '           trusting anything this session says about its own instructions.\n'
else
  note "claude user law" "none, so AGENTS.md is the whole law here"
fi
codex_home="${CODEX_HOME:-$HOME/.codex}"
note "codex entry" "AGENTS.md, plus $codex_home/AGENTS.override.md, or else AGENTS.md there"
echo

# --- the router ------------------------------------------------------------
echo "Router"
if grep -q "No other routing block applies" "$ROOT/AGENTS.md" 2>/dev/null; then
  note "router" "$(grep -m1 'follows Code Factory' "$ROOT/AGENTS.md")"
  note "exclusivity" "AGENTS.md says no other routing block applies"
else
  bad "AGENTS.md does not declare an exclusive router"
fi
echo

# --- another project's instructions ---------------------------------------
echo "Scope"
# A path check, not a word search. The decision records cite the other
# project's session notes as sources, and a citation is not an instruction:
# Current decisions distinguish references from loaded instructions. No
# pre-prompt or an overlay file, which would be instructions.
foreign="$(local_git ls-files | grep -Ei '(pre-?prompt|overlay -|\.lanes\.md|HANDOFF\.md)' || true)"
if [ -n "$foreign" ]; then
  bad "instruction files from another project are in this tree:"
  printf '           %s\n' $foreign
else
  note "foreign instructions" "no pre-prompt, overlay, lanes or handoff file"
fi
# The runtime's own configuration, which sits outside this repository and can
# hand a session another project's instructions before it ever reads AGENTS.md.
# This is not hypothetical: a fresh Codex session in a clean clone of this
# repository, in a temporary directory, reported that it was carrying another
# project's pre-prompt. A committed setting cannot govern a runtime whose
# configuration lives in the home directory, so the check reads it.
# Four rounds of Sol's reviews of CF-10 found prose the sentence reader got
# wrong, so it reads none (ORCH74 79R4). A global file may name another
# project's context (a pre-prompt, operating context or system prompt) on one
# line only, "Pre-prompt scope: <path>, <path> | load <file>" (the load is
# optional, ORCH74 79LOAD), in the grammar docs/agents/session-check.md gives.
# Any other naming, a second scope line, one that holds a glob or breaks the
# grammar, or one whose folder reaches this repository is refused by line
# number, never by its text. A file that never names the context is fine.
# Codex reads AGENTS.override.md in its home (CODEX_HOME, or ~/.codex), or else
# AGENTS.md there: both are checked (security review, 75146a0).
if [ -n "${HUB_CODEX_GLOBAL:-}" ]; then
  codex_laws=("$HUB_CODEX_GLOBAL")
else
  codex_laws=("$codex_home/AGENTS.override.md" "$codex_home/AGENTS.md")
fi
for codex_agents in "${codex_laws[@]}"; do
if [ ! -f "$codex_agents" ]; then
  note "codex global law" "no file at $codex_agents"
elif owner_instructions "$codex_agents"; then
  note "codex global law" "$codex_agents is the owner's global instructions, by a hash listed in $OWNER_LIST"
else
  verdicts="$(python3 - "$codex_agents" "$HOME" "$ROOT" "$(pwd -P)" <<'PY' 2>/dev/null
import os, re, sys, unicodedata
path, home, roots = sys.argv[1], sys.argv[2].rstrip("/"), sys.argv[3:5]
try:
    raw = open(path, "rb").read()
    if b"\0" in raw:
        raise ValueError("NUL")
    text = raw.decode("utf-8-sig")
except (OSError, ValueError):
    print("bad could not be read as UTF-8 text")
    sys.exit(0)
# The words as a reader sees them: any case, any dash, no invisible format
# characters, full-width letters folded, and spacing that may break a line.
seen = "".join("-" if unicodedata.category(c) == "Pd" else "" if unicodedata.category(c) == "Cf" else c
               for c in unicodedata.normalize("NFKC", text))
NAMING = re.compile(r"pre[\s_-]*prompt|operating[\s_-]+context|system[\s_-]+prompt", re.I)
NAME = r"[\w@+=%&()~-]"
# A path, bare or quoted when it holds spaces. A folder may end in a slash or
# be a bare root; the load target, a file, ends in a name.
def path(tail):
    bare, quoted = (rf"\.?{NAME}(?:[\w@+=%&()~.{m}-]*{NAME})?" for m in ("", " "))
    return "|".join(rf"{q}(?:~/|/)(?:{s}/)*(?:{s}){tail}{q}" for s, q in ((bare, ""), (quoted, "\x22")))
FOLDER, FILE = "(?:" + path("?") + ")", "(?:" + path("") + ")"
SCOPE = "Pre-prompt scope:"
GRAMMAR = re.compile(rf"{SCOPE} +({FOLDER}(?:, *{FOLDER})*)( +\| +load +{FILE})? *\r?")
lines = text.split("\n")
scopes = [n for n, line in enumerate(lines, 1) if line.startswith(SCOPE)]
bad = []
for match in NAMING.finditer(seen):
    first, last = (seen.count("\n", 0, at) + 1 for at in match.span())
    if first != last or first not in scopes:
        bad.append(f"line {first} names a pre-prompt outside a scope line")
bad += [f"line {n} is a second scope line; line {scopes[0]} is the first" for n in scopes[1:]]
folders, loads = [], False
# No glob, which the grammar also breaks on: Sol found a star skipped
# resolving links (CF-10-FIX4 finding 1).
if scopes and re.search(r"[*?\[\]{}]", lines[scopes[0] - 1]):
    bad.append(f"line {scopes[0]} holds a glob; name each folder in full")
if scopes:
    line = GRAMMAR.fullmatch(lines[scopes[0] - 1])
    if line:
        folders = [f.strip().strip("\x22") for f in line.group(1).split(",")]
        loads = line.group(2) is not None
    else:
        bad.append(f"line {scopes[0]} breaks the scope line grammar")
# A folder reaches this repository when it is the repository, holds it, or
# sits inside it, by its own path or the one its links resolve to, by any case,
# and with the macOS firmlink spelling of the data volume read as the path it is.
FIRMLINK = "/system/volumes/data/"
def same(name):
    name = unicodedata.normalize("NFC", name).casefold().rstrip("/") + "/"
    return name[len(FIRMLINK) - 1:] if name.startswith(FIRMLINK) else name
def reaches(scope, root):
    scope, root = same(scope), same(root)
    return root.startswith(scope) or scope.startswith(root)
# macOS spellings of any folder that no link resolves (security review, 264a68b).
ALIASES = ("/.vol/", "/.nofollow/", "/.resolve/")
for name in folders:
    full = home + name[1:] if name.startswith("~/") else name
    if same(full).startswith(ALIASES):
        bad.append(f"line {scopes[0]} names a folder through /.vol, /.nofollow or /.resolve; name it by its own path")
        break
    candidates = {full, os.path.realpath(full)}
    if any(reaches(c, r) for c in candidates for r in set(roots)):
        bad.append(f"line {scopes[0]} scopes the pre-prompt to a folder that reaches this repository")
        break
for message in dict.fromkeys(bad):
    print("bad " + message)
if not bad:
    target = "; it loads one file" if loads else ""
    print(f"ok line {scopes[0]} scopes the pre-prompt to {len(folders)} folder(s), none reaching this one{target}"
          if scopes else "ok never names a pre-prompt, operating context or system prompt")
PY
)"
  while IFS= read -r verdict; do
    case "$verdict" in
      "ok "*) note "codex global law" "${verdict#ok }" ;;
      "bad "*) bad "codex global law: $codex_agents ${verdict#bad }" ;;
      *) bad "codex global law: $codex_agents could not be read" ;;
    esac
  done <<EOF
$verdicts
EOF
fi
done

echo
echo "  If your session was given a pre-prompt naming another project, another"
echo "  task store, lanes, seats or merge trains, stop and say so. It does not"
echo "  apply here. See docs/current-decisions.md."
echo

# --- memory ----------------------------------------------------------------
echo "Memory"
memory="$(claude_memory)"
if [ "$memory" = "false" ]; then
  note "auto memory" "off for Claude Code, by the committed setting"
else
  bad ".claude/settings.json does not disable auto memory: autoMemoryEnabled $memory"
fi

# Trusted project configuration can override user defaults. A file check
# proves the repository policy, not what this already-running session loaded.
codex_project="${HUB_CODEX_PROJECT:-$ROOT/.codex/config.toml}"
if python3 "$ROOT/scripts/codex-policy-check.py" "$codex_project"; then
  note "codex project policy" "memory generation and injection disabled in project configuration"
else
  bad "codex project policy: required memory-off values are missing or invalid"
fi
warn "codex effective state: UNVERIFIED. Confirm the new session's effective configuration."
echo "  Project configuration loads only for trusted projects; CLI overrides take precedence."
echo "  This read-only check does not change trust or prove the state of a running session."
echo "  What an agent needs to know lives in AGENTS.md, CONTEXT.md and"
echo "  docs/, where a person can read it and a pull request can change it."
echo

# --- skills ----------------------------------------------------------------
echo "Skills"
if [ -d "$ROOT/.claude/skills" ]; then
  count=$(find "$ROOT/.claude/skills" -maxdepth 1 -mindepth 1 -type d ! -name '_*' | wc -l | tr -d ' ')
  note "vendored" "$count skills in .claude/skills"
else
  bad ".claude/skills"
fi
# A link, and one that resolves to .claude/skills: a dangling link or one to
# another folder leaves Codex without the shared skills.
if [ -L "$ROOT/.codex/skills" ] && [ -d "$ROOT/.claude/skills" ] &&
  [ "$(cd "$ROOT/.codex/skills" 2>/dev/null && pwd -P)" = "$(cd "$ROOT/.claude/skills" && pwd -P)" ]; then
  note "codex" ".codex/skills -> $(readlink "$ROOT/.codex/skills")"
else
  bad ".codex/skills must be a symlink that resolves to .claude/skills, so Codex reads the same files"
fi
need_file ".claude/skills/_shared/security-review.md" "security review on any runtime"
echo

# --- tools -----------------------------------------------------------------
echo "Tools"
for tool in git node python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    bad "$tool is not on PATH"
  elif ! if [ "$tool" = git ]; then git_env git --version; else "$tool" --version; fi >/dev/null 2>&1; then
    bad "$tool is on PATH at $(command -v "$tool") but does not run"
  else
    note "$tool" "$(command -v "$tool")"
  fi
done
if command -v gitleaks >/dev/null 2>&1; then
  note "gitleaks" "$(command -v gitleaks)"
else
  warn "gitleaks is not on PATH; the pre-commit hook will fail until it is"
fi
if [ -f "$ROOT/.nvmrc" ]; then
  note "node wanted" "$(cat "$ROOT/.nvmrc")"
  note "node here" "$(node --version 2>/dev/null || echo none)"
fi
echo

# --- verdict ---------------------------------------------------------------
if [ "$PROBLEMS" -eq 0 ]; then
  echo "Session check: repository policy checks passed; effective session state remains UNVERIFIED."
  exit 0
fi
echo "Session check: $PROBLEMS problem(s). This session is not ready."
echo "Do not start work. docs/agents/session-check.md says what each one means."
exit 1
