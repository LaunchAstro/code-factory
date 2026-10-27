// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  fixture,
  open,
  pr,
  ready,
  check,
  now,
} from "./watch-landing-fixture.mjs";

function outcome(f, status, command = "landing-assessment") {
  const result = f.run(command);
  assert.equal(
    result.status,
    status === "UNKNOWN" ? 1 : 0,
    result.stdout + result.stderr,
  );
  const event = f.records().at(-1);
  assert.equal(
    event?.type,
    command === "arrival-cap" ? "ARRIVAL-CAP" : "LANDING-ASSESSMENT",
  );
  assert.equal(event.message.split(" ")[0], status);
  assert.equal(event.timestamp, now);
  assert.equal(event.fields.repo, "fixture/repo");
  return event;
}

test("assessment selects the oldest READY PR by event time and names its review gate and owner", (t) => {
  const f = fixture(t);
  writeFileSync(f.log, ready(2, 20) + ready(1, 10));
  f.data.open.body = open([
    pr(2),
    pr(1, { reviewDecision: "REVIEW_REQUIRED" }),
  ]);
  const e = outcome(f, "ASSESS");
  assert.equal(e.fields.pr, "1");
  assert.equal(e.fields.owner, "BUILDER-1");
  assert.equal(e.fields.gate, "review");
});

test("an open predecessor skips the oldest PR for the next independent READY PR", (t) => {
  const f = fixture(t);
  f.data.open.body = open([pr(1, { body: "Depends-on: #9" }), pr(2), pr(9)]);
  assert.equal(outcome(f, "ASSESS").fields.pr, "2");
});

test("a closed predecessor does not block selection", (t) => {
  const f = fixture(t);
  f.data.open.body = open([pr(1, { body: "Predecessors: #9, #10" }), pr(2)]);
  assert.equal(outcome(f, "ASSESS").fields.pr, "1");
});

test("READY predecessor metadata is honoured", (t) => {
  const f = fixture(t);
  writeFileSync(f.log, ready(1).trimEnd() + " predecessors=2\n" + ready(2));
  assert.equal(outcome(f, "ASSESS").fields.pr, "2");
});

for (const [gate, extra, checks] of [
  ["conflict", { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }],
  ["hold", { labels: { nodes: [{ name: "factory/held" }], totalCount: 1 } }],
  ["required-check", {}, [check("database conformance", "pending")]],
  ["ready", {}],
])
  test(`assessment reports the ${gate} gate`, (t) => {
    const f = fixture(t);
    f.data.open.body = open([pr(1, extra), pr(2)]);
    if (checks) f.data.checks = { body: checks, exit: 8 };
    const e = outcome(f, "ASSESS");
    assert.equal(e.fields.gate, gate);
    if (checks)
      assert.equal(decodeURIComponent(e.fields.check), "database conformance");
  });

test("a failed required check is a named gate rather than a failed read", (t) => {
  const f = fixture(t);
  f.data.checks = { body: [check("build", "fail")], exit: 1 };
  assert.equal(outcome(f, "ASSESS").fields.check, "build");
});

test("assessment uses live merges and the configured threshold including its boundary", (t) => {
  const f = fixture(t);
  f.settingsData.landingAssessment.minutes = 61;
  writeFileSync(f.settings, JSON.stringify(f.settingsData));
  outcome(f, "OK");
  f.settingsData.landingAssessment.minutes = 60;
  writeFileSync(f.settings, JSON.stringify(f.settingsData));
  outcome(f, "ASSESS");
});

test("no previous merge is reported explicitly", (t) => {
  const f = fixture(t);
  f.data.merged.body = [[]];
  outcome(f, "NO-MERGE-YET");
});

test("all READY PRs behind predecessors yield no independent candidate", (t) => {
  const f = fixture(t);
  f.data.open.body = open([
    pr(1, { body: "Depends-on: #2" }),
    pr(2, { body: "Depends-on: #1" }),
  ]);
  outcome(f, "NO-INDEPENDENT-READY");
});

