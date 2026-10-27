# The method

How a large product gets built by agent lanes, so it comes out as solid as
possible whoever drives it, programmer or not: tests first, an independent
review and the merge gate. The owner is the person the product is for. New to
the repository? Read the [reading order](../README.md#where-to-start) first.
[FLEET.md](FLEET.md) sets who does what: the shape of the work, the roles,
review, models, switch-ons, paperwork and the work map's ledger. This file
holds the build mechanics FLEET.md leaves out. Where the two disagree,
FLEET.md wins. One agent on one problem is single mode instead
([SINGLE.md](SINGLE.md)).

It is the one build method for every project. The fleet skills (`director`,
`orchestrator`, `build-review`, `sub-agents`) state their own never-rules
inline and link here for the rest. Model choice comes from your own model
list.

The build teaches this file, never the reverse. Nothing stays here that the
build doesn't do. Anything marked **unproven** has not been measured yet.
Dropped rules and why are in [HISTORY.md](HISTORY.md#dropped-and-why); check
there before bringing one back. Changes follow
[FLEET.md](FLEET.md#how-this-changes).

## What reaches the owner

**Standing permission.** The orchestrator decides every routine build
question (size, rule clashes, splits, ticket wording, order inside a wave,
disputes) and mentions it at its next check-in, in the state note (below),
never as a question. The owner can reverse any of them.

**Standing acceptance.** A piece merges on its passed review, green required
checks and its [three description lines](FLEET.md#paperwork-four-things-per-agent-nothing-else),
through the merge script (GitHub's merge queue where the repository has one),
without waiting on the owner.

Only these reach the owner, batched, one line each with a recommendation:

- a real client-data, money or credential problem the agents cannot fix;
- anything that spends money or cannot be undone;
- cutting a capability, or a restructure bigger than about a unit of work;
- the stage reviews, where the build pauses while the owner tests;
- a decision the plan names as the owner's;
- a piece at twice its budget ([FLEET.md](FLEET.md#the-work-maps-ledger-and-budgets-scripts-not-agents)).

**Where the orchestrator's check-ins go.** The orchestrator reports to the
owner only the items above. Its check-ins, dispatch lines, cost and fill
lines, section and round reports, and every hold or blocker that is not one
of the items above go to the state note, which the director reads on each
check. The owner can still read it there.

A question the recorded decisions already answer is never asked again. The
owner's hands-on steps go as one batched list, each with its exact click path.
Secrets move through the password manager, never printed.

## Before the build: plan deep

Plan deep, build in bulk, edit in post. A wayfinder map becomes a spec, then
tickets, then build units in waves, each unit owning its own files. Sol
reviews the plan before ticketing and each ticket after. Plan review stops
once only minor or far-fetched findings remain. Nothing is built until the
owner says go.

**The route** is the same in both modes. Map everything, turn it into
tickets and a spec, then build.

1. `wayfinder` charts the map and its decision tickets, the owner's words
   quoted in each.
2. `to-spec` writes one spec per repository.
3. `to-tickets` cuts tracer-bullet tickets with native blockers.
4. The build, `single-agent` ([SINGLE.md](SINGLE.md)) or the fleet.
5. `close-out`.

Every map, spec and ticket body carries a `Section: <id>` line, or
`Section: outside` for work on no map, so the work map places it the moment
it exists ([issue tracker](agents/issue-tracker.md#ticket-and-section-declarations)).
A settled job, or a copy change, starts at step 4.

**Offer a work map before a big build.** Before step 4, if the project has no
work map yet, the agent offers one to the owner in one line, with its
recommendation, when any of these hold: 20 or more tickets, a fleet build
with more than one lane, or a build expected to run past one sitting
(overnight, or about 8 hours or more). On the owner's yes, the map is set up
as its own tab beside the others ("Add another project" in the work map's
README). A smaller job gets no offer.

**Everything on the map.** Work the map doesn't show doesn't exist for the
owner. When `wayfinder` creates a project's tickets, each ticket body carries
`Section: <id>`, with an id from the project's work map. Pull requests
already carry theirs ([issue
tracker](agents/issue-tracker.md#ticket-and-section-declarations)). A work
map isn't done at setup until its header reads 0 tickets, 0 PRs and 0 files
not placed (`progress.notPlaced: "sections"` in its config shows those three
counts), so it never counts plan units the map doesn't use.

Each piece is tagged **ordinary** or **sensitive** at ticketing, because
FLEET.md's builders and reviewers follow the tag. A piece is ordinary only if
it has clear acceptance tests, about 300 product lines or fewer, and touches
none of: sign-in, money, data separation, authority, migrations, locks,
retries, concurrency or secrets. Everything else is sensitive. When unsure,
it is sensitive. This list picks builders and reviewers only. Sol's effort
comes from [SOL-EFFORT.md](SOL-EFFORT.md#high-risk)'s own list.

## Done means switched on

Merged code can still need a separate switch-on step.

1. Every unit and ticket names its switch-on step: what turns on, who does it,
   and any owner cost or decision. Merged but not switched on is owed, not
   done.
2. The orchestrator plans switch-on lanes alongside build lanes, not after
   everything.
3. How to switch on is in [FLEET.md](FLEET.md#switch-ons-and-deploys).

## Building on `main`

1. **Pieces straight to `main`.** Each piece branches from `main` and lands
   on `main` within hours, through the merge script (GitHub's merge queue
   where the repository has one), which is `main`'s only gate. Branches live
   hours, not days. A piece that other pieces depend on lands first. Chain
   tickets land in their stated order.
2. **A first core goes slowly.** The foundation a new product stands on is
   built one ticket per pull request, in strict order, each through the full
   review, before any parallel building on top of it.
3. **Dark until finished.** A capability not yet whole lands behind a switch
   (a feature flag), off in production by default, naming its owner, when it
   turns on, an expiry and a removal ticket. Off stops the feature's routes,
   jobs and other effects, not only its screens. Every piece tests both states
   through real entry points. A switch never hides a migration.
4. **No shared hotspot files.** A file every lane edits is split per area,
   one writer per area file (the named-suites list and the lint baseline are
   the usual ones). A new lint exemption is reviewed as a policy change.
5. **Migrations** are numbered by UTC timestamp, duplicates refused. Each
   names its prerequisites, which land first. Only an unlanded migration is
   renumbered, never an applied one. Each proves a fresh install, an upgrade
   from the deployed schema and running code with its feature off.
6. **Carried approvals.** This is the one carry rule. The variants and skills
   point here. After a rebase onto `main`, a passed review carries to the
   new head only when `git range-diff <old-base>..<approved-head>
   <new-base>..<new-head>` shows every commit identical. That carry reaches
   the merge script only through a quick Sol range-diff check of the new
   head, or through a carry tool that checks it, once the repository has one.
   Never post a `Sol verdict` status by hand. Anything else gets Sol's narrow
   check of what changed, and Sol re-runs the proofs that change touches.
   That covers a product-line change, a resolved conflict, a merge of `main`
   whose conflicts are only test lists, counts or migration numbers, and an
   empty commit. A carry is never a build proof. The full run on the exact
   combined head still runs.
7. **Capability review before the switch turns on.** Sol reads the whole
   capability (its landed pieces, changed dependencies and end-to-end proofs)
   for [the five classes](#what-review-always-covers), naming the scope read
   and the exact head. Unread scope, a missing proof or an open correctness
   finding keeps the switch off. A whole-capability read finds defects that
   per-piece reviews pass.

## Sol review effort

Both fleet and single mode follow [SOL-EFFORT.md](SOL-EFFORT.md): `medium`
for every review except those on [its high-risk list](SOL-EFFORT.md#high-risk),
which use `high`. This is independent of build variant and the
ordinary/sensitive tag. Keep a high-risk PR at high effort through its narrow
fix reviews. The assigned shim selects the effort explicitly. Review rounds
and merge gates are unchanged.

<a id="build-speeds"></a>

## Build variants

Every build runs one of three variants, named in its brief and binding
message.

| Variant | For | Rules |
| --- | --- | --- |
| **Hardened production** | Code a defect in could reach the public: public, used by clients, more than one tenant, or moving money | This file, unchanged: [hardened-production.md](variants/hardened-production.md) |
| **Production** | Private production code for the owner or their own team, on their own machines or private network, run on real data and kept | [production.md](variants/production.md) |
| **Prototype** | Throwaway code on made-up or public sample data, nothing deployed or kept | [prototype.md](variants/prototype.md) |

**Picking one.** At the start of a build, ask in order. The first yes wins.

1. Can anyone outside the owner and their own team use it or reach its data,
   or does it move money? Hardened production. Anything reachable from the
   internet counts, even behind a sign-in, since a sign-in defect would
   expose it.
2. Will it run on real data or real files, or be kept and relied on?
   Production.
3. Otherwise, prototype.

Unsure between two means the stricter. The variant is the owner's call. The
agent offers its pick with a one-line reason before the build, and the
owner's answer is recorded. Nobody picked means hardened production. A
prototype never starts without the owner's yes.

**The same in every variant**, the five checks the owner sees:

1. Only [what reaches the owner](#what-reaches-the-owner) reaches them,
   batched, one line each with a recommendation.
2. Every pull request carries its `Why:`, `Left undone:` and `Closes #n`
   lines ([FLEET.md](FLEET.md#paperwork-four-things-per-agent-nothing-else)).
3. The secrets sweep and the client-material sweep run on every push.
4. Nothing is spent, deleted or undone without the owner's yes.
5. [Done means switched on](#done-means-switched-on), with the owner's test
   step at a stage end.

**Other names.** `slow` means hardened production in briefs and boot files.
READY lines carry `variant=hardened` or `variant=production`. A
`speed=slow` means hardened. The `Speed: slow` line in Sol's prompt is fixed
text and names no variant, since Sol reviews the same way in both variants
that have Sol. A brief that names `medium` or `fast` runs as hardened
production and tells the owner in one line. A piece on `main` does not by
itself allow client data in an unfinished capability.

## Where the full tests run

- **Where.** A public repo runs CI on GitHub's hosted runners, never on a
  self-hosted runner, which an outside pull request's workflow could reach.
  Hosted minutes on a private repo are spend under a hard budget, so private
  repos run on the approved local runner. The check machine may host it for
  private repos only, in an ephemeral unprivileged container with no host
  mounts, fork workflows off, one job at a time.
- **What.** A pull request runs the light checks: the fast checks and the
  tests its change touches (unknown scope runs everything). Every required
  check name still reports, so the queue accepts it. The merge queue runs the
  full set on the exact combined head. A result from another head never
  counts. Slow optional jobs run nightly, never on the merge path. No test,
  suite or assertion is dropped to go faster. A CI change proves the same
  named-suite count and test totals before and after.
- **Locally,** a lane runs only touched files' tests, types, lint and the
  secrets sweep, without asking anyone first. A local full run goes through
  the machine-wide check queue. Shared database tests take an exclusive lease.
- **A queue drop.** The merge script re-queues once, then hands the piece back
  to its lane ([FLEET.md](FLEET.md#roles)). The lane reproduces the failure
  and either fixes the defect or proves an infrastructure fault. Re-queuing an
  unchanged head a second time is not a fix.
- **Rehearse before light checks.** A project moves to light checks only after
  a throwaway queue run proves every required check runs in the queue, a
  failing or missing result blocks landing, and stale evidence is refused.
  CodeQL and DCO need care ([queue traps](CI-CHECKS.md#queue-traps)).
- **Slow CI.** Read per-job times (`gh run view --json jobs`) before adding
  machines. Keep each job under about 10 minutes. A longer suite splits into
  shards behind one aggregate check, with the same tests.
- **Local full runs in parallel.** A local full run runs independent test
  files side by side, bounded to the machine (Rust: `cargo nextest`, or a
  bounded runner over `cargo test --no-run`). Tests on an exclusive resource
  keep their lease. When a full run passes about 10 minutes, read per-file
  times before adding machines or rules, since a few slow files are often
  most of it. Investigate a failure that shows only in parallel and fix its
  cause. Never skip the test.
- **Queue hygiene.** A push to `main` skips the full set when the merge group
  already tested the same tree, except the one run once the queue empties. A
  red there stops the line. Only a pull request next in line for review or
  the queue keeps its light-check run. Queue width = measured runner slots /
  jobs per group.

What each check guards, costs and catches: [CI-CHECKS.md](CI-CHECKS.md).

## The merge pipeline

- **Pre-check first.** No pull request enters the queue without a green
  pre-check on its exact head. The pre-check runs the queue's full check set
  on our own machine, on the head merged onto latest `main`, and posts the
  result as a commit status. No fallback. Entries already queued are
  pre-checked too. A red is dequeued before it reaches the front.
- **Critical path alone, the rest in threes.** A piece on the deadline's
  critical path (the round's top tier) pre-checks alone, in parallel, as soon
  as it is ready, on hosted runners when the repo is public (free minutes) or
  in a free machine slot. Other pieces pre-check in groups of at most 3, from
  the queue's next-to-build entries backwards. A red group splits over its
  suspects. Every green enqueues within 5 minutes. Every red gets a fix lane
  within 15. Larger groups stall the line, since one red member holds all the
  others.
- **Big runs by machine.** A big run is a pre-check group, a full suite, or a
  Postgres or Docker run.
  - **The check machine** (18 cores) runs up to 4 at once while it reads
    under 0.8 load per core with at least 12 GB free. Past either line nothing
    new starts and running ones carry on. Its first-come queue
    (`orchestration/m5/checks/check-queue.py`) enforces part of this today: 3
    slots, and while another run is active, the 0.8 line and 2 minutes after
    the last start. A run into an empty queue starts regardless of load. The
    queue does not check free memory, and its default mode is shadow
    ([its README](../orchestration/m5/README.md)).
  - **The owner's machine takes no big runs.** No full checks, test suites,
    Playwright runs or builds on the owner's machine, and never make load on
    purpose, unless the owner opens it for work. It runs the owner's own
    interactive tools, which break under heavy load. A test failing only
    under load on the owner's machine is not a finding. A single probe of a
    few seconds under `nice -n 15` is not a big run.
  - **When the owner opens their machine for work**, it is read by CPU use
    and RAM (the 30-second `cpu.used` reading in `machines.json`), not load.
    On macOS, load counts threads waiting on disk and network, so it reads
    high while the CPU is mostly free. It then takes up to 2 big runs, under
    `nice -n 15`, and new lanes while CPU and RAM use are under 70 and 75
    percent. At 85 percent CPU nothing new starts and running ones carry on.
    Load above 6 per core is a safety stop.
  - The owner's own panes count in the reading, and only the owner can stop
    them. The rest waits or uses GitHub's CI. Test containers go when their
    run ends.
- **Timing failures.** A queue failure in a test the pull request doesn't
  touch, passing on one automatic re-run, is recorded as timing. Twice, and
  the test moves from the merge-group check to a nightly run through one
  quarantine file (test, reason, owner, ticket, 14-day expiry). Real failures
  still block. This is the only exception to "no test is dropped".
- **Merge alarm.** An alert at 45 minutes with no merge while pull requests
  wait, and under 3 merges an hour. FLEET.md's 2-hour tripwire stays.
- **At the Sol ceiling.** Splitting a piece and the director read in place of
  a third round both live in the ladder at the cap in
  [Review rounds](#review-rounds).
- **Live checks to the owner's step.** When Sol has no findings on the exact
  head and the only gap needs the owner or daylight, the check goes on that
  step's checklist and the code merges. Sensitive pieces keep their director
  read.
- **Fill from the critical path.** Seats go to the next milestone's pieces,
  then the stage's, review debt last. One table names each critical piece's
  pull request, blocker and lane, in tiers. Every slot (pre-check, machine,
  Sol, merge queue) takes the top tier first, then the next, then the rest.
- **One GitHub reader.** Round tools read GitHub through one shared reader
  on a 5-minute cycle that logs its cost, never a loop per pull request.

## Pull request size

**Unproven.** About 800 lines of product code per pull request, 1,000 at
most, so a later agent can read one part without loading the whole slice. Its
tests ride along. A slice lands as a series of these pieces, each a working
step that reads on its own. The pull request reports product lines, test
lines and the total to review. A piece too big for one review session is
split. Generated files are left out only with the check that verifies them
named.

## What review always covers

No trim may weaken review of these five classes, and no finding in them
closes without a fix and a re-check:

1. **Data separation**: business to business, client to client, person to
   person. Every test names each boundary it proves.
2. **Races and timing.**
3. **Secrets and sign-in.**
4. **Money.**
5. **Tests that don't prove their claim.**

Any real correctness defect is held to the same rule, whoever found it.
Cosmetic notes and edge cases with no real defect become follow-ups.

**Races, before review.** A sensitive piece touching locks, sign-in, money,
permissions or data separation is attacked from [the checklist](CHECKLIST.md)'s
"Races and timing" and "Web writes" before its Sol review, with a
two-connection proof for each read-then-write, and a crash and a retry at
each step. The lane runs it through a fresh Opus sub-agent as part of
building. It is test work, not a gate. The one Opus read FLEET.md gives these
pieces is the director's.

**Proofs.** Sol gives each blocking finding an exact failing scenario
(inputs, steps, expected, actual, `file:line`). The lane turns it into a
failing test, then fixes the code until it passes. The test must fail on the
old head and pass on the new one. A scenario that cannot be made to fail goes
back to Sol. A changed test that hides the defect closes nothing.

<a id="review-rounds-and-the-catalogue"></a>

## Review rounds

The one home for how Sol's review runs, how many rounds a piece gets and what
happens at the cap, in both modes and every variant with Sol.
[FLEET.md](FLEET.md#review), [SINGLE.md](SINGLE.md#risk), the variant pages
and the skills point here.

- **The loop.** The builder builds, Sol reviews, the builder fixes, Sol
  reviews again, until Sol approves the exact head. No second reviewer runs
  beside Sol, on a piece, a plan or a stage. The director's read of sign-in,
  money and data-separation pieces ([FLEET.md](FLEET.md#review)) and the
  read at the cap (below) stay.
- **Every head, in both Sol variants.** In hardened production and
  production, Sol approves every head before it merges: product code, tests,
  styling, wording and docs alike, as both variant pages say and the loop
  above requires. Its effort follows the pull request's risk rank
  ([SOL-EFFORT.md](SOL-EFFORT.md#high-risk)), which goes by what the change
  does, not its file type. A prototype has no Sol
  ([prototype.md](variants/prototype.md)).
- **How many rounds.** Full mode gets two, never a third. Round 1 reads the
  whole pull request, round 2 only the fix's diff and the findings it closes.
  Single mode follows [SINGLE.md's rank table](SINGLE.md#risk), high up to 3.
  A blocking finding is fixed before merge, never carried.
- **At the cap, one ladder.** A piece Sol has not approved after its mode's
  last round takes these steps in order, and nothing else. There is no extra
  round and no hold for the owner.
  1. **Split.** A red after the last round splits. A gap `main` also has, in
     a pull request better than `main` everywhere else, becomes its own
     ticket with its own rounds, and the pull request merges after
     pre-check. A red part of the piece's own code goes back to `main`'s
     version and becomes its own design-first piece. Sol checks the removal
     only, and the rest merges.
  2. **Up to the director.** A red touching money or sensitive data, or one
     with no clean split, goes up. The director gives one read of the named
     gaps or unread paths, in place of a third round. With no director in the
     round, one fresh Opus read stands in. Its findings hold the piece.

  The owner hears of a piece at the cap only through
  [what reaches the owner](#what-reaches-the-owner). A ceiling with unread
  scope is a hold, never an approval.
- **Same kind twice, fix the kind.** Within one pull request, when a round's
  finding is the same kind as the last round's (another input form, another
  edge of one rule), don't patch the case. Fix the whole class or tighten the
  rule into a strict criterion, write it into Sol's criteria file and say so
  on the pull request. Across pull requests, in every Sol variant, when a
  second pull request hits the same kind of finding (a second `Seen again:`
  on one root cause in the catalogue, or a split-off ticket of the same
  kind), the next piece is one shared design for that kind, with Sol's design
  check, before any more patches. Patching one case at a time keeps a kind
  coming back, and a shared design ends it.
- **Design first.** A piece that touches locks, authority, retries or
  reconcile starts with a one-page design, which Sol checks once before any
  code.

## The catalogue

- **The catalogue.** One per product repo: a GitHub issue per root cause,
  labelled `catalogue` and ranked by a `severity:` label. Blocking only if a
  real client could lose money, see another client's data or be locked out.
  A defect a person would notice is major. A narrow edge, clean-up, test or
  doc gap is minor. Unsure is blocking, with the reason. Every source searches
  it first, and a repeat adds one `Seen again:` comment. A major or minor
  finding in code the pull request didn't write goes here, not into another
  round. Lanes work it from the top, `Closes #n` in the pull request. Every
  carried finding closes before the stage is accepted and before any real
  client.
- **Minor findings never hold a merge.** They go to one tidy list, fixed in a
  single pass at the end.
- **Sweeps by area.** Code merged without review is swept one whole area of
  `main` at a time (about 2,000 to 4,000 lines), skipping areas reviewed and
  unchanged since. Draft branches are never swept.

### Review debt

Used when the owner defers review, or merged code missed its review.

- Every pull request that merged without its review carries a label for the
  check it lacks. The label comes off only when that check has run on the
  merged code and its findings are filed. Record where review stopped.
- Review by area at one pinned SHA, not each old pull request. Each owed pull
  request clears by linking the area review that covers its files.
- One triage lane merges the findings with the open issues into one list,
  deduplicated by root cause, closing what `main` already fixes, sorted by
  severity. Fixing starts on reviewed areas while the rest are still read.
- One builder per area, foundations first (database, permissions, core
  commands), then screens. Each clears its area in one pass with one review,
  and a second round only for a blocking or major finding.
- One final whole-app pass confirms the parts fit.

## Fixes stay small

**Unproven.** A fix is the smallest change that closes the finding. Delete or
simplify before adding, with no new layer or harness for one finding. No
duplicate suite around a finding's proof. Money, permissions, sign-in and
data separation are fixed in full. If a round would add more than about 150
net lines, or a pull request has grown by half since its first review, the
lane stops and writes a two-line simpler design before going on.

## Quality targets

Reported at each section end with numerator and denominator. They measure
performance. They are never a reason to accept a known defect.

| Target | Value |
| --- | --- |
| Serious problems reaching `main` | 0; each one gets the escape response below |
| Passed at the first review | 30 percent by the end of the first section, 50 percent by the end of the stage |
| Review rounds per piece | 2 or fewer |
| Tokens on the work, not overhead | 70 percent or more ([FLEET.md](FLEET.md#the-work-maps-ledger-and-budgets-scripts-not-agents)) |

**Escapes.** When a serious problem reaches `main` undetected, the
orchestrator holds the affected switch and dependent landings, finds what was
exposed, and picks a safe switch-off, revert or fix. The lane that built it
repairs it. Sol checks the reproduction and the recovery.

## Section-end passes

After each section's last piece lands, fresh sessions that wrote none of that
section's code run one pass each, in order, applying their changes before the
next starts: a thermonuclear review (clean-up, duplicates, fix-round bloat),
the codebase architecture pass, deslop on the code, and unslop on every
shipped word (the `batch-cleanup` skill). Then the checks and the agents'
click-through. These passes are never written into a builder's prompt
(**unproven**). Security, privacy, backups and tests are never simplified
away.

**The section-end cleanup pull request.** The passes' result lands through
the normal gate: the merge script and Sol on its exact head, plus, in
production, all five of [its strict rules](variants/production.md#what-stays-strict)
where they touch that code. Over 1,000 lines it lands as pieces that each
stand alone on `main`, in order, and the last piece's tree equals the checked
cleanup head (`git diff <checked-head> <last-piece>` prints nothing). Its fix
step stops only when nothing in [the five classes](#what-review-always-covers)
and no real correctness defect is left, and Sol approves the exact final
head.

**Sol's stage-end read.** Each stage gets its own review, not only its pieces.
At each stage end, before the owner's test pack, Sol reads the whole merged
stage at its exact head, naming the scope read and the head. The builders fix
what it finds, and Sol approves the exact head. Unread scope is a hold, never
an approval. [Building on `main`](#building-on-main) item 7, Sol's capability
review, still runs before each switch turns on. Neither read has a second
reviewer beside Sol.

At a stage end, agents run the owner's test script on staging, and the owner
gets the test pack: the script, a one-page summary and a short recording,
about an hour of the owner's time.

## Seats, lanes and stops

- **Seats** are separate paid subscriptions, each with its own five-hour
  window and weekly allowance. Two panes on one seat share one window. The
  owner sets each seat's cap, and nothing new starts on a seat past it.
  Refuse paid extra usage. New work goes on the seat with the most room
  (`seat-gauge`, a skill that reads each seat's remaining usage).
- **Fill to the cap.** Up to 10 working lanes per seat while work exists.
  Count working lanes, never open panes. No variant caps open, ready or
  approved pull requests. Sol takes fixes and the oldest pieces first, and
  ready pieces wait in that order while Sol runs at its account or machine
  limit. The caps that stay are capacity: seats, machines, Sol's account and
  machine, runner slots and queue width. `watch.mjs arrival-cap` only
  reports. Its `CAP-HOLD` holds no build.
- **Panes.** Send text to a working pane without Escape, which interrupts it.
  A pane the owner drives from a phone, or a browser lane (`claude --chrome`),
  runs on a full-login seat. GitHub permission-grant clicks stay owner steps.
  Agents never close a pane the owner is chatting in.
- **Closing a lane.** Once its pull request has merged, with nothing
  unpushed and no process of its own left running, it finishes as
  [FLEET.md](FLEET.md#paperwork-four-things-per-agent-nothing-else) says
  (its three description lines, then `close-out`). Custody proofs apply only
  to lanes that touched production secrets.
- **The machine.** Keep 20 GB of the owner's machine's disk free, read after
  `tmutil listlocalsnapshots /` (deleting a snapshot needs the owner's yes).
  CPU, RAM and load lines for each machine are in
  [the merge pipeline](#the-merge-pipeline).
  Tests clean up their temp folders and containers. Stop only what you
  started, by PID, after checking the command.
- **Heavy runs on the check machine.** Local full checks, Docker database
  stands, browser captures and gate sweeps run on the check machine. A lane
  keeps at most one test process on the owner's machine, and none past a
  few-second probe unless the owner opens it for work. Every call to the
  check machine goes through one shared connection under a lock, with load
  from one shared reading a minute. How many big runs each machine takes is
  in [the merge pipeline](#the-merge-pipeline).
- **Sol's runs** follow measured disk, load and memory, never the queue's
  length. Pull request rounds come first. Design checks take spare slots. A
  run that ends "at capacity" with no verdict retries once after 3 minutes.
  Sol's wrapper removes its containers when it posts its verdict.
- **Saved logins.** Agents never read one with the macOS `security` tool,
  which raises a password box on the owner's screen. They use the service's
  own signed-in tool.
- **Context: finish at 45, hand off at 50, hard cap 70.** This is the one
  hand-off rule for every role in both modes: lane, single agent,
  orchestrator and director. Read it from the context bar in the pane's
  status line.

  | Context | What the session does |
  | --- | --- |
  | Under 45 | Carries on. |
  | 45 to 49 | Starts nothing new and finishes the task in hand (a pull request, a ticket, a fix round), then hands off. |
  | 50 to 69 | Hands off now: the usual cut-off. Only when finishing the task in hand needs the context it holds may it run on, saying why in the note. |
  | 70 and over | Hands off now, whatever is in hand. |

  The gauge is the orchestrator skill's `ctx.sh`, run with
  `CTX_PREP=45 CTX_STOP=50` (it prints `PREPARE` at the first and `HANDOVER`
  at the second). Single mode's lines and hand-off note are in
  [SINGLE.md](SINGLE.md#hand-off-at-50-percent-context). Codex and Sol keep
  the context limits their own launch profiles set.
- **Boot and hand-over.** A boot reads only the state note, the newest boot
  file, the register, the last 50 lines of the event log and owner files
  newer than the last handover. Older evidence is read when a step needs it.
  An orchestrator or director that hands over logs one line, in this one
  format ([FLEET.md](FLEET.md#pausing-and-restoring-the-whole-fleet) and the
  skills point here):

  ```text
  <YYYY-MM-DDTHH:MM:SSZ> ORCHESTRATOR-HANDOVER <old-pane> -> <new-pane>
  <YYYY-MM-DDTHH:MM:SSZ> RELAY-HANDOVER <old-pane> -> <new-pane>
  ```

## Sub-agents

**Unproven.** Every sub-agent starts **fresh**, with a short self-contained
brief, never a fork of its lead's context. The `sub-agents` skill is how any
lane briefs, runs and joins one.

- A lane runs up to 6 build sub-agents, each for an independent piece of
  about 800 lines. Reviewers and orchestrators run none.
- Sub-agents spend the lead's seat and the machine, so they are trimmed first
  when a seat or [the machine](#seats-lanes-and-stops) runs hot.
- A sub-agent running 90 minutes is a loop suspect. Its lead stops it if it
  loops or its question is moot.

## The round folder

The round folder is git-ignored. It holds the owner's instruction files,
briefs, the state note and the event log ([FLEET.md](FLEET.md#paperwork-four-things-per-agent-nothing-else)
says what the log keeps). The repo, not the round folder, is the source of
truth for finished work.
