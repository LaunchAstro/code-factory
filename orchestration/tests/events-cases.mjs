// node --test orchestration/tests/events-cases.mjs
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  appendFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseEventLine } from "../events.mjs";

const prefix = "2000-01-01T04:48:27Z EXAMPLE-012 ";

test("every line of the sanitised round is known, with the source line on failure", () => {
  const lines = readFileSync(
    new URL("./fixtures/round-2000-01-01.events.log", import.meta.url),
    "utf8",
  ).split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const [index, line] of lines.entries()) {
    assert.notEqual(
      parseEventLine(line).type,
      "unknown",
      `line ${index + 1}: ${line}`,
    );
  }
  assert.equal(lines.length, 1908);
});

test("old and newer merge wording preserve the same merge metadata", () => {
  const expected = {
    type: "MERGED",
    timestamp: "2000-01-01T04:48:27Z",
    actor: "EXAMPLE-012",
    pr: 1192,
    head: null,
    mergeCommit: null,
    fields: {},
  };
  for (const form of ["MERGED #1192", "MERGED PR #1192", "MERGED pr=1192"]) {
    assert.deepEqual(parseEventLine(prefix + form), {
      ...expected,
      fields: form.includes("pr=") ? { pr: "1192" } : {},
    });
  }
  assert.deepEqual(
    parseEventLine(prefix + "MERGED #1278 as abcdef12 (head 123456789). note"),
    {
      ...expected,
      pr: 1278,
      head: "123456789",
      mergeCommit: "abcdef12",
    },
  );
});

test("ready records expose their ticket, head and reported fields without claiming a gate passed", () => {
  const record = parseEventLine(
    prefix +
      "READY M-A03-1 #1360 head=abcdef123 tests=473 checks=25/26 kind=tooling",
  );
  assert.equal(record.type, "READY");
  assert.equal(record.pr, 1360);
  assert.equal(record.head, "abcdef123");
  assert.deepEqual(record.fields, {
    head: "abcdef123",
    tests: "473",
    checks: "25/26",
    kind: "tooling",
  });
});

test("merged records preserve explicit repository metadata", () => {
  const record = parseEventLine(
    prefix + "MERGED #1192 head=abcdef123 repo=fixture/repo",
  );
  assert.equal(record.type, "MERGED");
  assert.equal(record.fields.repo, "fixture/repo");
});

test("legacy incomplete announcements stay known with absent identifiers", () => {
  const record = parseEventLine(prefix + "PR-OPENED M-A04-3a # head=abcdef123");
  assert.equal(record.type, "PR-OPENED");
  assert.equal(record.pr, null);
  assert.equal(record.head, "abcdef123");
  assert.equal(
    parseEventLine(prefix + "READY M-A13-2 #1402 correction: checks=25/29")
      .head,
    null,
  );
});

test("embedded issue references in a batch annotation are not the pull request", () => {
  assert.equal(
    parseEventLine(
      prefix + "PR-OPENED M-A03-1 (piece 3: #799 #666) #1361 head=abcdef123",
    ).pr,
    1361,
  );
  assert.equal(
    parseEventLine(
      prefix + "PR-OPENED M-A03-1 (piece 2: #825 #444) head=abcdef123",
    ).pr,
    null,
  );
});

test("review runner prefixes carry their subject, verdict and counters", () => {
  const review = parseEventLine(
    "2000-01-01T04:48:27Z SOL-PR 1212 RUN-END head=abcdef123 Verdict: changes requested",
  );
  assert.equal(review.type, "RUN-END");
  assert.equal(review.subject, "1212");
  assert.equal(review.verdict, "changes requested");
  const area = parseEventLine(
    "2000-01-01T04:48:27Z SOL-AREA A03 RUN-END exit=0 findings=3 last=[done]",
  );
  assert.equal(area.type, "RUN-END");
  assert.equal(area.fields.exit, "0");
  assert.equal(area.fields.findings, "3");
});

test("subagent reports carry named counts and retain legacy corrections as notes", () => {
  const record = parseEventLine(
    prefix + "SUBAGENTS build 0, review 3 (cap 3; note)",
  );
  assert.equal(record.type, "SUBAGENTS");
  assert.deepEqual(record.counts, { build: 0, review: 3 });
  assert.deepEqual(
    parseEventLine(prefix + "SUBAGENTS correction: piece 2 is off origin/main")
      .counts,
    {},
  );
});

test("subagent job annotations do not become active category counts", () => {
  const record = parseEventLine(
    prefix +
      "SUBAGENTS build 0, review 2 (jobs: a=check 22 findings, b=check 24 findings; cap 2: brief)",
  );
  assert.equal(record.type, "SUBAGENTS");
  assert.deepEqual(record.counts, { build: 0, review: 2 });
  assert.deepEqual(
    parseEventLine(
      prefix + "SUBAGENTS build 1, race attack 2, research 1 (jobs: review 9)",
    ).counts,
    { build: 1, "race attack": 2, research: 1 },
  );
  assert.deepEqual(
    parseEventLine(prefix + "SUBAGENTS correction: build 7, review 8").counts,
    {},
  );
  const fixture = readFileSync(
    new URL("./fixtures/round-2000-01-01.events.log", import.meta.url),
    "utf8",
  ).split("\n");
  assert.deepEqual(parseEventLine(fixture[430]).counts, {
    build: 0,
    review: 2,
  });
});

