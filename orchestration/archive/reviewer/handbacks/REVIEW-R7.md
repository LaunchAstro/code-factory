# Lane REVIEW-R7, 21 September 2026: six Sol sessions across three real pull requests

Opus 5, seat `<SEAT>`. Ran the reviewer, recorded what it did, reviewed nothing, wrote nothing to the rehearsal repository, put no hand on CI.

## The six sessions

| # | PR | Head | Kind | Review id | Verdict | Criterion | Notes | Wall | Rollout | Forks | Identity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 17 | 36693cb | first | 5262302695 | changes requested | 1 | 3 | 3m38s | `<TRANSCRIPT-REF>` | 2 | `<REVIEWER-ACCOUNT>` |
| 2 | 20 | bd5aabd | first | 5262317107 | changes requested | 2 | 6 | 3m56s | `<TRANSCRIPT-REF>` | 2 | `<REVIEWER-ACCOUNT>` |
| 3 | 21 | 99203b5 | first | 5262334433 | changes requested | 1 | 4 | 3m24s | `<TRANSCRIPT-REF>` | 0 | `<REVIEWER-ACCOUNT>` |
| 4 | 17 | de6c8e3 | fix | 5262351225 | approve | 0 | 4 | 3m50s | `<TRANSCRIPT-REF>` | 2 | `<REVIEWER-ACCOUNT>` |
| 5 | 20 | e7345cd | fix | 5262365357 | approve | 0 | 4 | 3m25s | `<TRANSCRIPT-REF>` | 0 | `<REVIEWER-ACCOUNT>` |
| 6 | 21 | f68fa4c | fix | 5262394997 | changes requested | 1 | 2 | 3m19s | `<TRANSCRIPT-REF>` | 0 | `<REVIEWER-ACCOUNT>` |

Six sessions of a run ceiling of six, two on each of pull requests 17, 20 and 21, so the run closed at its cap with every pull request at its own cap. Zero `FAILED-TIMEOUT`, zero sessions on a repeated head, zero sessions the orchestrator did not ask for, zero sub-agents, zero reruns, zero update-branch, zero 4xx of any kind, no BLOCKER. Every review is bound to the head the orchestrator named (`commit_id` equals it), carries the four header lines exactly, and is the only review on its head. Each pull request carries one review per head and no more.

Run-level counts: 6 sessions, 6 reviews, 2 approve and 4 changes requested, 5 Criterion findings and 23 Notes lines in total, 6 forks, 31 shell calls naming `.claude/skills`, 0 writes to any repository, 0 reviews of this lane's own, wall 3m19s to 3m56s against a 900 second cap.

## The first approve in three rounds, and the first merge-ready heads

Round 6 ended with four reviews and no approve at all. This round produced two. Pull request 17's fix head closed its one Criterion finding and raised nothing; pull request 20's fix head closed both of its findings and raised nothing. Both reviews record every prior finding closed under `Notes:`, one line each, and carry `Verdict: approve` with zero Criterion lines, so the fix-head condition of the pass line is exercised for the first time this lane has seen.

Pull request 21 went the other way and is the round's only reopened criterion. Its fix head closed the prior `Criterion: 7` under `Notes:` and then raised a new `Criterion: 3` at `scripts/main-module.mjs:38`: the eval detector misses Node's `-pe` form, and Sol's own sentence says the same reproduction succeeds on the previous commit, so it is a regression the fix introduced. That is the same shape as round 6, where both fix heads reopened against behaviour the previous implementation had right, but this round it is one of three rather than two of two.

## Three real tickets, all three reviewed twice

Unlike round 6, which had no third pull request to review, all three trial pull requests existed and each took a first head and a fix head. Plans resolved from the one acceptance directory each diff touches, and each resolved cleanly with no ambiguity: 17 to `tests/acceptance/16-pr-size-flags/`, 20 to `18-quoted-job-key/`, 21 to `19-main-module-guard/`. The diffs were real work, not fixtures: 3, 3 and 17 changed files on the first heads, growing to 4, 4 and 19 on the fix heads as each builder added a CI case file.

## The shim held, second round running

