# Skill proposals

*A record of how the method got here, kept as evidence for [HISTORY.md](HISTORY.md#dropped-and-why). You don't need it to run a build; start at the [reading order](../README.md#where-to-start).*

Changes the method in [METHOD.md](METHOD.md) suggests for the orchestration
skills. Each proposal carries its status against the installed skills; one
with no status is still open. A skill changes only on evidence gathered over
time and after a grilling with the owner, never on one session's lesson, and
a revision that only adds is suspect. So each proposal says what evidence
would settle it and whether the skill grows or shrinks. Changes being proved,
and findings waiting on a second sighting, are in
[SKILL-WATCH.md](SKILL-WATCH.md).

The skills are `orchestrator`, `director` (with `kick.sh`),
`claude-subscription-switch` and `afk-orchestrator`.

## orchestrator

1. **Applied**: the skills carry neither figure and point at METHOD.
   Proposal: replace the two ceilings-table figures (panes per seat and pull
   request size) with the owner's rules, up to 10 working lanes per seat with
   a floor of 6, and [Pull request size](METHOD.md#pull-request-size). Size:
   replaces two cells, no growth.
2. **Applied**: the orchestrator counts working lanes per seat. Proposal:
   count working lanes, not open panes. Size: one clause.
3. **Superseded**: the section-end passes live in METHOD and run on the
   section's own code, not all of `main`.
4. **Applied**: the skills link METHOD's sections instead of restating them.
   A pointer shrinks the skill and leaves one copy to drift. Size: shrinks.
5. **Superseded**: batches, the one integrator and the frozen batch head left
   the skills with the builder-Sol loop.

## director

6. **Watch disk and working lanes by default.** Both are already in its
   "Watching" list; the proposal is that `kick.sh` logs the free disk and the
   working-lane count with each kick, so the director reads numbers rather
   than looking. Size: a few lines of script. Needs a grilling on whether the
   kicker should stay token-free and silent.
7. **A generic name for the owner's instruction files.** A reusable skill
   says `OWNER-<TOPIC>.md`, not a name tied to one owner. Size: rename only.
   Low priority.

## afk-orchestrator

8. **Its citations resolve.** Its switched-off status is unchanged. Proposal:
   confirm the citations at the next grilling rather than re-pointing them.
   Size: none.

## claude-subscription-switch

No proposal. Model choice lives in your model list.

## Sol's review of the five build skills

Sol reviewed `build-review`, `batch-cleanup`, `code-factory`, `orchestrator`
and `sub-agents` against METHOD.md and CHECKLIST.md and asked for twelve
changes. Each is entered here as a proposal, not applied: one review is one
sighting. Each names Sol's check (a case in its proof set), the part of
[METHOD.md](METHOD.md) it leans on, and whether the skill grows or shrinks.
The first five are the ones Sol rated most serious.

9. **Applied**: Sol approves every head. Proposal: every piece lands only on
   Sol's approval of its exact head, or of the change since an approved head
   ([review rounds](METHOD.md#review-rounds)), with no land-first exception
   for fast pieces ([Build variants](METHOD.md#build-variants)). Check
   `fast`. Size: shrinks (an exception removed in three places).
10. **Superseded** by proposal 23. Proposal: a real defect still holds a
    piece after the last round; only cosmetic notes and edge cases go to
    follow-ups. Check `rounds`. Size: shrinks.
11. **Superseded** by the builder-Sol loop. Proposal: the one-fix stop needs
    every protected class closed, as [Section-end passes](METHOD.md#section-end-passes)
    stops only when no real correctness defect and nothing in the protected
    classes remains. Check `batch-fix`. Size: shrinks.
12. **Applied**: the section-end cleanup pull request lands through the
    normal gate. Proposal: cleanup lands through the same exact-head gate as
    any piece, since cleanup commits change code after review. Check
    `cleanup-gate`. Size: one clause.
13. **Applied**: `sub-agents` scans the staged paths before the commit.
    Proposal: scan interrupted work before it is committed, since a scan of
    the staged index after the commit sees nothing. Check `staged-scan`;
    [CHECKLIST.md](CHECKLIST.md) (secrets and sign-in). Size: none
    (reordered).
14. **Superseded** by the builder-Sol loop. Proposal: the batch steps follow
    trunk landing. Check `topology`. Size: shrinks.
15. **Struck**: hand-off is at 45, 50 and 70 percent for every role.
    Proposal: the context script's hand-over threshold matches the method's.
    Check `context`. Size: one number.
16. **Applied or moot.** Proposal: every file the skills require exists
    somewhere allowed, through versioned paths or a boot step where the
    project supplies and checks them. Check `generators`. Size: grows by a
    short inputs list.
17. **Applied or moot.** Proposal: the dispatch command matches the
    launcher's argument form, or the skill pins the launcher version it
    expects. Check `launcher`. Size: one line in two files.
18. **Applied**: the lane brief asks headless Sol for neither a handback nor
    a wrap-up. Headless reviewers close out with the review comment, proof
    files and shim result. Check `headless`. Size: one clause.
19. **Applied** by [SOL-EFFORT.md](SOL-EFFORT.md). Proposal: review effort
    has one rule, and the skills point at it instead of copying it. Check
    `effort`. Size: shrinks.
20. **Applied**: `sub-agents` names the shared list as legacy only.
    Proposal: sub-agents never share a suite registry; each area has its own
    file with one writer and no shared index. Check `registry`. Size: one
    clause.

Not proposed: Sol's note that other wording and over-engineering concerns
are non-blocking. Sol found no instruction that reads saved logins or
switches GitHub accounts.

## METHOD.md

21. **Applied** in the template's acceptance README ("What a branch may
    change"). Proposal: a pull request that changes a test helper, setup or
    configuration together with product code splits to use acceptance.
    Size: one sentence.
22. **Applied** in the template's acceptance README ("What a branch may
    change"). Proposal: a tooling-, setup- or configuration-only pull request
    has no acceptance route; it splits from any code, and the owner waives
    acceptance for it. A documentation-only pull request needs no plan.
    Size: one sentence.

## Owner-directed method changes

Skills that restate the method change through a skill pass, never in the
pull request that changes [METHOD.md](METHOD.md). These are owner-directed,
so they skip the evidence-over-time wait; each still needs a skill pass and
the owner's yes to install. Each row in
[SKILL-WATCH.md](SKILL-WATCH.md#checkpoint-4-october-2026) checks the rule
holds.

23. **Superseded** by two rounds and the builder-Sol loop in
    [review rounds](METHOD.md#review-rounds). Proposal: the skills' round
    grants and holds point at [review rounds](METHOD.md#review-rounds) and
    [what review always covers](METHOD.md#what-review-always-covers) instead
    of granting extra rounds or holding a pull request red for the owner.
    Size: shrinks.
24. **Narrow re-checks and the sweep** (`build-review/REVIEWER.md`,
    `code-factory/SOL-PROMPT.md`). A fix-head review reads the fix's diff and
    the findings it closes; in a sweep Sol writes no proof test, names the bug
    and place, searches the catalogue first and files one issue per new root
    cause. Settles it: one pointer to review rounds in place of the fix-head
    wording, plus the sweep as a named review kind. Size: grows by about one
    line.
25. **Applied**: `code-factory` links [Fixes stay small](METHOD.md#fixes-stay-small).
    Proposal: lean fixes, one proof test per finding, timing-only cases
    grouped by root cause, money, permissions, sign-in and data separation
    fixed in full. Size: one clause.
26. **The orchestrator routes by the catalogue and the machine**
    (`orchestrator/tick.md`). Fill takes catalogue issues from the top rank,
    gives sweeps their own Sol slots after new pieces, sets Sol's run cap from
    disk, load and memory, and sends heavy runs to the check machine. Settles
    it: the fill step links [the catalogue](METHOD.md#the-catalogue) and
    [Seats, lanes and stops](METHOD.md#seats-lanes-and-stops), and its fill
    line adds disk and the Sol cap. Size: grows by two links and two fields.
27. **Heavy runs on the check machine in sub-agent briefs**
    (`sub-agents/briefs.md`). The build brief names a load cap and leaves full
    checks to the lead, without saying where they run. Settles it: the lead's
    full checks run on the check machine and a sub-agent keeps one test
    process on the owner's machine, per
    [Seats, lanes and stops](METHOD.md#seats-lanes-and-stops). Size: one
    clause.
