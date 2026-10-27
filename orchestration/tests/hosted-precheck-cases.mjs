// SPDX-License-Identifier: AGPL-3.0-only
// hosted-precheck.mjs against a fake GitHub and real git: every refusal
// writes nothing, a batch is built from main plus the exact heads, and a run's
// jobs decide success, failure, a split or no count.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture, jobs, RUN_URL } from "./hosted-precheck-fixture.mjs";
import { closedPipe, fullPipe } from "./stderr-pipe-fixture.mjs";

const refused = (f, result, pattern) => {
  assert.equal(result.status, 3, result.stdout + result.stderr);
  assert.match(result.stdout, /^REFUSED /mu);
  assert.match(result.stdout, pattern);
  assert.deepEqual(f.writes(), []);
  assert.equal(f.branches(), "");
  assert.match(f.log().at(-1) ?? "", / END .*REFUSED/u);
};

/** A started batch of #11 and #12, with its state. */
function started(t, edit = () => {}) {
  const f = fixture(t);
  edit(f);
  const result = f.start(11, 12);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return { f, state: f.state(result.stdout) };
}

test("starts a batch: main plus one merge per exact head, a draft with both labels", (t) => {
  const f = fixture(t);
  const result = f.start(11, 12);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^STARTED c-\S+ pr=500 /mu);
  const state = f.state(result.stdout);
  assert.deepEqual(
    state.members.map((m) => [m.pr, m.sha]),
    [
      [11, f.heads[11]],
      [12, f.heads[12]],
    ],
  );
  // The pushed branch: two merges on main, the second parent of each the exact head.
  const tip = f
    .git("ls-remote", "origin", `refs/heads/${state.branch}`)
    .split("\t")[0];
  assert.equal(tip, state.head);
  f.git("fetch", "-q", "origin", state.branch);
  assert.equal(f.git("rev-parse", `${tip}^2`), f.heads[12]);
  assert.equal(f.git("rev-parse", `${tip}^1^2`), f.heads[11]);
  assert.equal(
    f.git("rev-parse", `${tip}^1^1`),
    f.git("rev-parse", "origin/main"),
  );
  const message = f.git("show", "-s", "--format=%B", tip);
  assert.match(message, /^chore\(precheck\): batch c-\S+ merges #12 /u);
  assert.match(message, /^Assisted-by: LLM$/mu);
  assert.match(message, /^Agent-model: claude-opus-5-5$/mu);
  const create = f.calls().find((a) => a.join(" ").includes("pulls -X POST"));
  assert.ok(
    create.includes("draft=true") && create.includes("base=main"),
    create.join(" "),
  );
  const labels = f
    .calls()
    .find((a) => a[1] === "repos/fixture/repo/issues/500/labels");
  assert.ok(
    labels.includes("labels[]=ci-next") &&
      labels.includes("labels[]=precheck-batch"),
  );
  assert.deepEqual(f.statuses(), []);
  assert.match(f.log()[0], / START c-\S+ #11 \w{7} #12 \w{7}/u);
});

test("refuses while two merge groups are building, and writes nothing", (t) => {
  const f = fixture(t);
  f.routes.queue.body = {
    workflow_runs: [
      {
        name: "ci",
        head_branch: "gh-readonly-queue/main/pr-1-" + "a".repeat(40),
      },
      {
        name: "ci",
        head_branch: "gh-readonly-queue/main/pr-2-" + "b".repeat(40),
      },
    ],
  };
  refused(f, f.start(11, 12), /2 merge groups building/u);
});

test("refuses when the merge queue cannot be read", (t) => {
  const f = fixture(t);
  f.routes.queue = { match: f.routes.queue.match, exit: 1 };
  refused(f, f.start(11, 12), /merge queue unreadable/u);
});

test("refuses a unit with no hosted job, naming it", (t) => {
  const f = fixture(t);
  const none = { none: "skipped on a pull_request event (ci.yml:492)" };
  f.config.units.db1 = none;
  f.config.units.db2 = none;
  refused(
    f,
    f.start(11, 12),
    /no hosted job for db1 db2: skipped on a pull_request event/u,
  );
});

test("refuses when main's copy of a pinned file is not the one the map was checked against", (t) => {
  const f = fixture(t);
  f.config.pins[".github/workflows/ci.yml"] = "0".repeat(40);
  refused(
    f,
    f.start(11, 12),
    /\.github\/workflows\/ci\.yml on main is \w{7}, the map was checked against 0000000/u,
  );
});

test("refuses a batch whose member changes a pinned file", (t) => {
  const f = fixture(t);
  f.config.pins["a.txt"] = f.git("rev-parse", "origin/main:a.txt");
  refused(f, f.start(11, 12), /#11 changes a\.txt/u);
});

test("refuses an outside contributor's pull request", (t) => {
  const f = fixture(t);
  f.routes.pull12.body.user.login = "someone-else";
  refused(
    f,
    f.start(11, 12),
    /#12 is not a round lane's: author someone-else/u,
  );
});

test("refuses a pull request from a fork", (t) => {
  const f = fixture(t);
  f.routes.pull12.body.head.repo.full_name = "someone-else/repo";
  refused(
    f,
    f.start(11, 12),
    /#12 is not a round lane's: head in someone-else\/repo/u,
  );
});

test("refuses a pull request no lane declared ready at that head", (t) => {
  const f = fixture(t);
  f.heads[12] = f.git("rev-parse", "origin/main");
  f.routes.pull12.body.head.sha = f.heads[12];
  refused(f, f.start(11, 12), /#12 has no READY or FIX-PUSHED line at \w{7}/u);
});

test("refuses a held, draft or closed pull request, or one whose head moved", (t) => {
  const f = fixture(t);
  f.routes.pull11.body.labels = [{ name: "Held" }];
  f.routes.pull12.body.head.sha = "e".repeat(40);
  const result = f.start(11, 12);
  refused(f, result, /#11 carries Held/u);
  assert.match(result.stdout, /#12 head is e{7}, not \w{7}/u);
});

test("refuses while another batch is open", (t) => {
  const f = fixture(t);
  f.routes.batches.body = [{ number: 499, pull_request: {} }];
  refused(f, f.start(11, 12), /batch #499 is still open/u);
});

test("finish waits while the run is going, and cleans nothing up", (t) => {
  const { f, state } = started(t);
  f.routes.runs.body.workflow_runs[0].status = "in_progress";
  const before = f.writes().length;
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 4, result.stderr);
  assert.match(result.stdout, /^WAIT /u);
  assert.equal(f.writes().length, before);
});

test("finish posts success on each exact head, naming the batch and run, then closes and deletes", (t) => {
  const { f, state } = started(t);
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`^GREEN ${state.id} run ${RUN_URL} #11 #12`, "u"),
  );
  const posted = f.statuses();
  assert.deepEqual(
    posted.map((s) => s.sha),
    [f.heads[11], f.heads[12]],
  );
  for (const s of posted) {
    assert.ok(
      s.fields.includes("state=success") &&
        s.fields.includes("context=hosted/precheck"),
    );
    const description = s.fields.find((x) => x.startsWith("description="));
    assert.ok(
      description.includes(state.id) && description.includes(RUN_URL),
      description,
    );
    assert.ok(description.length <= "description=".length + 140);
  }
  assert.ok(
    f
      .calls()
      .some(
        (a) =>
          a.join(" ") ===
          "api repos/fixture/repo/pulls/500 -X PATCH -f state=closed",
      ),
  );
  assert.ok(
    f
      .calls()
      .some(
        (a) =>
          a.join(" ") ===
          `api repos/fixture/repo/git/refs/heads/${state.branch} -X DELETE`,
      ),
  );
  assert.match(f.log().at(-1), new RegExp(`END ${state.id} GREEN`, "u"));
});

test("a red batch of two posts nothing and splits over its suspects", (t) => {
  const { f, state } = started(t);
  const list = jobs(f.config);
  list.find((j) => j.name === "database conformance shard 2").conclusion =
    "failure";
  f.routes.jobs.body = { jobs: list };
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stdout,
    /^SPLIT \S+ run \S+ units db2 suspects #11 \| #12/u,
  );
  assert.deepEqual(f.statuses(), []);
  assert.ok(f.calls().some((a) => a.join(" ").includes("pulls/500 -X PATCH")));
});

test("a red batch of one posts failure on that head", (t) => {
  const f = fixture(t);
  const state = f.state(f.start(12).stdout);
  const list = jobs(f.config);
  list.find((j) => j.name === "gitleaks over the full history").conclusion =
    "failure";
  f.routes.jobs.body = { jobs: list };
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /^RED \S+ run \S+ units secrets #12/u);
  const [s] = f.statuses();
  assert.equal(s.sha, f.heads[12]);
  assert.ok(s.fields.includes("state=failure"));
});

test("a mapped job that only deferred its steps means the batch does not count", (t) => {
  const { f, state } = started(t);
  f.routes.logs.raw =
    "ci-scope: isolation tests: deferred on a pull request; it runs in full in the merge queue\n";
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 3);
  assert.match(
    result.stdout,
    /^NOCOUNT \S+ run \S+ .*deferred on a pull request/u,
  );
  assert.deepEqual(f.statuses(), []);
});

test("a mapped job that was skipped means the batch does not count", (t) => {
  const { f, state } = started(t);
  const list = jobs(f.config);
  list.find((j) => j.name === "database conformance shard 1").conclusion =
    "skipped";
  f.routes.jobs.body = { jobs: list };
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 3);
  assert.match(result.stdout, /db1 \(database conformance shard 1\) skipped/u);
  assert.deepEqual(f.statuses(), []);
});

