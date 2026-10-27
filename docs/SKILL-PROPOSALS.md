# Skill proposals

*A record of how the method got here, kept as evidence for [HISTORY.md](HISTORY.md#dropped-and-why). You don't need it to run a build; start at the [reading order](../README.md#where-to-start).*

Changes the method in [METHOD.md](METHOD.md) suggests for the orchestration
skills. Each proposal carries its status, checked against the skills installed
on 26 October 2026; one with no status is still open. The owner's rule: a skill changes only on evidence
gathered over time and after a grilling with the owner, never on one session's
lesson, and a revision that only adds is suspect. So each proposal says what
evidence exists, what would settle it, and whether the skill grows or shrinks.
Changes made since 1 October 2026, and findings waiting on a second sighting,
are in [SKILL-WATCH.md](SKILL-WATCH.md).

The skills are `orchestrator`, `director` (with `kick.sh`),
`claude-subscription-switch` and `afk-orchestrator`, as they stood on 29
September 2026.

## orchestrator

1. **Applied by 26 October 2026**: the skills carry neither figure and point at METHOD. Was: **Ceilings table: two figures behind the owner's rules.** It still says "at
   most 3 panes per seat" and "each pull request under 400 lines of product
   code". The owner has since set up to 10 working lanes per seat with a floor
   of 6. Pull request size lives in [METHOD.md](METHOD.md#pull-request-size).
   Evidence: the owner's MORE-PANES, SIX-ALWAYS and COMPRESS files
   (addenda 2 and 4); the decisions register, section 20.
   Size: replaces two cells, no growth. Ready for a grilling now.
2. **Applied by 26 October 2026**: the orchestrator counts working lanes per seat. Was: **Count working lanes, not open panes.** One orchestrator sat at its cap
   with two lanes working. Evidence: the MORE-PANES file; `events.log` 1453.
   Size: one clause in section 8. Ready now.
3. **Superseded 26 October 2026**: the section-end passes live in METHOD and run on the section's code. Was: **Stage-end passes on the section's code only.** Section 7 says the passes
   run "over all of `main`"; the owner changed that to the section's own code
   on 29 September (COMPRESS addendum 3). Size: two words. Ready now.
4. **Applied 26 October 2026**: the skills link METHOD's sections. Was: **Point at METHOD.md instead of restating it.** Sections 2, 6 and 7 restate
   rules METHOD.md now holds. A pointer shrinks the skill and leaves one copy
   to drift. Size: shrinks. Wait until batch 1 confirms METHOD.md holds up.
5. **Superseded 26 October 2026**: batches, the one integrator and the frozen batch head left the skills with the owner's builder–Sol loop. Was: **The chunks phase.** The skill's brief section assumes one unit per lane
   per session. Slices, batches, the batch pull request, the one integrator,
   the frozen batch head and Sol's attestation are all unproven. Wait for batch
   1's evidence, then propose the smallest wording that covers them.

## director

6. **Watch disk and working lanes by default.** Both are already in its
   "Watching" list; the proposal is that `kick.sh` logs the free disk and the
   working-lane count with each kick, so the director reads numbers rather
   than looking. Evidence: the disk incident (`events.log` 1371 to 1399) and
   the relay's lane-count nudges. Size: a few lines of script. Needs a
   grilling on whether the kicker should stay token-free and silent.
7. **A generic name for the owner's instruction files.** They are named after
   this owner (`NATHAN-<TOPIC>.md`). A reusable skill would say
   `OWNER-<TOPIC>.md`. Size: rename only. Low priority.

## afk-orchestrator

8. **Its citations resolve again.** It cites `RUNNER-SPEC-2026-09-18.md` and
   `ROUND2-REPORT.md` in this repository, which was archived on 28 September
   and revived on 29 September, so the citations work. Its switched-off status
   (condition 1 open) is unchanged. Proposal: confirm the citations at the next
   grilling rather than re-pointing them. Size: none.

## claude-subscription-switch

No proposal. Model choice lives in Skill Factory's
`models.md` (a private repository).

## Sol's review of the five build skills (CF-12, 3 October 2026)

Sol reviewed `build-review`, `batch-cleanup`, `code-factory`, `orchestrator`
and `sub-agents` as installed on 3 October 2026 (the then-installed skill versions,
judged against METHOD.md and CHECKLIST.md at `69afe53`) and asked for twelve
changes. Each is entered here as a proposal, not applied: one
review is one sighting. Each names Sol's check (a case in its CF-12 proof set,
which failed on that snapshot for the reason given), the part of
[METHOD.md](METHOD.md) it leans on, and whether the skill grows or shrinks.
The first five are the ones Sol rated most serious.

9. **Applied 26 October 2026**: Sol approves every head in both Sol variants. Was: **Every piece lands only on Sol's approval of its exact head**
   (`code-factory/SKILL.md:24`, rule 3 at line 25, `build-review/REVIEWER.md:17`,
   `build-review/SKILL.md:27`). The skills let a fast everything-else piece
   land on green checks before Sol reviews it. The method no longer does:
   [Build speeds](METHOD.md#build-speeds) sends medium and fast through
   Phase 2 (METHOD.md at commit 360e60f, in the private history), whose step 3 lets no piece enter
   the queue without Sol's approval of its exact head. The land-first fast
   lane is [history](HISTORY.md#build-speeds-before-trunk). Evidence: check
   `fast`; the orchestrator already runs every Code Factory fix piece this
   way (ORCH71, 3 October). Settles it: the three skill lines drop the
   exception and point at Phase 2 step 3. Size: shrinks (an exception removed
   in three places). Since 4 October the landing rule they point at is
   [review rounds](METHOD.md#review-rounds-and-the-catalogue): Sol's approval
   of the exact head or of the change since an approved head (proposal 23).
10. **Superseded 4 October 2026** by the owner's three-round rule; proposal
    23 replaces it. Was: **a real defect still holds a piece after round three**
    (`code-factory/INTEGRATOR.md:7`). The skill turns every finding outside
    the five classes into a follow-up after three rounds; Phase 2 step 4
    holds the piece for any real defect and lets only cosmetic notes and
    edge cases go. Evidence: check `rounds`. Settles it: a pointer to step 4
    in place of the copied rule. Size: shrinks.
11. **Superseded 26 October 2026** by the owner's builder–Sol loop: the one-fix stop left with the blind pair. Was: **The one-fix stop needs all five classes closed**
    (`code-factory/INTEGRATOR.md:15`, reused by stage-end step 5). The skill
    stops after one fix unless a client-data, money or credential finding is
    open; [Section-end passes](METHOD.md#section-end-passes) stops only when
    no real correctness defect and nothing in the five classes remains.
    Evidence: check `batch-fix`. Settles it: link the method's stopping rule.
    Size: shrinks.
12. **Applied 26 October 2026**: the section-end cleanup pull request lands through the normal gate (METHOD). Was: **Cleanup lands through the same exact-head gate**
    (`code-factory/INTEGRATOR.md:19`). The cleanup step merges on green
    checks, but cleanup commits change code after the batch was reviewed.
    Evidence: check `cleanup-gate`. Settles it: the step names the same gate
    as any piece, re-cut heads included. Size: one clause.
13. **Applied by 26 October 2026**: `sub-agents` scans the staged paths before the commit. Was: **Scan interrupted work before it is committed**
    (`sub-agents/briefs.md:76`, "Ending one" step 2). The step commits, then
    runs `gitleaks protect --staged`, which by then sees an empty index; in
    Sol's disposable repository a planted marker was caught before the commit
    and missed after it. Evidence: check `staged-scan`;
    [CHECKLIST.md](CHECKLIST.md) (secrets and sign-in). Settles it: swap the
    order (scan, then commit only on success), or scan the committed range
    before any push. Size: none (reordered).
14. **Superseded 26 October 2026** by the owner's builder–Sol loop. Was: **The batch steps follow trunk landing**
    (`code-factory/INTEGRATOR.md:16`, steps 1 to 4). They still describe batch
    cuts, a blind-pair batch review and one batch merge, which Phase 2
    replaces except for batches already in flight. Evidence: check
    `topology`. Settles it: fence the old steps to that named exception and
    point at Phase 2, keeping the capability review before a switch turns on
    and the stage-end blind pair. Size: shrinks.
15. **Struck 26 October 2026**: hand-off is at 45, 50 and 70 percent for every role (owner, 17 and 24 October 2026). Was: **The context script hands over at 30 percent** (`orchestrator/ctx.sh:6`).
    It stops at 50; Roles (METHOD.md at commit 360e60f, in the private history) sets 30 for the orchestrator and
    the director, and `tick.md` and `handover.md` act only on its HANDOVER
    word. Evidence: check `context` (the real script printed `CTX 30 GO`).
    Settles it: the threshold moves to 30, with preparation below it. Size:
    one number.
16. **Applied or moot by 26 October 2026** (CF-Refine audit H21). Was: **Every file the skills require exists somewhere allowed**
    (`code-factory/SOL-PROMPT.md:3`, line 25; `orchestrator/SKILL.md:23`).
    `make_sol_prompt.py`, `ticket_criteria.py` (and its `SEPARATION`) and
    `loop/SKILL.md` are not in the snapshot or in this repository. Evidence:
    check `generators`. Settles it: versioned paths, or a boot step where the
    project supplies and validates them. Size: grows by a short inputs list.
17. **Applied or moot by 26 October 2026** (CF-Refine audit H21). Was: **The dispatch command matches the launcher** (`orchestrator/brief.md:24`,
    `handover.md:7`). `claude-seat-up --name <LABEL> <SEAT> --model <MODEL>`
    reads `--name` as the seat with the pinned launcher, whose form is
    `claude-seat-up <SEAT> [claude args...]`; it exited 1 and started nothing.
    Evidence: check `launcher`. Settles it: pin the launcher version the
    skill expects, or use the pinned form and name the pane separately. Size:
    one line in two files.
18. **Applied by 26 October 2026**: the lane brief asks for neither. Was: **Headless Sol is not asked for a handback or wrap-up**
    (`orchestrator/brief.md:16`). Every lane brief asks for both, while
    `build-review/REVIEWER.md:19` and `code-factory/SOL-PROMPT.md:24` forbid
    them for headless Sol. Evidence: check `headless`. Settles it: boot
    lines, handbacks and wrap-up for pane roles only; headless reviewers close
    out with the review comment, proof files and shim result. Size: one
    clause.
19. **Applied 17 October 2026** by [SOL-EFFORT.md](SOL-EFFORT.md) (owner, #188). Was: **Review effort has one owner rule** (`build-review/REVIEWER.md:3`, with
    `code-factory/SOL-PROMPT.md:34`, `code-factory/SKILL.md:23`,
    `orchestrator/round.md:17`). The skills say medium for every review, as
    Roles (METHOD.md at commit 360e60f, in the private history) does (owner, 2 October), while the review's
    acceptance criteria asked for high on sensitive work and low on
    low-impact work. Sol reports the disagreement and picks no side. Evidence:
    check `effort`. Settles it: the owner confirms the split, then the four
    copies point at Roles. Size: shrinks if they point.
20. **Applied by 26 October 2026**: `sub-agents` names the shared list as legacy only. Was: **Sub-agents never share a suite registry** (`sub-agents/briefs.md:24`,
    join at line 64). The independence test lets pieces edit one append-only
    list and union-merge it; Phase 2 step 6 gives each area its own file with
    one writer and no shared index. Evidence: check `registry`. Settles it:
    disjoint area files once a project has that layout, the old exception
    named as legacy only. Size: one clause.

Not proposed: Sol's note that other wording and over-engineering concerns
are non-blocking. Sol found no instruction that reads saved logins or
switches GitHub accounts.

## METHOD.md

21. **Applied by 26 October 2026** in the template's acceptance README ("What a branch may change"). Was: **A pull request that changes a test helper, setup or configuration and its product together splits to use acceptance** (ORCH73 78PATH, PR #78: acceptance refuses a head that changed anything outside product source and the plan's own directory). Size: one sentence. Ready for a grilling.
22. **Applied by 26 October 2026** in the template's acceptance README ("What a branch may change"). Was: **A tooling-, setup- or configuration-only pull request has no acceptance route: it splits from any code, and the owner waives acceptance for it** (ORCH74 78EDGE and 78R6, PR #78: the path rule refuses it, and Markdown beside code splits too, since vitest runs a Markdown setup file; a documentation-only pull request needs no plan, and a link is never documentation). Size: one sentence. Ready for a grilling.

## The 4 October method (owner-directed)

The owner made the 4 October way of working the method (NATHAN-CF-METHOD
item 4): skills that restate it change through Skill Factory, never in the
pull request that changed [METHOD.md](METHOD.md). These are owner-directed, so
they skip the evidence-over-time wait; each still needs a Skill Factory pass
and the owner's yes to install. Line references identify the cited skill files in the versions reviewed. Each
row in [SKILL-WATCH.md](SKILL-WATCH.md#checkpoint-4-october-2026) checks the
rule holds.

23. **Superseded** by the owner's round rules: two rounds in full mode, no third (12 and 19 October 2026), and the builder–Sol loop (26 October 2026), in [review rounds](METHOD.md#review-rounds). Was: **Three rounds for every piece, the rest to the catalogue**
    (`code-factory/INTEGRATOR.md:7`, `code-factory/SKILL.md:25`,
    `build-review/SKILL.md:28`, `build-review/ALWAYS-BLOCKS.md:5`,
    `orchestrator/holds.md:3`, `:5`, `orchestrator/round.md:8`). The skills
    grant a fourth round for a serious finding, hold a pull request red at its
    ceiling for the owner, let protected-class findings run "however many
    rounds it takes", and say any real defect blocks the merge. The method now caps every pull request at three Sol rounds, merges
    on Sol's approval of the exact head or of the change since an approved
    head, fixes a blocking finding before merge, carries only major and minor
    findings to the catalogue and closes them before the stage is accepted. Settles it: each line points at
    [review rounds](METHOD.md#review-rounds-and-the-catalogue) and
    [what review always covers](METHOD.md#what-review-always-covers). Size:
    shrinks.
24. **Narrow re-checks and the sweep** (`build-review/REVIEWER.md:15`, `:17`,
    `code-factory/SOL-PROMPT.md:22`). A fix-head review reads the fix's diff and
    the findings it closes; in a sweep Sol writes no proof test, names the bug
    and place, searches the catalogue first and files one issue per new root
    cause. Settles it: one pointer to review rounds in place of the fix-head
    wording, plus the sweep as a named review kind. Size: grows by about one
    line.
25. **Applied by 26 October 2026**: `code-factory` links [Fixes stay small](METHOD.md#fixes-stay-small). Was: **Lean fixes** (`build-review/SKILL.md:28`). One proof test per finding,
    timing-only cases grouped by root cause, money, permissions, sign-in and
    data separation fixed in full. Settles it: a pointer to
    [Fixes stay small](METHOD.md#fixes-stay-small). Size: one clause.
26. **The orchestrator routes by the catalogue and the machine**
    (`orchestrator/tick.md:11`, `:12`). Fill takes catalogue issues from the
    top rank, gives sweeps their own Sol slots after new pieces, sets Sol's
    run cap from disk, load and memory, and sends heavy runs to the M5. Settles
    it: step 7 links [review rounds](METHOD.md#review-rounds-and-the-catalogue)
    and [Seats, lanes and stops](METHOD.md#seats-lanes-and-stops), and step 8's
    fill line adds disk and the Sol cap. Size: grows by two links and two
    fields.
27. **Heavy runs on the M5 in sub-agent briefs** (`sub-agents/briefs.md:13`,
    `:14`). The build brief names a load cap and leaves full checks to the
    lead, without saying where they run. Settles it: the lead's full checks run
    on the M5 and a sub-agent keeps one laptop test process, per
    [Seats, lanes and stops](METHOD.md#seats-lanes-and-stops). Size: one
    clause.
