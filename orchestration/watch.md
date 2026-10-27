# Watch command

`watch.mjs merge-stall` runs one report-only pass. It follows the merge check
in the director's patched kick script, without its pane actions.
`watch.mjs lane-watch` reports suspected lane stalls and recorded waits.
Landing assessment and arrival cap are described below; the touches check
is described in the orchestration README.

```sh
node orchestration/watch.mjs merge-stall \
  --repo OWNER/REPO --round /path/to/round \
  --settings orchestration/watch.settings.json
```

The round must already contain `events.log`. The pass appends to that file
and writes `merge-stall.state.json` beside it. `--state FILE` selects another
state file whose parent already exists. Settings, log and state paths must
be distinct. It creates no directories and performs no GitHub mutations or
pane reads/actions. Run passes sequentially from a shell loop; do not overlap
passes sharing a log or state file.

The settings file is [`watch.settings.json`](watch.settings.json). `mergeStall.minutes`
is the positive no-merge threshold (45 in the shipped settings), and
`mergeStall.githubTimeoutMs` is the positive integer timeout for each GitHub
read. `mergeStall.githubMaxBufferBytes` is its positive integer response-size
limit (64 MiB in the shipped settings); exceeding it reports UNKNOWN. All
three are required. `--settings` defaults to the shipped file. No
threshold falls back to a code constant. `--now YYYY-MM-DDTHH:mm:ssZ` selects
a clock for fixture replay; ordinary operation uses UTC now.

## Reads and outcomes

Three read-only `gh api` calls supply the newest merge, queue size and CLEAN
PR count. Closed PRs are paginated through REST and the maximum `merged_at`
is selected across all pages: update order is not merge order. Open PRs are
paginated through GraphQL and counted by `mergeStateStatus`. The queue comes
from `mergeQueue.entries.totalCount`; an explicit null queue means no queue
is configured. Missing data, malformed JSON, GraphQL errors, an unresolved
merge state, truncated open-PR pagination, invalid/future merge times, a
timeout or a nonzero `gh` exit produce UNKNOWN. The kit does not read tokens
or print GitHub response text.

The decision order is:

| Outcome      | Condition                                                                  |
| ------------ | -------------------------------------------------------------------------- |
| UNKNOWN      | A required read, settings or state could not be trusted.                   |
| EMPTY-QUEUE  | No queued entries and no CLEAN PRs, including before the first merge.      |
| NO-MERGE-YET | Work waits, and GitHub reports no previous merge.                          |
| STALL        | Work waits, and the newest merge is at least the configured threshold old. |
| OK           | Work waits, and the newest merge is younger than the threshold.            |

Every emitted line uses `WATCH MERGE-STALL`, imports the shared parser and
passes the [event grammar](events.md). Successful readings carry `repo`,
`queued`, `clean`, `last-merge`, `age-minutes` and `threshold-minutes` fields.
UNKNOWN carries a fixed reason rather than raw errors. Its exit status is 1;
other outcomes exit 0. Invalid CLI options or a failed report/state write
exit 2 and print a fixed diagnostic to stderr.

## Persistent stall reporting

The versioned state file records repository and the merge timestamp already
reported as stalled. Repeat passes, including fresh processes, suppress that
same stall. A new merge starts a new interval; OK, EMPTY-QUEUE and
NO-MERGE-YET clear the active stall. UNKNOWN preserves state. Other outcomes
are reported each pass.

The pass appends before saving state. It also parses previous watcher lines
from the round log to recover a stall after a lost state file or a failure
between append and save. MERGED prose in the log never supplies merge age or
queue health. Corrupt state is UNKNOWN. An unterminated log is refused
instead of joining a new report to its last event.

## Verification and adoption

```sh
node --test orchestration/tests/watch-merge-stall-cases.mjs
```

The suite drives the CLI through a fake `gh`, a pane-action trap, a copied
log and persisted state. It checks status lines with `parseEventLine`.

Adopt this command only at a round boundary. To verify it during a running
round, copy `events.log` to an isolated round directory, keep the source
snapshot read-only, and point `--round` at the copy. Do not attach it to the
live round's kick script, loops, waiters or tools.

## Landing assessment and arrival cap

```sh
node orchestration/watch.mjs landing-assessment --repo OWNER/REPO --round /path/to/copied-round
node orchestration/watch.mjs arrival-cap --repo OWNER/REPO --round /path/to/copied-round
```

Both subcommands use the same path, clock and settings options as merge-stall.
They read live GitHub metadata and parsed READY records from the copied round
log. They append reports only to that copy and write their own
`landing-assessment.state.json` or `arrival-cap.state.json`; they never
change GitHub, enqueue/dequeue PRs, dispatch lanes or act on panes. Preserve
an immutable source snapshot when testing during a live round.

