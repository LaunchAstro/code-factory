// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseEventLine } from "../events.mjs";

// Dynamic import lets both acceptance predicates fail before the replay exists.
test("synthetic round: the 2 h 45 min idle lane is flagged within 30 minutes", async (t) => {
  const { replay } = await import("../replay.mjs");
  const result = replay(t);
  assert.equal(result.idle.lane, "EXAMPLE-012");
  assert.equal(result.idle.lastSignal, "2000-01-01T11:17:40Z");
  assert.equal(result.idle.flaggedAt, "2000-01-01T11:47:40Z");
  assert.equal(result.idle.delayMinutes, 30);
  assert.equal(result.idle.before, "OK");
  assert.equal(result.idle.after, "SUSPECTED-STALL");
  assert.equal(result.sourceUnchanged, true);
  assert.equal(result.readOnly, true);
});

test("synthetic round: every recorded merge stall fires and false alarms have causes", async (t) => {
  const { replay } = await import("../replay.mjs");
  const result = replay(t);
  assert.equal(result.stalls.length, 7);
  assert.equal(result.stalls.filter((s) => s.outcome === "STALL").length, 7);
  assert.ok(
    result.stalls.every((s) => s.before === "OK" && s.repeatSuppressed),
  );
  assert.equal(result.falseAlarms.length, 2);
  assert.deepEqual(
    result.falseAlarms.map((s) => s.id),
    ["gap-2", "gap-5"],
  );
  assert.deepEqual(
    result.falseAlarms.map((s) => s.cause),
    [
      "slow-shard-passed-without-requeue",
      "queue-ci-progressing-then-passed",
    ],
  );
  assert.ok(
    result.stalls.every(
      (s) => s.assessment === "ASSESS" && s.owner && s.assessedPr === s.pr,
    ),
  );
  assert.equal(result.emptyQueue, "EMPTY-QUEUE");
  assert.equal(result.readOnly, true);
  assert.equal(result.sourceUnchanged, true);
});

test("the signal projection is known, bounded and covers every complete merge gap", async () => {
  const { evidence, sourceURL, shift } =
    await import("./round-replay-fixture.mjs");
  const lines = readFileSync(sourceURL, "utf8").trimEnd().split("\n");
  assert.equal(lines.length, evidence.projectionLines);
  const records = lines.map((line, i) => {
    const event = parseEventLine(line);
    assert.notEqual(event.type, "unknown", `line ${i + 1}: ${line}`);
    assert.match(
      line,
      /^2000-01-01T[0-9:]{8}Z (?:EXAMPLE-[0-9]{3}|ORCH) [A-Z-]+(?: #[0-9]+)?(?: head=a{7,40})?$/,
    );
    return event;
  });
  const merged = records.filter((e) => e.type === "MERGED");
  const gaps = merged
    .slice(1)
    .flatMap((end, i) =>
      Date.parse(end.timestamp) - Date.parse(merged[i].timestamp) >= 45 * 60000
        ? [{ start: merged[i].timestamp, end: end.timestamp }]
        : [],
    );
  assert.equal(gaps.length, evidence.stalls.length);
  for (const [i, gap] of gaps.entries()) {
    assert.ok(
      Math.abs(
        Date.parse(gap.start) - Date.parse(evidence.stalls[i].lastMerge),
      ) <= 93000,
    );
    assert.ok(
      Math.abs(
        Date.parse(gap.end) - Date.parse(evidence.stalls[i].nextMerge),
      ) <= 93000,
    );
  }
  const last = records
    .filter(
      (e) =>
        e.actor === evidence.idle.lane &&
        e.timestamp < evidence.idle.wrappedAt &&
        !["HANDBACK-READY", "WRAPPED"].includes(e.type),
    )
    .at(-1);
  assert.equal(last.timestamp, evidence.idle.lastSignal);
  assert.equal(
    records.find((e) => e.actor === evidence.idle.lane && e.type === "WRAPPED")
      .timestamp,
    evidence.idle.wrappedAt,
  );
  assert.equal(
    shift(evidence.idle.lastSignal, 30 * 60),
    "2000-01-01T11:47:40Z",
  );
});
