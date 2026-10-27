# Hardened production

For code a defect in could reach the public: public on the internet, used by
clients, more than one tenant, or moving money. Ops Astro is the reference
build. Until 25 October 2026 this was the slow speed, and `slow` still means
it ([Build variants](../METHOD.md#build-variants)).

The rules are [METHOD.md](../METHOD.md), [FLEET.md](../FLEET.md) and, for one
agent on one area, [SINGLE.md](../SINGLE.md), plus the production learnings
adopted below, each with its condition. Nothing else in
[production.md](production.md), and nothing in [prototype.md](prototype.md),
applies here. The parts that set its pace, for comparison with production:

- Sol approves every head, product code, tests, styling, wording and docs
  alike, until it approves the exact head. How many rounds each mode gets,
  and the ladder at the cap, are in
  [Review rounds](../METHOD.md#review-rounds).
- The merge queue runs the full set on the exact combined head
  ([The merge pipeline](../METHOD.md#the-merge-pipeline)). On a private repo
  the pre-check runs it on the head merged onto the latest `main` before
  merging, but the merge script does not yet require that status
  (private ticket #284). So on a
  private repo with no merge queue and no landing tool that binds each merge
  to the tested tree, GitHub's "require branches to be up to date" stays on,
  whatever the agent count. Switching it off is not proven: it waits for
  raw-to-export's `LAND-SHADOW` evidence, and none exists yet.
- Sensitive pieces touching locks, sign-in, money, permissions or data
  separation get a race attack before Sol (METHOD's full list and procedure:
  [What review always covers](../METHOD.md#what-review-always-covers)).
  Sign-in, money and data-separation pieces also get the director's read
  beside Sol ([FLEET.md](../FLEET.md#review)).
- A capability's switch stays off until Sol has read the whole capability
  ([Building on main](../METHOD.md#building-on-main), item 7).
- Carried approvals follow item 6 there, under A2's condition below.

## Production learnings adopted (owner, 26 October 2026)

The owner allowed hardened production to take any production learning that
removes waste without weakening a hardened guarantee. Each below is adopted
with its condition; the evidence for and against is in
the CF-Refine audit (`refine-2026-10/AUDIT.md`, a private round record).
Sol reviews any change to them at `high`.

- **A1. No stacked pull requests.** No stack by default. Two exceptions,
  landed only by top-carry with its gate (each reviewed head is an ancestor
  of the top; `main..top` holds nothing unreviewed): a re-cut of a reviewed
  over-size pull request, and a critical-path chain the owner's deadline
  names. Never train-enqueue. Tools: the merge script refusing a base other
  than the default branch
  (private ticket #285), and
  private ticket #248.
- **A2. An identical rebase carries its approval.** Posted only by
  private ticket #272's tool,
  never by hand: an identical `range-diff`, on the tree the pre-check or
  queue tests. Anything else, a merge of `main` whose conflicts are only
  test lists, counts or migration numbers included, gets Sol's narrow check
  and the touched proofs re-run ([item 6](../METHOD.md#building-on-main)).
  For a sensitive piece, it carries only when nothing that landed on `main`
  since the approved base touches its changed files or the modules they call; otherwise one narrow Sol check plus a director read.
  The rehearsal gains a stale-carry case. Until #272: a quick Sol range-diff
  check.
- **A3. Pre-check groups from pull requests that merge clean together.** Queue repos:
  up to 3 from the queue's next-to-build entries that merge clean together,
  critical path alone, enqueued in the tested order; a chain or whole-system
  piece still lands on a still `main`. Private repos: groups of one until a
  landing tool binds each merge to the tested tree
  (private ticket #286;
  raw-to-export's `batch.sh land` is the model, never copied).
- **A4. Parallel test runs**, already adopted
  ([local full runs in parallel](../METHOD.md#where-the-full-tests-run),
  owner, 25 October 2026), with three conditions: workers bounded to the
  machine; shared-resource tests keep an exclusive lease or their own
  database; a five-class proof never goes to quarantine for a failure seen
  only in parallel, and the pre-check's alone-rerun logs
  `PRECHECK-TIMING <unit>` to `events.log` for a ticket. That last condition
  is not met yet: the pre-check records an alone-rerun pass only in its own
  run files
  (private ticket #289). Until
  it logs the line, the alone-rerun relief does not apply, and hardened
  production keeps today's behaviour.
- **A5. Lanes watch only their own lines.** A ruling for every lane is posted
  `to=all`; watchers match their own label or `to=all` as whole words, never
  a prefix or quoted text; one format per watched line, and the reader alarms
  on a line it can't parse.
- **A6. No open-PR caps.** Caps on open, ready or approved pull requests go.
  Capacity caps stay: seats, machines, Sol's account and machine, runner
  slots, queue width. METHOD's queue hygiene (owner, 12 October 2026) stays
  until the owner decides
  private ticket #162.
- **A7. Sol runs side by side with the checks.** Sol starts at READY beside
  the light checks, with the sentence that CI is the merge gate's job (never
  a finding or a coverage hold) in every prompt. On a sensitive piece, Sol
  starts after the race attack. More than one database-using Sol run only
  with a database each. At Sol's account limit, the critical path goes side
  by side and the rest wait for green.

Every hardened guarantee stays: hosted CI and the merge queue on public
repos, the security review, conformance proofs, the five classes, the queue
rehearsal, the race attack, the director read, a capability switched off
until Sol reads the whole capability, and strict carries.

A hardened production project that loses its public reach does not drop to
production by itself: the owner re-picks.
