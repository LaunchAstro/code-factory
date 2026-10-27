# Orchestration kit

The scripts behind a Code Factory build: the merge script, the pre-checks,
the watchers, single mode's hand-off and the reviewer mechanics. Report
commands run from the kit checkout against a round's files. New to the
repository? Read the [reading order](../README.md#where-to-start) first.

The [first round kit](#the-first-round-kit) at the end (stages, briefs, the
boot file and `archive/factory.sh`) is kept runnable with its cases. No
current build uses it.

## Current tools

- `lane-report.mjs` classifies an explicit fleet inventory and writes local
  reports. Its live transport stays sealed pending review and parent release.
  See the [reference](lane-report.md) and [trial runbook](lane-report-trial.md).

- `watch.mjs lane-watch` reports suspected lane stalls and recorded waits,
  with no pane actions; see [watch.md](watch.md#lane-watch).
- `watch.mjs merge-stall` runs one report-only GitHub queue check using
  `watch.settings.json`, the shared event grammar and persistent stall state.
  See [the watch command](watch.md) for outcomes, tests and round-boundary adoption.

- `precheck/` runs the tree the merge queue would build (main plus a batch of
  READY pull requests) through the queue's whole check set on a test machine
  of our own, as a named step list, and posts the result as a commit status on
  each head before it is enqueued. See [precheck.md](precheck/precheck.md).
  `tests/precheck-cases.sh` is its cases, run with `bash`.

- `enqueue.mjs` is an agent-invoked single pass for a READY PR: all dynamically
  required checks must succeed on the full expected head, with no hold label.
  It enqueues, or on a repository with no merge queue merges directly;
  failed reads wait. See [enqueue.md](enqueue.md) for use,
  refusal outputs, fake-GitHub tests and round-boundary adoption.
- `hosted-precheck.mjs` runs a batch of round lanes' ready PRs through the
  merge queue's units on hosted runners, as a draft PR. It posts
  `hosted/precheck` only when every unit ran in full, and refuses before
  writing anything otherwise. See [hosted-precheck.md](hosted-precheck.md).
- `precheck-status.mjs` prints one head's pre-check decision for an enqueue
  loop, from `m5/precheck` and `hosted/precheck`. See
  [hosted-precheck.md](hosted-precheck.md#the-enqueue-loop).

- `reviewer/` the codex shim (`run_sol_review`, `sol_review_effort`, and
  `codex_slot`, the login-wide Codex limiter), Sol's prompt renderer and rules
  gate, and its README. `tests/codex-shim-cases.sh` and
  `tests/codex-slot-cases.sh` are the shim's cases, run with `bash`.
- `trust-gate/trust-gate.sh` reads a PR's comments, reviews and review
  comments for a lane or Sol, keeping only what org members, named users and
  named bots wrote, and failing closed ([README](trust-gate/README.md)).
  `tests/trust-gate-cases.sh` is its cases, run with `bash`.
- `single/handoff.sh` single mode's hand-off: reads the context gauge, writes
  the hand-off note and dispatches the fresh session ([SINGLE.md](../docs/SINGLE.md#hand-off-at-50-percent-context)).
  `tests/single-handoff-cases.sh` is its cases, run with `bash`.
- `precheck-stall.sh` alerts when a pre-check line stalls (line A on the check machine,
  line B on the owner's machine): a batch past 190 minutes, a line idle 30 minutes while
  PRs wait (a PRECHECK-WAIT head with no verdict, or a PR in the line's queue
  file), or a batch with no runner process of its own. It writes keyed `RELAY-ALERT`
  lines to the round's `RELAY-LOG.md`, and gates nothing. Each run of the
  director's `kick.sh` calls it with
  `ROUND=<round> <this checkout>/orchestration/precheck-stall.sh`. Its defaults
  skip the runner check until the round names where its runners keep
  `<run>.pid`, and watch that round's queue files. The kit's own
  `precheck/runner.sh` writes no `<run>.pid`, so a round sets
  `PRECHECK_PIDS_A`, `PRECHECK_PIDS_B`, `PRECHECK_QUEUE_A` and `PRECHECK_QUEUE_B`.
  `tests/precheck-stall-cases.sh` is its cases, run with `bash`.
- `copy-sweep.sh` removes old review and check copies: folders in
  `$TMPDIR/cf-sol` (Sol review copies, see [reviewer/README.md](reviewer/README.md#review-copies)),
  `sol*` folders directly inside `/private/tmp` and `$TMPDIR` (other rounds'
  own Sol scripts copy there) and, with `--checks DIR`, the check machine's `out-*` and
  `chk-*` folders in DIR. It
  keeps anything changed in the last 6 hours, anything a running process
  names or has open (`lsof +D`, or lsof failing), a copy its review marked
  `KEPT`, and the newest all-green `out-<sha>-*` of each open PR's head,
  which `green-run.sh` reuses. Start with `--dry-run`. `tests/sol-copies-cases.sh`
  is its cases, run with `bash`.
- `m5/checks/` the check machine's runner and its first-come queue, shared by
  every project ([README](m5/README.md#m5-check-queue)).
  `tests/check-queue-cases.py` is its cases.
- `seats/` the first kit's copy of `claude-seat-up` and what it reads.
  `tests/seat-up-cases.sh` is its cases, run with `bash`; they need `zsh`, as
  the script does.
- `watch.mjs` also provides `landing-assessment` and `arrival-cap` passes,
  with READY ownership and predecessor metadata from the shared grammar. Both
  report only: no variant caps open pull requests, so `CAP-HOLD` holds no
  build ([METHOD.md](../docs/METHOD.md#seats-lanes-and-stops)). See
  `watch.md`; cases are in `tests/watch-landing-cases.mjs`. Adopt the kit only
  at a round boundary.

## Touches before dispatch

`watch.mjs touches` is a single-pass, report-only check built on `events.mjs`.
It reads declarations, explicit brief paths and all open PR files through
paginated `gh api` GET calls. It prints grammar lines to stdout; it writes no
round files, GitHub state or panes. The orchestrator appends the output and
decides whether to dispatch. Adopt it at the start of a new round.

Copy `watch.example.json` to the round's
`watch.json`, beside `touches.json` and `events.log` under `--round`
(the boot template uses `<ORCHESTRATION-ROOT>/.local/lanes`). Its
`touches.busyFiles` is a configurable list of exact repository-relative paths
that refuse dispatch even without a holding lane.
The example seeds four paths where lanes have collided before.
`busyFilesSource` describes where the list came from; it is not a file the
checker loads. Change the list for the round's repository and current work.

Create `touches.json` under the directory passed as `--round`, initially
`{"lanes": []}`, beside its `events.log` (an empty initial log is valid).
Each admitted lane has one declaration:

```json
{
  "lanes": [
    {
      "lane": "BUILD-A",
      "declaredAt": "2026-10-14T00:00:00Z",
      "paths": ["packages/example.mjs"],
      "brief": "briefs/BUILD-A.md",
      "branch": "feat/example"
    }
  ]
}
```

Brief paths are relative to `--round` (absolute paths also work). The candidate
and each working lane's brief must have exactly one physical line such as
`Touches: ["packages/example.mjs"]`. An explicit empty list is allowed;
omitting the line is UNKNOWN. The checker combines these paths with the
recorded or requested paths; it does not infer paths from prose. All paths
must be exact, canonical repository-relative file names, with no empty,
`.` or `..` segments, backslashes or control characters. Directory and glob
declarations are not expanded. Matching is case-sensitive.

Run from the kit checkout:

```sh
node orchestration/watch.mjs touches --round /path/to/round --settings /path/to/round/watch.json --repo Example/project --lane BUILD-B --paths '["packages/example.mjs"]' --brief briefs/BUILD-B.md
```

- Exit 0 prints `TOUCHES-CHECK DECLARED lane=... paths=...`. Decode the
  percent-encoded JSON paths, record them with the event timestamp as
  `declaredAt` and the brief path, then start the lane. `branch` is optional;
  it attributes an open PR to its working lane when the head branch and head
  repository both match. Fork PRs remain identified as `PR-number`.
- Exit 1 prints `TOUCHES-CHECK HELD` for each overlap, naming its path and
  holder. Holders are a lane, `PR-number`, or `ROUND-SETTING`; reasons are
  `busy-file`, `lane-declaration`, `brief`, or `open-pr`. Do not dispatch.
- Exit 2 prints `TOUCHES-CHECK UNKNOWN` when any read fails, the log has an
  unknown physical line, or an input has an invalid shape. Do not dispatch.
  No partial declaration or refusal is emitted before all reads succeed.

The orchestrator serialises check, declaration recording and dispatch. A
report is a snapshot, not a reservation. Rechecks do not duplicate or clear
declarations. A valid `WRAPPED` event by the declaration's actor at or after
`declaredAt` releases that declaration and its brief paths on the next pass,
including after a process restart. Other wrap wording or narrative mentions
do not release it. If reusing a lane label, record a new declaration later
than its previous wrap; use a fresh label when both happen within a second.
An open PR still holds its changed files until it closes or merges, even
when its author lane wraps. Busy settings also remain until changed.

Renames hold both old and new paths. A response reaching GitHub's documented
[3,000-file limit](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files)
returns UNKNOWN because it may be incomplete. Failed reads never mean clear.
Every CLI run prints a report; there is no deduplication state to hide a
dispatch attempt. Cases: `node --test orchestration/tests/touches-cases.mjs`.

## The first round kit

These scripts and templates ran the first, stage-by-stage version of Code
Factory, and live under [`archive/`](archive/). Their cases still run from
`tests/` through the one entry point, and `archive/stages.mjs --check` still
guards the stage table at the end of the root README.

- `archive/stages.json` the one source for the seven stages in the root README's stage table: actor, model, ceilings, brief template, and the condition that starts
  and ends each one. A row's `reviews` is how many reviews of record the stage
  spends, and its `reviewsPerPullRequest` how many of those one pull request
  may draw.
- `archive/stages.mjs` `--render` rewrites that table from `archive/stages.json`; `--check`
  refuses a stage with two rows, in any mix of case, a ceiling that is not a
  whole number, a table, a brief path, a `runner.json` minute or a
  `runner.json` `perPullRequest` count that disagrees with it, a brief that
  does not take each ceiling its row carries from that ceiling's placeholder,
  a boot template that does not take its hold cap from
  `<REVIEW-REVIEWS-PER-PULL-REQUEST>`, a REVIEW-FIXHEAD brief that does not
  take that cap and `<REVIEW-REVIEWS>` from theirs, a brief or boot template
  that restates a ceiling it takes from a placeholder (a count in digits or
  any number word, scale words and ordinals included, beside that ceiling's
  unit, as in "two pushes", "a billion sessions" or "a twenty-first review",
  or an ordinal other than a lone "first" ending a clause, as in "there is no
  third"),
  and a brief or boot template carrying
  Markdown that renders as nothing: a link or image target, a reference
  definition, or any `<` that does not open a placeholder listed below or a
  row's ceiling, so no HTML comment, tag or element.
  `tests/stages-cases.mjs` is its cases, run with `node --test`.
- `archive/briefs/` BUILD, PLAN-CHECK, DESLOP, CLEAN, REVIEW, REVIEW-FIXHEAD, FIX and
  SCORE templates.
- `archive/boot/` the orchestrator's boot file and the state note it rewrites each tick.
- `archive/reviewer/` holds the first kit's example first-head and fix-head
  prompts and a worked REVIEW handback.
- `archive/factory.sh` one command from a clean clone: the preflight, the round's briefs
  and boot file, then the orchestrator pane. It refuses a seat or model that
  is not one plain token, a clone whose origin it cannot fetch, a clone not at
  the head that fetch found, a missing template, a stage row that names no
  brief, an `archive/stages.json` ceiling that is not a whole number, and a round file
  already in `.local/lanes/`. It reads the templates, the skill verifier and
  its pins, and the seat script from that checked commit, never the working
  tree, publishes the round whole or not at all, even when the process moving
  it in crashes or the run is killed while it moves, and holds
  `.local/factory.lock` from choosing the round number to publishing its
  files, so a second run at the same time is refused. A stage's brief is the
  one its `archive/stages.json` row names, the path `archive/stages.mjs` checks, and the round
  file takes that template's name, less any `-TEMPLATE`. It checks the
  installed skills against their pins again as the last step before the
  boot, after the seat script is read, and boots nothing if they changed
  after the preflight. Copy `archive/factory.example.json` to `archive/factory.json`
  (git-ignored) once, or `--config` at another; cases in
  `tests/factory-cases.sh`.
- `skills/` the pinned sources of the skills the orchestrator loads. Run
  `node orchestration/skills/fetch.mjs` after cloning to populate them; the
  fetched directories are git-ignored. `tests/fetch-cases.mjs` is its cases.

## The placeholders

Every upper-case placeholder in this kit is listed here, in the file that uses it.
A metavariable is the exception: it is filled from the line a lane is answering,
not once by a project, and `archive/factory.sh` knows them from this list: `<n>`,
`<slug>`, `<branch>`, `<head>`, `<head-1>`, `<head-2>`, `<sha>`, `<id>`,
`<id-1>`, `<id-2>`, `<pass>`, `<seat>`, `<session-id>`, `<cwd-slug>`,
`<model-id>`, `<clone>`, `<code>`, `<count>`, `<file>`, `<login>`, `<verdict>`,
`<prompt-file>`, `<risk>`, `<proof-file>`, `<line or symbol>`, `<reproduction command>`,
`<wrong behaviour>`, `<right behaviour>`, `<comment id or FAILED-TIMEOUT>`,
`<review id or FAILED-TIMEOUT>`. Anything else a written file still carries,
upper case or lower, name or phrase, is a refusal at exit 1.

The round, and everything that names it:

| Placeholder | What it is |
| --- | --- |
| `<PROJECT>` | the project the round is run for. |
| `<ROUND>` | the round's label, the one every lane label, brief name, trail and handback is built from. |
| `<ROUND-NAME>` | the round's name in one phrase, for the state note's title. |
| `<N>` | the round's number. `ROUND<N>-REPORT.md` is the report SCORE writes. |
| `<DATE>` | the round's date, as the brief file names and wrap-up titles carry it. |
| `<T>` | how many tickets the round runs: BUILD's pull-request ceiling, and the count SCORE scores. |
| `<VERBATIM>` | the owner's own words for what the round is for, quoted and never paraphrased. |
| `<what this round is for, one sentence>` | the boot file's line on the round, which `archive/factory.sh` fills with `<VERBATIM>`'s words. |
| `<N+1>` | the next round's number, which the boot file's handover file is named for. |
| `<LABEL>` | one lane's label. Its tail phrase is `<LABEL>-BOOT-TAIL`, its handback ends `LANE-<LABEL>-DONE`. |

Where the work lives:

| Placeholder | What it is |
| --- | --- |
| `<ORCHESTRATION-ROOT>` | the directory that owns the round: its `.local/lanes/` holds every brief, trail, handback and `events.log`, it is git-ignored, and it sits beside the code clone rather than inside it. |
| `<CLONE>` | that code clone. |
| `<OWNER>`/`<REPO>` | the repository the clone points at. |
| `<UPSTREAM-OWNER>` | the owner the clone's repository was forked from, when it was. |
| `<ORCHESTRATION-REPO>` | the repository SCORE opens its one pull request against. |
| `<REPORT-DIR>` | the directory in that repository the round report and ledger go in. |
| `<GH-ACCOUNT>` | the `gh` account that stays active. No lane ever runs `gh auth switch`. |
| `<ARCHIVE-DIR>` | the subdirectory of `.local/lanes/_archive/` CLEAN moves a round's spent files into. |
| `<CUTOFF-DATE>` | CLEAN archives files dated before this. |
| `<KEEP-FROM-ROUND>` | CLEAN moves nothing from this round or later. |

Seats, panes and models:

| Placeholder | What it is |
| --- | --- |
| `<SEAT>` | the subscription a pane boots on, and the name `claude-seat-up` takes. |
| `<OLD-SEAT>`, `<NEW-SEAT>` | the two seats when a live conversation is carried from one to the other. |
| `<MODEL>` | the model a lane runs. |
| `<PANE>` | the herdr pane a lane sits in. |
| `<KEEP-OPEN>` | the panes the orchestrator must leave open, because the owner owns them. |
| `<SEAT-TRANSCRIPT-DIR>` | where a seat's JSONL transcripts are, for reading an acknowledgement the pane reader missed. |
| `<CONTEXT>` | the orchestrator's own context percentage in the state note. |
| `<K>`, `<K-1>` | this orchestrator's number and its predecessor's. |
| `<PRIOR>` | the round that closed before this one. |
| `<TAB>` | one literal tab, the trail TSV's separator. |

Pull requests, reviews and fixes:

| Placeholder | What it is |
| --- | --- |
| `<PR>` | the pull request number. |
| `<BRANCH>` | its branch. |
| `<PREFIX>` | the prefix BUILD gives every ticket branch. |
| `<HEAD>` | the head a review was bound to. |
| `<HEAD-1>`, `<HEAD-2>` | the two heads a held pull request already spent its reviewer sessions on. |
| `<REVIEW-ID>` | the review of record a fix lane answers. |
| `<REVIEW-ID-1>`, `<REVIEW-ID-2>` | the two reviews at `<HEAD-1>` and `<HEAD-2>`. |
| `<REVIEWER>` | the reviewer's name, as its own `Reviewer:` line gives it. |
| `<REVIEWER-ACCOUNT>` | the GitHub account the review posts from, which is never the builder's. |
| `<PASS>` | which fix pass this is. |
| `<PASSES-GRANTED>` | how many the owner decision granted. |
| `<REVIEWER-TOKEN-FILE>` | the file holding the reviewer account's GitHub token, read by `reviewer/codex-shim.sh` and nothing else. `reviewer/README.md` says how to make it. |
| `<PROOF-FILE>` | the file under `tests/ci/` where a fix proves its criterion red then green. |
| `<ROUND-BOUND-LINE>` | the line in `events.log` the round starts at, so SCORE reads the round's lines and no earlier ones. |

Stage ceilings, which `archive/factory.sh` fills from `archive/stages.json`, so a brief never
states a number of its own:

| Placeholder | What it is |
| --- | --- |
| `<BUILD-WALL>` and the like | a row's ceiling, named `<STAGE>-<CEILING>`: the row's `stage` in upper case, then `CONTEXT`, `WALL`, `PUSHES`, `REVIEWS`, `REVIEWS-PER-PULL-REQUEST` or `PULL-REQUESTS` for the field of that name, a whole number. `archive/stages.mjs --check` refuses a brief that lacks one its own row carries, a boot template that lacks `<REVIEW-REVIEWS-PER-PULL-REQUEST>`, the count at which it holds a pull request, a REVIEW-FIXHEAD brief that lacks it or `<REVIEW-REVIEWS>`, and a template that also writes a ceiling it takes as a count: the units are percent, minutes, pushes, reviews or sessions, and pull requests. |
| `<REVIEW-WALL-SECONDS>` and the like | a row's wall in seconds, for a session deadline. `archive/stages.mjs --check` refuses a PLAN-CHECK or REVIEW brief that lacks its own. |

The placeholders a copied project fills are listed once, in
`template/README.md`, and that list is the one to work from. `<OWNER-HANDLE>`
ships unfilled in 8 files there, and until it is replaced every review request
and the sandbox hold route to somebody outside the project. The same list
carries `Product Name`, `<COPYRIGHT-HOLDER>`, `<YEAR>` and the package name,
and it marks the licence and governance files as the owner's to edit rather
than a project's, because they name Launch Astro's maintainer by design.

`template/scripts/runner/runner.json` carries the same idea in lower case:
`<owner>/<repository>`, `<seat>` in the launcher template, and
`../<orchestration-root>/` on the two paths the runner writes.
