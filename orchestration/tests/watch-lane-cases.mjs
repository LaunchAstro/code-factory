// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  fixture,
  now,
  old,
  recent,
  push,
  READ_TIMEOUT_MS,
} from "./watch-lane-fixture.mjs";

function outcome(f, status) {
  const result = f.run();
  assert.equal(
    result.status,
    status === "UNKNOWN" ? 1 : 0,
    result.stdout + result.stderr,
  );
  const event = f.events().at(-1);
  assert.equal(event?.message.split(" ")[0], status);
  assert.equal(event.fields.lane, "BUILD");
  assert.equal(event.timestamp, now);
  return event;
}

test("all three silent signals produce one suspected stall across restarts", (t) => {
  const f = fixture(t);
  const e = outcome(f, "SUSPECTED-STALL");
  assert.equal(e.fields.reason, "no-event+no-commit+no-push");
  assert.equal(e.fields["pane-state"], "working");
  assert.equal(e.fields["event-minutes"], "60");
  assert.equal(e.fields["commit-minutes"], "60");
  assert.equal(e.fields["push-minutes"], "60");
  assert.equal(f.run().status, 0);
  assert.equal(f.events().length, 1);
  rmSync(join(f.round, "lane-watch.state.json"));
  assert.equal(f.run().status, 0);
  assert.equal(f.events().length, 1);
});

for (const signal of ["event", "commit", "push", "recorded-push"]) {
  test(`recent ${signal} activity prevents a suspected stall`, (t) => {
    const f = fixture(t);
    if (signal === "event")
      appendFileSync(f.log, `${recent} BUILD PROGRESS compiling\n`);
    if (signal === "commit") f.data.git.raw = recent;
    if (signal === "push") f.data.gh.body = [[push(recent)]];
    if (signal === "recorded-push") f.records.lanes[0].lastPushAt = recent;
    outcome(f, "OK");
  });
}

for (const [line, reason] of [
  ["RUN-START tool=compiler", "long-running-tool"],
  ["WAITING reason=review", "review-wait"],
  ["PAUSED reason=owner", "owner-pause"],
]) {
  test(`a recorded ${reason} explains silence without a stall verdict`, (t) => {
    const f = fixture(t);
    appendFileSync(f.log, `${old} BUILD ${line}\n`);
    const event = outcome(f, "WAITING");
    assert.equal(event.fields.reason, reason);
    assert.equal(event.fields.silence, "no-event+no-commit+no-push");
    assert.equal(
      f.events().some((e) => e.message.startsWith("SUSPECTED-STALL")),
      false,
    );
    appendFileSync(f.log, `${old} BUILD PROGRESS resumed\n`);
    outcome(f, "SUSPECTED-STALL");
  });
}

for (const tool of ["herdr", "gh", "git"]) {
  test(`a failed ${tool} read is UNKNOWN with a failing exit and no healthy line`, (t) => {
    const f = fixture(t);
    f.data[tool] = { exit: 1 };
    outcome(f, "UNKNOWN");
    assert.equal(f.events().length, 1);
  });
  test(`a malformed ${tool} read is UNKNOWN`, (t) => {
    const f = fixture(t);
    f.data[tool] = { raw: "{unreadable" };
    outcome(f, "UNKNOWN");
  });
}

test("pane absence is reported and never mistaken for working", (t) => {
  const f = fixture(t);
  f.data.herdr.body.result.panes = [];
  assert.equal(outcome(f, "SUSPECTED-STALL").fields["pane-state"], "absent");
});

test("unknown pane status is UNKNOWN even with fresh activity", (t) => {
  const f = fixture(t);
  f.data.git.raw = recent;
  f.data.herdr.body.result.panes[0].agent_status = "unknown";
  outcome(f, "UNKNOWN");
});

test("all passes use only read commands and preserve their source snapshot", (t) => {
  const f = fixture(t);
  outcome(f, "SUSPECTED-STALL");
  f.data.gh = { exit: 1 };
  outcome(f, "UNKNOWN");
  f.data.gh = { body: [[push(recent)]] };
  outcome(f, "OK");
  appendFileSync(f.log, `${old} BUILD PAUSED reason=owner\n`);
  outcome(f, "WAITING");
  const calls = readFileSync(f.calls, "utf8")
    .trimEnd()
    .split("\n")
    .map(JSON.parse);
  assert.ok(calls.some((c) => c.tool === "herdr"));
  assert.ok(
    calls
      .filter((c) => c.tool === "herdr")
      .every(
        (c) => JSON.stringify(c.args) === JSON.stringify(["pane", "list"]),
      ),
  );
  assert.equal(
    calls.some((c) =>
      c.args.some((a) => /send|text|keys|close|merge|delete/u.test(a)),
    ),
    false,
  );
  assert.equal(readFileSync(f.source, "utf8"), f.original);
  assert.equal(readFileSync(f.log, "utf8").startsWith(f.original), true);
  assert.deepEqual(readdirSync(f.round).sort(), [
    "events.log",
    "lane-watch.state.json",
    "lanes.json",
  ]);
});