test("a job that started before the contamination gate finished means the batch does not count", (t) => {
  const { f, state } = started(t);
  const list = jobs(f.config);
  list[1].started_at = "2026-10-19T03:01:00Z";
  f.routes.jobs.body = { jobs: list };
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 3);
  assert.match(
    result.stdout,
    /started before the contamination gate finished/u,
  );
  assert.deepEqual(f.statuses(), []);
});

test("a cancelled run waits while labels settle, then does not count", (t) => {
  const { f, state } = started(t);
  f.routes.runs.body.workflow_runs[0].conclusion = "cancelled";
  f.now = new Date(Date.parse(state.startedAt) + 60_000).toISOString();
  assert.equal(f.run("finish", "--state", state.file).status, 4);
  f.now = new Date(Date.parse(state.startedAt) + 600_000).toISOString();
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 3);
  assert.match(result.stdout, /run cancelled/u);
});

test("refuses while another start holds the lock, and writes nothing", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.round, "lane-scratch", "OA-Precheck-C"), {
    recursive: true,
  });
  writeFileSync(
    join(f.round, "lane-scratch", "OA-Precheck-C", "start.lock"),
    "",
  );
  const result = f.start(11, 12);
  assert.equal(result.status, 3);
  assert.match(result.stdout, /^REFUSED: another start holds /u);
  assert.deepEqual(f.calls(), []);
  assert.equal(f.branches(), "");
});

