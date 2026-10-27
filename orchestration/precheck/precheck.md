# Pre-queue check

Before a pull request goes into the merge queue, run the tree the queue would
build (latest `main`, then the pull request merged with `--no-ff`) through
the queue's whole check set on a machine of our own, and post the result as a
commit status on the head. A queue ejection then costs one local run, not a
hosted group and the groups behind it.

The pull requests given share a run (a batch), merged in the order given,
as the queue would build them. Ops Astro ran batches of three, then six. A
green batch is green for every pull request in its tree. A red batch is held
and split: one run per suspect, restricted to the red units.

## Files

- `precheck.sh`: the laptop half. It pushes `main`, the heads and GitHub's
  tags to the test machine's own mirror, starts the runner and waits. Then it
  writes the verdict and posts the status.
- `runner.sh`: the test machine's half. It builds the merge tree, fakes the
  `merge_group` event, and runs the step list.
- `steps/<project>.sh`: the project's step list, its CI's merge-group jobs as
  units of named steps. `steps/ops-astro.sh` is LaunchAstro/ops-astro's.
- `stop-run.sh <run>`: stops one run by process tree, never by name.
- `../tests/precheck-cases.sh`: the kit's own cases, offline (below).

## The step list

It follows Rails 8.1's local CI (`ActiveSupport::ContinuousIntegration`; the
pattern only, nothing copied):

- every step is named;
- every step runs, even after an earlier one fails;
- each step writes one line to `<run>/steps.log`:
  `STEP PASS|FAIL <unit> <seconds>s <title>`;
- a unit is green only if all its steps passed, and a run only if every unit
  is.

Units run in parallel, at most `-w` at once (default 5). Keep the test
machine near one load per core. Past that, timing proofs fail and the failures
cascade. So admission holds back the heavy units (the step list's
`heavy_unit`): `MIN_HEAVY` of them (default 2) always run, and one more starts
only while the machine's 1-minute load is under `MAX_LOAD` per core (default
1.0), one at a time and at least 60 s apart, so each start shows in the load
before the next. Only started units count. Each start is logged in
`<run>/logs/admit.log` with its wait.

The wait loop writes `precheck-logs/<run>/load.tsv` every 30 s: UTC, the
machine's load per core (everything on it), and the cores the run's own
processes use. Containers in a VM, like Docker Desktop's, are not counted.

On a full merge-group job set the floor is the units' summed time over the
workers. In the first batch (18 Oct, Ops Astro) that was 24,168 s over 5
workers, 81 minutes, and the batch took 96. The units ran at hosted-runner
speed. A 20-30 minute batch on one machine needs faster suites, not a
different runner. A unit that failed in the parallel phase runs once more, alone. A
red that only load made is not the queue's red. The first failure stays in
the unit's log, and the alone run's lines carry `(alone)`.

## Hardening

- `pnpm install --ignore-scripts` everywhere: no install-time script runs.
- Every install and every step runs under `env -i`. It gets PATH, a scratch
  HOME in the runner's folder, `LANG` and the test variables, and nothing
  else.
  - git reads no system config (`GIT_CONFIG_NOSYSTEM`; Homebrew's names
    the keychain helper) and no global one, as the scratch HOME has no
    `~/.gitconfig`. `GIT_CONFIG_GLOBAL` stays unset: a project's hooks may
    treat any other `GIT_CONFIG_*` as a changed git (Ops Astro's pre-push
    does, and its range tests then fail).
  - docker reads an empty config, so it has no credential helper.
  - gh finds no login.
- Every value that reaches the test machine's shell is checked on the
  laptop first: PR numbers, heads (7 to 40 hex), the head branch (a plain
  ref name), unit names, the worker count and `owner/name`. A bad one is
  refused before anything leaves.
- Only the round's own pull requests are checked. The head branch must be
  in the repository itself, not a fork, and the author must be listed in
  `PRECHECK_AUTHORS`. Anything else is refused before a byte leaves the
  laptop, and the refusal is logged.
- Each Postgres unit gets its own throwaway container, labelled
  `precheck=<run>`. On exit the runner removes them, along with any compose
  stack built from its folder (its containers, networks and volumes).

Docker or VM isolation of the steps themselves is not done yet.

## The status

Context `PRECHECK_CONTEXT`, gh-signoff style. It defaults to `precheck`, a
context [`precheck-status.mjs`](../precheck-status.mjs) never reads: the merge
script reads only `m5/precheck` and `hosted/precheck`. Set
`PRECHECK_CONTEXT=m5/precheck` for the M5 line, or an enqueue loop waits for a
status that never comes.

Every description names the exact head and base:

| State | Description |
|---|---|
| `pending` | `running: head <sha> base <sha>` |
| `success` | `green: head <sha> base <sha> with #a #b #c` |
| `failure` | `red <unit>:<step> head <sha12> base <sha12> log <run>/logs/<unit>.log`, or `red merge conflict: head <sha12> base <sha12>: <files>` |
| `pending` | `no verdict: head <sha12> conflicts only with earlier PRs in its batch; back in the line` |
| `error` | `no verdict in 180 min`; `setup failed, no verdict; rerun`; `no verdict: queue entry #<n> ahead conflicts (<where>); tree is not the queue's` |

