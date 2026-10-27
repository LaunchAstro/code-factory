// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, head, sol, runCheck } from "./enqueue-fixture.mjs";

function refuses(f, pattern, status = 1) {
  const result = f.run();
  assert.equal(result.status, status, result.stderr);
  assert.match(result.stdout, pattern);
  assert.equal(
    f.recorded().filter((a) => a.join(" ").includes("enqueuePullRequest"))
      .length,
    0,
  );
}

for (const conclusion of [
  "skipped",
  "neutral",
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
]) {
  test(`enqueue refuses required ${conclusion} with its gate name`, (t) => {
    const f = fixture(t);
    f.data.runs.body[0].check_runs[0].conclusion = conclusion;
    refuses(f, /WAIT gate=Sol%20verdict%20for%20this%20revision/);
  });
}
test("enqueue refuses a pending required check", (t) => {
  const f = fixture(t);
  Object.assign(f.data.runs.body[0].check_runs[0], {
    status: "in_progress",
    conclusion: null,
  });
  refuses(f, /WAIT gate=Sol%20verdict%20for%20this%20revision/);
});
test("enqueue refuses a missing required check by name", (t) => {
  const f = fixture(t);
  f.data.runs.body[0].check_runs.shift();
  f.data.runs.body[0].total_count = 1;
  refuses(f, /WAIT gate=Sol%20verdict%20for%20this%20revision.*missing/);
});
for (const state of ["CLOSED", "MERGED"]) {
  test(`enqueue refuses ${state} PR`, (t) => {
    const f = fixture(t);
    f.pr.state = state;
    refuses(f, /WAIT gate=pr-state/);
  });
}
for (const label of ["hold", "held", "factory/held", "HOLD"]) {
  test(`enqueue refuses label ${label}`, (t) => {
    const f = fixture(t);
    f.pr.labels = { nodes: [{ name: label }], totalCount: 1 };
    refuses(f, /WAIT gate=hold/);
  });
}
test("enqueue refuses an unexpected initial head", (t) => {
  const f = fixture(t);
  f.pr.headRefOid = "b".repeat(40);
  refuses(f, /WAIT gate=head/);
});
for (const [name, change, pattern] of [
  ["moved head", { headRefOid: "b".repeat(40) }, /WAIT gate=head/],
  [
    "new hold",
    { labels: { nodes: [{ name: "hold" }], totalCount: 1 } },
    /WAIT gate=hold/,
  ],
  ["closed PR", { state: "CLOSED" }, /WAIT gate=pr-state/],
]) {
  test(`enqueue rechecks ${name} after the check reads`, (t) => {
    const f = fixture(t);
    f.data.final = {
      body: { data: { repository: { pullRequest: { ...f.pr, ...change } } } },
    };
    refuses(f, pattern);
  });
}
for (const read of ["pr", "rules", "runs", "statuses", "final"]) {
  test(`enqueue waits on failed ${read} read`, (t) => {
    const f = fixture(t);
    f.data[read] = { exit: 1, raw: "{}" };
    refuses(f, /WAIT gate=read-/, 2);
  });
}
test("enqueue all required successes once with the exact expected head", (t) => {
  const f = fixture(t),
    result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ENQUEUED/);
  const writes = f
    .recorded()
    .filter((a) => a.join(" ").includes("enqueuePullRequest"));
  assert.equal(writes.length, 1);
  assert.match(
    writes[0].join(" "),
    new RegExp(`expectedHeadOid:\\s*"${head}"`),
  );
  const reads = f.recorded().filter((a) => /\/check-runs|\/status/u.test(a[1]));
  assert.equal(reads.length, 2);
  assert.ok(reads.every((a) => a[1].includes(`/commits/${head}/`)));
  assert.ok(f.recorded().every((a) => a[0] === "api"));
  const second = f.run([], false);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /ALREADY-QUEUED/);
  assert.equal(
    f.recorded().filter((a) => a.join(" ").includes("enqueuePullRequest"))
      .length,
    1,
  );
});
test("enqueue uses renamed required check data without code changes", (t) => {
  const f = fixture(t);
  f.data.rules.body[0][0].parameters.required_status_checks[0].context =
    "review version two";
  f.data.runs.body[0].check_runs[0].name = "review version two";
  assert.equal(f.run().status, 0);
});
test("enqueue refuses an empty required list", (t) => {
  const f = fixture(t);
  f.data.rules.body = [[]];
  refuses(f, /WAIT gate=required-checks/);
});
test("enqueue respects required source app identity", (t) => {
  const f = fixture(t);
  f.data.runs.body[0].check_runs[0].app.id = 999;
  refuses(f, /WAIT gate=Sol%20verdict%20for%20this%20revision.*missing/);
});
test("enqueue ignores success from another commit", (t) => {
  const f = fixture(t);
  f.data.runs.body[0].check_runs[0].head_sha = "b".repeat(40);
  refuses(f, /WAIT gate=read-runs/, 2);
});
test("enqueue reads classic protection as well as branch rules", (t) => {
  const f = fixture(t);
  f.pr.baseRef.branchProtectionRule = {
    requiredStatusChecks: [{ context: "classic gate", app: null }],
  };
  refuses(f, /WAIT gate=classic%20gate.*missing/);
});
test("enqueue supports commit-status requirements on the exact head", (t) => {
  const f = fixture(t);
  f.data.rules.body[0][0].parameters.required_status_checks[0].integration_id =
    null;
  f.data.runs.body[0].check_runs.shift();
  f.data.runs.body[0].total_count = 1;
  f.data.statuses.body[0] = {
    sha: head,
    total_count: 1,
    statuses: [{ id: 50, context: sol, state: "success" }],
  };
  assert.equal(f.run().status, 0);
});
test("enqueue rejects a newer failing run over an older success", (t) => {
  const f = fixture(t);
  f.data.runs.body[0].check_runs.push(
    runCheck(sol, { id: 100, conclusion: "failure" }),
  );
  f.data.runs.body[0].total_count = 3;
  refuses(f, /WAIT gate=Sol%20verdict%20for%20this%20revision/);
});
test("enqueue mutation rejects a move after the final read without retry", (t) => {
  const f = fixture(t);
  f.data.enqueue = {
    body: { errors: [{ message: "expected head mismatch" }] },
  };
  const result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stdout, /WAIT gate=enqueue/);
  assert.equal(
    f.recorded().filter((a) => a.join(" ").includes("enqueuePullRequest"))
      .length,
    1,
  );
});
test("enqueue reads every page of required checks and results", (t) => {
  const f = fixture(t);
  f.data.rules.body.push([
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: [
          { context: "another required gate", integration_id: null },
        ],
      },
    },
  ]);
  f.data.runs.body[0].total_count = 3;
  f.data.runs.body.push({
    total_count: 3,
    check_runs: [runCheck("another required gate", { id: 3 })],
  });
  assert.equal(f.run().status, 0);
  assert.ok(
    f
      .recorded()
      .filter((a) => a[1] !== "graphql" && a[1] !== "markdown")
      .every((a) => a.includes("--paginate") && a.includes("--slurp")),
  );
});
test("enqueue waits on a truncated result set", (t) => {
  const f = fixture(t);
  f.data.runs.body[0].total_count = 3;
  refuses(f, /WAIT gate=read-runs/, 2);
});
for (const read of ["pr", "rules", "runs", "statuses"]) {
  test(`enqueue waits on malformed ${read} data`, (t) => {
    const f = fixture(t);
    f.data[read] = { raw: "{}" };
    refuses(f, /WAIT gate=read-/, 2);
  });
}
test("enqueue waits on partial GraphQL success with errors", (t) => {
  const f = fixture(t);
  f.data.pr.body.errors = [{ message: "permission denied" }];
  refuses(f, /WAIT gate=read-pr/, 2);
});
test("enqueue waits when required checks change during reads", (t) => {
  const f = fixture(t);
  f.data.finalRules = { body: [[]] };
  refuses(f, /WAIT gate=required-checks.*changed-list/);
});
test("enqueue waits when the final rules read fails", (t) => {
  const f = fixture(t);
  f.data.finalRules = { exit: 1 };
  refuses(f, /WAIT gate=read-rules/, 2);
});
test("enqueue waits when the base changes during reads", (t) => {
  const f = fixture(t);
  f.data.final = {
    body: {
      data: {
        repository: {
          pullRequest: {
            ...f.pr,
            baseRef: { ...f.pr.baseRef, name: "release" },
          },
        },
      },
    },
  };
  refuses(f, /WAIT gate=base/);
});
test("enqueue refuses incomplete labels and drafts", (t) => {
  const f = fixture(t);
  f.pr.labels.totalCount = 101;
  refuses(f, /WAIT gate=read-pr/, 2);
  f.pr.labels.totalCount = 0;
  f.pr.isDraft = true;
  refuses(f, /WAIT gate=pr-state/);
});
test("enqueue ignores failing optional checks", (t) => {
  const f = fixture(t);
  f.data.runs.body[0].check_runs.push(
    runCheck("optional check", { id: 10, conclusion: "failure" }),
  );
  f.data.runs.body[0].total_count = 3;
  assert.equal(f.run().status, 0);
});
test("enqueue requires both same-named check run and commit status green", (t) => {
  const f = fixture(t);
  f.data.statuses.body[0] = {
    sha: head,
    total_count: 1,
    statuses: [{ id: 50, context: sol, state: "pending" }],
  };
  refuses(f, /WAIT gate=Sol%20verdict%20for%20this%20revision.*pending/);
});
test("enqueue waits on a status response from another head", (t) => {
  const f = fixture(t);
  f.data.statuses.body[0].sha = "b".repeat(40);
  refuses(f, /WAIT gate=read-statuses/, 2);
});
test("enqueue never retries failed or ambiguous writes", (t) => {
  const f = fixture(t);
  for (const response of [
    { exit: 1 },
    { raw: "not json" },
    { body: { data: { enqueuePullRequest: null } } },
  ]) {
    f.data.enqueue = response;
    const before = f.recorded().length,
      result = f.run();
    assert.equal(result.status, 2);
    assert.match(result.stdout, /WAIT gate=enqueue/);
    assert.equal(
      f
        .recorded()
        .slice(before)
        .filter((a) => a.join(" ").includes("enqueuePullRequest")).length,
      1,
    );
  }
});
test("enqueue refuses an abbreviated READY head before any GitHub read", (t) => {
  const f = fixture(t),
    result = f.run(["--head", head.slice(0, 12)]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /WAIT gate=input/);
  assert.equal(f.recorded().length, 0);
});

