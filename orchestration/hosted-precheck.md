# Hosted pre-check (line C)

`hosted-precheck.mjs` runs a batch of ready pull requests through the merge
queue's units on GitHub-hosted runners before any of them enqueues. It is a
third pre-check line beside the test-machine lines, and it posts the same kind
of result: a commit status on each exact head. A batch counts only when it ran
every unit the test-machine pre-check runs, database tests included, on the
exact heads merged onto main as it stood at the start.

The project's CI has no `workflow_dispatch`, and a push runs only on main, so
a batch is a draft pull request. Its branch is main plus one merge per head.
The draft carries the labels that ask for the full set, and it is closed and
its branch deleted when its run ends.

## Rules

- **Round lanes' pull requests only.** Each member must be opened by a round
  identity, have its head in the repository itself (never a fork), be based on
  main, open and not a draft, carry no hold label, and have a `READY` or
  `FIX-PUSHED` line in the round's `events.log` at that head.
- **Every unit has a hosted job.** The config maps each test-machine unit to
  the CI job that runs it. A unit mapped to `{"none": reason}` refuses every
  batch and names the reason.
- **The map is pinned.** `pins` holds the blob of each file that decides what a
  pull request run runs (the workflow, the scope script and its map, the
  full-or-light script). A batch refuses when main's copy differs, or when a
  member changes one. A changed file means the map has to be checked again by
  hand and its pins moved in a reviewed change.
- **The queue comes first.** A batch takes about half the hosted job slots, so
  it starts only while at most `maxBuildingGroups` merge-group runs are
  building, and only when no other batch is open. An unreadable queue refuses.
- **The contamination gate first.** A run counts only when the gate job
  succeeded and finished before any other job started.
- **The log is read.** A mapped job that succeeded but whose log carries a
  `deferred` marker (a step that said it runs only in the merge queue) means
  the unit did not run in full, and the batch does not count.

Every read and check runs before anything is written. A refusal writes nothing
to GitHub. It adds `START` and `END ... REFUSED` lines to the event log and
nothing else.

## Use

```sh
node orchestration/hosted-precheck.mjs start --config orchestration/hosted-precheck.ops-astro.json \
  --root ROUND --clone OPS_ASTRO_CLONE --agent-model MODEL  PR SHA [PR SHA ...]
node orchestration/hosted-precheck.mjs finish --config orchestration/hosted-precheck.ops-astro.json \
  --root ROUND --state ROUND/lane-scratch/OA-Precheck-C/<id>.json
```

`start` builds the batch with git plumbing (`merge-tree`, `commit-tree`), so
the clone's working tree and checked-out branch are never touched. The push
runs the repository's own pre-push hook. Each merge commit carries the
provenance trailers the project's commit check asks for; `--agent-model` names
the model that ran the line.

`finish` is one pass: call it every few minutes while it prints `WAIT` and
exits 4. Stop on any other exit. Exit 2 prints nothing on stdout, so a loop
that only watches for `WAIT` must read the exit code too.

| First word | Exit | Meaning |
| --- | --- | --- |
| `STARTED <id> pr=<n> branch=<b> head=<sha> state=<file>` | 0 | Draft opened and labelled. `left-out #n` means #n conflicts only with an earlier member: run it in another batch. `conflict #n` means #n conflicts with main: it is left out with no status, because every status names a hosted run. |
| `REFUSED <id>: <reasons>` | 3 | Nothing written. Every reason is listed. |
| `REFUSED: another start holds <lock> ...` | 3 | Another `start` holds the round's `lane-scratch/<lane>/start.lock`. Remove the lock only if no start is running. |
| `WAIT <id> run <url> <status>` | 4 | The run has not finished. A cancelled run waits `settleSeconds` from the start, because adding the labels cancels the first runs. |
| `GREEN <id> run <url> #a #b` | 0 | Success posted on each head. The description names the batch and the run. |
| `RED <id> run <url> units <u> #a` | 1 | One member: failure posted on its head. |
| `SPLIT <id> run <url> units <u> suspects #a #b \| #c #d` | 1 | More than one member: nothing posted. Start each half as its own batch, one at a time, until a red names one pull request. |
| `NOCOUNT <id> run <url> <reasons>` | 3 | A unit did not run in full, the gate was not first, a job the config's `requiredJobs` names did not succeed (`<job> <conclusion>` or `<job> missing`), the run was cancelled, or its jobs or logs could not be read. Nothing posted. |
| `FAILED <id>: push of <branch> refused` | 3 | The push was refused; no draft was opened and no state file is written. |
| `FAILED <id>: opening the draft: <error> state=<file> (<cleanup>)` | 3 | The draft could not be opened or labelled. Any draft is closed and the pushed branch deleted; the bracket says whether that worked, and `finish` on the state file retries it. |
| `ENDED <outcome> (<cleanup>)` | 0 or 3 | `finish` on a batch that has already ended: it posts nothing again and retries only the cleanup step that failed. 0 once the draft is closed and its branch deleted. |
| nothing on stdout | 2 | A usage error (the usage on stderr) or an error the command did not expect (`hosted-precheck: <message>` on stderr). Not done: read stderr and stop the loop. |