The same settings file provides `landingAssessment.minutes` (45 in the
shipped settings) and `arrivalCap.ready` (4 in the shipped settings, a
positive integer). Each
section also requires positive integer `githubTimeoutMs` and
`githubMaxBufferBytes`. Missing or invalid settings produce UNKNOWN rather
than falling back. Each pass paginates open PRs and reads the live queue.
Assessment also selects the newest actual merge across closed-PR pages.

READY announcements identify the PR and its owner actor. The first READY in
an active waiting interval supplies its age, even across later head updates;
an incomplete correction preserves its owner and head. Closed PRs and READY
records for an older head are excluded. A 7–40 character READY head must match
the prefix of GitHub's full head SHA; assessment reports the full SHA.
MERGED, CLOSED, DROPPED, HELD, HOLD and PARKED PR announcements withdraw READY;
a later READY starts a new
interval. WRAPPED leaves a finished lane's PR waiting to land. Records with
an explicit `repo` for another repository are ignored; legacy records
without `repo` belong to the repository selected for this round.

Predecessors are declared on a READY record as `predecessors=12|34` or in the
PR body on a line `Depends-on: #12` or `Predecessors: #12, #34`. These refer
to PR numbers in the selected repository. A predecessor still present in the
complete live open-PR set blocks assessment selection; a closed predecessor
does not. Invalid declarations produce UNKNOWN. The assessment sorts by
READY timestamp (PR number breaks ties), then selects the oldest candidate
without an open predecessor. Being independently landable means no open
predecessor; its gates can still need work.

At the configured no-merge threshold, `WATCH LANDING-ASSESSMENT ASSESS`
names `pr`, exact `head`, `owner`, `ready-since` and `gate`. Gates are `hold`
(labels `hold`, `held` or `factory/held`), `conflict`, `review` (draft or
required/changes-requested review), `required-check`, `branch-update` (BEHIND),
or `ready` when no gate remains. Hold takes precedence over conflict, then
review, then checks, then branch update.
Required checks come from `gh pr checks --required`; a nonpassing check is
named in the percent-encoded `check` field. The head is reread after check
reads so a changing head produces UNKNOWN. A blocked PR with no identifiable
gate or unresolved candidate mergeability also produces UNKNOWN. This is an
assessment, not authorization to merge; exact-head Sol approval and every
required context remain the orchestrator's merge gate.

Assessment reports `OK` before the threshold, `NO-MERGE-YET` when GitHub has
no previous merge, `EMPTY-READY` when no READY work waits after the threshold,
and `NO-INDEPENDENT-READY` when every candidate has an open predecessor.
Reports include the live `queued` count and merge timestamp. Local MERGED
prose does not decide whether the threshold has been reached.

