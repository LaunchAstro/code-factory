# How the loop got its shape

Two things changed between 17 and 21 September 2026, and both cost money to
learn. Briefs went from prose to numbered files. Copilot went from a reviewer
in the chain to nothing at all. Every figure below comes from `docs/rounds/`,
with the file named.

## From long prompts to short briefs

The night of 17 to 18 September is the control. Rules were written as
sentences, there was no round cap, and the lane reading the ceilings was the
same lane deciding whether one more round was fine. It produced 4 merges for
USD 243, 132 Codex sessions, 41 Copilot reviews and 12h55m of wall
(`Verification Loop — Consolidated Learnings and Plan of Attack —
2026-09-21.md` section 6). Section 3.3 of the same file is blunt about the
mechanism: long instructions bury the ceremony. SCORE-R5's first reply carried
no model line and no BOOTED phrase. FIX-R2-45 pushed twice against a ceiling of
one. Several lanes wrote their artefacts to the wrong root.

The fix started on 18 September, with numbers and file names in place of
sentences. Round 6 is where the shorter brief got measured. Lanes until then
read a common file plus their own brief; round 6's common file ran to 1,430
words (`Verification Loop Round 6 — 2026-09-21.md`, and `ROUND6-LEDGER.tsv`
line 3 shows the arithmetic: a 338-word template on top of it makes 1,768).
Mid-round the owner asked for the instructions to be cut, and FIX-R6-15 got a
self-contained brief of 324 words with no common file at all.

The two fix lanes, side by side (`ROUND6-REPORT.md`):

| Lane | Brief | Criteria | Wall | Cost | Context |
| --- | --- | --- | --- | --- | --- |
| FIX-R6-14 | 1,768 words | 3 of 3 | 20m32s | $6.59 | 20 percent |
| FIX-R6-15 | 324 words | 5 of 5 | 4m57s | $2.07 | 10 percent |

They fixed different defects, so the cost gap is a ratio and not a proof. What
the short brief does prove is narrower and better: nothing the long one carried
was needed for compliance. Both handbacks were complete.

The rule that came out of it is in section 1 of the consolidated learnings,
written as "a self-contained file under 500 words, with the ceilings as
numbers in the first screen and the task in the exact commands the lane will
run". Round 7 ran it
at under 600 words per brief, which is where it settled
(`Verification Loop Round 7 — 2026-09-21.md`). The premise check is item 5 of
that same section and the part that earns its keep. Section 3.1 lists five cases,
four rounds and the fix night, where a lane was told to do something the
repository could not support, told not to ask, and improvised.

## Copilot's place in the chain, and why it left

Copilot was a real layer at the start. Round 1 drew 10 reviews, the fix night
drew 41 (consolidated learnings section 6). The template in force then said
"Copilot review on every push", and `NEXT.md` L2 records what that did: Copilot
was not consistently available for required reviews: it was absent for three planted defects and sixteen of seventeen fix
heads, and nothing went red (consolidated learnings section 4, owner decision 1).

The absence mattered less than it looked, because Copilot was never a gate
(`REPORT.md` line 116). What it did do was stranger. The eight pull requests
GitHub reported as `BLOCKED` before round 1's cleanup were exactly the eight
with unresolved Copilot threads (`REPORT.md` line 112).
Three of the four that read `CLEAN` carried a planted defect. Copilot was
holding merges on whether its comments had been ticked off, not on whether the
code was sound.

Owner decision 1 closed it: a reviewer is never a gate, and Copilot is out.
Every round from 2 to 7 recorded Copilot 0 (consolidated learnings section 6 for
rounds 2 to 6, `ROUND7-REPORT.md` line 55 for round 7). Round 2's totals are
Sol 12 of 12, Copilot 0 of 12 (`ROUND2-REPORT.md` line 114).