`GREEN`, `RED`, `SPLIT` and `NOCOUNT` lines end with the cleanup result in
brackets, as `ENDED` does.

Every outcome after `STARTED` closes the draft and deletes its branch, and the
`END` line says whether that worked. The state file records each step. If one
failed, run `finish` on the same state until it prints `ENDED ... (closed,
branch deleted)`. An open draft blocks the next batch.

## The ops-astro map

`hosted-precheck.ops-astro.json` maps the 28 units of the test-machine
pre-check (`steps/ops-astro.sh`) to `ci.yml` as it stood at
`6b784397d703aa00a2f44a2cdc78419873d89635`. Ten units have a job that runs in
full on a pull request: `gate`, `secrets`, `prsize`, `audit`, `semgrep`,
`pins`, `dbgate`, `commits`, `licences` and `parity`. Eighteen don't, so today
every batch refuses:

- `db1`-`db12`: `database-shard` has `if: github.event_name != 'pull_request'`.
  On the full-scope pull request run 39145222161, 22 jobs ran and the shards
  were skipped.
- `check1`-`check3` and `iso1`-`iso3`: the jobs run, but `scripts/ci-scope.ts`
  lists `local checks` and `isolation tests` as `queueOnly`, so on any pull
  request their wrapped steps say "deferred on a pull request" and pass.

LaunchAstro/ops-astro#1918 lets a pull request labelled `precheck-batch` run
the merge-group set. When it merges, check the new `ci.yml` and scope files by
hand, map the eighteen units to their jobs, and move the pins in one reviewed
change.

## The enqueue loop

A loop that waits for a pre-check before enqueueing reads it with one command:

```sh
node orchestration/precheck-status.mjs --repo LaunchAstro/ops-astro --head <full sha>
```

It reads every commit status on that exact head (all pages) and takes each
context's newest status, by id, for `m5/precheck` and `hosted/precheck`. A
failure or error in either stops; otherwise a success in either passes;
otherwise it waits. It prints one line, the status's state, context and
description, and exits 0 for `success ...`, 1 for `failure ...` or
`error ...`, and 2 for `pending ...`, `wait none` (no pre-check status),
`wait read-failed` (a failed read, or a status of another shape or for another
commit) or `wait usage` (a head that is not a full lowercase SHA, refused
before any read). A status on an older head never counts for a newer one. It
only reads.

The round's loop takes it as its `pc()` read; `success*` passes and
`failure*` or `error*` stops, as before. Cases:
`node --test orchestration/tests/precheck-status-cases.mjs`, against a fake
`gh`.

## Tests

`node --test orchestration/tests/hosted-precheck-cases.mjs` runs against a fake
`gh` and real git repositories in a temporary folder: every refusal (busy or
unreadable queue, a unit with no hosted job, a pin drifted on main or changed by
a member, an outside author, a fork, no READY line, a held or moved head, an
open batch), the built branch's parents and message, success, a red of one, a
split, a deferral marker, a skipped job, a job before the gate, and a cancelled
run.