test("the silence threshold comes from settings and includes its boundary", (t) => {
  const f = fixture(t);
  f.limits.laneWatch.minutes = 61;
  outcome(f, "OK");
  f.limits.laneWatch.minutes = 60;
  assert.equal(outcome(f, "SUSPECTED-STALL").fields["threshold-minutes"], "60");
  assert.equal(
    JSON.parse(
      readFileSync(new URL("../watch.settings.json", import.meta.url), "utf8"),
    ).laneWatch.minutes,
    30,
  );
});

test("watcher lines and unknown prose do not count as lane activity", (t) => {
  const f = fixture(t);
  appendFileSync(
    f.log,
    `${recent} WATCH LANE-WATCH OK lane=BUILD\n${recent} BUILD NOT-A-KNOWN-EVENT PROGRESS\n`,
  );
  outcome(f, "SUSPECTED-STALL");
});

test("a new boot in the same second discards an old pause and stall", (t) => {
  const f = fixture(t);
  outcome(f, "SUSPECTED-STALL");
  appendFileSync(
    f.log,
    `${old} BUILD PAUSED reason=owner\n${old} BUILD BOOTED\n`,
  );
  outcome(f, "SUSPECTED-STALL");
  assert.equal(f.events().length, 2);
});

test("inactive records are skipped; a working sibling still gets its own outcome", (t) => {
  const f = fixture(t);
  f.records.lanes.push({
    ...f.records.lanes[0],
    id: "PARKED",
    status: "parked",
  });
  outcome(f, "SUSPECTED-STALL");
  assert.equal(f.events().length, 1);
});

test("pushes on another branch cannot conceal a silent lane", (t) => {
  const f = fixture(t);
  f.data.gh.body = [[push(recent, "feat/other")]];
  outcome(f, "SUSPECTED-STALL");
});

test("pushes beyond the first page count and pagination is requested", (t) => {
  const f = fixture(t);
  f.data.gh.body = [
    Array.from({ length: 100 }, () => push(old, "feat/other")),
    [push(recent)],
  ];
  outcome(f, "OK");
});

test("a full retained feed that cannot cover the silence window is UNKNOWN", (t) => {
  const f = fixture(t);
  f.data.gh.body = Array.from({ length: 3 }, () =>
    Array.from({ length: 100 }, () => push(recent, "feat/other")),
  );
  outcome(f, "UNKNOWN");
});

test("invalid and future signal times refuse to infer health", (t) => {
  const f = fixture(t);
  for (const value of ["2026-02-30T01:00:00Z", "2026-10-15T01:00:00Z"]) {
    f.data.git.raw = value;
    outcome(f, "UNKNOWN");
    f.data.git.raw = old;
    f.data.gh.body = [[push(value)]];
    outcome(f, "UNKNOWN");
    f.data.gh.body = [[]];
    f.records.lanes[0].lastPushAt = value;
    outcome(f, "UNKNOWN");
    f.records.lanes[0].lastPushAt = old;
  }
});

test("corrupt state is UNKNOWN and cannot erase previous stall suppression", (t) => {
  const f = fixture(t);
  outcome(f, "SUSPECTED-STALL");
  const state = join(f.round, "lane-watch.state.json");
  const saved = readFileSync(state, "utf8");
  writeFileSync(state, "{}");
  outcome(f, "UNKNOWN");
  writeFileSync(state, saved);
  assert.equal(f.run().status, 0);
  assert.equal(f.events().length, 2);
});

test("a failed shared read reports every working lane as UNKNOWN", (t) => {
  const f = fixture(t);
  f.records.lanes.push({
    ...f.records.lanes[0],
    id: "SECOND",
    pane: "wSecond:p1",
  });
  f.data.herdr = { exit: 1 };
  assert.equal(f.run().status, 1);
  assert.deepEqual(
    f.events().map((e) => [e.fields.lane, e.message.split(" ")[0]]),
    [
      ["BUILD", "UNKNOWN"],
      ["SECOND", "UNKNOWN"],
    ],
  );
});

