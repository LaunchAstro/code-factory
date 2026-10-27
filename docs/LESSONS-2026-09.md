# Lessons, September 2026

What went wrong while building Ops Astro's core on 28 and 29 September 2026,
and the rule each incident left in [METHOD.md](METHOD.md). One or two lines
each.

The evidence sits in that build's round folder, which is private and not in
this repository: `events.log` (cited by line), the owner's instruction files
(`NATHAN-<TOPIC>.md`), `COMPRESS-OPTIONS.md` and `consensus/CONSENSUS.md`, and
the session records of those two days.

## The owner and the flow

- **Routine questions stalled the build for hours.** The chain sat 25 minutes on
  two answers the agents could have given. Rule: standing permission, each call
  logged as `ORCH-DECISION`. (`NATHAN-STANDING-PERMISSION.md`)
- **Protected parts waited overnight for the owner's acceptance.** Rule:
  standing acceptance; a reviewed, passing result is the final yes.
  (`NATHAN-OVERNIGHT-2.md`, `NATHAN-STANDING-ACCEPTANCE.md`)
- **The plan was too big to finish at the measured pace**: about 937
  estimate-days and 620 pull requests. Rule: finish the core, then recut the
  rest into slices and batches, one stage at a time. (`COMPRESS-OPTIONS.md`
  sections 1 and 7)
- **The orchestrator closed the owner's chat pane twice** while the owner was
  still talking to it, because the pane logged DONE. Rule: agents never close
  an owner-chat pane. (`NATHAN-PANES.md`)

## Review

- **A fix closed less than the reviewer meant**: tests covered business to
  business but not client to client, twice in one day. Rule: every finding comes
  with Sol's failing proof test, applied unchanged. (`NATHAN-SOL-TESTS.md`)
- **Separation tests were too thin to prove anything.** Rule: every test names
  each boundary: business, client, person. (`NATHAN-PROCESS-FIXES.md` item 4)
- **Tests that didn't prove their claim** were raised in 40 of 100
  changes-requested results. Rule: the builder checklist, run before review;
  a green suite is not proof. ([CHECKLIST.md](CHECKLIST.md); `CONSENSUS.md` 2.3)
- **A ticket's wording changed after review began**, and the next review read
  the old text. Rule: every Sol prompt carries the current ticket.
  (`NATHAN-PROCESS-FIXES.md` item 5)
- **Eight Sol passes on one hand-written reader of pull-request bodies**, each
  pass finding another Markdown layout that hid a field. Rule: use a real
  parser, not line patterns; the fix was a Markdown library, and the first
  kit's round 7 taught the same. (`events.log` 832, 867, 925, 1077, 1093)
- **Uniform review ceilings versus slices of very different size.** One 30-minute
  session cannot be assumed to cover a big slice. Rule: a ceiling reached is a
  hold with the unread part recorded, never an approval. (`CONSENSUS.md` 2.3)

## Merging and checks

- **Up-to-date rebase churn.** 60 rebases, 42 Sol re-checks, and a 26-minute
  test run each time `main` moved; 28 approved pull requests waited, median 4.4
  hours from approval to merge. Rule: keep the rule, remove the churn: group
  merges now, one merge per batch later. (`COMPRESS-OPTIONS.md` sections 1 and 4)
- **An unrelated merge put a ready chain ticket behind** and cost it a catch-up
  cycle. Rule: keep `main` still while a chain merges. (`events.log` 1211)
- **CodeQL never ran on a head pushed while its pull request targeted a stack
  branch**, and closing and reopening did not trigger it. Rule: prove every
  required check runs on the batch pull request route before batch 1.
  (`events.log` 1895, 1978 to 1981; `CONSENSUS.md` 2.4)
- **A stacked branch drifted**: it was built on an older head of the ticket
  below it, so its derived test ledger compared against the wrong base. Rule:
  after the lower ticket merges, rebase onto `main` and rebuild derived files
  there. (`events.log` 2320)
- **The size gate never fitted.** Nearly every core fix needed a waiver, and 30
  tickets were cut into 141 parts to stay under it. Rule: 400 lines is a guide,
  never a gate. (`COMPRESS-OPTIONS.md` sections 2 and 3)
- **The size check counted moved lines as new**, and one per-file cap had no
  waiver at all. Rule: measure moves as moves. (`events.log` 1514)
- **A stale review-evidence job blocked merges, and editing a description re-ran
  the whole suite.** Rule: check evidence once, at merge; a description edit runs
  only the evidence job. (`COMPRESS-OPTIONS.md` section 4, drag 5;
  `NATHAN-PROCESS-FIXES.md` item 3)
- **Faster CI by sharding was proposed** and cancelled because it burned tokens.
  Rule: no extra work only for speed. (`NATHAN-MERGE-SPEED.md`)

## The fleet and the machine

- **Counting open panes instead of working lanes.** An orchestrator sat "full"
  at its cap with two lanes working; the rest were idle or finished. Rule:
  count working lanes; floor of 6. (`NATHAN-MORE-PANES.md`; `events.log` 1453)
- **Lanes stopped silently** after their security review printed, with no pull
  request opened. Rule: every brief says to carry on in the same turn; nudge
  within 10 minutes. (`events.log` 714, 988)
- **The orchestrator missed events while its watch was down or waiting on the
  wrong thing**: a pushed fix sat 45 minutes, four events sat 18. Rule: wait
  on events, one wait at a time, and act on everything pending after each wake.
  (`events.log` 878; `NATHAN-PROCESS-FIXES.md` item 2; the orchestrator
  session records)
- **`pkill -f vite` in one lane killed five lanes' test runs**, because every
  lane runs as the same user. Rule: stop only your own processes, by PID.
  (`events.log` 1300, 1301, 1313)
- **The disk filled and took Docker down for about 40 minutes.** Leaked test
  containers' volumes and temp folders added to a large outside cause. Rule:
  tests clean up after themselves, a suite fails if it leaves anything behind,
  and new worktrees pause under 20 GB free. (`events.log` 1371 to 1399;
  `NATHAN-DISK.md`)
- **One lane's database start changed the shared password**, and roles another
  lane left behind turned every lane's tests red. Rule: tests that change shared
  database state get their own cluster or an exclusive slot, and lanes drop
  what they create. (`events.log` 1292, 1303; `NATHAN-INB1D-LESSONS.md` item 4)
- **Many small lanes hit shared limits**: 79 lane closes in 23 hours, the disk,
  the shared database's memory. Rule: fewer, bigger lanes after the core.
  (`COMPRESS-OPTIONS.md` section 2)
- **A pane was closed while it was still writing its final message.** Rule:
  wait for the pane to read `done`, then verify the wrap-up by file.
  (`events.log` 273)

## Secrets

- **Keep secrets in hidden fields.** Rotate any token exposed in a transcript
  before copying that transcript.
