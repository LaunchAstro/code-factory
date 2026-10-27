// SPDX-License-Identifier: AGPL-3.0-only
// The Section line (#203): the work map places a merged PR by it. Missing
// warns until 1 Nov 2026, then waits; malformed waits from the start.
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, head } from "./enqueue-fixture.mjs";

const lines =
  "**Why:** the reason.\n**Left undone:** none\nCloses #7\n";
const writes = (f) =>
  f.recorded().filter((a) => a.join(" ").includes("enqueuePullRequest")).length;

function at(t, now, body) {
  const f = fixture(t, { ENQUEUE_NOW: now });
  f.pr.body = body;
  return f;
}

for (const [name, section] of [
  ["plain", "Section: checks"],
  ["bold", "**Section:** checks"],
  ["a list item", "- Section: sitefix"],
  ["in backticks", "Section: `work-map`"],
  ["outside", "Section: outside"],
  ["the same id twice", "Section: checks\nSection: checks"],
  ["the whole line in bold", "**Section: checks**"],
  ["a bold id", "**Section:** **checks**"],
  ["a closing full stop", "Section: checks."],
]) {
  test(`section accepts ${name}`, (t) => {
    const f = at(t, "2026-11-02T00:00:00Z", lines + section);
    const result = f.run();
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.stdout.trim(), `ENQUEUED #17 head=${head}`);
  });
}

test("section missing before the switch date warns and carries on", (t) => {
  const f = at(t, "2026-10-31T12:59:59Z", lines);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    `ENQUEUED #17 head=${head}`,
    "WARN gate=section reason=missing required-from=2026-11-01",
  ]);
  assert.equal(writes(f), 1);
});

test("section missing from the switch date waits", (t) => {
  // 1 Nov 2026 00:00 in Sydney (AEDT, UTC+11).
  const f = at(t, "2026-10-31T13:00:00Z", lines);
  const result = f.run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /^WAIT gate=section reason=missing$/mu);
  assert.equal(writes(f), 0);
});

for (const [name, section] of [
  ["an uppercase id", "Section: Checks"],
  ["two ids on one line", "Section: checks, engine"],
  ["a path", "Section: checks/extra"],
  ["no id", "Section:"],
  ["two different sections", "Section: checks\nSection: engine"],
  ["prose", "Section: the checks area"],
  ["an unpaired backtick", "Section: `checks"],
]) {
  test(`section waits on ${name}, even before the switch date`, (t) => {
    const f = at(t, "2026-10-20T00:00:00Z", lines + section);
    const result = f.run();
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^WAIT gate=section reason=malformed$/mu);
    assert.equal(writes(f), 0);
  });
}

test("a Section line only inside a code block is missing", (t) => {
  const f = at(t, "2026-11-02T00:00:00Z", lines + "```\nSection: checks\n```");
  const result = f.run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /^WAIT gate=section reason=missing$/mu);
});

test("the lane is told the Section line too", (t) => {
  const f = at(t, "2026-11-02T00:00:00Z", lines);
  const result = f.run(["--pane", "w1:p3"]);
  assert.equal(result.status, 1, result.stdout);
  const text = f.herdr().find((a) => a[1] === "send-text")?.[3] ?? "";
  assert.match(text, /Section: <work map section id, or outside>/u);
});
