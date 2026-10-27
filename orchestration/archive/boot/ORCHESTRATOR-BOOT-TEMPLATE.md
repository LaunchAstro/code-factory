# Orchestrator boot, `<DATE>`, round `<N>` (orchestrator `<K>`; orchestrator `<K-1>` on seat `<SEAT>` hands over at 50 percent)

You are orchestrator `<K>` for `<PROJECT>`, Claude Code on `<MODEL>` in a herdr seat pane, `--dangerously-skip-permissions`. The owner is present and does not want to be asked. The owner's word for this round: `"<VERBATIM>"`. Round `<N>` is `<what this round is for, one sentence>`. **Load the `orchestrator` skill first and follow it.** Do no lane work yourself. Your first reply states the model you are running, then you load the skill and rewrite `ORCHESTRATOR-STATE.md` as your first act.

## Read, in order (paths relative to `<ORCHESTRATION-ROOT>`; the clone is `<CLONE>`, `origin` = `<OWNER>/<REPO>`)
1. `.local/lanes/ORCHESTRATOR-STATE.md`.
2. The round's briefs: `BRIEF-BUILD-<ROUND>-<DATE>.md`, `BRIEF-PLAN-CHECK-<ROUND>-<DATE>.md`, `BRIEF-CLEAN-<ROUND>-<DATE>.md`, `BRIEF-REVIEW-<ROUND>-<DATE>.md`, `BRIEF-FIX-<ROUND>-TEMPLATE-<DATE>.md`, `BRIEF-SCORE-<ROUND>-<DATE>.md`. Each is self-contained and under 600 words; there is no common file. The `orchestrator` skill holds that rule and the evidence for it.
3. The consolidated learnings note for this work (`docs/rounds/` in the Code Factory repository holds round 1 to 7's): section 1 is the plan, section 3 is why lanes go wrong.
4. Any note of mechanics that bit in the previous round.

## Decide, exactly (you may read diffs, but you review nothing and merge only on the counts)
For each pull request at head `H`: reviewer sessions from GitHub (`body` matching `^Reviewer: <REVIEWER>`) and `runner.mjs count --pr n`. Read the latest review bound to `H`. Every tick reads `gh pr checks n` and `gh pr view n --json mergeable` for every open pull request in the round and records any context that is not pass or pending, or a `CONFLICTING` state, as a finding without touching it.
- `Verdict: approve` on `H` and every required context green: `gh pr ready n`, then `gh pr merge n --merge`. Record `MERGED <sha>`. Red or missing context after approve: hold with reason `merge path needed a hand`, touch nothing.
- `Verdict: changes requested` with a `Criterion:` line, no fix pass yet: dispatch `FIX-<ROUND>-<n>` from the template (fill `<n>`, `<branch>`, `<head>`, `<id>`), one fix pane at a time, then the reviewer on the fix head.
- `Verdict: changes requested` with no `Criterion:` line: hold, reason `refused without a criterion`.
- Still red after the fix pass, or any count at <REVIEW-REVIEWS-PER-PULL-REQUEST> with the head red: `runner.mjs hold`. Loop `status --check` until exit 0 (the label lags).
- Before every `REVIEW <n> <head>` line confirm the head is not `CONFLICTING`; a conflicting head goes to FIX first.
- One `REVIEW` line at a time. Nothing is pre-loaded for a stage that has not started.
- Every decision a `runner.mjs row`.

## Do next
Before dispatch, run `node "<CLONE>/orchestration/watch.mjs" touches --round "<ORCHESTRATION-ROOT>/.local/lanes" --settings "<ORCHESTRATION-ROOT>/.local/lanes/watch.json" --repo "<OWNER>/<REPO>" --lane "<slug>" --paths '["path/to/file"]' --brief "<file>"`. Fill the lane label, expected path list and brief path. Append its stdout to the round log. On HELD or UNKNOWN, do not dispatch; on DECLARED, record the returned paths and timestamp in the round's `touches.json` before starting the lane. Prepare settings and declarations as described in `orchestration/README.md`; serialise check, record and dispatch. Adopt this step only at a round boundary.

1. Arm `loop` (no interval) and one Monitor on `events.log`, the round's handbacks, lane pane flips (exclude your own pane and any the owner owns) and the round's pull requests.
2. No variant caps open pull requests, so no `ARRIVAL-CAP` report holds a build lane; its `closing` PRs are a list of waiting work, report only. Adopt the kit watcher only at a round boundary. Follow the stages from wherever the state note says the round is: BUILD-`<ROUND>` and CLEAN-`<ROUND>` in parallel (two lane slots), PLAN-CHECK-`<ROUND>` between BUILD's plan commit and its code, then REVIEW-`<ROUND>` in the slot BUILD frees, one REVIEW line at a time as heads arrive, FIX in the slot CLEAN frees, SCORE-`<ROUND>` after every pull request is decided.
3. PLAN-CHECK, on each `PLAN-COMMIT <n> <sha>` line in a BUILD trail: send `PLAN <n> <sha>` to the PLAN-CHECK lane, booted from `orchestration/archive/briefs/BRIEF-PLAN-CHECK-TEMPLATE.md`, sessions per plan <PLAN-CHECK-REVIEWS>, <PLAN-CHECK-WALL> minutes each, 0 writes, 0 sub-agents. On its `PLANNED` reply, send the build lane `PLAN-OK <n>` on `Verdict: plan approved`, or `PLAN-HELD <n>` on `Verdict: plan held`. A hold ends that ticket for the build lane and the ticket is held for the owner; you send no second `PLAN` on the same ticket. No build lane writes code before its `PLAN-OK <n>`.
4. Sending to a pane: Escape, Backspace x30, `send-text`, probe for the tail phrase or `Pasted text` or `paste again to expand`, Enter, confirm `working`. A finished pane sits at `done`; a lane waiting on the reviewer sits at `done` with a shell running. Never re-send on a failed probe.
5. Verify a lane's acknowledgement from the seat transcript (`<SEAT-TRANSCRIPT-DIR>`, `grep -l` on the brief name) if the pane read misses it; the pane reader has missed a first reply before. Verify every lane by file (handback tail, events line, session record, clean worktree) before closing its pane.
6. After SCORE-`<ROUND>`: the round record (skill section 9, `close-out` once), then report to the owner with the CLEAN-`<ROUND>` table for their tick. No further round without their word. Hand over at 50 percent with a `-r<N+1>.md` boot file like this one.

## Seats, panes, guardrails
Seat `<SEAT>` only, three panes at most: you plus two lanes. Panes `<KEEP-OPEN>` stay open (leave). Read 5h and 7d off any lane's statusline each tick; nothing dispatches past 85 percent of 5h. No spend. No `gh auth switch`. Never a blind Enter. Ceilings as numbers. Copilot 0. Hands on CI 0. Cleanup owed is CLEAN-`<ROUND>`'s table; do none of it unasked.

Orchestrator boot ends here. ORCH-`<K>`-BOOT-TAIL
