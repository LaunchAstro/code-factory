# Issue tracker

GitHub Issues is the tracker for `LaunchAstro/code-factory-private`. Planning maps can
have children in other LaunchAstro repositories. Build tickets live in the
repository where their change lands.

## Labels and issue types

The tracker uses these issue types.

| Type            | Label                                                                                  | Purpose                                                                   |
| --------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Map             | `wayfinder:map`                                                                        | Destination, standing decisions, unresolved questions, and scope.         |
| Decision ticket | `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` | One question or prerequisite that clears the route through a map.         |
| Spec            | `ready-for-agent` and a `Spec:` title                                                  | Agreed behaviour and acceptance for a set of build tickets.               |
| Build ticket    | `ready-for-agent`                                                                      | One independently verifiable change with its acceptance and dependencies. |

Older decision tickets can carry `wayfinder:ticket`. Read their parent and
resolution before treating them as build work. Source proposals can retain
`enhancement`; a proposal label does not make an issue ready to build.

Specs also carry `ready-for-agent`. A query on that label alone is not a
dispatch queue. Skip `Spec:` issues and check each build ticket's native
blockers and owner before assigning work.

## Wayfinding operations

Each map has Destination, Notes, Decisions so far, Not yet specified, and Out
of scope sections. The map indexes decisions. Their details remain in the
decision tickets and resolution comments. Open work is visible through the
map's native sub-issues rather than a second list in its body.

Use GitHub's native sub-issue relationship for children, including children
in other repositories. A build ticket also links its map and spec under
Parent. Its remaining sections are What to build, Acceptance criteria, and
Blocked by. The body and GitHub's native blocking relationships must agree.
Use native blockers for real prerequisites. A ticket with no blockers says
"None (can start immediately)".

The frontier consists of open, unassigned children whose blockers are all
closed. Check that each closed blocker delivered the needed acceptance.
Assign a ticket to its owner before work starts. Each active build ticket has
one owner and one isolated branch or clone.

These reads show a map, its children, and a child's native blockers. The
repository is explicit because an issue number alone is local to one repo.

```sh
gh issue view 121 --repo LaunchAstro/code-factory-private
gh api repos/LaunchAstro/code-factory-private/issues/121/sub_issues --paginate
gh api repos/LaunchAstro/code-factory-private/issues/130/dependencies/blocked_by --paginate
```

After a decision resolves, record the answer in a resolution comment, close
the decision ticket, and add a named link with a one-line gist to the map.
Leave unspecified work under Not yet specified until its question is clear.
Work outside the destination belongs under Out of scope.

The current example is Map: watcher repairs and landing capacity (private ticket #121).
Its shared fleet watchers and landing capacity spec (private ticket #123)
has build tickets in Code Factory and Ops Astro. Tickets for Ops Astro's CI
land in Ops Astro while remaining children of the Code Factory map.

## Ticket and section declarations

Every PR body carries a top-level plan declaration and a section declaration.
So does every map, spec and ticket body that `wayfinder`, `to-spec` and
`to-tickets` write: the work map places an issue by its `Section:` line, and a
child without one inherits its parent's. Work on no map says
`Section: outside`. Use the exact spelling in these examples.

```text
Ticket: C80
Section: checks
```

Use `Ticket: C80, C81` for several plan tickets, or `Unit: U32` for a whole
unit. These IDs come from the product's build plan. A GitHub issue reference
in a title or paragraph does not replace the declaration.

For work outside that plan, including this kit's tracker documentation and
Ops Astro's watcher-related CI chores, use `Ticket: none`. Link the tracker
issue or map separately in the PR body. Use `Closes #124` only when the PR
delivers the issue's acceptance. Use a full repository reference for an issue
in another repository.

The round log records the same declarations at boot and when work changes.

```text
2026-10-14T01:00:00Z BUILD-A BOOTED (model, seat example) Ticket: C80 Section: checks machine=m5
2026-10-14T01:01:00Z BUILD-A TICKET Ticket: C81 Section: checks
2026-10-14T01:02:00Z BUILD-A TICKET Ticket: C81 complete Section: checks
```

Use UTC timestamps. Include `machine=m5` when the lane runs on the M5.
Keep Ticket and Section beside each other on BOOTED and TICKET lines.
The `complete` marker records completion of the named plan ticket.

The live roadmap's declared box IDs are `design`, `engine`, `access`,
`checks`, `hosting`, `m5`, `tasks`, `team`, `wayfinder`, `people`, `chat`,
`runs`, `auto`, `sitefix`, `conn`, `docs`, `skills`, `review`, `sitereview`,
`workbench`, `reports`, `crm`, `records`, `portal`, `live`, `money`, `ads`,
and `edit`. Code Factory watcher and tracker chores declare `checks`.

The section map convention ticket (private ticket #141)
defines project section maps. The [event grammar](../../orchestration/events.md)
defines the wire records. The live roadmap convention (`CONVENTION.md` in the private roadmap repository)
defines the plan declarations. Ticket and Section declarations are required
by the round convention even while older readers lack those fields.

## Build evidence and completion

A build ticket names observable acceptance and required evidence. Its PR
links the ticket and reports what was built and how it was verified.
Protected parts that guard data separation, sign-in, or money require a green
conformance proof. Review and merge follow [METHOD.md](../METHOD.md) and the
lane's current brief. The orchestrator owns review and landing.

Acceptance added after a merge needs a separate follow-up ticket when it is
unbuilt. Link that ticket to the map and the original issue, and name the
remaining behaviour. A closed issue or merged PR does not prove later
criteria are complete.

Keep built, reviewed, merged, and switched on distinct in the handback.
Name the switch-on step and its owner. The shared kit adopts changes at a
round boundary, as the watcher map requires. Merged work awaiting that step
is still owed.
