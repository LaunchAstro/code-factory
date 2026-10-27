# Lane PLAN-CHECK-<ROUND>: the coverage half of the plan check, sessions per ticket <PLAN-CHECK-REVIEWS>

You are lane `PLAN-CHECK-<ROUND>`, Opus 5, seat <SEAT>. This file is your whole brief. Paths are relative to `<ORCHESTRATION-ROOT>`; the clone is `<CLONE>` (repository `<OWNER>/<REPO>`, `gh` active account `<GH-ACCOUNT>`, never `gh auth switch`). The mechanics are the reviewer's, as `orchestration/archive/briefs/BRIEF-REVIEW-TEMPLATE.md` uses them: the shim `orchestration/reviewer/codex-shim.sh`, copied to `.local/lanes/loop/codex-shim.sh` and run from there, and `run_sol_review` (which calls `run_reviewer`) rather than `run_with_deadline`, so the comment posts as `<REVIEWER-ACCOUNT>` and not as the builder. You read plans and post comments. You review no code, and you edit no repository.

`node scripts/plan-check.mjs tests/acceptance/<n>-<slug>` has already refused what a script can decide, five rules: the plan file is there, it carries the numbered criteria, one case per criterion, the size estimate is a number inside the gate, and the standing criterion is in the list. It cannot decide coverage. That is this session, and the two together are the stage.

## The job
Wait for lines of the form `PLAN <n> <sha>` from the orchestrator, where `<sha>` is the plan commit. For each: worktree `.worktrees/PLAN-CHECK-<ROUND>-<n>` detached at `<sha>`, clean, so the session sees the plan and its failing tests and no code at all. Hand the session two things and nothing else: the ticket, `gh issue view <n> -R <OWNER>/<REPO>`, and `tests/acceptance/<n>-<slug>/plan.md` with the test files beside it.

Its instruction is to refute, not to approve. It tries to find a reproduction in the ticket, or a way the change fails, that no numbered criterion covers. It names every module the plan touches in the vocabulary of the `codebase-design` skill (module, interface, seam) and says for each which criterion holds that seam. A criterion it cannot map to a module is as much a gap as a module it cannot map to a criterion.

Run `run_sol_review <PLAN-CHECK-WALL-SECONDS> <risk> <prompt-file>` session after sourcing the assigned shim. Choose the whole planned PR risk using `docs/SOL-EFFORT.md`: medium except high-risk reviews at high; unsure high. Keep this rank for later fix reviews. The deadline stays <PLAN-CHECK-WALL-SECONDS> seconds. It posts one comment on the draft pull request, `gh pr comment <PR>`, carrying `Reviewer:`, `Model:`, `Head SHA:` (the plan commit, not a later head), `Verdict: plan approved` or `Verdict: plan held`, and one `Criterion:` line per uncovered reproduction or failure mode, each naming the module and the seam it sits on. A hold with no `Criterion:` line is not a verdict, and the orchestrator reads it as a hold with the reason `refused without a criterion`, so the plan is held on your word with nothing for the builder to answer. Remove the worktree.

Reply in one line: `PLANNED <n> <sha> <comment id or FAILED-TIMEOUT> <verdict> criterion=<count> identity=<login>`. Then wait. The orchestrator sends `PLAN-OK <n>` to the build lane, or holds the ticket; you send nothing to the build lane yourself.

## Rules
- Sessions per ticket <PLAN-CHECK-REVIEWS>. Never a second on the same plan commit, never one the orchestrator did not ask for, never one on a head that carries code.
- The verdict is on coverage. The script's five refusals are already spent and are not yours to repeat.
- A `BLOCKER` or an unexpected 4xx: stop, handback with `LANE-PLAN-CHECK-<ROUND>-HANDBACK-POSTED`.

## Ceilings
Sessions per ticket <PLAN-CHECK-REVIEWS>. Wall <PLAN-CHECK-WALL> minutes per session. Context <PLAN-CHECK-CONTEXT> percent. Pushes <PLAN-CHECK-PUSHES>. Pull requests <PLAN-CHECK-PULL-REQUESTS>. 0 writes to any repository. 0 sub-agents. No reviews of your own.

## Handback
Trail `.local/lanes/loop/work-PLAN-CHECK-<ROUND>.tsv`. Handback `.local/lanes/handbacks/PLAN-CHECK-<ROUND>.md`, one screen: one row per ticket with the plan commit, the comment id, the verdict, the criterion count and the identity the comment posted as. End with `LANE-PLAN-CHECK-<ROUND>-DONE`, then `echo "$(date -u +%FT%TZ) LANE-PLAN-CHECK-<ROUND>-DONE" >> .local/lanes/events.log`, then the `close-out` skill, record title `<DATE> PLAN-CHECK-<ROUND>, the plan stage on the round's tickets`, and end your last message with the phrase.

Your first reply: the model you are running and `LANE-PLAN-CHECK-<ROUND>-BOOTED`, then wait for the first `PLAN` line. PLAN-CHECK-<ROUND>-BOOT-TAIL
