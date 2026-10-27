# The reviewer of record: identity and mechanics

The reviewer's review is the one a required context reads. Two things hold at
once: it posts as `<REVIEWER-ACCOUNT>`, and the active `gh` account stays
`<GH-ACCOUNT>`. No lane runs `gh auth switch`.

## The token file

`codex-shim.sh` reads the reviewer account's GitHub token from one file,
`<REVIEWER-TOKEN-FILE>`, inside the codex process's own process group: a small
`sh` there reads the file, exports `GH_TOKEN` and execs codex, so the calling
shell, the deadline's watchdog and a `set -x` trace never hold the value. One
function does that, `run_reviewer`. A lane runs a session through
`run_sol_review`, which selects the effort and calls `run_reviewer`, and no
other way:

    source .local/lanes/loop/codex-shim.sh
    run_sol_review 900 <low|medium|high> /absolute/path/to/prompt-file

`run_with_deadline`, the other function in the file, applies the deadline and
exports nothing: a session run under it posts as the active `gh` account, the
builder's, and the review of record is void. Nothing else in the round sees the
token. To make the file:

1. Sign in as the reviewer account and mint a token scoped to pull requests
   read and write on the one repository, and to nothing else.
2. Write it to a path under `$HOME` outside every clone, then
   `chmod 600` that file.
3. Put that path in `codex-shim.sh` in place of `<REVIEWER-TOKEN-FILE>`.

Select the risk before launch under [the shared fleet/single effort rule](../../docs/SOL-EFFORT.md).
`run_sol_review` pins GPT-6.1-Sol at `medium` for low/medium reviews and `high`
for high-risk reviews; missing/unknown risk is refused. Its generic
`run_reviewer` dependency still owns the token and deadline boundary.

A token value never goes into a repository, a brief, a prompt, a trail or a
log. The file is the only copy.

## Prove it before the first session

Add the reviewer account to the repository as a collaborator, then run the
probe:

    GH_TOKEN="$(cat <REVIEWER-TOKEN-FILE>)" gh api \
      repos/<OWNER>/<REPO>/collaborators/<REVIEWER-ACCOUNT> -i | head -1

204 means the account is a collaborator and its reviews will carry
`author_association: COLLABORATOR`. Round 7 ran that probe before all six
sessions and got 204 every time
([`../archive/reviewer/handbacks/REVIEW-R7.md`](../archive/reviewer/handbacks/REVIEW-R7.md)).
404 means the invitation is unaccepted: stop.

## What else is here

`codex-shim.sh` also carries `run_with_deadline`, the timeout shim for a host
with no GNU `timeout`, which `run_reviewer` calls; a lane calls
`run_sol_review`.
The deadline is a number of seconds and nothing else. When the command
returns, anything it left in its process group gets TERM, three seconds'
grace, then KILL. The command starts only once the watchdog and its timer are
running, the timer still running 0.08 seconds after it started, and a
watchdog that fails to run, or ends any way but cancelled or fired, fails the
run. Cancelled means the shim's own TERM, marked by a file it leaves first,
stopping a timer that was still running: a TERM from anywhere else, or a
timer that failed, fails the run, and a timer that ran out is a deadline that
fired, however late the watchdog saw it. The watchdog is Perl, so no `/bin/sh`
(dash, Bash) decides it. `../tests/codex-shim-cases.sh` holds the cases. The
first kit's three `*-prompt-*example.txt` files, in `../archive/reviewer/`, are
prompts as they were sent.

## Codex slots: one cap for the whole login

`codex-shim.sh` provides a configurable concurrency limiter. `codex_slot <command...>` takes one of `CODEX_SLOTS` slots (default 5) before running a command and releases it when the command ends.
`run_sol_review` takes its slot before its deadline starts, and the shim's
`codex` function sends every non-interactive session (`codex exec`, its alias
`codex e`, and `codex review`, options before them included) through
`codex_slot`, so each one in a shell that sourced the shim waits its turn. A command run
under a held slot takes no second one. The slots flow between rounds; a
round's own cap (refine's `sol-slot.sh`) still applies on top until HQ lifts
it.

