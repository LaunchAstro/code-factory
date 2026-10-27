# Handover

Resume at your first unfinished step.

1. Rewrite the state note in full, naming the interrupted step; append the packet: `$S/packet.sh <OWNER/REPO> ...` per round repository, open holds with raised times, `working` ledger rows, every active rule file's path. `UNKNOWN` or pre-handover checks are unknown, never green.
2. `herdr workspace rename "$HERDR_WORKSPACE_ID" <PROJ>-Orchestrator-Old`. Keep Monitor, loop and ticks running.
3. Boot your successor, same model, on the seat with most room under its cap (`seat-gauge`): `claude-seat-up --name <PROJ>-Orchestrator <SEAT> --model <MODEL>`. Nobody else, director included, boots it.
4. `$S/send.sh <PANE> ORCH-BOOT-TAIL "Read <BOOTFILE> in full: your whole boot. Append <UTC> <PROJ>-Orchestrator ORCH-SUCCESSOR-BOOTED <PANE> model=<model> to events.log, then reply how many packet rule paths resolve and each packet PR's head and required checks, re-read now. Rule only after an ORCHESTRATOR-HANDOVER line ending -> <PANE>, re-reading the state note and events.log first. ORCH-BOOT-TAIL"`.
5. When an `ORCH-SUCCESSOR-BOOTED` line names that pane, stop your Monitor and loop, append `<UTC> ORCHESTRATOR-HANDOVER <you> -> <successor pane>`, send `$S/send.sh <PANE> ORCH-BOOT-TAIL "Handover logged: rule now. ORCH-BOOT-TAIL"` leaving your pane open. None in 10 minutes: read its pane once; working, wait 10 more; else close it and retry step 3 once, same seat. Still none, or a send.sh `STOP` (close its pane first): resume ticking, re-arming Monitor and loop, and lead the check-in with it.
