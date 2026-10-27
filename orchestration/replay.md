# Synthetic round acceptance replay

Run `node orchestration/replay.mjs` for the JSON report, or
`node --test orchestration/tests/round-replay-cases.mjs` for the acceptance
assertions. Refs #129; map #121; spec #123 stories 4, 11 and 26.

This runs the real `watch.mjs` CLI for merge stall, lane watch and landing
assessment. Each incident gets an isolated temporary round, copied log and
persisted state. Every subprocess sees a PATH containing only fake gh, git
and herdr executables. Unknown commands fail; no live GitHub, pane, queue or
round tool is read or changed. Temporary directories are removed on exit.
The checked-in source and a read-only snapshot are verified unchanged.

The round is synthetic: it is dated 1 January 2000, its lanes are
`EXAMPLE-001` onwards and its pull requests are numbered from 1001. The
intervals between its records are kept, so the watchers see realistic
timing. The grammar fixture (`tests/fixtures/round-2000-01-01.events.log`)
spans 1–3 January and is the full format-drift test. This replay adds a
signal projection of the first day:

- `tests/fixtures/round-2000-01-01.replay.log`: 424 structured signal records;
  lane labels, timestamps, event words and primary PR numbers only. Heads
  are repeated hexadecimal `a` characters. There are no names, email, hosts,
  paths, secrets or prose. It is a signal projection, not a complete
  merge-count or queue ledger.
- `tests/fixtures/round-2000-01-01.replay.json`: seven merge intervals and a
  queue observation for each. Cause fields contain structured labels only;
  their explanations are in the results table below.

At each boundary the log contains only records up to that time. Fake GitHub
reads supply the recorded newest merge and queue count; one recorded READY
PR represents the open set. Synthetic passing checks and an approved CLEAN
head let landing assessment identify that candidate's recorded owner. This
proves selection and trigger behaviour, **not reconstruction of every live
PR gate or oldest PR in the full queue**. The assertions check the selected
PR as well as its owner. Production selection/gate cases remain in the
landing suites. Queue observations precede each tested boundary; their state
is carried forward until the next merge. No intervening complete queue
history is available.

For lane watch, the idle lane EXAMPLE-012 starts at 04:48:27; its last event
is BATCHES-READY at 11:17:40; its wrap is at 14:02:12, about 2 h 45 min
later. Commit and push timestamps are set to the last signal, and an idle
pane is supplied. The log has no branch-tip, push-feed or pane snapshots.
These explicit fake assumptions prove that the kit reports the silence
within 30 minutes; they do not establish what a commit or push would have
shown. At 11:47:39 the output is OK; at 11:47:40 it is SUSPECTED-STALL with
all three ages 30 and reason no-event+no-commit+no-push.

## Results and false alarms

Every gap of at least 45 minutes between consecutive merge batches in the
projection is represented below. The incomplete trailing interval is
excluded.
Times are UTC. Each flag fires at 45 minutes, is absent one second earlier,
and is suppressed on the next pass in a fresh CLI process. Landing
assessment fires for the same interval and names the supplied READY owner.
An old merge with no queued or CLEAN work reports EMPTY-QUEUE.

| Interval | Last merge | Flag     | Next merge | Waiting PR | Cause                                  |
| -------- | ---------- | -------- | ---------- | ---------- | -------------------------------------- |
| gap-1    | 00:29:36   | 01:14:36 | 01:15:23   | #1006      | Flaky check; requeued once             |
| gap-2    | 03:26:40   | 04:11:40 | 04:22:43   | #1007      | Slow shard passed without a requeue    |
| gap-3    | 04:22:43   | 05:07:43 | 05:12:18   | #1012      | Rebase and a conflict                  |
| gap-4    | 06:37:32   | 07:22:32 | 08:28:46   | #1039      | Test failure, then a fix               |
| gap-5    | 09:08:46   | 09:53:46 | 10:27:13   | #1049      | Queue CI still progressing, then green |
| gap-6    | 11:08:09   | 11:53:09 | 12:10:27   | #1056      | Review asked for changes               |
| gap-7    | 12:55:37   | 13:40:37 | 14:25:33   | #1076      | Conflict, then a wait for review       |

Flags: **7/7**. False actionable alarms: **2**, listed explicitly:

1. **gap-2:** the shard ran close to its time limit and passed without a
   requeue. A stalled merge clock did not mean that the job was hung.
2. **gap-5:** the queue CI was still in progress at the flag and later
   passed. The merge-age predicate alone could not establish a hung job.

Both are true no-merge-threshold findings; they are counted conservatively
as false alarms for intervention. Classification is part of the scenario,
not inferred by the watcher. It does not prove that all possible
false alarms over every minute of the round have been enumerated. The
bounded replay tests boundary samples for all seven complete intervals.

The idle and seven-stall acceptance tests were written and run before the
replay module, and both failed with a missing module. The existing watcher
implementations needed no repair. A directory entry point discovers every
`*-cases.mjs` suite so `node --test orchestration/tests/` works on Node 24
and later without launching all one-second fixture reads concurrently. The new tests also validate every
projected line, privacy shape, temporal evidence and read-only execution.
See the [old-check coverage table](watch-coverage.md) for replacement gaps.
Adopt the production kit only at a new round boundary; this replay switches
on no current watcher, loop or skill. #131 owns retirement after review.