- **One lock host.** The slots live on the M5, reached as `ssh m5`. The lock
  code goes on ssh's stdin, so the M5 needs only Perl and a marker file. On
  the M5 itself, the shim sees the marker and takes slots there directly.
- **Waits, never fails.** A caller with no slot prints one line,
  `codex-slot: waiting for a Codex slot (5/5 held on m5)`, and tries again
  every 15 seconds.
- **Dead holders' slots come back.** Each command has one holder process,
  which heartbeats every 60 seconds. The lock host reclaims a slot whose
  holder's PID is gone (a holder on the lock host), or whose lease is 600
  seconds past its last heartbeat (a holder on the other machine). A caller's
  own slot is never reclaimed from under its retry: an acquire whose grant
  landed but whose answer was lost finds that slot next time. The slot
  is held until the command, its shell and any child the command leaves
  running have all ended, however they end (`kill -9` included), so killing
  only the shell never hands on a slot whose command still runs. Killing the
  holder process itself gives the slot back.
- **Fallback.** When the M5 can't be reached, or has no marker, this machine's
  own fallback pool grants 1 slot, and says so in one line naming this
  machine: `codex-slot: lock host m5 unreachable; fallback lock host
  <this machine> granted slot 1/1`. Waiters take the M5's slots again once it
  answers.
- **Log.** Each grant, release and reclaim is a line in the pool's `log`:
  `~/.codex-slots/log` on the M5, `~/.codex-slots/fallback/log` for a
  fallback pool.

Why the fallback can't run the login past 6 while the machines are cut off: the fallback pool is apart from
the M5's, and neither machine can see the other while they're cut off, so
they can't share one count then. The fallback grants at most 1, so the worst
case while they're cut off is the M5's 5 plus 1. Two things can add to that. A holder whose lease runs out
while its run goes on (cut off for more than 10 minutes, or a laptop asleep)
has its slot handed on; its next heartbeat takes one back if one is free, or
prints one line saying all are taken. A caller that sets its own
`CODEX_SLOTS` above 5 starts while more than 5 run. And with the M5's
`LOCK-HOST` marker gone, the M5's own callers fall back too, so each machine
grants 1 beside any slots still held: 7 with five held, which is why the
marker comes off only once the M5's slots are drained (below). `CODEX_SLOT_FALLBACK=0` removes the
fallback: callers wait for the M5 instead.

| Setting | Default | |
| --- | --- | --- |
| `CODEX_SLOTS` | `5` | slots on the login; `off` turns the limiter off and runs each command as before |
| `CODEX_SLOT_HOST` | `m5` | the lock host's ssh name |
| `CODEX_SLOT_DIR` | `.codex-slots` | the pool's folder, under `$HOME` unless absolute |
| `CODEX_SLOT_FALLBACK` | `1` | this machine's fallback slots; `0` for none |
| `CODEX_SLOT_POLL`, `CODEX_SLOT_BEAT`, `CODEX_SLOT_TTL` | `15`, `60`, `600` | seconds between tries, between heartbeats, and a lease's life |
| `CODEX_SLOT_LABEL` | `codex` | a name for the holder in the log, such as the round and PR |

Set up the lock host once, on the M5: make `~/.codex-slots/LOCK-HOST` (an
empty file). Nothing else is installed there. To take the M5 out of service,
remove the marker only once `~/.codex-slots/slots/` on the M5 is empty; every
caller then falls back to its machine's 1 slot. Removed with slots still held,
those holders run on and each machine's fallback grants beside them. To stop
limiting instead, set `CODEX_SLOTS=off`.

