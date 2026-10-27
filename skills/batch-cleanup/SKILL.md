---
name: batch-cleanup
description: Run one cleanup pass (thermonuclear, architecture, deslop or unslop) on one section's merged code and commit the checked result. Use when a cleanup lane's brief names your pass, input head and base.
metadata:
  job: run one section cleanup pass
  form: workflow
  source: local
  version: 0.2.0
---

**Clean** one section's merged code (a batch, in older briefs) with one pass at its section end, and commit the checked result for the next pass. The four passes run in this order, each in a fresh lane: thermonuclear, architecture, deslop, unslop ([Section-end passes](../../docs/METHOD.md#section-end-passes)).

## Not for
- Choosing, ordering or dispatching the passes: `orchestrator` owns that.
- An owner-driven architecture review: `improve-codebase-architecture` owns that.

## Inputs and authority
- Needs: the brief's base (or batch base), input head, scope, pass name, checks and numeric ceilings. Any missing, or HEAD isn't the input head: log `<UTC> CLEANUP <pass> BLOCKER <reason>` and reply `BLOCKED: <reason>`.
- May: edit files inside `git diff <base>...<input-head>`, run the checks, make one commit and push it, append to `events.log`, file tickets. You alone write during your pass. Sub-agents 0, spend 0.
- Never: simplify away security, privacy, backups, tests or Sol's proof tests, or weaken review of the five classes (data separation, races and timing, secrets and sign-in, money, tests that don't prove their claim); leave each exactly as strong. File a capability cut, or a restructure bigger than about a unit, as a ticket for the owner; apply neither. Merge nothing and load no other pass; the orchestrator starts the next. Stop only processes you started, by PID, after checking its command.

## Steps
1. **Check the input.** Confirm `git rev-parse HEAD` is the input head and you wrote none of the section. Done when: both hold, or BLOCKER is logged.
2. **Load your pass.** Open only your pass file and every leaf skill it names, each at its pinned path in the brief. Done when: those files are open and no other pass file was.
3. **Apply the pass** to that section's code only: `git diff <base>...<input-head>`; older code is context. Keep every capability and the repository's stricter rules. Make the smallest change per finding. Leave prose to the unslop pass. Done when: each finding is applied or its reason noted.
4. **Run the brief's checks.** A failed check: log `<UTC> CLEANUP <pass> HELD <check>` and go to step 6. Done when: every check is green, or HELD is logged.
5. **Commit.** One signed `chore(cleanup): <pass>` commit (amend your unpushed commit, no fix-ups), pushed to the brief's cleanup branch. Its body lists the pass and leaf skill files, each check's command and result, and each finding not applied, with why. With no edit, record NO-CHANGE at the same SHA and put the same list in the close-out record. Log `<UTC> CLEANUP <pass> DONE in=<sha7> out=<sha7>` or `<UTC> CLEANUP <pass> NO-CHANGE at=<sha7>`. Done when: the line is logged, `git status` is clean, and the pushed head is `out` (for NO-CHANGE, still the input head).
6. **Finish** with `close-out`. Its `CLOSED` line names `cleanup/<section>@<sha7>` (your HEAD) for `#<pr>`. At a ceiling, log `<UTC> CLEANUP <pass> PARTIAL at=<sha7>` with the unread paths; resume only in an orchestrator-allocated session. Done when: close-out's `CLOSED` line follows this pass's `CLEANUP` line in `events.log`.

## Output
Your `CLEANUP` line, the pushed commit for DONE, and the close-out record with its tickets, in place of a handback.

## Reads
- [THERMONUCLEAR.md](THERMONUCLEAR.md) when your pass is thermonuclear.
- [ARCHITECTURE.md](ARCHITECTURE.md) when your pass is architecture.
- [DESLOP.md](DESLOP.md) when your pass is deslop.
- [UNSLOP.md](UNSLOP.md) when your pass is unslop.
