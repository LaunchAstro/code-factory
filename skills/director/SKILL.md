---
name: director
description: Sit thin over a fleet build as the owner's one long-lived session, routing his words and keeping orchestrators and merges moving. Use when the owner asks for a director, relay or remote-control pane, or a director boot file hands you the seat.
metadata:
  job: route the owner's words
  form: workflow
  source: local
  version: 0.5.1
---

**Route** each owner instruction to a `NATHAN-<TOPIC>.md` file, ticket or register line, and keep the fleet moving with one-line pointers ([FLEET.md](../../docs/FLEET.md#roles)).

## Not for
- Briefing, booting, nudging or closing lanes: `orchestrator` owns that.
- Building, reviewing or merging a piece: its `build-review` lane owns it to merged; the merge script merges.

## Inputs and authority
- Needs: the round folder (`$ROUND`), the register, and the last director's `REMOTE-CONTROL-BOOT-<n>.md` or the owner's first message. Missing: reply `BLOCKED: missing <input>`.
- May: write `NATHAN-<TOPIC>.md` files; append to the register and `RELAY-LOG.md`; file tickets and roadmap entries; comment on PRs and set or clear their `hold` label; send one-line pointers; run `kick.sh`; boot your successor.
- Never: brief, dispatch, build or diagnose; hand that to the orchestrator in one pointer. Read diffs only at step 4.
- Never deliver except with `../orchestrator/send.sh` beside this skill, which queues an urgent line on a working pane and never sends it Escape. Leave other fleets' panes and the owner's own alone. Stop only processes you started, by PID. Name secrets; keep their values out of chat, files and commits.

## Steps
1. **Read in** on a full-login seat: the boot file, the register (settled: never re-ask it), `ORCHESTRATOR-STATE.md` and the last 30 lines of `RELAY-LOG.md`. Done when: `RELAY-LOG.md` has `- HH:MM read-in: orchestrator <pane>, open: <items>.`
2. **Start watching** per [WATCH.md](WATCH.md). Append `<UTC> RELAY-HANDOVER <old-pane> -> <your-pane>` (herdr pane ids) to `events.log`. Done when: that line is logged and `RELAY-LOG.md` has WATCH.md's boot line.
3. **Route each owner instruction** to one place: fleet work to `$ROUND/NATHAN-<TOPIC>.md` (his words verbatim, then a numbered reading) plus one pointer to the orchestrator; new work to a ticket or roadmap entry; a decision to the register. Batch non-urgent pointers. Done when: each instruction has its one place, and each pointer shows delivered or queued.
4. **Read sign-in, money and data-separation diffs** on each `BLOCKED director-read #<pr> head=<sha7>` line: read that head once, for those three only; post a PR comment that starts `Director read <sha7>: pass` or `Director read <sha7>: findings` (each with `file:line` and a failing scenario); send the lane one line. Its findings hold the piece; no third Sol round follows. Done when: the comment for that head is on the PR.
5. **Check** on [WATCH.md](WATCH.md)'s schedule, on each `RELAY-ALERT` line, and when the owner asks. Done when: `RELAY-LOG.md` has this check's line and each finding has its pointer or owner line.
6. **Tell the owner** only METHOD's [owner items](../../docs/METHOD.md#what-reaches-the-owner), milestones and answers, never a red held for him; at twice a piece's budget, first add `hold` to its PR and send its lane one pause line. Shape: `<count>. Next: <step>. Needs you: <item> (rec: <choice>, reply <word>/<word>).` Drop `Needs you` when nothing does. Done when: every message fits that shape.
7. **Hand over** per [HANDOVER.md](HANDOVER.md) when `../orchestrator/ctx.sh <your-pane>` prints `PREPARE` or `HANDOVER` at the owner's thresholds ([METHOD](../../docs/METHOD.md#seats-lanes-and-stops)), or `RELAY-LOG.md` has your `DIRWATCH` line. Done when: your successor's `RELAY-HANDOVER` line is logged.

## Output
The steps' files, register lines, PR comments and owner messages, then `REMOTE-CONTROL-BOOT-<n+1>.md`.

## Reads
- `herdr` for every pane read and send.
- `claude-subscription-switch` when booting your successor.
- [HANDOVER.md](HANDOVER.md) also to boot any director.