It is not a required check: as a required status, the queue would demand it
on its own merge-group commits too. It is an admission gate only. Any token
that can write to the repository can post the same status, and the hosted
queue still runs every check. A required status that only a GitHub App can
sign is the next step. It is not built: it waits on a choice between App-only
signing, which can't be forged, and a hosted fallback for when the test
machine is down.

## Settings

The laptop half reads:

| Variable | What |
|---|---|
| `PRECHECK_ROOT` | the round folder: `events.log`, `prechecks/`, `trails/`, `precheck-logs/` |
| `PRECHECK_REPO` | a local clone; only fetched into (`refs/precheck/*`, `refs/precheck-tags/*`) |
| `PRECHECK_GH_REPO` | `owner/name` |
| `PRECHECK_HOST` | the test machine, as `ssh` names it |
| `PRECHECK_REMOTE` | the runner's folder under that machine's home (default `precheck`) |
| `PRECHECK_STEPS` | the step list file |
| `PRECHECK_AUTHORS` | GitHub logins whose pull requests may be checked |
| `PRECHECK_CONTEXT`, `PRECHECK_LANE` | the status context and the events-line label (both default `precheck`; see [the status](#the-status)) |
| `PRECHECK_LOGS` | where run logs go (default `$PRECHECK_ROOT/precheck-logs`) |
| `PRECHECK_REVIEW` | `1` (the default) holds a batch red for review; `0` lets a single-PR run publish its red |
| `PRECHECK_UNITS` | optional unit names: run only these (a split run) |
| `PRECHECK_ATTACH` | `1` re-attaches to a run already going |
| `PRECHECK_BASE` | optional `<pr> <head>` pairs: the queue entries ahead of the batch, merged first so the tree is the one the queue will build; checked like the batch, given no status. If one of them doesn't merge, the tree is not the queue's: every head gets an `error` status, no verdict, and the run exits 3 |

On the test machine, `<remote>/precheck.env` names its paths: `NODE_BIN` (the
CI's Node major), `BROWSERS_SEED` (a Playwright browsers folder to copy once),
`DOCKER_PLUGINS` (docker's CLI plugins folder) and `DOCKER_BIN`. It can also
set `PORT_BASE` (default 56500); three runs at once take 90 ports from there.
`MIN_HEAVY` and `MAX_LOAD` set admission (above).

## Run

```sh
bash orchestration/precheck/precheck.sh -w 5 1843 f2063cd 1839 bd90ad7 1835 f56b3ee
```

Run it in the background. It waits up to 180 minutes. Then:

- a green batch posts success on every head, and writes
  `prechecks/<pr>-<head>.green` and one `PRECHECK-GREEN` line each;
- a red batch is held in `precheck-logs/<run>/pending.red` and logs
  `PRECHECK-BATCH ... red`. Split it with one run per suspect:

  ```sh
  PRECHECK_UNITS="check1 db4" PRECHECK_REVIEW=0 bash orchestration/precheck/precheck.sh 1843 f2063cd
  ```

  ssh forwards no environment, so `precheck.sh` puts `PRECHECK_UNITS` in
  the runner's command. A name the step list doesn't have, or a list that
  leaves no unit, is a setup failure: an `error` status, never a green.

- `PRECHECK_ATTACH=1`, with the same arguments, re-attaches to a run already
  going.

| Exit | Meaning |
|---|---|
| 0 | The run ended with its statuses posted: green on every head in the tree, or a single-PR red published. A head left out of the tree can still be red or `pending` (below). |
| 2 | Usage error, or a `BLOCKER` (for example a refused status post, or no verdict after 180 minutes): see `events.log` and stderr. |
| 3 | No verdict: setup failed, or a `PRECHECK_BASE` entry doesn't merge. Every head has an `error` status. |
| 4 | A batch red, held in `pending.red` for a split. |
| 5 | Refused: the pull request is not a round lane's (author or head repository). Nothing ran. |

Before exit 0 or 4, each head left out of the tree gets its status. A conflict
with main is that PR's red. A conflict only with earlier PRs in its batch
leaves the head `pending` with no verdict, and that PR goes back in the line.

Edit `precheck.sh` and `runner.sh` by writing a copy and moving it into place.
A run that is waiting reads its script as it goes. The kit installs the runner
on the test machine the same way.

## Tests

```sh
bash orchestration/tests/precheck-cases.sh
python3 orchestration/tests/precheck-fail-closed-cases.py
```

Offline: ssh, scp and gh are stubs, and the test machine is a scratch home,
so `precheck.sh` and `runner.sh` run for real on a three-unit step list. The
cases cover the step helper, the scrub (a token planted in the test machine's
environment reaches no step, log or record), admission, every refusal, a red
run named `unit:step`, a green batch with a conflicting pull request, and a
split run. The fail-closed cases add that an unknown unit, a job killed by a
signal and a conflicting queue entry ahead never publish green. They don't
cover Docker, Postgres or a real step list: Ops Astro's 18 Oct batches prove
those, on the round's copy of these scripts. This kit's own scripts have not
yet run a live batch: #224.
