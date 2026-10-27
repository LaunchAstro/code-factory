# Single mode

Code Factory has two modes (owner, 15 October 2026):

- **Full mode**, [FLEET.md](FLEET.md) and [METHOD.md](METHOD.md): a director,
  an orchestrator and lanes, for a big build with many pieces.
- **Single mode**, this file: one agent owns one area of a repository (Ops
  Astro's chat, the agency site's services page) and lands its work on `main`
  as a run of small pull requests, with Sol reviewing what carries risk.

There is nothing in between. The lean core was trialled on the website
template and retired the same day this file was written.

Both modes run one of the [build variants](METHOD.md#build-variants). This
file is hardened production as written. Production is this file with the
changes in [variants/production.md](variants/production.md), which win where
the two disagree. A prototype follows
[variants/prototype.md](variants/prototype.md) instead of this file's review
and merge steps.

## Who

- **The owner, or the session the owner is talking to,** names the area and
  the job and launches the agent with the `dispatch` skill, on a seat that
  [Seat Gauge](https://github.com/LaunchAstro/seat-gauge) shows has room.
  At the hand-off line, the agent launches its own successor the same way
  ([below](#hand-off-at-50-percent-context)).
- **The agent** (Opus 5.5 high unless the launch names another Claude
  model; never Codex, since Sol reviews its work) shapes, builds, ranks, gets
  the review its rank needs, and merges. Its steps are the
  `single-agent` skill.
- **Sol** (GPT-6.1-Sol, headless; [effort by risk](SOL-EFFORT.md)) reviews
  every pull request until it approves the exact head
  ([Review rounds](METHOD.md#review-rounds)) and never writes product code.

No director, orchestrator, merge agent or watcher.

## Shape it first, when it isn't settled

A job that isn't settled takes [the route](METHOD.md#before-the-build-plan-deep)
before any code: `wayfinder`, `to-spec`, `to-tickets`, each ticket with its
`Section:` line. With the owner present and an idea still open, the agent
prototypes it (`prototype`) and grills the owner on it (`grilling`) inside
the map's decision tickets. A settled job, or a copy change, skips this.

## Small pull requests, merged as they go

Conflicts come from branches that live long and drift from `main`
([DORA](https://dora.dev/capabilities/trunk-based-development/): branches
of hours, merged at least daily). So the agent:

- keeps each pull request to METHOD's [pull request size](METHOD.md#pull-request-size)
  (about 800 product lines, 1,000 at most), and lands it before starting the
  next;
- brings its branch up to date with `main` before the review, so Sol reads
  what will land, and merges straight after;
- on a conflict at merge, updates again, fixes it, reruns the checks, and has
  Sol read only the fix and re-run the proofs it touches
  ([carried approvals](METHOD.md#building-on-main), item 6).

Two agents on the same area at once is full mode.

On a private repository with no merge queue and no landing tool that binds
each merge to the tree its full run tested, GitHub's "require branches to be
up to date before merging" stays on for `main`, whatever the agent count. The
merge script checks only the pull request's head, so without the setting two
heads each checked on an older `main` could land together untested. No queue
of our own. Production's [change 11](variants/production.md#what-changes) keeps its
own wording. Switching the setting off is not proven: it waits for
raw-to-export's `LAND-SHADOW` evidence, and none exists yet.

## Risk

Every pull request is ranked before it ships. The agent ranks it, a fresh
sub-agent ranks the diff blind, and the higher rank stands. Unsure means the
higher rank.

| Rank | What | Review |
| --- | --- | --- |
| High | Anything on [the high-risk list](SOL-EFFORT.md#high-risk) | Sol at `high`, up to 3 rounds, plus one fresh Opus read |
| Medium | Anything else that changes behaviour: features, fixes, APIs, data handling | Sol at `medium`, one read; every finding gets a fix and one narrow re-check of the fix |
| Low | No change to behaviour, data or security, and no change to a rule [the high-risk list](SOL-EFFORT.md#high-risk) names: styling, layout, copy, docs, tests only | Sol at `medium` until it approves the exact head ([every head](METHOD.md#review-rounds)) |

This table is single mode's round limit; what happens at it is the ladder in
[Review rounds](METHOD.md#review-rounds). The
[five classes](METHOD.md#what-review-always-covers) are high at any
size. The rank goes in the description as `**Risk:** <rank>, <reason>`.
[Sol effort](SOL-EFFORT.md) is the same in both modes, including fix passes.

**Same kind twice, fix the kind** (owner, 17 October 2026): the rule, within
one pull request and across them, is in
[Review rounds](METHOD.md#review-rounds).

Render Sol's prompt with
[`make_sol_prompt.py`](../orchestration/reviewer/make_sol_prompt.py), following
its [usage](../orchestration/reviewer/README.md#render-a-sol-prompt). It always
passes the diff as a separate file and opens with the no-skill reviewer line,
including on fix passes (#184).

## Merge

The agent runs the merge script,
[`orchestration/enqueue.mjs`](../orchestration/enqueue.mjs), pointed at its
repository. It never merges around it:

- **Ops Astro** (public, GitHub's merge queue): the script queues the pull
  request once every required check, Sol's included, is green on the exact
  head and the description has its three lines. Sol's verdict is one of those
  checks, so Sol reviews every pull request there, low included.
- **Private repositories** (where the plan has no merge queue): the script
  merges straight to `main` once every check on the head has passed and the
  description has its lines and its risk. For medium and high, Sol must also
  have set a `Sol verdict` commit status of `success` on that exact head. The
  script refuses a low rank on a change that touches migrations, CI, packages,
  env files, deploy config or sign-in
  ([details](../orchestration/enqueue.md#with-no-merge-queue)). It lets a low
  rank through without the status; the agent still runs it only once Sol has
  approved that exact head.

## Hand-off at 50 percent context

A session that runs until Claude Code summarises itself loses the pull
request heads, worktrees and Sol rounds it was holding (owner, 17 October
2026, private ticket #182). So the
agent hands off to a fresh session first, by the context bar in its pane's
status line. The numbers, what each band means and the owner's words are the
one rule for every role in [METHOD.md](METHOD.md#seats-lanes-and-stops):
finish at 45, hand off at 50, hard cap 70. Single mode names the bands with
these lines:

| Context | Line |
| --- | --- |
| Under 45 | GO |
| 45 to 49 | WRAP |
| 50 to 69 | HANDOFF |
| 70 and over | HARD |

[`orchestration/single/handoff.sh`](../orchestration/single/handoff.sh) does
the mechanical part, and holds the three numbers:

- `handoff.sh ctx` prints the line. The reading comes from the orchestrator
  skill's `ctx.sh`, the same gauge reader the director and orchestrator hand
  over by, which reads the bar off the herdr pane.
- `handoff.sh note <owner/repo> --clone <checkout> <pr>...` writes the
  hand-off note: each open pull request's number, branch, worktree (looked up
  in that clone only), head, Sol round and Sol verdict status, read live, and
  a `<fill>` for what only the agent knows (the job, the pull request in hand,
  the tickets left in order, the live install state, the owner's words not yet
  in a ticket).
- `handoff.sh dispatch <note> --cwd <dir> --label <label> --seat <seat>`
  refuses a note with a `<fill>` left, then launches a fresh `single-agent`
  session with the note as its whole brief, through the `dispatch` skill's
  `herdr-dispatch`, on the seat [Seat Gauge](https://github.com/LaunchAstro/seat-gauge)
  shows has room. `--dry-run` launches nothing.

The pull request in hand is parked first: pushed, with its Sol state in the
note. Then the old session stops. Codex and Sol keep the context limits their
own launch profiles set.

## The work map

Single mode feeds the work map through GitHub, with nothing extra to write:
the branch and tab named by the project's lane rules
(`docs/work-map/project.json` in its roadmap), `Closes #n` on the tickets,
and Sol's comment ending in its exact-head footer.

## Paperwork

As full mode ([FLEET.md](FLEET.md#paperwork-four-things-per-agent-nothing-else)),
plus the risk line on a private repository, then `close-out`.
