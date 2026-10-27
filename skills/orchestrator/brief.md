# Briefs and dispatch

Dispatch open, unassigned, unblocked map units, lowest wave first, one per lane-session; parallel lanes own disjoint files.

## Checklist

One self-contained file per lane, under 600 words, naming:

1. Label, seat, model and the whole role stack by path, run unprompted, with `sub-agents` and its sub-agent number (0 allowed); a slice lead's lists its pieces from your plan, each `sub-agent` or `in order`.
2. Each binding ceiling, as a number.
3. The review of record, a different company's model than the builder's; the lane runs it and owns its piece to merged through the merge script's gate.
4. Stops: on BLOCKER or 4xx, stop, log it, build nothing around it; after the security review prints, carry on in the same turn: push, PR, log; start any run over 5 minutes with `nohup`, recording its PID; stop only PIDs it started; clean up by owned id (container, volume, database).
5. Secrets and client-material sweeps ([Build variants](../../docs/METHOD.md#build-variants)); for client data, each separation to prove (business, client, person).
6. The trail TSV; the lane finishes with `close-out`, its PR's three lines plus that record being its result.
7. The first `events.log` line, `<UTC> <LABEL> BOOTED model=<model> seat=<seat> Section: <section id> Ticket: #<n>`; on a new ticket, `<UTC> <LABEL> TICKET Section: <id> Ticket: #<n>` and a workspace rename; and, word for word, "Log only milestone lines; never acknowledge a message; your next milestone is the answer."
8. `<LABEL>-BOOT-TAIL` last.

Premise-check each: paths exist, rules are real. Owner-only questions go as one numbered list, a recommendation beside each; answers go into the briefs.

## Dispatch

1. Read the launcher's command line. `<LABEL>` is `<PROJ>-<Section>-<ticket>`; the launcher appends `-<Seat>`. A name `herdr workspace list` already has gets a letter in the section; never close a workspace you didn't create. Run `claude-seat-up --name <LABEL> <SEAT> --model <MODEL>`; the printed pane's workspace must read exactly `<LABEL>-<Seat>`, else stop before sending.
2. At `agent_status: idle` the banner shows the bound model and `bypass permissions on`; else stop, lead the check-in with it, boot nothing else.
3. `$S/send.sh <PANE> <LABEL>-BOOT-TAIL "Lane <LABEL>, seat <SEAT>: read <BRIEF> in full and follow it. First reply: your model and LANE-<LABEL>-BOOTED; then start. <LABEL>-BOOT-TAIL"`
4. A first reply without model and phrase stops the lane. Fan out once this canary passes; state-note ledger row `working` with label, seat, model and pane.