`WATCH ARRIVAL-CAP CAP-HOLD` reports that waiting READY PRs are at or above
the configured number; `CAP-OPEN` reports below it. Both are report only: no
variant caps open pull requests, so neither holds a build
([METHOD.md](../docs/METHOD.md#seats-lanes-and-stops)). `ready` and `cap` give
the counts, and `closing` lists every waiting PR and owner, oldest first, as
`12:BUILDER-A|34:BUILDER-B` (`none` for no waiting work). Dependencies and
gates do not reduce this count. The watcher is adopted at a round boundary,
leaving current tools, loops and waiters running.

Identical reports are suppressed across fresh processes. Changed gates,
waiting PRs, thresholds or merge intervals produce a fresh assessment or cap
report. Versioned state stores a report signature; the log recovers the
append-before-state crash window or a lost state file. If the log loses the
report, a state signature alone does not suppress fresh evidence. UNKNOWN
always reports and preserves prior state. Invalid state, malformed API responses, incomplete
pagination, failed commands and failed required reads produce UNKNOWN (exit
1). Refused paths/options or failed report/state writes exit 2, as above.

```sh
node --test orchestration/tests/watch-landing-cases.mjs orchestration/tests/watch-landing-regression-cases.mjs
```

The fake-gh tests exercise the CLI, fixture log, grammar, transitions,
pagination, failed reads, restarts and the absence of mutation/pane commands.

## Lane watch

`watch.mjs lane-watch` runs one pass over working lanes, using the shared
parser. It appends `WATCH LANE-WATCH` reports and writes only its own
`lane-watch.state.json`. It never sends text or keys, closes panes or
workspaces, invokes a reaper, or changes lane records. The merge-stall
subcommand and its settings remain compatible.

```sh
node orchestration/watch.mjs lane-watch \
  --repo OWNER/REPO --round /path/to/isolated/round
```

As with merge-stall, use an isolated copy of the round log during the live
round and adopt the kit only at the next round boundary. Keep the original
snapshot read-only. Run passes sharing a log/state sequentially.

### Lane records and settings

`--lanes FILE` defaults to `ROUND/lanes.json`. The file is a read-only round
record, version 1, with a `lanes` array:

```json
{
  "version": 1,
  "lanes": [
    {
      "id": "BUILD",
      "status": "working",
      "branch": "feat/build",
      "worktree": "/path/to/lane/checkout",
      "pane": "wBuild:p1",
      "startedAt": "2026-10-14T01:00:00Z",
      "lastPushAt": "2026-10-14T01:15:00Z"
    }
  ]
}
```

IDs are unique event actors. `status` is `working`, `ready`, `parked` or
`wrapped`; only working records are assessed. The worktree and branch name
identify the local branch, including commits that have not been pushed.
Git validates literal branch names with `check-ref-format --branch`; valid
punctuation and Unicode names are accepted. Checkout shorthand is refused.
`startedAt` is the UTC start of this lane instance. Update it when reusing a
lane label. `lastPushAt` is an optional recorded successful push time; keep
it current when available. Without a recorded push, the instance start is
the baseline for a branch that has not yet pushed. All records in a pass
belong to the repository supplied with `--repo`.

`laneWatch.minutes` is the positive silence threshold, shipped as 30.
`laneWatch.readTimeoutMs` and `laneWatch.maxBufferBytes` are positive integer
limits on each gh, git and herdr read. They are required, with no fallback
threshold. `--now`, `--settings` and `--state` work as above. Log, settings,
lane-record and state paths must be distinct, including symlink targets.
An unreadable lane-record file is UNKNOWN with `lane=unknown`.

### Signals and reasons

The pass reads these three signals:

- The latest known event from the lane actor, at or after its instance
  start. WATCH reports and unknown prose do not count as activity.
- The local branch tip's committer time from `git log --no-walk`. It reads
  the named branch, without fetching, switching branches or changing files.
- The latest observed PushEvent for the exact branch from paginated
  `gh api repos/OWNER/REPO/events`, combined with `lastPushAt` and the
  instance-start baseline. Commits and pushes are distinct signals.

GitHub's [event feed](https://docs.github.com/en/rest/activity/events) is
limited to 300 events and 30 days, and can lag by 30 seconds to 6 hours.
This is evidence for a suspected stall, not proof that no push occurred.
Record successful push times in the lane records to cover feed lag. A
saturated feed whose oldest event cannot cover the configured silence
window is UNKNOWN. Long replay windows require recorded push evidence;
the feed cannot reconstruct events beyond its retention period.

The command reads `herdr pane list` once. A matching pane supplies its
working, blocked, idle or done state. A successfully read list without that pane
supplies `absent`; an unknown target status produces UNKNOWN.

Explicit records explain ordinary silence:

| Record                                         | Reason on the report |
| ---------------------------------------------- | -------------------- |
| `RUN-START tool=NAME` or `WAITING reason=tool` | `long-running-tool`  |
| `WAITING reason=review`                        | `review-wait`        |
| `PAUSED reason=owner`                          | `owner-pause`        |

These reasons persist until BOOTED, PROGRESS, PUSHED, FIX-PUSHED, READY,
WRAPPED or PARKED records the next activity/state. They are reported as
WAITING, including when all signals are silent, without a stall verdict.
`DONE tool=NAME` also clears a matching tool wait (or a tool wait without a
recorded name); it preserves owner pauses, review waits and waits for another
tool. A completed tool therefore cannot suppress a later silent interval.
Physical log order distinguishes boots in the same second. Other lanes'
records never set the reason or event age.

### Reports and persistence

All three signals must be at least `laneWatch.minutes` old for
SUSPECTED-STALL. Its reason is `no-event+no-commit+no-push`. OK means at least
one observed signal is newer; it does not certify lane health. WAITING
names the recorded reason. Reports include each age, threshold and pane
state. Failed, timed-out, oversized, malformed or future-dated reads are
UNKNOWN for the affected lane and exit 1. Unknown reads never clear an
existing stall. Options or failed writes exit 2.

State identifies the repository, lane instance and last reported silence
interval. Repeat passes and fresh processes suppress the same suspected
stall. New activity, a new instance or a same-second BOOTED line permits a
new interval. Reports append before state is saved; shared-parser recovery
from the log handles a lost state file or an interrupted save. Corrupt
state is UNKNOWN. Report writes refuse an unterminated log.

```sh
node --test orchestration/tests/watch-lane-cases.mjs
```

The tests execute the CLI with fake gh, git and herdr commands and copied
logs. See the [17-defect coverage table](watch-lane-defects.md) for the old
watchdog/reaper gaps and their tests or scope exclusions.
