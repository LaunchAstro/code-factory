---
name: orchestrator
description: Conduct a round of lane work in herdr panes. Use when the owner hands over several tasks to run side by side while present, or a boot file names you the orchestrator.
metadata:
  job: conduct a round of lanes
  form: workflow
  source: local
  version: 0.7.1
---

Conduct the **round**: lanes build, review with Sol and own each piece to merged; you bind, brief, dispatch, verify by file and hold.

## Not for
- Unattended overnight runs, once switched on: `afk-orchestrator` owns that.
- Relaying the owner across a multi-day build: `director` owns that.

## Inputs and authority
- Needs: the git-ignored round folder: the state note (`ORCHESTRATOR-STATE.md` or newest boot file), decision sheet, owner's verbatim answers and `events.log`. Run `export ROOT=<ROUNDDIR> S=<SKILLDIR>`. Any missing: write `BLOCKED: missing NAME in ROOT` at the top of the state note, creating `$ROOT/ORCHESTRATOR-STATE.md` (and `$ROOT`) if missing, and stop.
- May: write briefs, the state note and `events.log`; boot seats; drive and close panes this round created; label and comment on PRs.
- Reports: the owner gets only [What reaches the owner](../../docs/METHOD.md#what-reaches-the-owner)'s items, batched, one line each with a recommendation. All else (check-ins, holds, blockers, dispatches, seat changes, section and round reports) goes in the state note for the director's (or owner's) read.
- Never: merge, edit lane-owned files or review code (the merge script and lanes do). Stop only PIDs you started, deliver only with `$S/send.sh`, never Escape a working pane, never `herdr pane run` into another pane (read lanes' git state from your own shell).

## Steps
1. **Boot.** Read the Needs files in order. Load `claude-subscription-switch` and `herdr`, and `code-factory` for a build round. `herdr workspace rename "$HERDR_WORKSPACE_ID" <PROJ>-Orchestrator-<Seat>`, your own seat, the label `claude-seat-up` gives a role window. Run the updated kit from `~/.cache/code-factory`, copying only the reviewer shim into the round's assigned path, filled per its [reviewer README](../../orchestration/reviewer/README.md); name its source commit in the state note. Source the shim and check `type sol_review_effort run_sol_review`; missing helpers hold the round. Load `loop` with no interval and arm one Monitor on `events.log`, adding each pane you dispatch. Done when: the window is renamed and the Monitor armed.
2. **Bind** per [round.md](round.md). Done when: the state note has the binding and no lane pane exists.
3. **Brief** per [brief.md](brief.md). Done when: every brief passes the checklist; each owner-only question is answered or its lane waits.
4. **Dispatch.** Canary first, per [brief.md](brief.md#dispatch). Done when: every lane is `working` and replied `LANE-<LABEL>-BOOTED` with its model.
5. **Tick.** Every wake, run [tick.md](tick.md). Done when: the state note holds this check-in.
6. **Batch end.** Run [batch-end.md](batch-end.md). Done when: the section-end cleanup PR merged or held; at a stage end, Sol approved its exact head and the owner's OK is logged.
7. **Hand over.** When `$S/ctx.sh` prints `HANDOVER` ([hand-off rule](../../docs/METHOD.md#seats-lanes-and-stops)), stop the current step at once and follow [handover.md](handover.md). Done when: `events.log` has your `ORCHESTRATOR-HANDOVER` line naming the successor's pane.
8. **Close.** Close out every lane per [tick.md](tick.md#close-out); leave each round repository `git status` clean; route findings and narrative per the project's `AGENTS.md`; finish with one `close-out`. Done when: every ledger row is closed, the record names every lane, the state note holds the round report.

## Output
At close: the round report (merged with SHAs, held and why, what is left, cost line, ceilings crossed, by how much) and one close-out record.

## Reads
- [holds.md](holds.md) when a PR reaches its review cap.