Sol took the seat. Sol is gpt-5.6-sol run through the Codex CLI, posting as a
collaborator account that is not the builder's (`Verification Loop Rounds 4-5 —
2026-09-21.md`). It names planted defects at the file and line: 8 of 10 in round
1, 4 of 4 in round 2, 2 of 2 in rounds 3 and 5, and 2 of 2 on round 6's first
heads (consolidated learnings section 2). Its review is the review of record, and the
`review evidence for this revision` context reads the verdict off it and turns
a required check red or green with nobody reading the diff. Round 7 has it
working both ways: run 35549439261 green on an approve, run 35550046689 failing
on a refusal by design (`ROUND7-LEDGER.tsv`).

<a id="the-chain-today"></a>

## The chain on 21 September 2026

1. A build lane takes the ticket to a draft pull request, plan commit first.
2. A Sol session reads the plan and the diff at that head, and posts one review.
3. `review evidence for this revision` reads that review and goes red or green.
4. The orchestrator decides on the counts while a human is watching the round, merge, one fix pass or hold, and the runner takes that step overnight only once its merge step is written, which `template/scripts/runner/` does not yet carry.
5. A fix lane closes the one `Criterion:` line, and the head goes back to Sol.

## Retired on 28 September, revived as the method on 29 September

On 28 September 2026 the owner retired Code Factory and the repository was
archived. Its per-stage pipeline had been judged far too heavy on 22
September; the owner's rule since then is "plan deep, build in bulk, edit in
post". The checks it proved moved into the Ops Astro product repository, and
the orchestration moved into the orchestrator skill.

Ops Astro's build then ran for two days. Its core, 16 fixes and the parts
beside them, went through small pull requests with up to three Sol reviews
each: 157 review results over 54 pull requests. Nearly every first read found
a real problem, and a merged pull request waited a median of 4.4 hours from
first approval to merge. On 29 September the owner compressed the plan: finish
the core, then recut the rest into big slices built in batches, 400 lines a
guide and never a gate, and review strength on client data, races, secrets,
money and weak tests never trimmed. Two reviewers from different companies,
Fable and Astra, then read the plan and the build data blind, talked it
through and signed one consensus.

The owner asked for all of that to be written down for reuse, and Code Factory
was unarchived on 29 September to hold it. [METHOD.md](METHOD.md) is the method,
[LESSONS-2026-09.md](LESSONS-2026-09.md) what went wrong and the rule each
incident taught, [CHECKLIST.md](CHECKLIST.md) the builder checklist, and
[SKILL-PROPOSALS.md](SKILL-PROPOSALS.md) the skill changes it suggests, none
applied. The chunks phase is unproven until batch 1, and these files are
refreshed with batch 1's evidence. `docs/rounds/`, `template/` and
`orchestration/` stay as the record of the first kit.

## Build speeds before trunk

What the [build speeds](METHOD.md#build-speeds) measured up to the trunk
decision of 2 October 2026, under the processes they ran.

Phase 1, the core: 16 fixes merged in about 30 hours, 2 of about 46 pull
requests passed Sol's first read, and a merged pull request waited a median of
4.4 hours from first approval to merge. Review earned its keep, catching one
business writing into another's sign-in records, a private task showing in
another person's tab, and weak tests. The queue was the drag: nearly every fix
needed a waiver from the 400-line gate, and the up-to-date rule cost 60 rebases
of about 26 minutes of tests each. That is why the rest is built in chunks.

**Slow** built the core's 16 fixes; its evidence closes Phase 1. **Medium**
built the core's 23 build pieces and batch 1 so far, in the batch flow. Groups
A to D merged in about 5 hours overnight with up to 16 lanes working; the last
piece took 14 hours or more over four rounds and grew to about 2,500 lines,
mostly proof tests. Slice pull requests grew to 13,000 to 24,000 lines, too big
for a later agent to read, and fix rounds bloated code until something capped
them. A piece that proves the whole system reruns its full check whenever
`main` moves, so it lands on a still `main`.

Slow ran under a 400-line cap and medium with no size gate, before the 800-line
rule of 30 September. **Fast**, until 2 October, landed non-sensitive pieces on
green automatic checks (security scan, data-separation tests, types, lint); Sol
reviewed them afterwards and its findings got small follow-up fixes. Batches
closed in order after the batch-end review. Its forecast was far less waiting,
perhaps 10 to 30 percent more rework later, mostly on screens, and a working
internal prototype on staging within about a week of batch 1 merging.

## Cut to the fleet model, 15 October 2026

METHOD.md went from 732 lines to about 340 to match [FLEET.md](FLEET.md), after
the owner's session that day (private ticket #154).
The full earlier text is METHOD.md at commit `360e60f`. What left, in short:

- **Roles, lane declarations, records and reports:** FLEET.md now owns them.
  The lane owns its piece to merge; the orchestrator no longer integrates or
  logs `ORCH-DECISION`; the director's watchdog and nudge timers became
  FLEET.md's tripwires and budget watcher.
- **Ops Astro round rules of 14 October:** the temporary model split ends on
  18 October and FLEET.md's model split replaces it. `FIX-DIFF-READ`
  (an Opus read of every Codex fix diff) went with it, under FLEET.md's
  "never twice". The `SIMPLE` or `OPUS` tag stayed, renamed ordinary or
  sensitive.
- **Enqueue by the orchestrator:** replaced by the merge script's loading bay.
- **The cross-model rule** (12 October, a model's review of its own company's
  work clears nothing): FLEET.md had Sol build ordinary pieces and Sol review
  everything, so the rule no longer held as written. It holds again: from
  17 October the owner had Opus build and Sol only review ("use opus not
  codex … to build … except for the review"), and FLEET.md's
  [models](FLEET.md#models) say so from 26 October.
- **Proof tests by a fresh Opus sub-agent** (5 October): the lane writes the
  proof from Sol's scenario, since FLEET.md has the lane fix its own findings.
- **The race attack by a separate sub-agent** (12 October): kept as the
  lane's own test work on sensitive pieces, not a gate; FLEET.md's one Opus
  read of those pieces is the director's.
- **Closure checks** (handback files, custody proofs, close acknowledgements,
  a lane closing once queued): a lane now closes after its merge, with its
  wrap-up in the pull request; custody proofs only for production secrets.
- **Build speeds and the core-then-chunks phases:** collapsed into slow by
  default on trunk. The speed tables are above.
- **Smaller dated detail** (the 85 percent seat stop, condense passes, the
  fork-versus-fresh sub-agent measure, Sol's proof runs on the laptop, the
  GlitchTip quota): dropped. Seat caps are the owner's, kept with the seat
  roster.

## Two modes, and the lean core retired, 15 October 2026

The owner, 15 October 2026: "we won't worry about the lean mode we'll just go
with either the full mode or the singular mode there's no real option in
between because the lean mode lean core didn't really work very well".

- **Retired:** `docs/LEAN.md` and its seven chunks in `docs/lean/`, the
  website-template trial of 5 October. They are in git history before this
  entry.
- **Added:** [SINGLE.md](SINGLE.md), single mode. One agent takes one problem
  to merged, runs Sol's review itself and merges through the repository's own
  gates (the loading bay where there is a merge queue). No director,
  orchestrator or merge agent. Its steps are the `single-agent` skill.
- Full mode stays [FLEET.md](FLEET.md) and [METHOD.md](METHOD.md).

## Single mode hands off at 50 percent, 17 October 2026

The owner, 17 October 2026, during the work-map build, where one session
reached 44 percent context with four pull requests in flight and about eleven
tickets left: a single-mode Claude session hands off to a fresh one instead of
running into Claude Code's automatic summary. 45 percent starts the wrap-up,
50 is the usual hand-off, 70 the hard cap.
[SINGLE.md](SINGLE.md#hand-off-at-50-percent-context) has the rule and
`orchestration/single/handoff.sh` the mechanics; it reuses the orchestrator
skill's gauge reader rather than adding another.

## Build speeds become build variants, 25 October 2026

The owner replaced the speeds with three named variants
(private ticket #270,
[Build variants](METHOD.md#build-variants)). Slow became hardened
production, unchanged, and keeps its old name. Production is new, built from
the raw-to-export audit (`raw-to-export-2026-10/AUDIT.md`, a private round record): Sol still
approves every head, but stacks, rebase re-checks and caps on open pull
requests go. Prototype has no Sol; it differs from fast, which merged
unreviewed code into the product and did not hold, in that it never touches
real data and is promoted through the review-debt method before it does.

## The blind pair retired, 26 October 2026

The owner, 26 October 2026: "we don't need two independent blind reviewers
... a builder that then sends it to sol and then sol sends it back to the
builder to make a fix". Every variant with Sol now runs that loop until Sol
approves the exact head ([Review rounds](METHOD.md#review-rounds)), and no
second reviewer reads beside Sol on a piece, a plan or a stage.

- **How it started.** On 28 September the owner asked for "a review on each
  stage as well not just a sole review" (ops-astro-roadmap
  `docs/decisions/build-and-review.md`). Agents designed the answer as two
  blind reviewers working in parallel, Astra (another company) for
  cross-cutting correctness and Opus 5.5 for security and over-engineering,
  each reading a whole plan, batch or stage without seeing the other. The
  pairing and the second company were the agents' design, not the owner's
  ask. METHOD took it in on 29 September (`f7da31f`), the vault skills on
  30 September.
- **The 15 October cut was never recorded.** The cut to the fleet model
  (`838628b`) took the pair out of METHOD, and FLEET.md said "Never twice",
  but the list of what left (above) didn't name it. The skills installed on
  25 October were built on an older candidate and still ran it.
- **What it caught.** Four runs, none after 9 October and none on
  raw-to-export. 28 September, the plan's final gate: 59 distinct findings
  with a code review beside it, all confirmed. 30 September to 1 October,
  batch 1's end (a frozen head of 631 files): 13 blocking findings plus one
  minor ruled blocking, only one shared with Sol, all on code Sol had
  approved piece by piece. 2 October, stage 2's plan (Opus half only): 36
  blocking. 9 October, an SEO batch end (Opus half only): 1 blocking and 4
  major, each reproduced, on pieces that had passed Sol. One part-finding
  was refuted.
- **What it cost.** At least about 2.5 agent-hours recorded, and more in
  structure: a frozen batch and a prep pack for every run (batch 1 needed 5
  prep sessions over 15 hours), and an Astra half competing with Sol for review
  capacity.
- **What survives.** The catches came from reading the whole range after the
  per-piece approvals, not from the pairing. That read stays, with Sol as the
  only reviewer: the capability review before a switch turns on
  ([Building on `main`](METHOD.md#building-on-main), item 7), Sol's
  stage-end read ([Section-end passes](METHOD.md#section-end-passes)) and
  Sol's plan review ([Before the build](METHOD.md#before-the-build-plan-deep)).
  The director's read and the race attack carry the security lens on
  sensitive pieces. The full record is
  the CF-Refine audit (`refine-2026-10/AUDIT.md`, a private round record).

## Dropped, and why

Every rule Code Factory dropped, retired, replaced or reversed, so a
returning rule can be checked against it. Seeded from
the CF-Refine audit (`refine-2026-10/AUDIT.md`, a private round record),
appendix A, on 26 October 2026; "Record" names where the evidence is. A rule
on this list comes back only through [FLEET.md](FLEET.md#how-this-changes).

| # | What | When | Why, or what replaced it | Record |
| --- | --- | --- | --- | --- |
| 1 | Long prose briefs, a common file | 18-21 Sep | Long instructions buried the ceremony; short numbered briefs | [above](#from-long-prompts-to-short-briefs) |
| 2 | Copilot review on every push, as a gate | 21 Sep | Not consistently available; missed planted defects | [above](#copilots-place-in-the-chain-and-why-it-left) |
| 3 | The per-stage first-kit pipeline | 22, 28 Sep | Retired with the first kit; its checks moved to the product repo | [above](#build-speeds-before-trunk), README |
| 4 | Up to 3, then 9, Sol rounds per pull request | 29 Sep, 4 Oct | Pace; see 13 | WHAT-WORKED |
| 5 | The 400-line pull request gate (FU-400) | 29-30 Sep | Nearly every fix needed a waiver; a guide, then [800 lines](METHOD.md#pull-request-size) | LESSONS, CI-CHECKS |
| 6 | A per-file cap with no waiver; moves counted as new | 29 Sep | No way through for real work; moves are measured as moves | LESSONS |
| 7 | Strict "up to date" | 1 Oct | 60 rebases of about 26 minutes each; dropped where a merge queue tests the combined head. It stays on for a private repo with no queue and no tree-binding landing tool (26 Oct) | LESSONS, [SINGLE.md](SINGLE.md#small-pull-requests-merged-as-they-go) |
| 8 | CI sharding for speed | Sep | Dropped for tokens; back on 12 Oct as CI-only shards (owner, 4 and 12 Oct) | LESSONS, SKILL-WATCH |
| 9 | Fast: land on green, Sol after | 2 Oct | Did not hold on stage 1 | [above](#build-speeds-before-trunk) |
| 10 | Medium: slices, batch cuts, batch-end reviews | 2 Oct | Slice pull requests of 13,000 to 24,000 lines; trunk | [above](#build-speeds-before-trunk) |
| 11 | Three-tier model trial | 1-2 Oct | Held for research; never ran | MODEL-SPLIT |
| 12 | Minimal reviews until Sol had room | 2 Oct | A stopgap: owed rows grew, none cleared | WHAT-WORKED |
| 13 | Three-round cap | 12, 19 Oct | 8 round-3 holds in 2 hours; two rounds, then split or a director read ([Review rounds](METHOD.md#review-rounds)). Single mode's high rank keeps 3 | SKILL-WATCH |
| 14 | Seat stops moved within the week | 2 Oct | The build sat idle 12.3 hours; the owner's per-seat caps | WHAT-WORKED |
| 15 | Heavy work split half laptop, half M5 | 4 Oct | Every dispatch went to the laptop; heavy runs on the M5 | WHAT-WORKED |
| 16 | Self-hosted runner on a public repo | 4 Oct | An outside pull request could run code on it; hosted runners | [METHOD.md](METHOD.md#where-the-full-tests-run) |
| 17 | Orchestrator handover at 30 percent | 5 Oct | 22 minutes in the seat; now 45 / 50 / 70 ([context](METHOD.md#seats-lanes-and-stops)) | WHAT-WORKED |
| 18 | Sol's proof applied unchanged, then a fresh Opus writing it | 5, 15 Oct | The lane writes the test from Sol's scenario | [above](#cut-to-the-fleet-model-15-october-2026) |
| 19 | One unit per orchestrator turn | 14 Oct | Owed work sat idle until a nudge | WHAT-WORKED |
| 20 | Director lines typed into busy panes | 14 Oct | Lines stranded at handovers; files, with pointers in panes | WHAT-WORKED |
| 21 | Custody proofs at every close | 14 Oct | 0 catches in 75 closures; production secrets only | WHAT-WORKED |
| 22 | Codex orchestrator, 500k profile, handover at 75 percent | 15 Oct | Opus orchestrates; the 75 went on 26 Oct | WHAT-WORKED |
| 23 | Temporary model split, FIX-DIFF-READ, SIMPLE or OPUS tags | 15, 18 Oct | Ended 18 Oct; tags renamed ordinary or sensitive | [above](#cut-to-the-fleet-model-15-october-2026) |
| 24 | Orchestrator as the one integrator; enqueue by it; ORCH-DECISION | 15 Oct | The lane owns its piece to merged; the merge script merges | [above](#cut-to-the-fleet-model-15-october-2026) |
| 25 | Director over orchestrator over lanes; lanes stop and report | 15 Oct | Returns sat unread; [FLEET.md](FLEET.md#roles) | WHAT-WORKED |
| 26 | The cross-model rule | 15 Oct | FLEET.md's split let Sol build; back from 17 Oct: Claude builds, Sol only reviews ([models](FLEET.md#models)) | [above](#cut-to-the-fleet-model-15-october-2026) |
| 27 | Race attack as a separate gate | 15 Oct | Kept as the lane's own test work | [above](#cut-to-the-fleet-model-15-october-2026) |
| 28 | Handback files, close acknowledgements, wrap-up documents | 15 Oct | Paperwork; the three PR lines and `close-out` | [FLEET.md](FLEET.md#paperwork-four-things-per-agent-nothing-else) |
| 29 | Core-then-chunks; phase-end sweep; blind pair on plans and stages | 15 Oct | Trunk; the pair retired on 26 Oct | [above](#the-blind-pair-retired-26-october-2026) |
| 30 | The 85 percent seat stop | 15 Oct | The owner's per-seat caps | [above](#cut-to-the-fleet-model-15-october-2026) |
| 31 | Condense passes | 15 Oct | Fixes stay small instead | [above](#cut-to-the-fleet-model-15-october-2026) |
| 32 | The fork-versus-fresh Measure; PARKED lines | 15 Oct | Sub-agents start fresh; milestone lines only | [above](#cut-to-the-fleet-model-15-october-2026) |
| 33 | Sol's proofs on the laptop; the GlitchTip quota | 15 Oct | Dated detail | [above](#cut-to-the-fleet-model-15-october-2026) |
| 34 | The lean core (`LEAN.md`, `docs/lean/`) | 15 Oct | "didn't really work very well"; full or single mode | [above](#two-modes-and-the-lean-core-retired-15-october-2026) |
| 35 | A frozen custom runner for switch-ons | 15 Oct | Use the app's own tools; rehearse writes and preserve a restoration copy. | WHAT-WORKED |
| 36 | Wrap-up on the PR | 15 Oct | Drifts from the code; `Why`, `Left undone`, `Closes` | WHAT-WORKED |
| 37 | Merge scripts and round tools copied per orchestrator | 12-15 Oct | 236 unreviewed forks; the one merge script | WHAT-WORKED |
| 38 | `queue-keeper.sh`, `queue-watch.sh` | 11 Oct | Replaced by the merge script | rounds/2026-10-11-slice-one-landing |
| 39 | Re-review of every new head, no carry | 11 Oct (unproven) | Every move of `main` staled every waiting PR; [carried approvals](METHOD.md#building-on-main), item 6. Approval stays bound to the exact head | WHAT-WORKED |
| 40 | The 45-minute pre-check fallback | 19 Oct | Let 10 PRs in unchecked; no fallback | [METHOD.md](METHOD.md#the-merge-pipeline) |
| 41 | Per-PR GitHub polling loops | 19 Oct | One shared reader | [METHOD.md](METHOD.md#the-merge-pipeline) |
| 42 | "At most 2 at once", the 2-slot cap, laptop load 50 | 18-19 Oct | Lanes waited while the M5 idled; read by machine | [METHOD.md](METHOD.md#the-merge-pipeline) |
| 43 | Pre-check batches of 6 | 19 Oct | One red held five; at most 3 | [METHOD.md](METHOD.md#the-merge-pipeline) |
| 44 | Director hourly check; kick at 120 minutes | 19 Oct | Validate stall alerts against configured thresholds; 30 and 45 minutes | SKILL-WATCH |
| 45 | Train-enqueue of stacks | 20 Oct | One goal merge in 3 hours; top-carry or serial | rounds/2026-10-20-ops-live-agent-run-night.md |
| 46 | Speeds slow, medium and fast | 25 Oct | [Build variants](METHOD.md#build-variants) | [above](#build-speeds-become-build-variants-25-october-2026) |
| 47 | Caps on open, ready or approved pull requests | 25, 26 Oct | Froze pull request opening for about 6.4 hours; capacity caps only | [METHOD.md](METHOD.md#seats-lanes-and-stops) |
| 48 | Stacked pull requests and restacks | 25, 26 Oct | Cost #177 seven heads; no stack by default (hardened: two exceptions by top-carry) | [production.md](variants/production.md#what-changes), [hardened](variants/hardened-production.md#production-learnings-adopted-owner-26-october-2026) |
| 49 | Sol re-reads of identical rebases | 2, 25 Oct | 74 re-checks found nothing; the carry | [METHOD.md](METHOD.md#building-on-main), item 6 |
| 50 | Strict "up to date" (production, with a landing tool only) | 25 Oct | Not yet proven: waits for raw-to-export's `LAND-SHADOW` evidence | [production.md](variants/production.md#what-changes), change 11 |
| 51 | Code Factory retired, then revived | 28-29 Sep | Revived to hold the method | [above](#build-speeds-before-trunk) |
| 52 | Sol effort medium, then high, then by risk | 17 Oct | [SOL-EFFORT.md](SOL-EFFORT.md) | CI-CHECKS |
| 53 | Two Sol slots kept for sweeps | 19 Oct | Pull request rounds first | CI-CHECKS |
| 54 | Queue width 5, back to 3 | 12 Oct | Width 5 added nothing; width by runner slots | WHAT-WORKED |
| 55 | Postgres 18 look-ahead on the merge path | 4 Oct | Slow optional jobs run nightly | CI-CHECKS |
| 56 | Lean `RULES` file and tunables file | 15 Oct | Went with the lean core | git history |
| 57 | Owner holds on every review ceiling | 12 Oct | Routine reds never wait on the owner; [the ladder](METHOD.md#review-rounds) | SKILL-PROPOSALS |
| 58 | Medium and fast forecasts; first-batch experiment | 2 Oct | Trunk | rounds/SOL-TRUNK-REVIEW-2026-10-02.md |
| 59 | The blind pair everywhere | 26 Oct | The owner's builder and Sol loop | [above](#the-blind-pair-retired-26-october-2026) |
| 60 | deslop "not used: overlaps simplify" (owner, 21 September) | 21 Sep | Superseded: METHOD's [section-end passes](METHOD.md#section-end-passes) run deslop on the code | SKILLS-BY-STAGE (`SKILLS-BY-STAGE-2026-09-21.md`, a private round record) |
| 61 | Orchestrator check-ins to the owner (cost, fill, holds, dispatch lines, section reports) | 26 Oct | Owner's S3 ruling (private ticket #351): the owner gets only "What reaches the owner"; the rest goes to the state note, which the director reads on each check | [METHOD.md](METHOD.md#what-reaches-the-owner) |
