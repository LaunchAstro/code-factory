# Lane BUILD-<ROUND>: <T> real tickets, <T> draft pull requests

You are lane `BUILD-<ROUND>`, Opus 5, seat <SEAT>. This file is your whole brief. Paths are relative to `<ORCHESTRATION-ROOT>`; the code lives in the clone `<CLONE>` (repository `<OWNER>/<REPO>`, `gh` active account `<GH-ACCOUNT>`, never `gh auth switch`).

## The tickets, in this order
Replace this list with one numbered entry per ticket, `<T>` of them, each written
as: the file and symbol at fault, the reproduction the lane can run, and the
behaviour the fix must produce, in that order and in one paragraph. The three entries
round 7 used, summarised in `docs/rounds/ROUND7-REPORT.md`, are the worked example of the
length and the level of detail. Premise-check every entry against the
repository before dispatching this brief: the file exists, the flag or key is
real, the reproduction reproduces. Cut a ticket whose premise does not hold
from the round. Never leave the lane to improvise around one.

Nothing here is planted. These are real defects on `main`, and you fix them
properly.

1. `<file>:<line or symbol>`. `<reproduction command>` does `<wrong behaviour>`. It must `<right behaviour>`, exit `<code>`.
2. `<file>:<line or symbol>`. `<reproduction command>` does `<wrong behaviour>`. It must `<right behaviour>`, exit `<code>`.
3. `<file>:<line or symbol>`. `<reproduction command>` does `<wrong behaviour>`. It must `<right behaviour>`, exit `<code>`.

## Per ticket
- Open one issue on the repository with the defect and the reproduction; note its number `<n>`.
- Branch `<PREFIX>/<n>-<slug>` from `origin/main` in worktree `.worktrees/BUILD-<ROUND>-<n>`.
- First commit: only `tests/acceptance/<n>-<slug>/plan.md` (shape of `tests/acceptance/10-label-trigger/plan.md`: why, `## Acceptance criteria` numbered, one of them the standing criterion as a numbered item beginning `Fails closed:` in the ticket's own words, at whatever position in the list suits it, as `CONTRIBUTING.md` step 3 states it, and a line reading `Size estimate: under <n> hand-written lines.`) plus the plan's failing tests in that directory. `BASE_SHA=$(git rev-parse origin/main) HEAD_SHA=$(git rev-parse HEAD) node scripts/acceptance-check.mjs` must refuse only for the tests being red.
- Then `node scripts/plan-check.mjs tests/acceptance/<n>-<slug>`, green. It refuses a criterion with no case, a case with no criterion, a missing or oversized estimate and a missing standing criterion, and you fix the plan until it passes.
- Push the plan commit, the first of your <BUILD-PUSHES> pushes, and open the draft pull request on it, `gh pr create --draft` with a neutral title `Real ticket <n>` and a body whose first line is `Closes #<n>`. Request no review, add no label, mark nothing ready.
- Append `PLAN-COMMIT <n> <sha>` to the trail, tell the orchestrator, and stop. Write no code until the orchestrator sends `PLAN-OK <n>`: the coverage half of the plan check is a session on that commit alone, and a plan approved after the code exists is the review the stage was built to move earlier. On `PLAN-HELD <n>` that ticket is over for you: no second plan commit, no code. Record the hold and its criterion lines in the handback and move to the next ticket. The orchestrator holds the ticket for the owner, who decides whether it comes back as a new ticket in a later round. That is what keeps the pushes at <BUILD-PUSHES>.
- On `PLAN-OK <n>`, the code, green: `corepack pnpm check`, the plan's tests, and `node scripts/pr-size.mjs --base origin/main --head HEAD` at most 1,000 (aim under 120 each; these are small).
- Signed commits throughout. Push the code onto the open draft pull request; with the plan commit, no pull request takes more than <BUILD-PUSHES> pushes.

## Do not
- Touch `tests/acceptance/` of any other ticket, any workflow, or any control script other than the one the ticket names.
- Spend money, start a sub-agent, run Copilot, ask for a review.
- Build around a `BLOCKER` or an unexpected 4xx: stop, write the handback with `LANE-BUILD-<ROUND>-HANDBACK-POSTED`, say what is left.

## Ceilings
Context <BUILD-CONTEXT> percent. Wall <BUILD-WALL> minutes. Pull requests <T>. Pushes <BUILD-PUSHES> per pull request, the plan commit's included. Reviews <BUILD-REVIEWS>. Sub-agents 0.

## Handback
Trail `.local/lanes/loop/work-BUILD-<ROUND>.tsv` (`ts<TAB>pr<TAB>what<TAB>why<TAB>evidence<TAB>result`, appended as you go, never rewritten). Handback `.local/lanes/handbacks/BUILD-<ROUND>.md`, one screen: per ticket the issue number, pull request number, branch, plan commit, head, size line, test counts. End the file with `LANE-BUILD-<ROUND>-DONE`, then `echo "$(date -u +%FT%TZ) LANE-BUILD-<ROUND>-DONE" >> .local/lanes/events.log`, then finish with the `close-out` skill, record title `<DATE> BUILD-<ROUND>, <T> real tickets`, and end your last message with the phrase.

Your first reply: the model you are running and `LANE-BUILD-<ROUND>-BOOTED`. BUILD-<ROUND>-BOOT-TAIL
