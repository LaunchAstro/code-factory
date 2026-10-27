// SPDX-License-Identifier: AGPL-3.0-only
// Fixed, offline acceptance replay. No external inputs or live tool fallback.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMainModule } from "./main-module.mjs";
import {
  candidate,
  evidence,
  fixture,
  shift,
} from "./tests/round-replay-fixture.mjs";

export function replay(lifetime) {
  const idle = evidence.idle;
  const flaggedAt = shift(idle.lastSignal, 30 * 60);
  const lane = fixture(lifetime, flaggedAt);
  writeFileSync(
    join(lane.round, "lanes.json"),
    JSON.stringify({
      version: 1,
      lanes: [
        {
          id: idle.lane,
          status: "working",
          branch: "feat/replay",
          worktree: lane.root,
          pane: "wReplay:p1",
          startedAt: idle.startedAt,
          lastPushAt: idle.lastSignal,
        },
      ],
    }),
  );
  lane.run("lane-watch", shift(flaggedAt, -1));
  const before = lane.records().at(-1).message.split(" ")[0];
  lane.run("lane-watch", flaggedAt);
  const idleReport = lane.records().at(-1);
  const after = idleReport.message.split(" ")[0];
  assert.equal(idleReport.fields.reason, "no-event+no-commit+no-push");
  for (const key of ["event-minutes", "commit-minutes", "push-minutes"])
    assert.equal(idleReport.fields[key], "30");
  const stalls = evidence.stalls.map((incident) => {
    const now = shift(incident.lastMerge, 45 * 60);
    assert.ok(now < incident.nextMerge, incident.id);
    assert.ok(incident.queueObservedAt <= now, incident.id);
    const f = fixture(lifetime, now);
    f.data.merged = [[{ merged_at: incident.lastMerge }]];
    f.data.queue.data.repository.mergeQueue.entries.totalCount =
      incident.queued;
    candidate(f, incident.pr);
    f.run("merge-stall", shift(now, -1));
    const before = f.records().at(-1).message.split(" ")[0];
    f.run("merge-stall", now);
    const outcome = f.records().at(-1).message.split(" ")[0];
    const count = f.records().length;
    f.run("merge-stall", shift(now, 1));
    const repeatSuppressed = count === f.records().length;
    f.run("landing-assessment", now);
    const report = f.records().at(-1);
    f.verify();
    return {
      ...incident,
      flaggedAt: now,
      before,
      outcome,
      repeatSuppressed,
      assessment: report.message.split(" ")[0],
      owner: report.fields.owner,
      assessedPr: Number(report.fields.pr),
      gate: report.fields.gate,
    };
  });
  const empty = fixture(lifetime, flaggedAt);
  empty.data.merged = [[{ merged_at: evidence.stalls[0].lastMerge }]];
  empty.data.queue.data.repository.mergeQueue.entries.totalCount = 0;
  empty.run("merge-stall", flaggedAt);
  const emptyQueue = empty.records().at(-1).message.split(" ")[0];
  empty.verify();
  lane.verify();
  return {
    idle: {
      ...idle,
      flaggedAt,
      delayMinutes:
        (Date.parse(idleReport.timestamp) - Date.parse(idle.lastSignal)) /
        60000,
      before,
      after,
    },
    stalls,
    falseAlarms: stalls.filter((s) => s.falseAlarm),
    emptyQueue,
    sourceUnchanged: true,
    readOnly: true,
  };
}

if (isMainModule(import.meta.url)) {
  const cleanup = [];
  try {
    assert.equal(process.argv.length, 2, "replay takes no arguments");
    console.log(
      JSON.stringify(replay({ after: (fn) => cleanup.push(fn) }), null, 2),
    );
  } finally {
    for (const fn of cleanup.reverse()) fn();
  }
}