for (const conclusion of ["success", "failure"]) {
  test(`enqueue admits green required checks despite an optional ${conclusion} run with app=null`, (t) => {
    const f = fixture(t);
    f.data.runs.body[0].check_runs.push(
      runCheck("optional check", { id: 10, app: null, conclusion }),
    );
    f.data.runs.body[0].total_count = 3;
    const result = f.run();
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /ENQUEUED/);
    assert.equal(
      f.recorded().filter((a) => a.join(" ").includes("enqueuePullRequest"))
        .length,
      1,
    );
  });
}
test("enqueue admits an unpinned successful required run with app=null", (t) => {
  const f = fixture(t);
  f.data.rules.body[0][0].parameters.required_status_checks[0].integration_id =
    null;
  f.data.runs.body[0].check_runs[0].app = null;
  const result = f.run();
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /ENQUEUED/);
});
test("enqueue names an unpinned neutral required gate with app=null", (t) => {
  const f = fixture(t);
  f.data.rules.body[0][0].parameters.required_status_checks[0].integration_id =
    null;
  Object.assign(f.data.runs.body[0].check_runs[0], {
    app: null,
    conclusion: "neutral",
  });
  refuses(f, /WAIT gate=Sol%20verdict%20for%20this%20revision reason=neutral/);
});
test("enqueue refuses an app-pinned required gate with app=null", (t) => {
  const f = fixture(t);
  f.data.runs.body[0].check_runs[0].app = null;
  refuses(f, /WAIT gate=Sol%20verdict%20for%20this%20revision reason=missing/);
});
test("enqueue refuses a newer neutral attempt over an old success with app=null", (t) => {
  const f = fixture(t);
  f.data.rules.body[0][0].parameters.required_status_checks[0].integration_id =
    null;
  f.data.runs.body[0].check_runs[0].app = null;
  f.data.runs.body[0].check_runs.push(
    runCheck(sol, { id: 10, app: null, conclusion: "neutral" }),
  );
  f.data.runs.body[0].total_count = 3;
  refuses(f, /WAIT gate=Sol%20verdict%20for%20this%20revision reason=neutral/);
});
test("enqueue waits on a malformed app object", (t) => {
  const f = fixture(t);
  f.data.runs.body[0].check_runs[0].app = {};
  refuses(f, /WAIT gate=read-runs/, 2);
});
