# Watch

`kick.sh` covers a quiet orchestrator, context hand-overs and merge stalls without tokens. Your check covers what it can't see. The owner's rule (19 Oct 2026): "the director checks every 30 minutes, not hourly, and each check closes out passive lanes (done or idle, no work in hand) and reads both pre-check lines for a stall". kick.sh's run of `precheck-stall.sh` reads the pre-check lines and writes their stall alerts to `RELAY-LOG.md`; you act on those alerts.

## Start the kicker and the check

Run this once, with the two paths filled in as absolute paths. It prints the kicker loop's PID:

```sh
export ROUND=/absolute/path/to/round SKILL_DIR=/absolute/path/to/this/skill
nohup bash -c 'while true; do bash "$SKILL_DIR/kick.sh"; sleep 540; done' >/dev/null 2>&1 & echo $!
```

Then schedule a check every 30 minutes with CronCreate, prompt `Director check: run WATCH.md, act, log one RELAY-LOG.md line.` Arm one Monitor on `RELAY-LOG.md` for `RELAY-ALERT` and `DIRWATCH` lines, so a hand-over or alert wakes you between checks. If CronCreate is missing, log "check none" and check on each `RELAY-ALERT` and when the owner asks; never type a slash command into a pane. Append to `RELAY-LOG.md`:

```
- HH:MM boot: kicker PID <pid>, check <id>, orchestrator <pane>.
```

## What kick.sh already does

Each run it nudges a quiet, idle orchestrator, at most once per pane in its nudge window, and sends it one hand-over nudge when `ctx.sh` prints `HANDOVER` (skill step 7). It writes your own `DIRWATCH` line and `RELAY-ALERT` lines to `RELAY-LOG.md`, never into your pane: pane gone, long silence, a nudge that did not land, a hand-over line with no pane id it can parse, and, while work waits, the owner's merge alarms (19 Oct 2026) and FLEET's no-merge tripwire. Its thresholds are inline in `kick.sh`. Every delivery goes through `send.sh`, which stops on any dialog.

## The list

Run all five and note each result.

1. **Fill.** With `seat-gauge`, count working lanes per seat (`agent_status` `working`, leaving out the orchestrator, yourself, other fleets' and the owner's panes). A seat under its cap with room on its machine while unblocked tickets wait: one pointer to the orchestrator.
2. **Passive lanes.** Count this fleet's lane panes that are done or idle with no work in hand: `LANE-<LABEL>-DONE` logged or their PR merged, no later `TICKET` line, and not `HELD`, `PARTIAL` or waiting on a review. Name each in the pointer, for the orchestrator to close out. One you named at the last check and still open: `KICK`.
3. **Budgets.** Any piece the budget watcher marks at twice its budget: step 6 of the skill.
4. **Disk.** Any machine under the disk floor in METHOD's [Seats, lanes and stops](../../docs/METHOD.md#seats-lanes-and-stops), read from `seat-gauge`: one pointer to the orchestrator to give a lane the clear-up.
5. **Check-in.** Read the check-in in `ORCHESTRATOR-STATE.md`: the orchestrator reports its holds, blockers, 4xx, dispatches and costs there, not to the owner. A hold or blocker it can't clear gets your pointer or your read (skill step 4); only METHOD's owner items go on to the owner (skill step 6).

## Act and log

Put every finding, and any merge alert since the last check, in one pointer to the orchestrator, ending in the probe word `RELAYKICK<HHMM>`. Log only the lines this skill names and milestones; never log or send an acknowledgement. One line per check in `RELAY-LOG.md`, local time:

```
- HH:MM check: <MOVING | KICK>. <what changed>. <n> lanes, <p> passive, load <per machine>. Orch <pct>%, director <pct>%. Disk <per machine>G. <No kick | KICK: findings>.
```

Write to `events.log`, `RELAY-LOG.md` and any file a loop follows only by appending (`>>`). Fix a wrong line with a new `CORRECTION:` line, never an edit in place: on 13 Oct an in-place edit made every watcher replay the log and re-queue about 134 PRs.
