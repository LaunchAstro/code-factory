// Reviewer-only proofs for df8f7f7d79983c66db0b08258d689f3dba96f795.
// Run: node --test orchestration/tests/sol-206-proof-cases.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fixture, head } from "./enqueue-fixture.mjs";

const lines = "**Why:** the reason.\n**Left undone:** none\nCloses #7\n";
const html = "<p><strong>Why:</strong> the reason.<br>\n<strong>Left undone:</strong> none<br>\nCloses #7";
const warning = "WARN gate=section reason=missing required-from=2026-11-01";
const observedRenders = JSON.parse(readFileSync(new URL("./sol-206-rendered.json", import.meta.url), "utf8"));
const writes = (f) => f.recorded().filter((a) =>
  a.join(" ").includes("enqueuePullRequest") || a[1]?.endsWith("/merge"));

function setup(t, section, queue = true, now = "2026-10-20T00:00:00Z") {
  const f = fixture(t, { ENQUEUE_NOW: now });
  f.pr.isMergeQueueEnabled = queue;
  const risk = queue ? "" : "\n**Risk:** low, the reason.";
  f.pr.body = lines + section + risk;
  f.data.markdown = { byText: {
    [f.pr.body]: html + "<br>\n" + section +
      (queue ? "" : "<br>\n<strong>Risk:</strong> low, the reason.") + "</p>",
  } };
  return f;
}

function finalSection(f, section) {
  const body = lines + section;
  f.data.final = { body: { data: { repository: {
    pullRequest: { ...f.pr, body },
  } } } };
  f.data.markdown.byText[body] = html + (section ? "<br>\n" + section : "") + "</p>";
}

test("Sol proof, criterion 2: removing Section between reads still prints the missing warning", (t) => {
  const f = setup(t, "Section: checks");
  finalSection(f, "");
  const r = f.run();
  assert.equal(r.status, 0, r.stdout);
  assert.equal(writes(f).length, 1);
  assert.equal(f.recorded().filter((a) => a[1] === "markdown").length, 2);
  assert.deepEqual(r.stdout.trim().split("\n"), [
    `ENQUEUED #17 head=${head}`, warning,
  ]);
});

for (const queue of [true, false]) {
  test(`Sol proof, criterion 4: an unmatched backtick is malformed on the ${queue ? "queue" : "direct"} path`, (t) => {
    // GitHub's real gh api markdown output verified on 18 October 2026:
    // <p><strong>Why:</strong> the reason.<br>\n
    // <strong>Left undone:</strong> none<br>\nCloses #7<br>\nSection: `checks</p>
    const f = setup(t, "Section: `checks", queue);
    f.data.markdown.byText[f.pr.body] = observedRenders[f.pr.body];
    const r = f.run();
    assert.equal(r.status, 1, `${r.stdout}mutations=${writes(f).length}`);
    assert.equal(r.stdout.trim(), "WAIT gate=section reason=malformed");
    assert.equal(writes(f).length, 0);
  });
}

for (const queue of [true, false]) {
  test(`Sol control: missing Section before cutoff warns after ${queue ? "enqueue" : "merge"}`, (t) => {
    const f = setup(t, "", queue, "2026-10-31T12:59:59Z");
    const r = f.run();
    assert.equal(r.status, 0, r.stdout);
    assert.equal(writes(f).length, 1);
    assert.match(r.stdout, queue ? /^ENQUEUED / : /^MERGED /);
    assert.equal(r.stdout.trim().split("\n")[1], warning);
  });
  test(`Sol control: missing Section at cutoff blocks ${queue ? "enqueue" : "merge"}`, (t) => {
    const f = setup(t, "", queue, "2026-10-31T13:00:00Z");
    const r = f.run();
    assert.equal(r.status, 1, r.stdout);
    assert.equal(r.stdout.trim(), "WAIT gate=section reason=missing");
    assert.equal(writes(f).length, 0);
  });
  for (const section of ["Section: Checks", "Section:", "Section: prose is bad", "Section: checks\nSection: engine"]) {
    test(`Sol control: ${JSON.stringify(section)} blocks ${queue ? "enqueue" : "merge"}`, (t) => {
      const f = setup(t, section, queue);
      const r = f.run();
      assert.equal(r.status, 1, r.stdout);
      assert.equal(r.stdout.trim(), "WAIT gate=section reason=malformed");
      assert.equal(writes(f).length, 0);
    });
  }
}

for (const [section, now, reason] of [
  ["", "2026-10-31T13:00:00Z", "missing"],
  ["Section: Checks", "2026-10-20T00:00:00Z", "malformed"],
  ["Section: checks\nSection: engine", "2026-10-20T00:00:00Z", "malformed"],
]) {
  test(`Sol control: final description ${JSON.stringify(section)} waits with ${reason}`, (t) => {
    const f = setup(t, "Section: checks", true, now);
    finalSection(f, section);
    const r = f.run();
    assert.equal(r.status, 1, r.stdout);
    assert.equal(r.stdout.trim(), `WAIT gate=section reason=${reason}`);
    assert.equal(writes(f).length, 0);
  });
}