`loop/codex-shim-R6.sh` was reused unchanged, since `timeout`, `gtimeout` and `setsid` are all still absent on this machine. The two second dry run the brief asks for ran before session 1: `run_with_deadline 2` over `sleep 987 & sleep 987` returned rc 143 at 2s wall with zero surviving `sleep 987` and zero watchdog strays. Across all six sessions nothing had to be killed by hand, and no session came within 500 seconds of the cap.

## DEFECT-IN-RUN: the code-review skill disable still does not hold, fifth round running

`-c 'skills.config=[{name="code-review",enabled=false}]'` again failed to keep the repository's code-review skill out of the session. Five of the six parents `cat`ed `.claude/skills/code-review/SKILL.md` by shell. Parent shell calls naming the skills tree were 4, 3, 3, 3, 3 and 3; fork calls were 3 and 2, 1 and 2, and 1 and 3; 31 in the run. No fork reached `code-review/SKILL.md` in any session, as in rounds 5 and 6. As in rounds 3 to 6, this lane cannot settle from the rollouts whether the flag blocked auto-loading and the model reached the file with a shell anyway, or whether the flag did nothing. Not stopped, per the brief.

Session 3 is the one exception and the first in five rounds: its parent made three shell calls naming `.claude/skills` and none of them read `code-review/SKILL.md`, though one `rg --files -g '*code-review*'` did list it. That session is also the first first-head to produce no fork. This lane only counted; the call is SCORE's.

## The fork pattern breaks again, in a new place

Round 6 reported two forks on every first head and a split on the fix heads, and said the divide is not first head against fix head. This round breaks it further: first heads produced 2, 2 and 0, and fix heads produced 2, 0 and 0. Six forks for the run, the same total as round 6 from the same number of parents, but distributed differently, and not by head kind, not by verdict (session 3 requested changes with no fork, session 4 approved with two) and not by diff size (session 3's 17-file diff forked none while session 1's 3-file diff forked two). Every fork carried a `parent_thread_id` naming its parent thread. This lane only counted.

## Other recorded observations

- **The sensitive question was asked six times and never fired.** `sensitiveFiles()` over `gh pr diff --name-only` returned an empty list at every head, including the 17- and 19-file diffs of pull request 21, so question three went into no prompt. Run per head, never inherited.
- **The collaborator probe returned 204 before every session**, so all six reviews posted as `<REVIEWER-ACCOUNT>` with `author_association` `COLLABORATOR`. Never `gh auth switch`; the active account stayed `<GH-ACCOUNT>` throughout. No 4xx of any kind this round, deliberate or otherwise.
- **Codex still dates rollout directories by local time.** A run that crosses local midnight files its rollouts under the local date, not the UTC date; count them by local date.
- **Timings are flat again and slightly tighter than round 6.** 3m19s to 3m56s across six sessions, first and fix heads alike, nothing near the 900 second cap.
- **Notes counts moved with the verdict, loosely.** The two approves carried 4 Notes each and no Criterion; the four changes-requested carried 3, 6, 4 and 2. Nothing in this lane's evidence makes that a rule.

## Evidence

- Trail `.local/lanes/loop/work-REVIEW-R7.tsv`, 33 rows, appended as the run went, never rewritten.
- Shim `.local/lanes/loop/codex-shim-R6.sh`, inherited unchanged, with its dry run recorded as the second trail row.
- Prompts `.local/lanes/loop/sol-review-prompt-{17-36693cb, 20-bd5aabd, 21-99203b5, 17-de6c8e3, 20-e7345cd, 21-f68fa4c}.txt`, 463, 480, 816, 518, 547 and 943 lines: pull request and head, `plan.md`, its test file, `gh pr diff`, then the first-head or fix-head question, with the prior review's Criterion findings pasted verbatim on the three fix heads.
- No worktree of this lane remains: `.worktrees/REVIEW-R7-17`, `-20` and `-21` were each removed after their session and `git worktree list` shows no `REVIEW-R7` entry. The `BUILD-R7-*`, `FIX-R7-*`, `BUILD-ACCEPT-DOCS` and `CHANGES-R4C` worktrees in that list belong to other lanes and were not touched.
- No `codex exec` process, no shim watchdog, no shim shell and no runner shell of this lane is running.

Nothing peeked: no `loop/key*`, no `handbacks/PLANT-*`, no `BRIEF-PLANT-*`, no `loop/work-PLANT-*`, and no diff read outside what was pasted into a prompt.

LANE-REVIEW-R7-DONE
