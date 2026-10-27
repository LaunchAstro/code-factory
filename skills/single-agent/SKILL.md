---
name: single-agent
description: Own one area of a repo alone, landing its work on main in small risk-ranked pull requests. Use when dispatched to own one area, or the owner asks this session to take one to merged.
metadata:
  job: own one area's work
  form: workflow
  source: local
  version: 0.4.0
---

**Own** one area's work to merged; read Code Factory's [SINGLE.md](../../docs/SINGLE.md) first.

## Not for
- Several pieces at once, or two agents in one area: `orchestrator` owns that.
- A lane under an orchestrator's brief: `build-review` owns that.

## Inputs and authority
- Needs: the repository, area, job and [variant](../../docs/METHOD.md#build-variants). None named or `slow` is hardened production; `medium` or `fast` too, telling the owner in one line; production is SINGLE.md with [production.md](../../docs/variants/production.md)'s changes; prototype: reply `BLOCKED: prototype uses prototype.md`. A hand-off note carries all four: [HANDOFF.md](HANDOFF.md). Missing: stop and reply `BLOCKED: need <repo|area|job>`. A GitHub 4xx or a step failing twice: stop and reply `BLOCKED: <reason>`.
- May: use your worktree and branches, push, open pull requests, run Sol, sub-agents and the merge script, launch your successor. Spend 0: at a billing, extra-usage or upgrade prompt, press nothing and reply `BLOCKED: spend`.
- Never: merge any other way than the merge script, or post a `Sol verdict` status yourself; on a `WAIT`, fix its gate. Never weaken a finding's test; argue it on the PR. Stop only processes you started, by PID after checking its command, never by name (`pkill -f`, `killall`). Search inside your worktree, never from `/` or `/Volumes`.

## Steps
`C`: the Code Factory clone, `~/.cache/code-factory`, pulled (cloned if missing). `G`: `C/orchestration/single/handoff.sh`. Run `G ctx` after every push, Sol round and merge, acting at once per step 9: `HANDOFF` or `HARD` hands off now, mid-review included (owner, 17 October 2026).

1. **Shape.** Read the job and code; unsettled, take [the route](../../docs/SINGLE.md#shape-it-first-when-it-isnt-settled) first. Done when: the ticket lists the decisions, pull requests within [Pull request size](../../docs/METHOD.md#pull-request-size), and each criterion's named test.
2. **Branch** a worktree off fresh `main`, named by the project's lane rules. Done when: `git status` is clean on the new branch.
3. **Build test-first.** Run each new test red for its criterion's reason, then build to green. Done when: the red line and green run are saved.
4. **Check.** Update from `main`; run the repo's checks and every row of [CHECKLIST.md](../../docs/CHECKLIST.md). Done when: checks are green; every row has a proof or exclusion.
5. **Rank** per SINGLE.md's [Risk](../../docs/SINGLE.md#risk), with a fresh sub-agent's blind rank; the higher stands, unsure is higher. Done when: the rank and reason are written down.
6. **Open the pull request** with the loading bay's three lines ([enqueue.md](../../orchestration/enqueue.md#the-loading-bays-gates)), `**Risk:** <rank>, <reason>` on a private repo, and step 3's proof. Done when: `gh pr view` shows them and the head SHA.
7. **Review to the rank** per [REVIEW.md](REVIEW.md): Sol on every head, SINGLE.md's rounds by rank, high's fresh Opus read. Done when: Sol approves the exact head, or the PR carries the `hold` label.
8. **Merge.** In `C`: `node orchestration/enqueue.mjs --repo <owner/repo> --pr <n> --head <full-sha>`. Any answer but `MERGED`: [MERGE.md](MERGE.md). Done when: `gh pr view` shows it merged, or held.
9. **Gauge and close.** `GO`, work left: step 2. `WRAP`, `HANDOFF` or `HARD`: [HANDOFF.md](HANDOFF.md). `NO-PANE` or `NO-READER`: tell whoever started you once, and carry on. A hold or the last merge ends the job: `close-out`. Done when: back at step 2, handed off, or the close-out record exists.

## Output
Per pull request, to whoever started you: `MERGED #<n> risk=<rank> sol-rounds=<n>` or `HELD #<n> <gate>`; at a hand-off, `HANDED-OFF <label> pane=<pane> ctx=<n> note=<path>`; then the `close-out` record.

