# Set up a machine to run one round

**Mostly archived.** This page set up a machine for the first kit's rounds
(21 September 2026), and is kept as reference: every section except
[Sign your commits](#sign-your-commits) belongs to that kit. Signing is
current for any machine that pushes to a LaunchAstro repository. Seats boot
today with the `claude-subscription-switch` skill's `claude-seat-up`, and a
build starts from [METHOD.md](METHOD.md).

Eleven things have to be installed and signed in before a round starts. Each line
gives the command that proves the tool is there; every one must exit 0.

| What | Why | Prove it |
| --- | --- | --- |
| herdr | the panes a lane runs in | `herdr workspace list` |
| Claude Code | every lane except the reviewer | `claude --version` |
| A seat launcher | one per subscription, `<SEAT>` is your own name for it | `test -x ~/bin/claude-<SEAT>` |
| A seat token | read by the launcher, never printed | `test -s "$CLAUDE_SEAT_TOKEN_DIR/<SEAT>.token"` |
| `claude-seat-up` | boots a seat as a new herdr window | `test -x ~/bin/claude-seat-up` |
| The Codex CLI, signed in | the reviewer of record | `codex login status` |
| `gh`, signed in | every pull request, review and label | `gh auth status` |
| corepack and pnpm | `corepack pnpm check`, the green line | `corepack pnpm --version` |
| gitleaks | the secret gate, over the full history | `gitleaks version` |
| Python 3.11 or later | `scripts/gate/sweep.py`, run by `corepack pnpm check` and the pre-commit hook | `python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))'` |
| perl | the timeout shim, since macOS has no GNU `timeout` | `perl -e 'exit 0'` |

Copy `orchestration/seats/claude-seat-up` to `~/bin/`, and take the launcher
template from `orchestration/skills/claude-subscription-switch/`, which the
fetch below brings down. Both the launcher and the token file live under
`$HOME`, outside every clone, and nothing in either goes into a repository.

The reviewer needs one more file, its own GitHub token:
`orchestration/reviewer/README.md` says how to make it and where to name it.

## Fetch the skills

*Archived: the first kit's pinned skills.*

The pinned copies are not in this repository (a snapshot of the Code Factory
skills is in [skills/](../skills/README.md)). `orchestration/skills/`
holds `SOURCES.json`, which pins each skill to a repository, a path and a
commit, and `fetch.mjs`, which brings the bodies down into
`orchestration/skills/<name>/`. Those directories are git-ignored. After
cloning, run:

    node orchestration/skills/fetch.mjs

It fetches every pinned skill, verifies each `SKILL.md` against the sha256 in the pin, and
exits non-zero on a mismatch. `node orchestration/skills/fetch.mjs --check`
compares each installed skill with what its pin fetches and writes nothing; it
is what proves the tree is clean, and it fails on a skill that is absent or
altered.

Two sets of skills are prerequisites, installed by you and only checked by the
fetch, never fetched by it:

| What | Install | Prove it |
| --- | --- | --- |
| Matt Pocock's engineering skills: `wayfinder`, `code-review`, `to-spec`, `to-tickets`, `triage`, `setup-matt-pocock-skills` | `claude plugin marketplace add mattpocock/skills` then `claude plugin install mattpocock-skills@mattpocock` | `node orchestration/skills/fetch.mjs --check` prints `present  Matt Pocock's engineering skills` |
| The pstack plugin: `unslop`, `deslop`, `thermo-nuclear-code-quality-review` | `claude plugin marketplace add ericlitman/open-pstack` then `claude plugin install pstack@open-pstack` | `node orchestration/skills/fetch.mjs --check` prints `present  pstack plugin` |

A missing prerequisite is reported with its install command and does not fail
the run, so read the last two lines of the output, not just the exit code.

## Sign your commits

*Current.*

The ruleset requires signed commits, so a fresh machine sets signing up before
its first push. SSH signing needs no new key:

    git config --global gpg.format ssh
    git config --global user.signingkey ~/.ssh/id_ed25519.pub
    git config --global commit.gpgsign true

Those three lines make signatures. Verifying them needs a fourth: git checks an
SSH signature against a list of keys it is told to trust, and without that list
`git verify-commit` fails with `gpg.ssh.allowedSignersFile needs to be
configured and exist`. Write the list, one line per signer, as the email and the
public key:

    printf '%s %s\n' "$(git config --global user.email)" \
      "$(cat ~/.ssh/id_ed25519.pub)" >> ~/.ssh/allowed_signers
    git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers

Prove it with `git verify-commit HEAD` or `git log --show-signature -1` on a
commit made after those four lines; both exit 0 and name the key. Add the same
public key to your GitHub account as a **signing** key, separate from the
authentication key, and GitHub shows the commit as Verified.

## Read in this order

*Archived: the first kit's reading order. Today's starts at
[METHOD.md](METHOD.md).*

1. `README.md`: what the loop is, the 7 conditions of the pass line, and the
   stages of a round with their ceilings.
2. `orchestration/README.md`: the kit, and every placeholder a round fills in.
3. `template/README.md`: the repository to copy, and the placeholders the
   copied project fills in.

Then copy `template/` into a new repository, run
`corepack pnpm install && corepack pnpm check`, and set the branch ruleset from
`template/docs/plan/ruleset.md`. Green is the starting line.

## Start a round with one command

*Archived: `orchestration/archive/factory.sh`, the first kit's round starter.*

Copy `orchestration/archive/factory.example.json` to `orchestration/archive/factory.json`, which
is git-ignored, and fill in every key it shows: the owner and repository, the
clone and the orchestration root beside it, the seat and model, the `gh` account
that stays active, and the reviewer's. `--config <file>` uses another copy, and
`orchestratorNumber` counts orchestrators, not rounds. From the orchestration
root:

    ../code-factory/orchestration/archive/factory.sh --verbatim "<the owner's words>" 26 27 28

`--verbatim` is required and must carry words, or the run refuses at exit 2 with
the usage line. It prints `ok` or `MISSING` for each preflight item: the seat
and the model each one plain token (letters, digits, dot, underscore, hyphen),
run from the orchestration root, herdr answering, the configured `gh` account signed in and
active (signed in but inactive is a `MISSING` whose fix, `gh auth switch -u`, no
lane runs for you), the seat launcher executable, the seat token readable (it is
never read), the clone clean on `main` at the head of `origin/main` that the
fetch just found (an origin it cannot fetch is a `MISSING`), the pinned skills clean
(checked by that commit's `fetch.mjs` against its `SOURCES.json`, so neither can
change after the clone check), and every ticket an open issue. One `MISSING` names its fix and ends the run at
exit 2, nothing written.

The briefs and the boot file are rendered from the templates in that checked
commit, not the working tree, written to a directory beside `.local/lanes/` and
moved in only once every one is clean, so a refusal leaves that directory as it
found it and the round label `R<N>`, one past the highest there, cannot drift.
A child process moves the files in and takes them back if a move fails, and
the run takes back every one of them unless the child finishes, whether a move
fails part-way or the child crashes, at the child's exit status; an interrupt,
hang-up or terminate waits until the round is in. If the run itself is killed
mid-move, its exit waits for the child, which finishes the round or takes it
back, and it boots nothing. Only a SIGKILL that reaches the child as well, while
it moves, can leave part of a round. Any placeholder left unfilled is that refusal, at exit 1, naming
file and placeholder; the metavariables `orchestration/README.md` lists are the
exception. A missing template, a missing `orchestration/archive/stages.json`, a ceiling
there that is not a whole number, and a round file already in `.local/lanes/`
are refused the same way. The stage ceilings in the briefs are filled from
`orchestration/archive/stages.json`. The seat script that boots the orchestrator is that commit's too. Choosing
`R<N>` and moving the files in happen under a lock on `.local/factory.lock`, so a
second run started meanwhile refuses at exit 2, nothing written.
`--dry-run` stops after the files, before the pane gets its boot line.
