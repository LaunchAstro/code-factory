// SPDX-License-Identifier: AGPL-3.0-only
// After MERGED the script asks each local work map to Sync (#204), so the
// merge shows within a minute. A busy, absent or failing map never changes
// the merge's result.
import assert from "node:assert/strict";
import test from "node:test";
import { described, fixture, head } from "./enqueue-fixture.mjs";

const maps = [
  "-\t0\tcom.launchastro.live-roadmap.serve",
  "-\t0\tcom.launchastro.live-roadmap.github",
  "4242\t0\tcom.launchastro.work-map.example-project.github",
  "-\t0\tcom.launchastro.work-map.example-project.agents",
  "-\t0\tcom.example.github",
].join("\n");
const uid = process.getuid?.() ?? 0;

function direct(t, env = {}) {
  const f = fixture(t, { WORK_MAP_SYNC: "1", LAUNCHCTL_LIST: maps, ...env });
  f.pr.isMergeQueueEnabled = false;
  f.pr.body = `${described}\n**Risk:** medium, the reason for this rank.`;
  f.data.rules.body = [[]];
  f.data.runs.body = [{ total_count: 0, check_runs: [] }];
  f.data.sol.body = [[{ id: 1, context: "Sol verdict", state: "success" }]];
  return f;
}
const kicks = (f) => f.launchctl().filter((a) => a[0] === "kickstart");

test("a merge kicks each work map's GitHub refresh, without -k", (t) => {
  const f = direct(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    `MERGED #17 head=${head} method=merge risk=medium`,
    "SYNC com.launchastro.live-roadmap.github started",
    "SYNC com.launchastro.work-map.example-project.github started",
  ]);
  assert.deepEqual(kicks(f), [
    ["kickstart", `gui/${uid}/com.launchastro.live-roadmap.github`],
    ["kickstart", `gui/${uid}/com.launchastro.work-map.example-project.github`],
  ]);
});

test("a failing kick is printed and the merge still exits 0", (t) => {
  const f = direct(t, { LAUNCHCTL_KICK_EXIT: "5" });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^MERGED #17 /u);
  assert.match(
    result.stdout,
    /^SYNC com\.launchastro\.live-roadmap\.github failed$/mu,
  );
});

test("no map job loaded: skipped, exit 0", (t) => {
  const f = direct(t, { LAUNCHCTL_LIST: "-\t0\tcom.example.github" });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^SYNC skipped reason=no-map$/mu);
  assert.equal(kicks(f).length, 0);
});

test("launchctl failing to list: skipped, exit 0", (t) => {
  const f = direct(t, { LAUNCHCTL_LIST_EXIT: "127" });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^MERGED #17 /u);
  assert.match(result.stdout, /^SYNC skipped reason=launchctl-unavailable$/mu);
});

test("WORK_MAP_SYNC=0 turns it off silently", (t) => {
  const f = direct(t, { WORK_MAP_SYNC: "0" });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `MERGED #17 head=${head} method=merge risk=medium`,
  );
  assert.equal(f.launchctl().length, 0);
});

test("nothing is kicked on ENQUEUED, ALREADY-QUEUED or WAIT", (t) => {
  const queued = fixture(t, { WORK_MAP_SYNC: "1", LAUNCHCTL_LIST: maps });
  assert.match(queued.run().stdout, /^ENQUEUED /u);
  assert.equal(queued.launchctl().length, 0);

  const already = fixture(t, { WORK_MAP_SYNC: "1", LAUNCHCTL_LIST: maps });
  already.pr.mergeQueueEntry = { id: "MQ_fixture" };
  assert.match(already.run().stdout, /^ALREADY-QUEUED /u);
  assert.equal(already.launchctl().length, 0);

  const waiting = direct(t);
  waiting.data.sol.body = [[]];
  assert.match(waiting.run().stdout, /^WAIT gate=sol /u);
  assert.equal(waiting.launchctl().length, 0);
});
