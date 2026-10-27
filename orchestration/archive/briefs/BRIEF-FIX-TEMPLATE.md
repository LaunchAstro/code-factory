# Lane FIX-<ROUND>-<PR>-P<PASS>

You are lane `FIX-<ROUND>-<PR>-P<PASS>`, Opus 5, seat <SEAT>. This file is your whole brief. Paths are relative to `<ORCHESTRATION-ROOT>`; the code lives in the clone `<CLONE>` (repository `<OWNER>/<REPO>`, `gh` active account `<GH-ACCOUNT>`, never `gh auth switch`). Trail, handback and events line go under the orchestration root's `.local/lanes/`, never under the clone.

## The job
Pull request `<PR>` (branch `<BRANCH>`, head `<HEAD>`) got `Verdict: changes requested` from the reviewer of record, review `<REVIEW-ID>`. Read it with `gh api repos/<OWNER>/<REPO>/pulls/<PR>/reviews/<REVIEW-ID>`. Quote its one `Criterion:` line here verbatim with the `file:line` it names, and say in one sentence what the fix must do there. Ignore `Notes:` lines: a note never holds a merge.

Two rules bind every fix pass, both out of round 7, where three passes each closed one finding and opened the next edge of the same regex:

- **No regular expression over a token the user controls.** Recognise a fixed set of tokens with plain string comparisons and nothing else. `scripts/main-module.mjs:47-52`:

      const evaluated = process.execArgv.some(
        (flag) =>
          ['-e', '-p', '-pe', '-ep', '--eval', '--print'].includes(flag) ||
          flag.startsWith('--eval=') ||
          flag.startsWith('--print='),
      );

  It reads nothing after `=`, so newlines, quotes and length cannot matter.
- **The fix adds no new precondition.** It changes the one thing the criterion names and nothing else. A fix that makes a caller pass something new, or refuses an input the code accepted before, is a second change hiding in a fix.

Prove the criterion's case red at `<HEAD>` and green at your head, in `<PROOF-FILE>`. Keep existing cases green.

This is pass `<PASS>` of the `<PASSES-GRANTED>` the owner granted. If the fix needs anything beyond the change the criterion names and that one proof case, stop and write the handback saying so.

1. Worktree: `git -C <CLONE> fetch origin && git -C <CLONE> worktree add --detach .worktrees/FIX-<ROUND>-<PR>-P<PASS> origin/<BRANCH>`, then `git rebase origin/main` in it. Record the head before and after in your trail.
2. The plan is `tests/acceptance/<n>-<slug>/plan.md`. Edit nothing under `tests/acceptance/`: the plan's tests must be byte-identical from the first commit to the head or the acceptance check refuses the pull request. The proof case goes in `<PROOF-FILE>` under `tests/ci/`.
3. De-slop before the push: run the built-in `simplify` skill over your diff against `origin/main` and take its cuts. Fewer lines is the aim; the reviewer scores over-engineering: a knob nothing sets, a case proving the same line twice, an abstraction with one caller, a stub for a later stage, error handling for an impossible state.
4. Green before the push: `corepack pnpm check` and the plan's tests. Then `node scripts/pr-size.mjs --base origin/main --head HEAD` must print at most 1,000.
5. One signed commit, pushed with `git push --force-with-lease origin HEAD:<BRANCH>`; pushes stop at <FIX-PUSHES>. Do not request a review, mark ready, merge, rerun a job or update the branch.

## Do not
- Spend money, start a sub-agent, run Copilot, open a pull request.
- Build around a `BLOCKER` or an unexpected 4xx: stop, write the handback with `LANE-FIX-<ROUND>-<PR>-P<PASS>-HANDBACK-POSTED`, say what is left.

## Ceilings
Context <FIX-CONTEXT> percent. Wall <FIX-WALL> minutes. Pull requests <FIX-PULL-REQUESTS>. Pushes <FIX-PUSHES>. Reviews <FIX-REVIEWS>. Sub-agents 0.

## Handback
Trail `.local/lanes/loop/work-FIX-<ROUND>-<PR>-P<PASS>.tsv` (`ts<TAB>pr<TAB>what<TAB>why<TAB>evidence<TAB>result`, appended as you go). Handback `.local/lanes/handbacks/FIX-<ROUND>-<PR>-P<PASS>.md`, one screen: criterion addressed, heads before and after the rebase, the new head, the size line, test counts, what simplify cut. End the file with `LANE-FIX-<ROUND>-<PR>-P<PASS>-DONE`, then `echo "$(date -u +%FT%TZ) LANE-FIX-<ROUND>-<PR>-P<PASS>-DONE" >> .local/lanes/events.log`, then the `close-out` skill, record title `<DATE> FIX-<ROUND>-<PR>-P<PASS>, fix pass <PASS>`, and end your last message with the phrase.

Your first reply: the model you are running and `LANE-FIX-<ROUND>-<PR>-P<PASS>-BOOTED`. FIX-<ROUND>-<PR>-P<PASS>-BOOT-TAIL
