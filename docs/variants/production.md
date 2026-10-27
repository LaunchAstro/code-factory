# Production

For private production code. One owner or their own team uses it, on their
own machines or private network. Nobody outside can reach it or its data,
nothing of it is reachable from the internet, it moves no money, and it runs
on real data or is kept ([picking a variant](../METHOD.md#build-variants)).
Dropped rules and why are in [HISTORY.md](../HISTORY.md#dropped-and-why).
Check there before changing a rule here. No variant re-adds a rule it lists
as dropped for throttling.

Production is [METHOD.md](../METHOD.md), [FLEET.md](../FLEET.md) and
[SINGLE.md](../SINGLE.md) with the changes on this page. Where this page and
those disagree, this page wins for a production build. Anything it doesn't
mention runs as METHOD says.

## What stays strict

These hold quality, so they don't loosen:

1. **Sol approves every head**, tests-only pull requests included, before it
   merges. Most of Sol's change requests are real defects. Rounds and the
   cap are in [Review rounds](../METHOD.md#review-rounds) (a fleet lane two
   rounds, a single-mode agent SINGLE.md's rank table).
2. **Photo or data work is proven live** before merge, on the real
   application, a test copy and public sample data. This covers any piece
   that reads, writes or shows photo files, data files or their records,
   read-only screens included (types-only and build-config pieces don't).
   Live trials catch defects every stand-in passes. The trial runs on the
   Sol-approved head. It carries across a rebase only when nothing that
   landed on `main` since that head touches code the trial runs (the piece's
   files and the modules they call). Otherwise the trial steps those changes
   reach re-run, as they do for a product-line change in the piece itself.
   The trial is a merge gate, never one of Sol's required proofs, so a trial
   still running never holds Sol's verdict. The Sol prompt names it as an
   owner-step check Sol does not judge. A trial that needs another piece's
   behaviour runs on the carried head once that piece has landed.
3. **The full test run is on the exact combined head**, the pre-check or
   group run of what will land, never a result from another head ([The merge
   pipeline](../METHOD.md#the-merge-pipeline)). Two pieces that each pass
   alone can fail to build together.
4. **Full care for files.** Anything that deletes, moves, renames or picks
   where files go gets Sol at `high`, the director's read beside it
   (METHOD's one Opus read; with no director in the round, one fresh Opus
   read stands in), and a live proof on a test copy. A delete outside the
   build's own cache needs the owner's yes. Files an agent created in its
   own temp or trial folder are that cache.
5. **Same kind twice, fix the kind, across pull requests.** When a second
   pull request hits the same kind of finding (for example a path that
   follows a link into another client's folder), the next piece is one
   shared design for that kind, with Sol's design check, before any more
   patches. Patching case by case keeps the kind coming back.

## What changes

1. **No stacked pull requests.** Each pull request is based on `main` and
   stands alone. A piece that needs an unlanded one waits for it to land,
   and its lane builds something else meanwhile. Never rebase onto an
   unlanded pull request or a pre-check group's head. A piece over 1,000
   lines splits into pull requests that each stand alone on `main`, never a
   stack. When B needs A's types, A's first pull request lands the types
   alone, so B can start from `main`. Stacks multiply heads and Sol runs, and
   a restack onto an unlanded head can carry one defect into several pull
   requests.
2. **An identical rebase carries its approval with no new Sol review.**
   [Carried approvals](../METHOD.md#building-on-main), item 6, is the rule.
   Only a `git range-diff` showing every commit identical carries. Anything
   else, test lists and counts included, gets Sol's narrow check of what
   changed and the touched proofs re-run. Identical rebases rarely hide a
   defect, and real catches come on rebases that change product lines. The
   merge script still needs a `Sol verdict` status on the exact new head,
   and nobody posts one by hand. A carry goes through a landing tool that
   checks it before posting the status. Such a tool carries only when the
   new head's parents are the approved head and `main` and its tree equals
   the group's tested tree. Where a repository has no such tool, a quick Sol
   range-diff check stands in until it has one. Adopt Code Factory's shared
   carry tool when it exists, never a repository's own copy.
3. **Pre-check groups are chosen from pull requests that merge clean together.** Up
   to 3 approved pull requests, oldest first, each skipped if `git
   merge-tree` against the landing `main` conflicts with the others, then a
   quick build of the combination before the full run. A red splits over its
   suspects. The next group may pre-check on the running group's tested
   head, and lands only after it. Members land in the tested order, each
   only onto the `main` the group run assumed, and every tree that will sit
   on `main` has passed the full set first. With members A, B and C on
   `main` M, the full set runs on M+A, M+A+B and M+A+B+C side by side in
   free machine slots, and a member lands only once its own prefix is green.
   A refused member leaves `main` on a tested prefix. The rest of the group
   goes back to be picked again. With no landing tool that carries a rebased
   member's approval and checks (change 2), a group is one pull request, and
   nothing pre-checks on a running group's head. The section-end cleanup
   pull request ([Section-end passes](../METHOD.md#section-end-passes))
   keeps all five strict rules above, live proof and file care included
   where they touch that code.
4. **The full run is fast and fails fast.** Test files run side by side
   ([local full runs in parallel](../METHOD.md#where-the-full-tests-run)).
   Heavy tests build with the optimiser on. The cheap steps (format, lint,
   every target's compile) run before the long test step. A cheap red that
   waits 30 minutes behind the tests is a defect in the check script. A pull
   request that shortens the full run is top tier, since every later run
   gets cheaper.
5. **No cap on open, ready or approved pull requests.** Seat, machine and
   sub-agent caps stay. A cap on approved pull requests stalls the build and
   only delays the findings.
6. **Sol reviews run side by side**, one for every ready head, within Sol's
   account and [the machine](../METHOD.md#seats-lanes-and-stops). Sol starts
   once the head's own checks are green, so it never holds a head only for a
   check that hasn't reported. Until the merge script clears such a refusal
   on a later approval, a head held only by one gets an empty commit and
   Sol's narrow check of it (change 2), so it is never left waiting.
7. **Idle lanes build the next piece**: the critical path first, naming the
   files they will touch, always on `main`. A lane never parks while unbuilt
   tickets exist.
8. **Lanes watch only their own lines** (lines that name their label) and
   send no acknowledgements. The lane's next milestone line is its answer.
   Every watched line has one format, and the tool that reads it raises an
   alarm on a line it can't parse. A line another lane waits on names that
   lane (`to=<label>`), or the orchestrator posts it under that label.
   `HANDOFF` is `build-review`'s dependent-work line and names its receiver
   (`to=<label>`). A context hand-off logs `HANDED-OFF`. A watcher matches
   the whole word, never a prefix. A new line type goes into
   [orchestration/events.md](../../orchestration/events.md), with its
   parser, before its first use. `HANDOFF`, `HANDED-OFF` and `TRIAL` are in
   use but not in it yet, and get added with their parsers.
9. **Live trials have their own lane** on the critical path. The
   orchestrator posts the approved head to it under its label. It logs
   `TRIAL <pr> head=<sha7> pass|fail to=<builder>`, and the merge waits on
   that line. The owner's steps for them go to the owner as one list ahead
   of the trials, so no approved pull request waits on an unscheduled click.
10. **Far-off findings go to the tidy list**, never a round: cases that need
    an unusual setup (two machines at once, an exact-moment race, look-alike
    Unicode names). The exception is one that could delete, move or misplace
    a real file, or show one client's data to another. That blocks.
11. **Up to date by test, not by setting.** GitHub's "require branches to be
    up to date" setting on `main` makes every merge rebase and re-check
    every open pull request. It may go only where the landing tool binds
    each merge to the tree the group run tested, refusing when `main` is not
    the group's tree so far. `enqueue.mjs` alone checks only the pull
    request's head, so with it the setting stays on. Without such a tool, two
    heads each pre-checked on the old `main` could land together untested.
    Turning it off is the owner's setting. Offer it at the binding message
    only where such a tool runs. Until then, the carry in change 2 keeps
    rebases cheap, and only the head picked for the next pre-check rebases.
    The others wait unrebased.

## The orchestrator's merge plan

At each tick, list the approved heads. Take the top tier first, then the
oldest, up to 3 that merge clean together (one, with no pre-check on a
running group's head, where no landing tool carries; change 3). Start their
pre-check in the next free machine slot. Start Sol on every green head
without a verdict (change 6), the critical-path piece's pre-check at READY
beside Sol and the others' at approval beside their trial, the merge waiting
for all of them. Give every idle lane the next ticket on the critical path
(change 7). One pull request on the critical path may pre-check alone, as
METHOD says. With groups of one, METHOD's merge alarm reads "45 minutes
with no merge while an approved, green head waits", not a merges-per-hour
count.

## Leaving production

A piece that would let anyone outside the team reach the product or its
data, or move money, stops. The owner re-picks, and the project runs as
hardened production from then on.
