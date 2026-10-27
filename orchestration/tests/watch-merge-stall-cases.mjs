// SPDX-License-Identifier: AGPL-3.0-only
// node --test orchestration/tests/watch-merge-stall-cases.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  fixture,
  queue,
  clean,
  now,
  oldMerge,
  recentMerge,
  GITHUB_TIMEOUT_MS,
} from "./watch-merge-stall-fixture.mjs";

const settingsExample = fileURLToPath(
  new URL("../watch.settings.json", import.meta.url),
);

function outcome(f, expected) {
  const result = f.run();
  assert.equal(
    result.status,
    expected === "UNKNOWN" ? 1 : 0,
    result.stdout + result.stderr,
  );
  const records = f.records();
  const event = records.at(-1);
  assert.equal(event?.type, "MERGE-STALL");
  assert.equal(event.message.split(" ")[0], expected);
  assert.equal(event.fields.repo, "fixture/repo");
  assert.equal(event.timestamp, now);
  return records;
}

test("a jam past the configured threshold is logged once across process restarts", (t) => {
  const f = fixture(t);
  outcome(f, "STALL");
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(f.records().length, 1);
  const state = JSON.parse(
    readFileSync(join(f.round, "merge-stall.state.json"), "utf8"),
  );
  assert.equal(state.stall, oldMerge);
});

test("no previous merge is distinct from a failed read", (t) => {
  const f = fixture(t);
  f.data.merged.body = [[]];
  outcome(f, "NO-MERGE-YET");
});

test("an empty queue with no CLEAN PRs is empty even before the first merge", (t) => {
  const f = fixture(t);
  f.data.merged.body = [[]];
  f.data.queue.body = queue(0);
  f.data.clean.body = clean(["BLOCKED", "BEHIND"]);
  outcome(f, "EMPTY-QUEUE");
});

test("a recent merge with waiting work is OK", (t) => {
  const f = fixture(t);
  f.data.merged.body = [[{ merged_at: recentMerge }]];
  outcome(f, "OK");
});

test("a CLEAN PR can stall before it enters the queue", (t) => {
  const f = fixture(t);
  f.data.queue.body = queue(0);
  outcome(f, "STALL");
});

test("a queue can stall without a CLEAN PR", (t) => {
  const f = fixture(t);
  f.data.clean.body = clean([]);
  outcome(f, "STALL");
});

test("the newest merge is selected across all pages, regardless of update ordering", (t) => {
  const f = fixture(t);
  f.data.merged.body = [
    [{ merged_at: oldMerge }, { merged_at: null }],
    [{ merged_at: recentMerge }],
  ];
  outcome(f, "OK");
  const calls = readFileSync(f.calls, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(calls.filter((args) => args.includes("--paginate")).length === 2);
});

test("CLEAN PRs beyond the first page are counted", (t) => {
  const f = fixture(t);
  f.data.queue.body = queue(0);
  f.data.clean.body = [...clean(["BLOCKED"]), ...clean(["CLEAN"])];
  f.data.clean.body[0].data.repository.pullRequests.pageInfo = {
    hasNextPage: true,
    endCursor: "next",
  };
  outcome(f, "STALL");
});

for (const kind of ["merged", "queue", "clean"]) {
  test(`a failed ${kind} read logs UNKNOWN, never OK`, (t) => {
    const f = fixture(t);
    f.data[kind] = { exit: 1 };
    outcome(f, "UNKNOWN");
  });
  test(`an unreadable ${kind} response logs UNKNOWN`, (t) => {
    const f = fixture(t);
    f.data[kind] = { raw: "{}" };
    outcome(f, "UNKNOWN");
  });
}

test("GraphQL errors accompanying data are UNKNOWN", (t) => {
  const f = fixture(t);
  f.data.queue.body.errors = [{ message: "unavailable" }];
  outcome(f, "UNKNOWN");
});

test("a truncated paginated read is UNKNOWN", (t) => {
  const f = fixture(t);
  f.data.clean.body[0].data.repository.pullRequests.pageInfo.hasNextPage = true;
  outcome(f, "UNKNOWN");
});

test("an invalid or future merge timestamp is UNKNOWN", (t) => {
  const f = fixture(t);
  for (const timestamp of [
    "bad",
    "2026-02-30T01:00:00Z",
    "2026-10-15T01:00:00Z",
  ]) {
    f.data.merged.body = [[{ merged_at: timestamp }]];
    outcome(f, "UNKNOWN");
  }
});

test("the settings file controls the threshold including its boundary", (t) => {
  const f = fixture(t);
  writeFileSync(
    f.settings,
    JSON.stringify({
      mergeStall: {
        minutes: 61,
        githubTimeoutMs: GITHUB_TIMEOUT_MS,
        githubMaxBufferBytes: 1048576,
      },
    }),
  );
  outcome(f, "OK");
  writeFileSync(
    f.settings,
    JSON.stringify({
      mergeStall: {
        minutes: 60,
        githubTimeoutMs: GITHUB_TIMEOUT_MS,
        githubMaxBufferBytes: 1048576,
      },
    }),
  );
  outcome(f, "STALL");
  assert.equal(
    JSON.parse(readFileSync(settingsExample, "utf8")).mergeStall.minutes,
    45,
  );
});

test("a new merge starts a new stall and UNKNOWN does not clear an existing stall", (t) => {
  const f = fixture(t);
  outcome(f, "STALL");
  f.data.queue = { exit: 1 };
  outcome(f, "UNKNOWN");
  f.data.queue = { body: queue(1) };
  assert.equal(f.run().status, 0);
  assert.equal(f.records().length, 2);
  f.data.merged.body = [[{ merged_at: "2026-10-14T01:10:00Z" }]];
  outcome(f, "STALL");
  assert.equal(f.records().length, 3);
});

test("log recovery prevents a duplicate after the state file is lost", (t) => {
  const f = fixture(t);
  outcome(f, "STALL");
  rmSync(join(f.round, "merge-stall.state.json"));
  assert.equal(f.run().status, 0);
  assert.equal(f.records().length, 1);
});

test("the pass writes only its log and state and never calls a pane or queue action", (t) => {
  const f = fixture(t);
  outcome(f, "STALL");
  assert.equal(readFileSync(f.source, "utf8"), f.original);
  assert.equal(readFileSync(f.log, "utf8").startsWith(f.original), true);
  assert.deepEqual(readdirSync(f.round).toSorted(), [
    "events.log",
    "merge-stall.state.json",
  ]);
  assert.equal(readFileSync(f.calls, "utf8").includes("pane-action"), false);
  assert.equal(readFileSync(f.calls, "utf8").includes('"api"'), true);
});

test("an oversized GitHub response is UNKNOWN at the configured read limit", (t) => {
  const f = fixture(t);
  writeFileSync(
    f.settings,
    JSON.stringify({
      mergeStall: {
        minutes: 45,
        githubTimeoutMs: GITHUB_TIMEOUT_MS,
        githubMaxBufferBytes: 128,
      },
    }),
  );
  f.data.merged.body = [[{ merged_at: oldMerge, padding: "x".repeat(1000) }]];
  outcome(f, "UNKNOWN");
});
