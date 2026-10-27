# How the loop got its shape

*A record of how the method got here. You don't need it to run a build; start at the [reading order](../README.md#where-to-start). Check [Dropped, and why](#dropped-and-why) before bringing a rule back.*

Two early changes shaped the loop. Briefs went from prose to short numbered
files, and Copilot left the review chain. The sections below give the rule
each change left and the reason for it.

## From long prompts to short briefs

Long prose instructions bury the required steps, and a lane that reads its own
limits is also the lane deciding whether to go past them. So a brief is one
self-contained file of under about 600 words, with the limits as numbers on
the first screen and the task written as the exact commands the lane will run.
A short brief carries everything a lane needs to comply.

Every brief also carries a premise check. A lane told to do something the
repository can't support, and told not to ask, improvises. The premise check
has it stop and ask instead.

Sources: `ROUND6-REPORT.md`, `ROUND6-LEDGER.tsv`.

## Copilot's place in the chain, and why it left

Copilot reviewing every push was not reliably there, and a missing review
turned nothing red. Where it did review, it held merges on whether its
comments had been ticked off rather than on whether the code was sound. So a
reviewer is never a gate, and Copilot is out of the chain.

Sol took the seat. Sol is gpt-5.6-sol run through the Codex CLI, posting as a
collaborator account that is not the builder's. It names defects at the file
and line. Its review is the review of record, and the
`review evidence for this revision` context reads the verdict off it and turns
a required check red or green with nobody reading the diff. It goes green on
an approval and red on a refusal, by design.

Sources: `REPORT.md`, `ROUND2-REPORT.md`, `ROUND7-REPORT.md`, `ROUND7-LEDGER.tsv`.

<a id="the-chain-today"></a>

## The review chain

1. A build lane takes the ticket to a draft pull request, plan commit first.
2. A Sol session reads the plan and the diff at that head, and posts one review.
3. `review evidence for this revision` reads that review and goes red or green.
4. The orchestrator decides on the counts while a human is watching the round, merge, one fix pass or hold, and the runner takes that step overnight only once its merge step is written, which `template/scripts/runner/` does not yet carry.
5. A fix lane closes the one `Criterion:` line, and the head goes back to Sol.

## Build speeds before trunk

The first kit ran a full pipeline at every stage, which was far too heavy. Its
checks moved into the product's own repository and its orchestration into the
orchestrator skill. The method that replaced it is plan deep, build in bulk,
edit in post. Size is a guide and never a gate, and review strength on client
data, races, secrets, money and weak tests is never trimmed.

Three build speeds came before trunk.

- **Slow** built in small pull requests under a 400-line cap, each with
  several Sol reviews. Review earned its keep, catching data crossing between
  businesses and weak tests. The queue was the drag: nearly every fix needed a
  size waiver, and the strict up-to-date rule cost a rebase and a full test run
  each time `main` moved.
- **Medium** built in batches and slices with no size gate. Slice pull
  requests grew too big for a later agent to read, and fix rounds bloated code
  until something capped them. A piece that proves the whole system reruns its
  full check whenever `main` moves, so it lands on a still `main`.
- **Fast** landed non-sensitive pieces on green automatic checks (security
  scan, data-separation tests, types, lint), with Sol reviewing afterwards and
  small follow-up fixes. It did not hold.

All three gave way to trunk: each piece is reviewed, then goes straight to
`main` through the queue.

## Cut to the fleet model

METHOD.md was cut down to match [FLEET.md](FLEET.md). What left, in short:

- **Roles, lane declarations, records and reports:** FLEET.md owns them. The
  lane owns its piece to merge. The orchestrator doesn't integrate or log
  `ORCH-DECISION`. The director's watchdog and nudge timers became FLEET.md's
  tripwires and budget watcher.
- **A temporary model split:** FLEET.md's model split replaced it.
  `FIX-DIFF-READ` (an Opus read of every Codex fix diff) went with it, under
  FLEET.md's "never twice". The `SIMPLE` or `OPUS` tag stayed, renamed
  ordinary or sensitive.
