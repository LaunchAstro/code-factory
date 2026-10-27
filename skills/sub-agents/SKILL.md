---
name: sub-agents
description: "Brief, run and join fresh sub-agents inside a lane. Use when a lane hands a job (a build piece, a race attack, a check) to a sub-agent."
metadata:
  job: brief and join fresh sub-agents
  form: workflow
  source: local
  version: 0.5.0
---

**Brief**, run and join fresh sub-agents for your lane's own piece. The limits are Code Factory's [Sub-agents](../../docs/METHOD.md#sub-agents).

## Not for
- Starting an agent in its own pane: `dispatch` owns that.
- Booting lanes and keeping seats filled: `orchestrator` owns that.

## Inputs and authority
- Needs: your label, your branch head sha and each job's done-when. Missing: reply `BLOCKED: missing <input>`.
- May: start sub-agents with the Agent tool (`subagent_type: "general-purpose"`, `model: "opus"`), add worktrees and branches, merge pieces into your branch.
- Never: hand a sub-agent your context; write what it needs into its brief, so it starts fresh from the brief alone. Never close or hand over with one running; join it, or end it per [briefs.md](briefs.md#ending-one). Keep work in progress as commits; never `git stash` in a repo with worktrees, since they all share one stash stack.

## Steps
1. **Split the jobs.** Pieces that pass the [independence test](briefs.md#independence-test) go to sub-agents, each sized per Sub-agents; the rest you do in order. Done when: every job is marked `sub-agent` or `in order`.
2. **Brief and start.** The cap is the lower of your brief's number and the limit in Sub-agents; with your seat at its cap or your machine `full` in `seat-gauge`, it is 0 and you do the jobs yourself. Add each build piece's [worktree](briefs.md#worktrees), write each [brief](briefs.md#brief), and start at most the cap at once, each brief whole as its prompt. Work your `in order` jobs meanwhile, away from their files. Done when: `git worktree list` shows each build piece's worktree and each sub-agent is running.
3. **Join each reply** per [briefs.md](briefs.md#join), checking it against any owner or orchestrator ruling that arrived since its brief. Done when: each piece is merged into your branch with its focused tests green, or rebuilt in order.
4. **Clean up.** Remove each joined piece's worktree and branch, and any container named for a piece; an ended piece's wip branch is pushed and kept ([briefs.md](briefs.md#ending-one)). Done when: `git worktree list` shows only your own and `docker ps -a --filter name=^<LABEL>-` is empty.

## Output
Each piece joined on your branch, each other job's result in hand, and no sub-agent, worktree or container left behind.

## Reads
- [briefs.md](briefs.md) at every step.
