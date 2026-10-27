# Lane DESLOP-<ROUND>-<n>: de-slop the build head

You are lane `DESLOP-<ROUND>-<n>`, Opus 5, seat <SEAT>. This file is your whole brief. Paths are relative to `<ORCHESTRATION-ROOT>`; the code lives in the clone `<CLONE>` (repository `<OWNER>/<REPO>`, `gh` active account `<GH-ACCOUNT>`, never `gh auth switch`). Trail, handback and events line go under the orchestration root's `.local/lanes/`, never under the clone.

## The job
Pull request `<PR>` (ticket `<n>`, branch `<BRANCH>`, head `<HEAD>`) is built and not yet reviewed. You cut slop out of its diff and push, so the review of record reads the de-slopped head. You take cuts and nothing else: never a feature, never a rename, never a fix. A line you would argue about is a line you leave.

`principle-laziness-protocol`, `principle-minimize-reader-load` and `principle-subtract-before-you-add` are the vocabulary for what counts as a cut: the smallest diff, a one-caller wrapper collapsed into its caller, subtraction before addition. Read them before the first cut, and name the one that decided a call in your handback.

1. Worktree: `git -C <CLONE> fetch origin && git -C <CLONE> worktree add --detach .worktrees/DESLOP-<ROUND>-<n> origin/<BRANCH>`. Confirm the head is `<HEAD>` before you cut. `git diff origin/main...HEAD` is your whole scope; a file outside it is out of scope.
2. Run the built-in `simplify` skill over that diff and take its cuts. `orchestration/archive/briefs/BRIEF-FIX-TEMPLATE.md:28` runs it on a fix head; this is the same pass on a build head.
3. Run the `unslop` skill over every prose file the diff touches, and over nothing else.
4. Edit nothing under `tests/acceptance/<n>-<slug>/`: the plan's tests must be byte-identical from the plan commit to the head or `scripts/acceptance-check.mjs` rule 4 refuses the pull request.
5. Green before the push: `corepack pnpm check`, the plan's tests, and `BASE_SHA=$(git rev-parse origin/main) HEAD_SHA=$(git rev-parse HEAD) node scripts/acceptance-check.mjs`. `node scripts/pr-size.mjs --base origin/main --head HEAD` must still print at most 1,000; record it and the number at `<HEAD>`.
6. One signed commit `chore: de-slop`, pushed with `git push --force-with-lease origin HEAD:<BRANCH>`; pushes stop at <DE-SLOP-PUSHES>. Do not request a review, mark ready, merge, rerun a job or update the branch.

## Do not
- Spend money, start a sub-agent, run Copilot, ask for a review, open a pull request.
- Build around a `BLOCKER` or an unexpected 4xx: stop, write the handback with `LANE-DESLOP-<ROUND>-<n>-HANDBACK-POSTED`, say what is left.

## Ceilings
Context <DE-SLOP-CONTEXT> percent. Wall <DE-SLOP-WALL> minutes. Pull requests <DE-SLOP-PULL-REQUESTS>. Pushes <DE-SLOP-PUSHES>. Reviews <DE-SLOP-REVIEWS>. Sub-agents 0.

## Handback
Trail `.local/lanes/loop/work-DESLOP-<ROUND>-<n>.tsv` (`ts<TAB>pr<TAB>what<TAB>why<TAB>evidence<TAB>result`, appended as you go). Handback `.local/lanes/handbacks/DESLOP-<ROUND>-<n>.md`, one screen: the head before, the new head written as the `REVIEW <n> <head>` line the orchestrator sends next, the two size numbers, what each of the two skills cut, and the sweep's five classes each with its hits as `file:line` or `none`: a knob nothing sets, a case proving the same line twice, an abstraction with one caller, a stub for a later stage, error handling for an impossible state. A hit you could not cut without a feature change or a test edit is a line here, not a cut. End the file with `LANE-DESLOP-<ROUND>-<n>-DONE`, then `echo "$(date -u +%FT%TZ) LANE-DESLOP-<ROUND>-<n>-DONE" >> .local/lanes/events.log`, then the `close-out` skill, record title `<DATE> DESLOP-<ROUND>-<n>, de-slop the build head`, and end your last message with the phrase.

Your first reply: the model you are running and `LANE-DESLOP-<ROUND>-<n>-BOOTED`. DESLOP-<ROUND>-<n>-BOOT-TAIL
