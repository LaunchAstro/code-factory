# Round tools

## Shared orchestration kit

Adopt at a new round boundary; current round tools keep running. Commands
below run one report-only pass and use `orchestration/watch.settings.json`.
Use an isolated round copy for verification. See [watch command](../orchestration/watch.md),
[event grammar](../orchestration/events.md), and the
[old-check coverage table](../orchestration/watch-coverage.md) before retiring a copy.

| Command                                                                                                                      | Purpose                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `node orchestration/watch.mjs merge-stall --repo OWNER/REPO --round ROUND`                                                   | Newest merge and queued/CLEAN work; failed reads UNKNOWN     |
| `node orchestration/watch.mjs lane-watch --repo OWNER/REPO --round ROUND`                                                    | Suspected lane stalls; requires ROUND/lanes.json             |
| `node orchestration/watch.mjs landing-assessment --repo OWNER/REPO --round ROUND`                                            | Oldest independent READY candidate, remaining gate and owner |
| `node orchestration/watch.mjs arrival-cap --repo OWNER/REPO --round ROUND`                                                   | Report waiting READY count against the cap; holds nothing    |
| `node orchestration/watch.mjs touches --repo OWNER/REPO --round ROUND --settings FILE --lane LANE --paths JSON --brief FILE` | Check declared paths for dispatch collisions                 |
| `node orchestration/replay.mjs`                                                                                              | Fixed offline synthetic round replay; fake tools only        |
| `node --test orchestration/tests/`                                                                                           | Kit and incident replay tests                                |
| `node orchestration/archive/stages.mjs --check`                                                                              | Validate stage definitions                                   |

These commands cover only some of the older round-folder scripts' checks; [watch-coverage.md](../orchestration/watch-coverage.md)
says which, and the checks it marks not covered stay with their existing
owners. Report-only commands do not replace every operational check.

## Shared kit event grammar

**[Round event grammar](../orchestration/events.md) and
[`events.mjs`](../orchestration/events.mjs).** The shared, read-only parser
for round `events.log` lines, including legacy merge wording, lane status
and watcher reports. `parseEventLine(line)` returns a typed record or the
single `{ type: 'unknown' }` result. Watchers and roadmap readers import it
when adopting the kit at a round boundary. It performs no I/O or pane actions.
The synthetic round replay refuses unknown lines with their line
number and text: `node --test orchestration/tests/events-cases.mjs`.
BOOTED/TICKET declarations and advisory SCOPE reports are specified there;
their valid and malformed forms are covered by
`node --test orchestration/tests/events-declarations-cases.mjs`.

## Shared kit watch command

**[`watch.mjs merge-stall`](../orchestration/watch.md).** One report-only
pass reads GitHub's newest merge, queue and CLEAN PRs, appends a grammar
report and persists stall deduplication. Thresholds live in
[`watch.settings.json`](../orchestration/watch.settings.json). Failed reads
are UNKNOWN. `landing-assessment` names the oldest independent READY PR,
its owner and remaining gate after the configured no-merge threshold.
`arrival-cap` logs CAP-HOLD/OPEN and closing work from the configured READY
limit. Both report only: no variant caps open, ready or approved pull
requests, so a `CAP-HOLD` holds no build
([METHOD.md](METHOD.md#seats-lanes-and-stops)). Adopt at a round boundary;
live kick scripts stay in place.

## Director

**[`watch.mjs lane-watch`](../orchestration/watch.md#lane-watch).** One
report-only pass over working lane records, event activity, local branch
commits and observed pushes. All three silent for the configured threshold
(default 30 minutes) produce one suspected-stall report with reasons and
pane state. Recorded tools, review waits and owner pauses explain silence;
failed reads are UNKNOWN. No pane or reaper action exists. Adopt only at a
round boundary. The [17-defect table](../orchestration/watch-lane-defects.md)
accounts for the held copies' proven gaps.

**[Touches before dispatch](../orchestration/README.md#touches-before-dispatch).**
`node orchestration/watch.mjs touches` reports overlaps against the round's
busy setting, working declarations, explicit brief paths and open PR files.
It prints DECLARED, HELD or UNKNOWN in the shared event grammar and writes
nothing. The orchestrator records declarations and serialises dispatch;
`WRAPPED` frees a declaration on the next pass. Adopt at a round boundary.
Cases: `node --test orchestration/tests/touches-cases.mjs`.

## Old round tools the coverage table still tracks

Two older orchestrator scripts, kept here because
[watch-coverage.md](../orchestration/watch-coverage.md) must give each a
coverage decision (`orchestration/tests/coverage-fixture-cases.mjs` reads
these rows).

| Script                                 | Does                                                                                                                                                                                               | When                                     | Safety                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `trainNq.sh` (the merge train)         | Keeps up to 5 pull requests in the merge queue, in the order file's order, after checking the head is unchanged, it merges clean with `main` and every queued head, and touches no shared hot path | A pass every 2 minutes, wall 110 minutes | A queue read error skips the pass; a moved head or conflict fails the entry and the lane logs READY again; one re-queue per pull request |
| `wait-keyN.sh`                         | Blocks until the log gains a line the orchestrator must read, prints those lines and a tick summary                                                                                                | Each tick                                | Writes only its mark file                                                                                                                |
