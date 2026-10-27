# The tick

The Monitor wakes on PR, READY, FIX-PUSHED, ASK, BLOCKER, HELD, ORCH-SUCCESSOR-BOOTED, CLOSED, CLEANUP, review and CI lines; one waiter owns the `events.log` read mark, advancing it only past lines it printed. Each wake, act on every pending line:

1. `$S/ctx.sh`: `HANDOVER`, go to [handover.md](handover.md); `PREPARE`, rewrite the state note in full at step 8; `NO-PANE`, rerun with your pane id.
2. `cat` each lane's trail whole, never `tail`.
3. BLOCKER or 4xx: hold the lane. Budget spent: stop the round. Either leads the check-in.
4. Count each PR's reviews and reviewer sessions (GitHub and trail) against the ceilings (Copilot's is 0). A PR red at its review cap goes to holds.md before step 5.
5. At READY and FIX-PUSHED, check the record lists its proofs at its head; else hold that step, asking only for the missing proof.
6. Done lanes go to close-out; `HELD`, `PARTIAL` and waiting lanes stay warm.
7. Fill to the cap (the [seat](../../docs/METHOD.md#seats-lanes-and-stops) and [sub-agent](../../docs/METHOD.md#sub-agents) caps) with unblocked work. Log `<UTC> ORCH PARKED <item>: <what it waits on>` once per parked piece, again only on change. A seat at its stop or load past its limit: trim sub-agents first.
8. Rewrite the state note in under 30 lines, keeping any handover packet, with the check-in in bullets: `HELD`, `BLOCKER` and 4xx first; routine calls since the last check-in; the fill line (lanes, sub-agents, load); the cost line (reviews and reviewer sessions against budget, each seat's 5h and 7d from the state note or statuslines, never by running `claude-seat-up`, each lane's context and dollars).

## Close-out

1. `$S/send.sh <PANE> <LABEL>-WRAP-TAIL "<TEXT>"`, prose with no leading `/`: run `close-out`, commit your work, stop your processes, delete temporary files, `<LABEL>-WRAP-TAIL`.
2. Verify by file: the lane's `CLOSED` line in `events.log` (a cleanup pass's `CLEANUP` line too); its close-out record, newer than its boot and holding a lane-unique phrase; the PR's three lines; its branch's `git status` clean; its processes gone; the PR state matching.
3. Missing: read the pane, repeat step 1 once; never close on a failed probe.
4. Read each pane before closing it: owner input since its wrap makes it an owner-chat pane, whatever the note says. Owner-chat panes and any the owner asks to keep stay open, recorded.

Append (`>>`) to `events.log`, `RELAY-LOG.md` and any file a loop follows; never edit them in place. Fix a wrong line with a new `CORRECTION:` line.