test("read timeouts and response limits are settings and yield UNKNOWN", (t) => {
  const f = fixture(t);
  f.limits.laneWatch.readTimeoutMs = 10;
  f.data.herdr.delay = 200;
  outcome(f, "UNKNOWN");
  f.limits.laneWatch.readTimeoutMs = READ_TIMEOUT_MS;
  delete f.data.herdr.delay;
  f.limits.laneWatch.maxBufferBytes = 64;
  outcome(f, "UNKNOWN");
});

test("state cannot overwrite the lane records or settings", (t) => {
  const f = fixture(t);
  for (const file of [f.lanes, f.settings, f.log])
    assert.equal(f.run(["--state", file]).status, 2);
});

test("a non-string lane identity is UNKNOWN rather than invented by coercion", (t) => {
  const f = fixture(t);
  f.records.lanes[0].id = 12;
  assert.equal(f.run().status, 1);
  assert.equal(f.events().at(-1)?.fields.lane, "unknown");
});

test("a malformed push record cannot imply no pushes", (t) => {
  const f = fixture(t);
  f.data.gh.body = [[{ type: "PushEvent", created_at: old, payload: {} }]];
  outcome(f, "UNKNOWN");
});

test("invalid settings report UNKNOWN for the lane", (t) => {
  const f = fixture(t);
  f.limits.laneWatch.minutes = 0;
  outcome(f, "UNKNOWN");
});

test("a stalled lane resumes and then enters a new silent interval", (t) => {
  const f = fixture(t);
  outcome(f, "SUSPECTED-STALL");
  appendFileSync(f.log, `${recent} BUILD PROGRESS building\n`);
  outcome(f, "OK");
  f.clock.now = "2026-10-14T03:00:00Z";
  assert.equal(f.run().status, 0);
  assert.equal(f.events().at(-1)?.message.split(" ")[0], "SUSPECTED-STALL");
  assert.equal(f.events().length, 3);
});

test("a response-size error preserves existing suppression state", (t) => {
  const f = fixture(t);
  outcome(f, "SUSPECTED-STALL");
  const file = join(f.round, "lane-watch.state.json");
  const before = readFileSync(file, "utf8");
  f.limits.laneWatch.maxBufferBytes = 1;
  outcome(f, "UNKNOWN");
  assert.equal(readFileSync(file, "utf8"), before);
});

test("an unterminated log is refused without changing its last line", (t) => {
  const f = fixture(t);
  const contents = f.original.trimEnd();
  writeFileSync(f.log, contents);
  assert.equal(f.run().status, 2);
  assert.equal(readFileSync(f.log, "utf8"), contents);
});

test("a failed individual lane read cannot borrow its sibling's health", (t) => {
  const f = fixture(t);
  f.records.lanes.push({
    ...f.records.lanes[0],
    id: "SECOND",
    pane: "wSecond:p1",
  });
  f.records.lanes[0].worktree = "missing-relative-checkout";
  assert.equal(f.run().status, 1);
  assert.deepEqual(
    f.events().map((e) => [e.fields.lane, e.message.split(" ")[0]]),
    [
      ["BUILD", "UNKNOWN"],
      ["SECOND", "SUSPECTED-STALL"],
    ],
  );
});

test("a replay reports 165 minutes of silence while explaining a recorded wait", (t) => {
  const f = fixture(t);
  const start = "2000-01-01T14:00:00Z";
  f.clock.now = "2000-01-01T16:45:00Z";
  f.records.lanes[0].startedAt = start;
  f.records.lanes[0].lastPushAt = start;
  f.records.lanes.push({ ...f.records.lanes[0], id: "WAIT", pane: "wWait:p1" });
  f.data.git.raw = start;
  writeFileSync(
    f.log,
    `${start} BUILD BOOTED\n${start} WAIT WAITING reason=review\n`,
  );
  assert.equal(f.run().status, 0);
  assert.deepEqual(
    f
      .events()
      .map((e) => [
        e.fields.lane,
        e.message.split(" ")[0],
        e.fields["event-minutes"],
      ]),
    [
      ["BUILD", "SUSPECTED-STALL", "165"],
      ["WAIT", "WAITING", "165"],
    ],
  );
});