test("issue-labelled announcements retain the actual pull request number", () => {
  assert.equal(
    parseEventLine(
      prefix + "PR-OPENED #1383 piece #1419 head=abcdef123 (test only)",
    ).pr,
    1419,
  );
  assert.equal(
    parseEventLine(
      prefix + "PR-OPENED #1383 piece #1419 head=abcdef123 (follow-up #1500)",
    ).pr,
    1419,
  );
  assert.equal(
    parseEventLine(
      prefix + "PR-OPENED #1383 piece (issue #1500) #1419 head=abcdef123",
    ).pr,
    1419,
  );
  const fixture = readFileSync(
    new URL("./fixtures/round-2000-01-01.events.log", import.meta.url),
    "utf8",
  ).split("\n");
  assert.equal(parseEventLine(fixture[830]).pr, 1126);
  for (const index of [751, 790, 985]) {
    assert.equal(parseEventLine(fixture[index]).pr, 1117);
  }
});

test("a previous-head field cannot replace the announced head", () => {
  const record = parseEventLine(
    prefix + "READY #1192 previous-head=abcdef1 head=1234567",
  );
  assert.equal(record.head, "1234567");
  assert.equal(record.fields.head, "1234567");
  assert.equal(
    parseEventLine(prefix + "READY #1192 previous-head=abcdef1").head,
    null,
  );
  assert.equal(
    parseEventLine(prefix + "READY #1192 other_head=abcdef1 head=1234567").head,
    "1234567",
  );
  assert.equal(
    parseEventLine(prefix + "MERGED #1192 as abcdef12 (head 1234567)").head,
    "1234567",
  );
});

test("the supplied fixture replay rejects and names a trailing unknown physical line", (t) => {
  const root = mkdtempSync(join(tmpdir(), "a1-124-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tests = join(root, "orchestration", "tests");
  mkdirSync(join(tests, "fixtures"), { recursive: true });
  const testFile = join(tests, "events-cases.mjs");
  const fixture = join(tests, "fixtures", "round-2000-01-01.events.log");
  copyFileSync(
    new URL("../events.mjs", import.meta.url),
    join(root, "orchestration", "events.mjs"),
  );
  copyFileSync(new URL("./events-cases.mjs", import.meta.url), testFile);
  copyFileSync(
    new URL("./fixtures/round-2000-01-01.events.log", import.meta.url),
    fixture,
  );
  const args = [
    "--test",
    "--test-name-pattern=^every line of the sanitised round is known, with the source line on failure$",
    testFile,
  ];
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const control = spawnSync(process.execPath, args, { encoding: "utf8", env });
  assert.equal(control.status, 0, control.stdout + control.stderr);
  appendFileSync(fixture, "\n");
  const replay = spawnSync(process.execPath, args, { encoding: "utf8", env });
  assert.equal(replay.status, 1, replay.stdout + replay.stderr);
  assert.match(replay.stdout + replay.stderr, /line 1909:/u);
});

test("watcher outcomes and legacy watcher notes are known", () => {
  for (const body of [
    "MERGE-RATE ALARM merged60=1",
    "MERGE-STALL UNKNOWN reason=github-read",
    "WATCHDOG B merge stall",
    "DIRECTOR-REAP PANE-CLOSED note",
    "WRAP-NUDGE note",
    "GAUGE note",
    "LANE-WATCH SUSPECTED-STALL reason=silence",
    "LANDING-ASSESSMENT STALL pr=1192 gate=review",
    "ARRIVAL-CAP HELD ready=4",
    "TOUCHES-CHECK HELD path=apps/example.mjs",
  ]) {
    assert.notEqual(parseEventLine(prefix + body).type, "unknown", body);
  }
});

test("the fixture contains only synthetic dates, neutral actors and sanitised narrative", () => {
  const text = readFileSync(
    new URL("./fixtures/round-2000-01-01.events.log", import.meta.url),
    "utf8",
  );
  for (const line of text.trimEnd().split("\n")) {
    assert.match(line, /^2000-01-0[1-3]T[0-9:]{8}Z /u);
    assert.match(line.split(" ")[1], /^(?:EXAMPLE-\d{3}|SOL-(?:PR|AREA|SWEEP))$/u);
  }
  assert.doesNotMatch(
    text,
    /\/Users\/|\/Volumes\/|https?:\/\/|@|pane[=:]|password[=:]|token[=:]/iu,
  );
});

test("unlisted types, prose mentioning events and malformed envelopes have one unknown result", () => {
  for (const line of [
    "",
    "READY #1192",
    prefix + "FUTURE-EVENT note",
    prefix + "note mentions MERGED #1192",
    prefix + "MERGED",
    prefix + "MERGED #x",
    prefix + "MERGED #1192x",
    prefix + "MERGED #0",
    prefix.replace("01-01", "02-30") + "READY #1192",
    prefix.replace("04:48", "25:48") + "READY #1192",
    prefix + "READY #1192\n" + prefix + "WRAPPED",
    "2000-01-01T04:48:27Z SOL-PR 1192 FUTURE-END note",
  ]) {
    assert.deepEqual(parseEventLine(line), { type: "unknown" }, line);
  }
  assert.deepEqual(parseEventLine(null), { type: "unknown" });
});

test("a new fixture event fails replay with its line number and text", () => {
  const lines = [prefix + "WRAPPED", prefix + "NEW-WATCHER note"];
  assert.throws(() => {
    for (const [index, line] of lines.entries()) {
      assert.notEqual(
        parseEventLine(line).type,
        "unknown",
        `line ${index + 1}: ${line}`,
      );
    }
  }, /line 2: .*NEW-WATCHER/u);
});