test("malformed arguments are refused before any read", (t) => {
  const f = fixture(t);
  for (const args of [
    ["11", "abc"],
    ["11", f.heads[11], "11", f.heads[11]],
    ["0", f.heads[11]],
    ["11", f.heads[11].toUpperCase()],
  ]) {
    const result = f.run(
      "start",
      "--clone",
      f.clone,
      "--agent-model",
      "m",
      ...args,
    );
    assert.equal(result.status, 2, args.join(" "));
  }
  assert.equal(f.run("finish", "--state", "x", "11", f.heads[11]).status, 2);
  assert.deepEqual(f.calls(), []);
});

test("a run of another workflow, branch or repository is never the batch's run", (t) => {
  const { f, state } = started(t);
  const real = f.routes.runs.body.workflow_runs[0];
  real.status = "in_progress";
  const later = "2026-10-19T03:40:00Z";
  f.routes.runs.body.workflow_runs.push(
    {
      ...real,
      id: 701,
      status: "completed",
      path: ".github/workflows/other.yml",
      created_at: later,
    },
    {
      ...real,
      id: 702,
      status: "completed",
      head_branch: "copy",
      created_at: later,
    },
    {
      ...real,
      id: 703,
      status: "completed",
      head_repository: { full_name: "someone-else/repo" },
      created_at: later,
    },
  );
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 4, result.stdout + result.stderr);
  assert.match(result.stdout, /^WAIT \S+ run \S+ in_progress/u);
  assert.deepEqual(f.statuses(), []);
});