A fleet switches on by pulling the kit (`git -C ~/.cache/code-factory pull
--ff-only`, on the laptop and on the M5). A script that sources the shim and
runs `run_sol_review`, or `codex exec` itself, then takes a slot with no
change. A script that starts Codex some other way, such as `perl -e 'alarm
7200; exec @ARGV' codex exec ...` or `run_with_deadline ... /bin/sh -c 'exec
codex exec ...'`, puts `codex_slot` in front of that command.
`sol-pr-cf.sh` takes its slot from the kit's shim, whatever the round's copy
holds, before its 1800-second deadline starts, and stops before making its
review copy when the kit has no `codex_slot` (#380). Cases:
`bash orchestration/tests/codex-slot-cases.sh`, with a fake M5, a fake ssh and
a fake Codex, and `sol-repo-cases.sh` for `sol-pr-cf.sh`.

A run at `Reconnecting n/5` with n below 5 is waiting out the login's 429
window, not hung. Don't stop it: stopping throws the review away and sends it
again into the same 429. Retry only a run that ends with no verdict, after
5/5 or at its own alarm, and don't count that retry toward fails-twice.

## Render a Sol prompt

`make_sol_prompt.py` adapts the owner's working single-agent renderer. Every
prompt starts with the no-skill reviewer instruction from #184. Every diff,
including a small one, lives in its own private patch directory outside the
worktree by default. The prompt contains its absolute path, never the patch.
Keep that directory until the review finishes, then remove it.

```sh
python3 orchestration/reviewer/make_sol_prompt.py \
  <pr> <branch> <full-base-sha> <full-head-sha> <detached-worktree> <criteria-file> \
  --repo <owner/repo> --checks <check-instructions-file> > /tmp/sol-prompt.txt
```

For a fix pass, append the three positional values after `<criteria-file>`:
the earlier comment URL, its findings file and the full previously reviewed
head. The patch then contains only previous-head..head. The renderer verifies
the worktree's HEAD before and after reading the diff. PR-supplied
`.gitattributes` are ignored so a change cannot mark its own text as binary
and hide the readable source diff (requires Git with `--attr-source`; unsupported Git fails before any patch is written). Repository and check
instructions are explicit, so the same renderer serves every project.

Policies come from `build-review/ALWAYS-BLOCKS.md` and `REVIEWER.md` under
`~/.claude/skills` at render time, as in the supplied helper. Override that root
with `--policy-root <dir>` and the patch parent with `--artifacts <dir>` when
needed. Save the rendered prompt outside the repository. Run it using the
project's assigned reviewer shim, or the headless command in `docs/SINGLE.md`'s
single-agent review method. No reviewer is launched by rendering.

Cases: `python3 orchestration/tests/sol-prompt-cases.py`. They use disposable
repositories and policy fixtures, with no remote calls or real agent launches.

Policy files are included in full, without assuming their second line is blank.

Binary changes remain in the patch and are listed as JSON paths in the prompt.
Sol must inspect their contents at both range commits, where present, or hold
with Coverage. A NUL byte in executable source must not bypass review.

## Finding ids, disputes and the close gate

`sol_rules.py` carries the close gate from 37signals' ralph-lisa-loop (MIT;
the rules are adapted, no text is copied) into a Sol review. Every finding has
a stable id, `S<pr>-<n>`, kept in a per-PR ledger across rounds. A builder may
dispute an open finding with evidence. The verdict comment states its open
findings and open disputes with counts, and the gate refuses a comment whose
counts or ids disagree with its own blocks. Sol rules each dispute; there is no
human mediator. Models, effort and the round limit
([Review rounds](../../docs/METHOD.md#review-rounds)) are unchanged.

Before rendering, append the rules to the checks file the renderer takes:

```sh
python3 orchestration/reviewer/sol_rules.py prompt --pr <pr> \
  --ledger <state-dir>/sol-ledger-<pr>.json [--disputes <snapshot>] >> <checks-file>
```

The block names the next free id, every open earlier id with its criterion and
location, and each dispute to rule on. A dispute file holds one or more
blocks, each a `Dispute: S<pr>-<n>` line, an `Evidence:` line and the
builder's argument. Snapshot it per head and pass the same snapshot to both
steps. A dispute on an id that is not open, one with no evidence, or a named
snapshot that is missing is refused with exit 2 and the review does not start.

After Sol posts, run the gate on the comment body for that head, read only
from the account Sol posts as:

```sh
python3 orchestration/reviewer/sol_rules.py gate --pr <pr> --head <full-sha> \
  --ledger <state-dir>/sol-ledger-<pr>.json --comment <body-file> [--url <comment-url>] [--disputes <snapshot>]
```

| Exit | Line | Meaning |
|---|---|---|
| 0 | `PASS` | Approve, every count matches, no open finding or dispute. The ledger advances. |
| 1 | `HOLD` | Changes requested and consistent. The ledger advances. |
| 3 | `FAIL` | Refused. The ledger is untouched; set the verdict context to failure on that head. |

The gate fails closed when:

- a count line is missing, or its number or ids differ from the finding blocks;
- an earlier open id has no block, `Closed:` or `Withdrawn:` line, or has
  both a `Closed:` and a `Withdrawn:` line;
- a new id skips, reuses or belongs to another PR;
- a dispute has no ruling and is not counted open;
- an upheld dispute leaves its finding open;
- an approval leaves anything open;
- a `criterion:` appears outside a `Finding:` block, whatever markup
  surrounds it, or the head line is not the reviewed head;
- a named dispute snapshot is missing at gate time.

Two things count that the dispute file and the ledger alone would not:

- A dispute the builder made in a PR reply comment, which Sol reads through
  the [trust gate](../trust-gate/README.md). A ruling on an open earlier
  finding of this PR counts as one; a ruling on any other id is still refused
  as not disputed. An open ruling carries into the next prompt.
- An id raised on an earlier PR, `S<m>-<n>`, in a `Closed:` or `Withdrawn:`
  line. Keep ledgers side by side as `sol-ledger-<pr>.json`: the id must be
  open in `sol-ledger-<m>.json` beside this one, and is recorded under
  `carried` in this PR's ledger. The earlier ledger is read, never written. No
  such ledger, an id not open there, an id already ended on this PR, or an
  earlier id raised or ruled on here is refused.

Any other exit is a refusal too. Cases:
`python3 orchestration/tests/sol-rules-cases.py` and Sol's proofs
`python3 orchestration/tests/sol-pr213-proofs.py`, with no network and no agent.

`sol-rl-gate.sh` wraps the gate for a round: it fetches the comment the
active gh login posted for the head, runs the gate, posts a failing
`Sol verdict` status on a refusal and logs one `SOL-RULES` line.

```sh
SOL_RL_ROOT=<round> orchestration/reviewer/sol-rl-gate.sh [--repo OWNER/NAME] <pr> <full-sha> [<comment-url>] [<snapshot>]
```

It reads and posts only in the repository it is given, LaunchAstro/ops-astro
by default. That repository keeps its ledgers in `<round>/polish/`; any other
keeps them in `<round>/polish/owner/name/` (lower case, as GitHub matches
names), so two repositories' PRs with one
number never share a ledger, and an earlier-PR id is looked up in its own
repository only. A caller for another repository passes `--repo` here and
points the prompt step at the same folder, as `sol-pr-cf.sh` (the Code
Factory caller) does: a lane disputing a Code Factory finding writes
`<round>/polish/launchastro/code-factory-private/disputes-<pr>.md`. `sol-pr-cf.sh`
takes `<round>` from `SOL_RL_ROOT`; without it, the round is the folder above
the script's folder, which is `orchestration/` in this repository, so set
`SOL_RL_ROOT` when running it from here. Cases:
`python3 orchestration/tests/sol-rl-gate-cases.py`, against a stand-in gh.

## Another repository's review

`sol-pr-cf.sh` reviews Code Factory's PRs unless given another repository
(#361):

```sh
SOL_RL_ROOT=<round> orchestration/reviewer/sol-pr-cf.sh [--repo OWNER/NAME] [--setup FILE] <pr> <lane> [<fix-url> <findings-file> <previous-head>]
```

With no `--repo`, or `--repo LaunchAstro/code-factory-private`, nothing changes. Code
Factory's private repository was `LaunchAstro/code-factory` until 27 October 2026
(#323); that name is now the public copy's, so `--repo LaunchAstro/code-factory`
is another repository like any other and is refused without its own `--setup`.
A review mirror whose origin names another GitHub repository (as one cloned
under the old name does) is pointed at the one under review. Ledgers kept
under `polish/launchastro/code-factory/` before the rename are moved to the
new name's folder once, at the rename, and checked gone (RENAME-PLAN steps 4
and 6); after that, that folder is the public copy's own.
Any other repository reaches `gh`, the trust gate, `sol-rl-gate.sh --repo` and
the verdict status under its own name, and keeps its own state, so it never
meets Code Factory's PR of the same number: its mirror and run logs in
`~/Desktop/Projects/code-factory-sol/<owner>/<name>/`, its prompt, criteria,
checks and ledger in `<round>/polish/<owner>/<name>/` (LaunchAstro/ops-astro's
ledger and disputes stay in `<round>/polish/`, where `sol-rl-gate.sh` keeps
them), Sol's proofs in
`<round>/handbacks/sol-proofs/<owner>/<name>/`, and `events.log` lines
tagged `<owner>/<name>#<pr>` in place of `cf<pr>` (names in lower case).
Its copy goes under `$TMPDIR/cf-sol/` and is removed the same way.

Another repository needs `--setup FILE`, its own review setup; Code
Factory's environment text (vitest, the round's Postgres) is Code
Factory's only. The hook is an executable run in the review copy before
the prompt is made, in its own process group, with `SOL_REPO`, `SOL_PR`
and `SOL_HEAD` set and the copy's path as its argument. It installs what
the review needs, starts any database, and prints the `Environment:` text
Sol is given; that text goes into the prompt and `polish/`, so it names
where a secret is (a file such as `.local/db.env`), never the secret. A hook that fails or prints nothing stops the review, and a
kill stops the hook and its children before the copy goes. Whatever the
hook leaves in its process group is stopped when it ends, whether it passed
or failed (TERM, three seconds' grace, then KILL), so a service the review
needs runs outside it, in a container as Code Factory's Postgres is. `--setup` with
Code Factory replaces Code Factory's text the same way. Cases:
`bash orchestration/tests/sol-repo-cases.sh`.

The reviewer tries the standalone build at `~/.codex/packages/standalone/current/bin/codex`, then `~/.local/bin/codex`, then `codex` on `PATH`. It requires Codex 0.162.1 or later and a readable version; otherwise it stops before creating a review copy, reporting the selected binary and version.

## Review copies

A Sol review's working copy is not a record. `sol-pr-cf.sh` keeps each
review's worktree, patch and full codex log in `$TMPDIR/cf-sol/<pr>-<sha7>-<pid>/`
and removes that folder when the review ends, fails or is killed by INT or
TERM (a kill stops the codex run too). If Sol's proof files can't be saved, the
copy stays instead, with a `KEPT` file saying why, and the run log says where. It keeps the verdict comment, the prompt
and criteria in `<round>/polish/`, Sol's proof files in
`<round>/handbacks/sol-proofs/pr-<pr>-<sha7>/`, the last 40 lines of codex's
log in `~/Desktop/Projects/code-factory-sol/run-pr-<pr>-<sha7>.log` and the
`RUN-END` line in `events.log`. `make_sol_prompt.py` writes its patch under
`$TMPDIR/cf-sol` unless given `--artifacts`. `../copy-sweep.sh` removes what a
stopped host left there. Cases: `bash orchestration/tests/sol-copies-cases.sh`.

Sol runs with `$TMPDIR` set to the copy's `tmp/`, so its own temp folders go
with the copy, their proof files saved first to `tmpdir/` in the proofs folder
(#369): files up to 20 MB, without `node_modules`, `.git` or build output
(`target`, `dist`, `build`, `.next`), since nothing sweeps that folder. A proof that can't be saved keeps the copy, marked `KEPT`. The
`sol<pr>*` folders Sol makes directly in `/private/tmp` are left to the hourly
`../copy-sweep.sh`.
