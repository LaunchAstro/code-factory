// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import test from "node:test";
import { fixture, old } from "./watch-lane-fixture.mjs";

test("a silent lane on a valid plus-sign branch is assessed", (t) => {
  const branch = "feat/build+tests";
  const valid = spawnSync("git", ["check-ref-format", "--branch", branch]);
  assert.equal(valid.status, 0);
  const f = fixture(t);
  f.limits.laneWatch.readTimeoutMs = 5000;
  f.records.lanes[0].branch = branch;
  const result = f.run();
  assert.equal(
    f.events().at(-1)?.message.split(" ")[0],
    "SUSPECTED-STALL",
    result.stdout,
  );
  assert.equal(result.status, 0);
});

test("a known blocked pane retains its recorded owner-pause reason", (t) => {
  const f = fixture(t);
  f.limits.laneWatch.readTimeoutMs = 5000;
  appendFileSync(f.log, `${old} BUILD PAUSED reason=owner\n`);
  f.data.herdr.body.result.panes[0].agent_status = "blocked";
  const result = f.run();
  const event = f.events().at(-1);
  assert.equal(event?.message.split(" ")[0], "WAITING", result.stdout);
  assert.equal(event.fields.reason, "owner-pause");
  assert.equal(event.fields["pane-state"], "blocked");
  assert.equal(result.status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(f.events().at(-1)?.fields.reason, "owner-pause");
  assert.equal(f.events().at(-1)?.fields["pane-state"], "blocked");
});

test("a completed tool cannot exempt later silence forever", (t) => {
  const f = fixture(t);
  f.limits.laneWatch.readTimeoutMs = 5000;
  appendFileSync(f.log, `${old} BUILD RUN-START tool=compiler\n`);
  assert.equal(f.run().status, 0);
  assert.equal(f.events().at(-1)?.fields.reason, "long-running-tool");
  appendFileSync(
    f.log,
    "2026-10-14T01:10:00Z BUILD DONE tool=compiler exit=0\n",
  );
  const result = f.run();
  const event = f.events().at(-1);
  assert.equal(event.fields["event-minutes"], "50");
  assert.equal(event.fields["commit-minutes"], "60");
  assert.equal(event.fields["push-minutes"], "60");
  assert.equal(result.status, 0);
  assert.equal(event.message.split(" ")[0], "SUSPECTED-STALL", result.stdout);
  assert.equal(event.fields.reason, "no-event+no-commit+no-push");
});

for (const branch of [
  "123",
  "feat/build@v2",
  "feat/café",
  "feat/build$tests",
  "feat/build=tests",
  "feat/\u00A0build\u00A0",
]) {
  test(`Git-valid branch ${JSON.stringify(branch)} is assessed`, (t) => {
    assert.equal(
      spawnSync("git", ["check-ref-format", "--branch", branch]).status,
      0,
    );
    const f = fixture(t);
    f.limits.laneWatch.readTimeoutMs = 5000;
    f.records.lanes[0].branch = branch;
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.events().at(-1)?.message.split(" ")[0], "SUSPECTED-STALL");
  });
}

test("invalid branch names cannot be interpreted as revision expressions", (t) => {
  const f = fixture(t);
  f.limits.laneWatch.readTimeoutMs = 5000;
  for (const branch of [
    "feat/build~1",
    "feat/build^",
    "feat/build..other",
    "feat//build",
    "feat/build.lock",
    "-build",
    "HEAD",
    "@{-1}",
  ]) {
    f.records.lanes[0].branch = branch;
    const result = f.run();
    assert.equal(result.status, 1, branch);
    assert.equal(f.events().at(-1)?.message.split(" ")[0], "UNKNOWN", branch);
  }
});

test("completion of another tool preserves an active tool wait", (t) => {
  const f = fixture(t);
  f.limits.laneWatch.readTimeoutMs = 5000;
  appendFileSync(
    f.log,
    `${old} BUILD RUN-START tool=compiler\n${old} BUILD DONE tool=formatter exit=0\n`,
  );
  assert.equal(f.run().status, 0);
  assert.equal(f.events().at(-1)?.fields.reason, "long-running-tool");
});

test("tool completion preserves an owner pause", (t) => {
  const f = fixture(t);
  f.limits.laneWatch.readTimeoutMs = 5000;
  appendFileSync(
    f.log,
    `${old} BUILD RUN-START tool=compiler\n${old} BUILD PAUSED reason=owner\n${old} BUILD DONE tool=compiler exit=0\n`,
  );
  assert.equal(f.run().status, 0);
  assert.equal(f.events().at(-1)?.fields.reason, "owner-pause");
});

test("tool completion ends a tool wait without a recorded tool name", (t) => {
  const f = fixture(t);
  f.limits.laneWatch.readTimeoutMs = 5000;
  appendFileSync(
    f.log,
    `${old} BUILD WAITING reason=tool\n${old} BUILD DONE tool=compiler exit=0\n`,
  );
  assert.equal(f.run().status, 0);
  assert.equal(f.events().at(-1)?.message.split(" ")[0], "SUSPECTED-STALL");
});
