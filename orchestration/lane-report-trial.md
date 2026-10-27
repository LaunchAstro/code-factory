# Run the one-day lane report trial

The [lane report reference](lane-report.md) describes inputs and limits.
Runtime remains sealed until the review and parent release below.

1. A fresh Sol reviewer reads the complete candidate, runs the named fake
   tests and checks the dormant transport. The parent records its release
   decision. No current test result supplies either approval.
2. Before opening the source seal, confirm the static M4 SSH alias and the
   real herdr metadata/read response format. These integrations are unrun.
   Confirm every inventory label belongs to this fleet, titles match, and
   progress timestamps come from the current round state. Coordinate the
   shared 35b slot with the audit. Keep the seal closed if anything is unknown.
3. Open the seal in a reviewed release change. Bind review and parent release
   to that exact head. Run one low-priority M5 pass with `nice -n 10 node
orchestration/lane-report.mjs --live --inventory <parent-inventory.json>
--out <new-pass-directory>`, adding `--previous <prior-report.json>` after
   the first pass. Omit `--now` to use current UTC. Compare the result with
   the Director's hourly check before authorising any repetition.
4. For one day, the parent invokes single passes sequentially beside that
   hourly check. This delivery installs no loop, poller, cron, launch agent or
   service. The parent reads local notes and decides any response. Record
   false alarms, missed problems and unknowns, with secret-free counts.
5. End the trial by ceasing invocation. Keep reports private. Reclose the seal
   in a reviewed change if runtime is withdrawn. Do not unload models or
   change the service to tidy up. The future service-cap change belongs to a
   separate lane after side chat switch-on, with its own preimage and restore.
