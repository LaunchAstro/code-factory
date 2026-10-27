# How the fleet works

This file sets the fleet's roles, review and paperwork. It wins over [METHOD.md](METHOD.md) wherever the two disagree.

**The rule behind everything:** tokens go on the problem, not on reports and ceremony. Spending 5 million tokens on a hard problem is fine. Spending them relaying, re-reading and proving paperwork is not.

## Pick the shape first

- **One feature, or a switch-on:** one agent owns it end to end. No director and no orchestrator.
- **A multi-piece build with parallel work:** the fleet (director, orchestrator, lanes).

Whoever starts the work says which shape it is.

## Roles

**Lane.** A lane owns its piece until the piece has **merged**:
1. Build it, test first.
2. Start its own fresh Sol review, fix what the review finds, and re-review, until Sol approves the exact head ([Review rounds](METHOD.md#review-rounds) sets the rounds and the ladder at the cap).
3. Run the checks and the one-off record step.
4. Write the three description lines (below), and mark the PR ready.
5. Wait cheaply (a script waits, not the agent) until the PR merges. If the queue drops it, fix it and mark it ready again.

The lane fixes its own bugs, failing checks and review findings without asking. It passes something up for only four reasons:
- it needs a permission, spend, or an owner-only step (a code, a login);
- it is blocked by something outside its own piece;
- the question is beyond its context (product behaviour, system design);
- the piece is still not approved at the round limit. The lane then takes [the ladder](METHOD.md#review-rounds): it splits the piece, or the piece goes up to the director.

**Orchestrator.** Keeps lanes filled to the seat caps, boots lanes with short briefs, unblocks and nudges stuck or looping lanes, and answers what it can. What it can't answer goes to the director. It never builds, diagnoses or investigates itself. Any job longer than a few minutes goes to a lane. Its turns stay short.

**Merge script ("loading bay").** Merges, not an agent:
- It picks up every PR marked ready and puts it in GitHub's merge queue. On a repository with no queue it merges the PR straight to `main` at its checked head ([enqueue.md](../orchestration/enqueue.md#with-no-merge-queue)).
- On a drop it re-queues the PR once. On a second drop it hands the PR back to its lane.
- The work map shows the bay from GitHub: ready, queued, merged and dropped, each with its reason.

**Director.** Kept thin. It routes the owner's words to the right place: a lane, the orchestrator, the roadmap or an issue. It keeps the orchestrators and the merges moving, and makes the build more efficient. It reads diffs only for sign-in, money and data separation. It stays quiet while work moves.

**Context, every role:** finish at 45 percent, hand off at 50, hard cap 70 ([METHOD.md](METHOD.md#seats-lanes-and-stops)).

## Models

Which model does each job, and at what effort, lives in your model list. This file keeps the rule behind it. Claude (Opus) builds, directs and orchestrates. Sol only reviews and never writes product code. The reviewer of record is always from a different company than the builder. A model's review of its own company's work clears nothing.

## Review

**Sol effort, full and single mode:** [the shared risk rule](SOL-EFFORT.md)
uses `medium` for every review except [high-risk ones](SOL-EFFORT.md#high-risk),
which use `high`. Rank the PR before launching; keep its rank on fix passes.
Review counts and the ordinary/sensitive build tags below do not select effort.

- **Every head:** Sol, until it approves the exact head: product code, styling, wording, tests and docs alike, at the effort [its risk rank](SOL-EFFORT.md#high-risk) sets. Rounds and the cap: [Review rounds](METHOD.md#review-rounds).
- **Sign-in, money or data separation:** one Opus read as well, the director's.
- **Never twice:** nothing is read by two gatekeepers for the same reason.

## Switch-ons and deploys

- Use the app's own deploy, migration and settings tools. Never a custom frozen runner.
- Rehearse against the real system early with a write that changes nothing.
- Save the current value before each write, put it back on failure, and check after each step.

## Pausing and restoring the whole fleet

For any operation that closes every pane. Jobs started with `nohup` survive a pane close; watchers and Monitors bound to a session don't.

1. **Each lane** stops at a safe point, pushes its work and saves `lanes/<lane>.md` in one hand-off folder: PR, head, branch, worktree, last step, next step, open asks, and each process it started with whether it survives a pane close.
2. **The orchestrator** writes `ORCHESTRATOR.md` there (its background jobs, whether each survives, and the reboot order with each lane's seat, model and effort), then `READY.md` once every lane has saved.
3. **The director** writes its next boot file. The panes close only after `READY.md` exists.
4. **Restore:** the director first, then the orchestrator from its successor boot, which reboots the lanes in the saved order under the machine load rules ([METHOD.md](METHOD.md#the-merge-pipeline)).
5. **Log the hand-over.** After a restore there is no outgoing orchestrator, so the successor still logs the `ORCHESTRATOR-HANDOVER` line ([its one format](METHOD.md#seats-lanes-and-stops)) in `events.log`: the director's kicker finds the orchestrator's pane from that line.

## Paperwork: four things per agent, nothing else

1. **A start line:** repo, section, ticket, seat, model and session (the Code Factory declaration writer).
2. **Three lines in its PR description,** and no separate wrap-up document. A wrap-up that describes the code drifts from it, and the code is the truth.
   - `**Why:**` the reasons for the choices, tied to that exact code.
   - `**Left undone:**` the follow-up ticket numbers, or `none`. Unfinished work becomes tickets.
   - `Closes #n` for each ticket the change finishes (GitHub closes it on merge), or `Closes: none`.

   Descriptions and tickets are pointers. When they disagree with the code, the code wins.
   - **The price of the queue.** Before the loading bay queues a PR, the merge script checks for the three lines ([enqueue.md](../orchestration/enqueue.md#the-loading-bays-gates)). If any is missing or malformed, the PR stays out of the queue, and the script sends the owning lane's pane one line with the template. The lane is still open, waiting for its merge.
   - **Automatic fallback.** When a session ends without a PR, or is closed suddenly, a script records only its branch and the tickets it touched.
   - **Visible gaps.** The work map marks any agent that closed without either. The orchestrator's close-down check sees the same mark.
3. **Its finish.** An agent started to do a task (a lane, a worktree job, a dispatched task) finishes with the `close-out` skill. It:
   - checks the three lines;
   - turns unfinished work into tickets;
   - saves a short record (the task, the PR and ticket numbers, non-code lessons, never the code) to the owner's private session records;
   - removes its own work copies once their work is pushed or merged (a copy holding unpushed work stays, named in its report);
   - tells whoever started it.

   A Sol run's script removes its review copy once the verdict posts, as `orchestration/reviewer/sol-pr-cf.sh` does. The check machine's weekly sweep ([orchestration/m5](../orchestration/m5/README.md)) moves what is left to the Bin. A session the owner took part in (a director, an owner chat) uses the wrap-up instead: their words verbatim, their questions, decisions, research and learnings.
4. **Its tokens and working time.** No agent reports these. A script collects them: herdr gives each pane's process, model and status, and the process's own session log gives its token counts and timestamps.

The event log keeps milestones only (started, ready, merged, blocked, closed) and starts fresh each day. Handovers are one line plus a short state note.

**Gone:** receipts, manifests, rebind cycles, close-down proofs, and verbatim copies of handbacks (the `close-out` record is a short pointer, not a copy). The only exception is production secrets.

## The work map's ledger and budgets (scripts, not agents)

- **One SQLite file** inside the work map: a rebuildable index of GitHub (PRs and times), herdr's panes, the session logs' token counts and times, the start lines and the PR descriptions. Message content is never read.
  - It is keyed by session and PR number, so nothing is stored twice.
  - It is never hand-edited, and it can be rebuilt from those sources at any time.
  - Every figure carries an "as of" time and shows *pending* when stale.
- **Budgets per ticket and spec,** by size and kind, from our own history: the median and spread of time and tokens. The first week is calibration.
- **A background script** compares each piece's progress with its budget:
  - at **1.5×** it alerts the orchestrator to kick it;
  - at **2×** the director tells the owner and pauses the piece.
- **A daily split** of tokens between work (builders, reviewers) and overhead (director, orchestrator). Target: at least 70% on the work.
- **Bookkeeping is scripts, never in the way.**
  - GitHub closes tickets from `Closes #n` on merge; a script marks a spec built when all its tickets are closed and rolls progress up the work map's sections.
  - Luna or Haiku runs beside it, read-only and advisory: it suggests fuzzy closes, flags stuck work and suggests what to work on next, each shown in the work map with a one-click confirm. It is never in the merge path; if it breaks, builds and merges carry on.
- **Tripwires:** a review or switch-on cycle restarting more than twice, or no merge for 2 hours while work is in flight. Each is reported, never answered with another round.

## How this changes

Evidence first, then a grilling, then the owner's yes. Each change is logged in [SKILL-WATCH.md](SKILL-WATCH.md) with what was tried and what it measured, and the file changes only after the owner agrees.