test("closed PRs, stale heads and withdrawn READY records are not waiting", (t) => {
  const f = fixture(t, 4);
  f.data.open.body = open([
    pr(2, { headRefOid: "b".repeat(40) }),
    pr(3),
    pr(4),
  ]);
  writeFileSync(f.log, f.original + "2026-10-14T01:30:00Z BUILDER-3 HELD #3\n");
  const e = outcome(f, "CAP-OPEN", "arrival-cap");
  assert.equal(e.fields.ready, "1");
  assert.equal(e.fields.closing, "4:BUILDER-4");
});

test("cap holds at four waiting READY PRs and opens when the live count drops", (t) => {
  const f = fixture(t, 4);
  const hold = outcome(f, "CAP-HOLD", "arrival-cap");
  assert.equal(hold.fields.ready, "4");
  assert.equal(
    hold.fields.closing,
    "1:BUILDER-1|2:BUILDER-2|3:BUILDER-3|4:BUILDER-4",
  );
  f.data.open.body = open([pr(1), pr(2), pr(3)]);
  outcome(f, "CAP-OPEN", "arrival-cap");
});

test("arrival cap comes from settings", (t) => {
  const f = fixture(t, 2);
  f.settingsData.arrivalCap.ready = 2;
  writeFileSync(f.settings, JSON.stringify(f.settingsData));
  outcome(f, "CAP-HOLD", "arrival-cap");
  f.settingsData.arrivalCap.ready = 3;
  writeFileSync(f.settings, JSON.stringify(f.settingsData));
  outcome(f, "CAP-OPEN", "arrival-cap");
});

for (const command of ["arrival-cap", "landing-assessment"]) {
  test(`${command} suppresses identical reports across restarts and lost state`, (t) => {
    const f = fixture(t, 4);
    outcome(f, command === "arrival-cap" ? "CAP-HOLD" : "ASSESS", command);
    assert.equal(f.run(command).status, 0);
    assert.equal(f.records().length, 1);
    rmSync(join(f.round, `${command}.state.json`));
    assert.equal(f.run(command).status, 0);
    assert.equal(f.records().length, 1);
  });
  for (const kind of command === "arrival-cap"
    ? ["queue", "open"]
    : ["merged", "queue", "open", "checks", "head"]) {
    test(`${command} logs UNKNOWN after a failed ${kind} read`, (t) => {
      const f = fixture(t, 4);
      f.data[kind] = { exit: 1 };
      outcome(f, "UNKNOWN", command);
    });
  }
  test(`${command} preserves state on UNKNOWN and refuses corrupt state`, (t) => {
    const f = fixture(t, 4);
    outcome(f, command === "arrival-cap" ? "CAP-HOLD" : "ASSESS", command);
    const state = join(f.round, `${command}.state.json`),
      original = readFileSync(state, "utf8");
    f.data.open = { raw: "{}" };
    outcome(f, "UNKNOWN", command);
    assert.equal(readFileSync(state, "utf8"), original);
    writeFileSync(state, "{}");
    outcome(f, "UNKNOWN", command);
  });
}

test("truncated open PR pagination, GraphQL errors and unresolved mergeability are UNKNOWN", (t) => {
  const f = fixture(t);
  f.data.open.body[0].data.repository.pullRequests.pageInfo.hasNextPage = true;
  outcome(f, "UNKNOWN");
  f.data.open.body = open([pr(1)]);
  f.data.open.body[0].errors = [{}];
  outcome(f, "UNKNOWN");
  f.data.open.body = open([pr(1, { mergeable: "UNKNOWN" })]);
  outcome(f, "UNKNOWN");
});

test("a head changed during gate reads is UNKNOWN", (t) => {
  const f = fixture(t);
  f.data.head.body.headRefOid = "b".repeat(40);
  outcome(f, "UNKNOWN");
});

test("open PRs beyond the first page count toward the cap", (t) => {
  const f = fixture(t, 4);
  f.data.open.body = [...open([pr(1), pr(2)]), ...open([pr(3), pr(4)])];
  f.data.open.body[0].data.repository.pullRequests.pageInfo = {
    hasNextPage: true,
    endCursor: "next",
  };
  outcome(f, "CAP-HOLD", "arrival-cap");
});

