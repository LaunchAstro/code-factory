---
name: build-review
description: Build one increment test-first, review it with Sol and land it. Use when a builder brief hands you tickets, or Sol's findings come back on it.
metadata:
  job: build one increment to merged
  form: workflow
  source: local
  version: 0.6.0
---

**Build** one increment test-first, review it with Sol and land it. You are Opus 5.5 high; Sol (GPT-6.1-Sol) reviews.

## Not for
- Reviewing a branch against standards and spec: `code-review` owns that.
- Owning one area alone: `single-agent` owns that.

## Inputs and authority
- Needs: the brief (project method file, increment, tickets, variant, ceilings as numbers); none named, `slow`, `medium` or `fast`: hardened production; prototype: reply `BLOCKED: prototype uses prototype.md`. A missing input, a GitHub 4xx or a step failing twice: log `<UTC> <lane> BLOCKER <reason>`, stop and reply `BLOCKED: <reason>`.
- May: code in your worktree and branch, push, run Sol on your piece, reply on review threads, append to `events.log`. Sub-agents only through `sub-agents`, as many as [Sub-agents](../../docs/METHOD.md#sub-agents) allows; spend 0.
- Never: merge or post a `Sol verdict` status by hand; the merge script merges. Never weaken a proof test; argue it in the thread and Sol rules. Stop only processes you started, by PID, after checking its command; never `pkill -f`, `killall` or kill by name.

## Steps
1. **Read in.** Read every ticket whole, Security line included. Base each pull request on `main`, unless the brief names a top-carry exception. Delete nothing outside the build's cache without the owner's yes. Done when: each criterion has a named test.
2. **Tests first.** Write the named tests; run them red for the reason the criterion names, never a missing import. Done when: the red run's failure line is recorded.
3. **Build** in readable commits with the project's trailers, each pull request within [Pull request size](../../docs/METHOD.md#pull-request-size). Before every push, get the project's checks, secrets sweep and client-material sweep green ([Build variants](../../docs/METHOD.md#build-variants)), then run every row of [CHECKLIST.md](../../docs/CHECKLIST.md) on your diff. Done when: tests pass; every checklist row has a proof (head, command, result) or exclusion.
4. **Declare ready.** Push, log `<UTC> <lane> READY <increment> base=<sha7> head=<sha7> variant=<hardened|production> (<tests>)`; that range is frozen. Carry on in the same turn after a security review's report, then with independent work; log `HANDOFF` for dependent work only after the piece lands. Done when: READY is logged.
5. **Review and fix.** Run Sol on the frozen range per [SOL-PROMPT.md](../code-factory/SOL-PROMPT.md). Turn each finding's scenario into its named test, failing on the old head; make the smallest change that passes it and the suite, deleting first. Per round: one push, one reply per finding, one `<UTC> <lane> FIX-PUSHED <increment> head=<sha7> net=<product>/<test>` line (signed: `+120/-30`). Rounds, cap ladder, repeat findings: [Review rounds](../../docs/METHOD.md#review-rounds). Past [Fixes stay small](../../docs/METHOD.md#fixes-stay-small)'s limits, don't push; send the orchestrator a two-line simpler design. Done when: Sol approves the exact head, Review rounds holds the piece, or the simpler design is sent.
6. **Land.** Write the PR's three lines per `close-out`. Mark it ready only once the PR shows a clean security review and, for a protected part, a green conformance proof: an orchestrator in the brief confirms both; with none, you check and log both. Unconfirmed or unproven: `BLOCKED: <reason>`. [Wait cheaply](../../docs/FLEET.md#roles); a dropped PR's fix reruns step 5. Done when: `gh pr view <pr> --json state` says `MERGED`.
7. **Close out** when merged, held or at a ceiling (a ceiling adds a handoff note). Done when: the `close-out` record exists.

## Output
The close-out record: merged or held (open findings, unrun checks).

## Reads
- [REVIEWER.md](REVIEWER.md) and [ALWAYS-BLOCKS.md](ALWAYS-BLOCKS.md): Sol's prompt inserts; builders skip.