- **Enqueue by the orchestrator:** replaced by the merge script's loading bay.
- **The cross-model rule** (a model's review of its own company's work clears
  nothing): set aside while Sol built ordinary pieces, and back in force now
  that Claude builds and Sol only reviews, as FLEET.md's
  [models](FLEET.md#models) say.
- **Proof tests by a fresh Opus sub-agent:** the lane writes the proof from
  Sol's scenario, since FLEET.md has the lane fix its own findings.
- **The race attack by a separate sub-agent:** kept as the lane's own test
  work on sensitive pieces, not a gate. FLEET.md's one Opus read of those
  pieces is the director's.
- **Closure checks** (handback files, custody proofs, close acknowledgements,
  a lane closing once queued): a lane closes after its merge, with its
  wrap-up in the pull request. Custody proofs stay only for production
  secrets.
- **Build speeds and the core-then-chunks phases:** collapsed into slow by
  default on trunk.
- **Smaller detail** (a fixed seat stop percentage, condense passes, the
  fork-versus-fresh sub-agent measure, proof runs tied to one machine, an
  error tracker's quota): dropped. Seat caps are set per seat by the owner.

## Two modes, and the lean core retired

A lean core between full and single mode didn't work well enough, so there are
two modes.

- **Retired:** `docs/LEAN.md` and its chunks in `docs/lean/`. They are in git
  history.
- **Added:** [SINGLE.md](SINGLE.md), single mode. One agent takes one problem
  to merged, runs Sol's review itself and merges through the repository's own
  gates (the loading bay where there is a merge queue). No director,
  orchestrator or merge agent. Its steps are the `single-agent` skill.
- Full mode stays [FLEET.md](FLEET.md) and [METHOD.md](METHOD.md).

## Single mode hands off at 50 percent

A single-mode Claude session hands off to a fresh one instead of running into
Claude Code's automatic summary. 45 percent context starts the wrap-up, 50 is
the usual hand-off, 70 the hard cap.
[SINGLE.md](SINGLE.md#hand-off-at-50-percent-context) has the rule and
`orchestration/single/handoff.sh` the mechanics. It reuses the orchestrator
skill's gauge reader rather than adding another.

## Build speeds become build variants

Three named [build variants](METHOD.md#build-variants) replace the speeds.
Hardened production is slow, unchanged. Production keeps Sol's approval of
every head but drops stacks, rebase re-checks and caps on open pull requests.
Prototype has no Sol. It differs from fast, which merged unreviewed code into
the product and did not hold, in that it never touches real data and is
promoted through the review-debt method before it does.

## The blind pair retired

Every variant with Sol runs one loop: the builder sends the head to Sol, Sol
sends findings back, and the builder fixes, until Sol approves the exact head
([Review rounds](METHOD.md#review-rounds)). No second reviewer reads beside
Sol on a piece, a plan or a stage.

- **What it was.** Two blind reviewers from different companies working in
  parallel, one for cross-cutting correctness and one for security and
  over-engineering, each reading a whole plan, batch or stage without seeing
  the other.
- **What it caught.** Real blocking findings on code Sol had approved piece by
  piece.
- **What it cost.** A frozen batch and a prep pack for every run, and a second
  reviewer competing with Sol for review capacity.
- **What survives.** The catches came from reading the whole range after the
  per-piece approvals, not from the pairing. That read stays, with Sol as the
  only reviewer: the capability review before a switch turns on
  ([Building on `main`](METHOD.md#building-on-main), item 7), Sol's
  stage-end read ([Section-end passes](METHOD.md#section-end-passes)) and
  Sol's plan review ([Before the build](METHOD.md#before-the-build-plan-deep)).
  The director's read and the race attack carry the security lens on
  sensitive pieces.

## Dropped, and why

Every rule Code Factory dropped, replaced or reversed, so a returning rule can
be checked against it. A rule on this list comes back only through
[FLEET.md](FLEET.md#how-this-changes).

| # | What was tried | Why it went, or what replaced it | Evidence |
| --- | --- | --- | --- |
| 1 | Long prose briefs on a common file | Short self-contained briefs | [above](#from-long-prompts-to-short-briefs) |
| 2 | Copilot review on every push, as a gate | Sol is the reviewer of record, and no reviewer is a gate | [above](#copilots-place-in-the-chain-and-why-it-left) |
| 3 | The per-stage first-kit pipeline | Its checks moved to the product's repository | [above](#build-speeds-before-trunk) |
| 4 | Many Sol rounds per pull request | Two rounds; see 13 | WHAT-WORKED |
| 5 | The 400-line pull request gate | A guide, then [800 lines](METHOD.md#pull-request-size) | LESSONS, CI-CHECKS |
| 6 | A per-file cap with no waiver; moves counted as new | Moves are measured as moves | LESSONS |
| 7 | Strict "up to date" | Dropped where a merge queue tests the combined head. It stays on for a private repo with no queue and no tree-binding landing tool ([SINGLE.md](SINGLE.md#small-pull-requests-merged-as-they-go)) | LESSONS |
| 8 | CI sharding for speed | CI-only shards | LESSONS, SKILL-WATCH |
| 9 | Fast: land on green, Sol after | Trunk, with each piece reviewed before it merges | [above](#build-speeds-before-trunk) |
| 10 | Medium: slices, batch cuts, batch-end reviews | Trunk | [above](#build-speeds-before-trunk) |
| 11 | Three-tier model trial | Held for research | WHAT-WORKED |
| 12 | Minimal reviews until Sol had room | Replaced by review before merge | WHAT-WORKED |
| 13 | Three-round cap | Two rounds, then split or a director read ([Review rounds](METHOD.md#review-rounds)). Single mode's high rank keeps 3 | SKILL-WATCH |
| 14 | Seat stops moved within the week | Per-seat caps set by the owner | WHAT-WORKED |
| 15 | Heavy work split evenly across two machines | Heavy runs go to the check machine | WHAT-WORKED |
| 16 | Self-hosted runner on a public repo | An outside pull request could run code on it; hosted runners ([METHOD.md](METHOD.md#where-the-full-tests-run)) | WHAT-WORKED, SKILL-WATCH |
| 17 | Orchestrator handover at 30 percent | Now 45 / 50 / 70 ([context](METHOD.md#seats-lanes-and-stops)) | WHAT-WORKED |
| 18 | Sol's proof applied unchanged, then a fresh Opus writing it | The lane writes the test from Sol's scenario | [above](#cut-to-the-fleet-model) |
| 19 | One unit per orchestrator turn | Owed units run back to back | WHAT-WORKED |
| 20 | Director lines typed into busy panes | Files, with pointers in panes | WHAT-WORKED |
| 21 | Custody proofs at every close | Production secrets only | WHAT-WORKED |
| 22 | Codex orchestrator on a large-context profile, late handover | Opus orchestrates, with the usual handover points | WHAT-WORKED |
| 23 | Temporary model split, FIX-DIFF-READ, SIMPLE or OPUS tags | Temporary by design; tags renamed ordinary or sensitive | [above](#cut-to-the-fleet-model) |
| 24 | Orchestrator as the one integrator; enqueue by it; ORCH-DECISION | The lane owns its piece to merged; the merge script merges | [above](#cut-to-the-fleet-model) |
| 25 | Director over orchestrator over lanes; lanes stop and report | Lanes own their piece to merge ([FLEET.md](FLEET.md#roles)) | WHAT-WORKED |
| 26 | Setting aside the cross-model rule | Reversed: Claude builds, Sol only reviews ([models](FLEET.md#models)) | [above](#cut-to-the-fleet-model) |
| 27 | Race attack as a separate gate | Kept as the lane's own test work | [above](#cut-to-the-fleet-model) |
| 28 | Handback files, close acknowledgements, wrap-up documents | The three PR lines and `close-out` ([FLEET.md](FLEET.md#paperwork-four-things-per-agent-nothing-else)) | WHAT-WORKED |
| 29 | Core-then-chunks; phase-end sweep; blind pair on plans and stages | Trunk; the pair is retired (see 58) | [above](#the-blind-pair-retired) |
| 30 | A fixed percentage seat stop | The owner's per-seat caps | [above](#cut-to-the-fleet-model) |
| 31 | Condense passes | Fixes stay small instead | [above](#cut-to-the-fleet-model) |
| 32 | The fork-versus-fresh measure; PARKED lines | Sub-agents start fresh; milestone lines only | [above](#cut-to-the-fleet-model) |
| 33 | Proof runs tied to one machine; an error tracker's quota | Detail of one setup | [above](#cut-to-the-fleet-model) |
| 34 | The lean core (`LEAN.md`, `docs/lean/`) | Full or single mode | [above](#two-modes-and-the-lean-core-retired) |
| 35 | A frozen custom runner for switch-ons | Use the app's own tools; rehearse writes and preserve a restoration copy | WHAT-WORKED |
| 36 | Wrap-up on the PR | `Why`, `Left undone`, `Closes` | WHAT-WORKED |
| 37 | Merge scripts and round tools copied per orchestrator | The one merge script | WHAT-WORKED |
| 38 | `queue-keeper.sh`, `queue-watch.sh` | Replaced by the merge script | WHAT-WORKED |
| 39 | Re-review of every new head, no carry | [Carried approvals](METHOD.md#building-on-main), item 6. Approval stays bound to the exact head | WHAT-WORKED |
| 40 | A timed pre-check fallback | No fallback ([METHOD.md](METHOD.md#the-merge-pipeline)) | SKILL-WATCH |
| 41 | Per-PR GitHub polling loops | One shared reader ([METHOD.md](METHOD.md#the-merge-pipeline)) | SKILL-WATCH |
| 42 | Fixed concurrency caps ("at most 2 at once", a 2-slot cap, a fixed load limit) | Capacity read by machine ([METHOD.md](METHOD.md#the-merge-pipeline)) | SKILL-WATCH |
| 43 | Pre-check batches of 6 | At most 3 ([METHOD.md](METHOD.md#the-merge-pipeline)) | SKILL-WATCH |
| 44 | Director hourly check; kick at 120 minutes | Stall alerts at 30 and 45 minutes | SKILL-WATCH |
| 45 | Train-enqueue of stacks | Top-carry or serial | none |
| 46 | Speeds slow, medium and fast | [Build variants](METHOD.md#build-variants) | [above](#build-speeds-become-build-variants) |
| 47 | Caps on open, ready or approved pull requests | Capacity caps only | [METHOD.md](METHOD.md#seats-lanes-and-stops) |
| 48 | Stacked pull requests and restacks | No stack by default (hardened: two exceptions by top-carry; [production.md](variants/production.md#what-changes), [hardened](variants/hardened-production.md#production-learnings-adopted)) | production.md |
| 49 | Sol re-reads of identical rebases | The carry | [METHOD.md](METHOD.md#building-on-main), item 6 |
| 50 | Strict "up to date" (production, with a landing tool only) | Waits for a shadow-landing trial ([production.md](variants/production.md#what-changes), change 11) | production.md |
| 51 | Sol effort medium, then high, then by risk | [SOL-EFFORT.md](SOL-EFFORT.md) | CI-CHECKS |
| 52 | Two Sol slots kept for sweeps | Pull request rounds first | CI-CHECKS |
| 53 | Queue width 5, back to 3 | Width by runner slots | WHAT-WORKED |
| 54 | Postgres 18 look-ahead on the merge path | Slow optional jobs run nightly | CI-CHECKS |
| 55 | Lean `RULES` file and tunables file | Went with the lean core | git history |
| 56 | Owner holds on every review ceiling | Routine reds never wait on the owner; [the ladder](METHOD.md#review-rounds) | SKILL-PROPOSALS |
| 57 | Medium and fast forecasts; first-batch experiment | Trunk | [above](#build-speeds-before-trunk) |
| 58 | The blind pair everywhere | The builder and Sol loop | [above](#the-blind-pair-retired) |
| 59 | Leaving deslop out because it overlaps simplify | Superseded: METHOD's [section-end passes](METHOD.md#section-end-passes) run deslop on the code | none |
| 60 | Orchestrator check-ins to the owner (cost, fill, holds, dispatch lines, section reports) | The owner gets only [What reaches the owner](METHOD.md#what-reaches-the-owner); the rest goes to the state note, which the director reads on each check | METHOD |