test("a member that conflicts with main is left out with no status", (t) => {
  const f = fixture(t);
  f.git("checkout", "-q", "-B", "advance", "origin/main");
  writeFileSync(join(f.clone, "a.txt"), "main moved\n");
  f.git("commit", "-q", "-am", "chore: main moves");
  f.git("push", "-q", "origin", "HEAD:main");
  const result = f.start(11, 12);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, / conflict #11$/mu);
  assert.deepEqual(
    f.state(result.stdout).members.map((m) => m.pr),
    [12],
  );
  assert.deepEqual(f.statuses(), []);
});

test("unreadable jobs on a completed run: no count, no status, draft cleaned up", (t) => {
  const { f, state } = started(t);
  f.routes.jobs = { match: f.routes.jobs.match, exit: 1 };
  const result = f.run("finish", "--state", state.file);
  assert.equal(result.status, 3, result.stdout + result.stderr);
  assert.match(result.stdout, /^NOCOUNT \S+ run \S+ jobs or logs unreadable/u);
  assert.deepEqual(f.statuses(), []);
  assert.match(result.stdout, /\(closed, branch deleted\)$/mu);
});

test("an ended batch posts nothing again and retries only the cleanup step that failed", (t) => {
  const { f, state } = started(t);
  f.routes.branch = {
    match: f.routes.branch.match,
    seq: [{ exit: 1 }, { body: {} }],
  };
  const first = f.run("finish", "--state", state.file);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /\(closed, branch delete failed\)$/mu);
  const posted = f.statuses().length;
  const retry = f.run("finish", "--state", state.file);
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.match(
    retry.stdout,
    /^ENDED GREEN \S+ .*\(closed, branch deleted\)$/mu,
  );
  assert.equal(f.statuses().length, posted);
  const closes = f
    .calls()
    .filter((a) => a.join(" ").includes("pulls/500 -X PATCH"));
  assert.equal(closes.length, 1);
  const again = f.run("finish", "--state", state.file);
  assert.equal(again.status, 0);
  assert.equal(
    f.calls().filter((a) => a.join(" ").includes("-X DELETE")).length,
    2,
  );
});

test("a draft that fails to open is cleaned up, and a failed cleanup is retried by finish", (t) => {
  const f = fixture(t);
  f.routes.labels = { match: f.routes.labels.match, exit: 1 };
  f.routes.close = {
    match: f.routes.close.match,
    seq: [{ exit: 1 }, { body: {} }],
  };
  const result = f.start(11, 12);
  assert.equal(result.status, 3, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /^FAILED \S+: opening the draft: .*\(close failed, branch deleted\)$/mu,
  );
  const file = (/ state=(\S+)/u.exec(result.stdout) ?? [])[1];
  assert.ok(file, result.stdout);
  const retry = f.run("finish", "--state", file);
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.match(retry.stdout, /^ENDED FAILED .*\(closed, branch deleted\)$/mu);
  assert.deepEqual(f.statuses(), []);
});

const USAGE =
  "usage: hosted-precheck.mjs start --config FILE --root ROUND --clone DIR --agent-model MODEL PR SHA [PR SHA ...]\n" +
  "       hosted-precheck.mjs finish --config FILE --root ROUND --state FILE\n";
const precheck = fileURLToPath(new URL("../hosted-precheck.mjs", import.meta.url));

test("usage on a closed stderr pipe still exits 2 and prints no error text", (t) => {
  const result = spawnSync(process.execPath, [precheck], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", closedPipe(t)],
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
});

test("usage arrives whole, with exit 2, once a full stderr pipe drains", async (t) => {
  assert.deepEqual(await fullPipe(t, [precheck]), { status: 2, stderr: USAGE });
});