test("reports preserve the read-only source and only use read commands", (t) => {
  const f = fixture(t, 4);
  outcome(f, "ASSESS");
  outcome(f, "CAP-HOLD", "arrival-cap");
  assert.equal(readFileSync(f.source, "utf8"), f.original);
  assert.ok(readFileSync(f.log, "utf8").startsWith(f.original));
  for (const line of readFileSync(f.calls, "utf8").trimEnd().split("\n")) {
    const args = JSON.parse(line);
    assert.ok(
      args[0] === "api" ||
        (args[0] === "pr" && ["checks", "view"].includes(args[1])),
    );
    assert.ok(
      !args.includes("--method") && !args.join(" ").includes("mutation"),
    );
  }
});

// No variant caps open pull requests (METHOD "Seats, lanes and stops"; CF-Refine
// R19): the arrival cap reports, and the boot template holds no build on it.
test("the boot template holds no build on an arrival-cap report", () => {
  const text = readFileSync(
    fileURLToPath(
      new URL("../archive/boot/ORCHESTRATOR-BOOT-TEMPLATE.md", import.meta.url),
    ),
    "utf8",
  );
  assert.doesNotMatch(text, /CAP-HOLD|CAP-OPEN/u);
  assert.match(text, /no `ARRIVAL-CAP` report holds a build lane/u);
});

for (const command of ["arrival-cap", "landing-assessment"]) {
  test(`${command} logs UNKNOWN when its settings file is missing`, (t) => {
    const f = fixture(t);
    rmSync(f.settings);
    outcome(f, "UNKNOWN", command);
  });
  test(`${command} logs UNKNOWN on invalid settings without falling back`, (t) => {
    const f = fixture(t);
    const key = command === "arrival-cap" ? "arrivalCap" : "landingAssessment";
    f.settingsData[key].githubTimeoutMs = 0;
    writeFileSync(f.settings, JSON.stringify(f.settingsData));
    outcome(f, "UNKNOWN", command);
  });
}

test("an incomplete READY correction preserves its owner and waiting age", (t) => {
  const f = fixture(t);
  writeFileSync(
    f.log,
    f.original + "2026-10-14T01:30:00Z ORCH READY #1 correction\n",
  );
  const e = outcome(f, "ASSESS");
  assert.equal(e.fields.owner, "BUILDER-1");
  assert.equal(e.fields["ready-since"], "2026-10-14T01:01:00Z");
});

test("malformed predecessor declarations are UNKNOWN", (t) => {
  const f = fixture(t);
  f.data.open.body = open([pr(1, { body: "Depends-on: #9 unknown" })]);
  outcome(f, "UNKNOWN");
});

test("no READY work opens the cap and reports EMPTY-READY after a merge stall", (t) => {
  const f = fixture(t, 0);
  outcome(f, "CAP-OPEN", "arrival-cap");
  outcome(f, "EMPTY-READY");
});

test("a new gate is reported within the same no-merge interval", (t) => {
  const f = fixture(t);
  outcome(f, "ASSESS");
  f.data.checks = { body: [check("build", "pending")], exit: 8 };
  const e = outcome(f, "ASSESS");
  assert.equal(e.fields.gate, "required-check");
  assert.equal(f.records().length, 2);
});

test("unterminated input is refused without appending or saving state", (t) => {
  const f = fixture(t);
  writeFileSync(f.log, f.original.trimEnd());
  const result = f.run("arrival-cap");
  assert.equal(result.status, 2);
  assert.equal(readFileSync(f.log, "utf8"), f.original.trimEnd());
});

test("a blocked state without a known gate cannot be called ready", (t) => {
  const f = fixture(t);
  f.data.open.body = open([pr(1, { mergeStateStatus: "BLOCKED" })]);
  outcome(f, "UNKNOWN");
});

for (const command of ["arrival-cap", "landing-assessment"]) {
  test(`${command} reports healthy evidence again after UNKNOWN`, (t) => {
    const f = fixture(t, 4);
    const status = command === "arrival-cap" ? "CAP-HOLD" : "ASSESS";
    outcome(f, status, command);
    const original = f.data.open;
    f.data.open = { exit: 1 };
    outcome(f, "UNKNOWN", command);
    f.data.open = original;
    outcome(f, status, command);
    assert.equal(f.records().length, 3);
  });
}
