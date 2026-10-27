// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";
import { fixture, head, open, pr, ready } from "./watch-landing-fixture.mjs";

function report(f, command) {
  const result = f.run(command);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return f.records().at(-1);
}

test("assessment selects the oldest READY when its abbreviated head matches GitHub", (t) => {
  const f = fixture(t);
  writeFileSync(f.log, ready(1).replace(head, head.slice(0, 10)) + ready(2));
  const event = report(f, "landing-assessment");
  assert.equal(event.fields.pr, "1", event.message);
  assert.equal(event.fields.owner, "BUILDER-1");
  assert.equal(event.fields.gate, "ready");
  assert.equal(event.fields.head, head);
});

test("four waiting READY PRs with matching abbreviated heads hold new builds", (t) => {
  const f = fixture(t, 4);
  writeFileSync(f.log, f.original.replaceAll(head, head.slice(0, 10)));
  const event = report(f, "arrival-cap");
  assert.equal(event.message.split(" ")[0], "CAP-HOLD", event.message);
  assert.equal(event.fields.ready, "4");
});

test("assessment does not call a BEHIND branch ready when its required checks pass", (t) => {
  const control = fixture(t);
  assert.equal(report(control, "landing-assessment").fields.gate, "ready");
  const f = fixture(t);
  f.data.open.body = open([pr(1, { mergeStateStatus: "BEHIND" }), pr(2)]);
  const result = f.run("landing-assessment");
  assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
  const event = f.records().at(-1);
  assert.notEqual(event.fields.gate, "ready", event.message);
  assert.equal(event.fields.gate, "branch-update");
});

test("a foreign repository MERGED event cannot withdraw this repository's waiting READY PR", (t) => {
  const f = fixture(t, 4);
  assert.equal(report(f, "arrival-cap").fields.ready, "4");
  writeFileSync(
    f.log,
    f.original +
      `2026-10-14T01:30:00Z ORCH MERGED #1 head=${head} repo=foreign/repo\n`,
  );
  const event = report(f, "arrival-cap");
  assert.equal(event.fields.ready, "4", event.message);
  assert.equal(event.message.split(" ")[0], "CAP-HOLD");
});

test("a nonmatching abbreviated head does not count toward the cap", (t) => {
  const f = fixture(t, 4);
  writeFileSync(f.log, f.original.replaceAll(head, "b".repeat(10)));
  const event = report(f, "arrival-cap");
  assert.equal(event.fields.ready, "0");
  assert.equal(event.message.split(" ")[0], "CAP-OPEN");
});

for (const repo of ["", " repo=fixture/repo"]) {
  test(`a MERGED event${repo || " without repository metadata"} withdraws a waiting READY PR`, (t) => {
    const f = fixture(t, 4);
    writeFileSync(
      f.log,
      f.original + `2026-10-14T01:30:00Z ORCH MERGED #1 head=${head}${repo}\n`,
    );
    const event = report(f, "arrival-cap");
    assert.equal(event.fields.ready, "3");
    assert.equal(event.message.split(" ")[0], "CAP-OPEN");
  });
}

for (const command of ["arrival-cap", "landing-assessment"]) {
  test(`${command} restores report evidence when the log loses a persisted report`, (t) => {
    const f = fixture(t, 4);
    const previous = report(f, command);
    writeFileSync(f.log, f.original);
    const restored = report(f, command);
    assert.ok(restored);
    assert.equal(restored.message, previous.message);
  });
}
