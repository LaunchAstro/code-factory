// SPDX-License-Identifier: AGPL-3.0-only
// A repository with no merge queue: the script merges itself, behind the same
// gates plus Sol's "Sol verdict" commit status on the exact head.
import assert from "node:assert/strict";
import test from "node:test";
import { described, fixture, head, runCheck } from "./enqueue-fixture.mjs";

let next = 1;
const verdict = (state = "success", context = "Sol verdict") => ({
  id: next++,
  context,
  state,
});

const ranked = (level) =>
  `${described}\n**Risk:** ${level}, the reason for this rank.`;

function direct(t, level = "medium") {
  const f = fixture(t);
  f.pr.isMergeQueueEnabled = false;
  f.pr.body = ranked(level);
  f.data.rules.body = [[]];
  f.data.runs.body = [{ total_count: 0, check_runs: [] }];
  f.data.sol.body = [[verdict()]];
  return f;
}
const merges = (f) => f.recorded().filter((a) => /\/merge$/u.test(a[1] ?? ""));

function waits(f, pattern, status = 1) {
  const result = f.run();
  assert.equal(result.status, status, result.stderr);
  assert.match(result.stdout, pattern);
  assert.equal(merges(f).length, 0);
}

test("merges directly with Sol's approval of the head and no checks", (t) => {
  const f = direct(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `MERGED #17 head=${head} method=merge risk=medium`,
  );
  const [call] = merges(f);
  assert.deepEqual(call.slice(1), [
    "repos/fixture/repo/pulls/17/merge",
    "--method",
    "PUT",
    "-f",
    `sha=${head}`,
    "-f",
    "merge_method=merge",
  ]);
  assert.equal(
    f.recorded().filter((a) => a.join(" ").includes("enqueuePullRequest"))
      .length,
    0,
  );
});
test("waits without a Sol verdict on this head", (t) => {
  const f = direct(t);
  f.data.sol.body = [[verdict("success", "some other status")]];
  waits(f, /WAIT gate=sol reason=missing/);
});
test("a later approval does not clear a refusal on the same head", (t) => {
  const f = direct(t);
  f.data.sol.body = [[verdict("failure"), verdict("success")]];
  waits(f, /WAIT gate=sol reason=changes-requested/);
});
test("a Sol review still running waits", (t) => {
  const f = direct(t);
  f.data.sol.body = [[verdict("pending")]];
  waits(f, /WAIT gate=sol reason=pending/);
});
test("reads Sol's status across pages", (t) => {
  const f = direct(t);
  f.data.sol.body = [[verdict("success", "build")], [verdict()]];
  assert.equal(f.run().status, 0);
});
test("an unreadable status list waits with code 2", (t) => {
  const f = direct(t);
  f.data.sol.body = [[{ id: 1, context: "Sol verdict", state: "approved" }]];
  waits(f, /WAIT gate=read-sol/, 2);
});
test("waits on any failing check, required or not", (t) => {
  const f = direct(t);
  f.data.runs.body = [
    {
      total_count: 1,
      check_runs: [runCheck("lint", { conclusion: "failure" })],
    },
  ];
  waits(f, /WAIT gate=lint reason=failure/);
});
test("waits on a check still running", (t) => {
  const f = direct(t);
  f.data.runs.body = [
    {
      total_count: 1,
      check_runs: [
        runCheck("tests", { status: "in_progress", conclusion: null }),
      ],
    },
  ];
  waits(f, /WAIT gate=tests reason=in_progress/);
});
test("a skipped optional check passes, and a rerun replaces its failure", (t) => {
  const f = direct(t);
  f.data.runs.body = [
    {
      total_count: 3,
      check_runs: [
        runCheck("deploy preview", { conclusion: "skipped" }),
        runCheck("tests", { id: 2, conclusion: "failure" }),
        runCheck("tests", { id: 3 }),
      ],
    },
  ];
  assert.equal(f.run().status, 0);
});
test("waits on a failing commit status", (t) => {
  const f = direct(t);
  f.data.statuses.body = [
    {
      sha: head,
      total_count: 1,
      statuses: [{ id: 1, context: "vercel", state: "failure" }],
    },
  ];
  waits(f, /WAIT gate=vercel reason=failure/);
});
test("required checks still bind with no queue", (t) => {
  const f = direct(t);
  f.data.rules.body = [
    [
      {
        type: "required_status_checks",
        parameters: { required_status_checks: [{ context: "build" }] },
      },
    ],
  ];
  waits(f, /WAIT gate=build reason=missing/);
});
test("the description's three lines still gate a direct merge", (t) => {
  const f = direct(t);
  f.pr.body = "Builds the thing.";
  waits(f, /WAIT gate=description reason=missing/);
});
test("uses squash when the repository allows no merge commit", (t) => {
  const f = direct(t);
  f.data.repo.body.allow_merge_commit = false;
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /method=squash/);
});
test("a branch rule's allowed methods narrow the choice", (t) => {
  const f = direct(t);
  f.data.rules.body = [
    [
      {
        type: "pull_request",
        parameters: { allowed_merge_methods: ["rebase"] },
      },
    ],
  ];
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /method=rebase/);
});
test("a merge GitHub refuses waits with code 2 and is not retried", (t) => {
  const f = direct(t);
  f.data.merge = { exit: 1, raw: "" };
  const result = f.run();
  assert.equal(result.status, 2, result.stderr);
  assert.match(
    result.stdout,
    /WAIT gate=merge reason=failed-or-incomplete-response/,
  );
  assert.equal(merges(f).length, 1);
});
test("a queue switched on during the reads waits", (t) => {
  const f = direct(t);
  f.data.final = {
    body: {
      data: {
        repository: { pullRequest: { ...f.pr, isMergeQueueEnabled: true } },
      },
    },
  };
  waits(f, /WAIT gate=base reason=changed-pr-or-base/);
});

test("a low-risk change merges without Sol", (t) => {
  const f = direct(t, "low");
  f.data.sol.body = [[]];
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MERGED #17 .* risk=low/);
  assert.equal(
    f.recorded().filter((a) => (a[1] ?? "").includes("/statuses?")).length,
    0,
  );
});
test("a high-risk change still needs Sol", (t) => {
  const f = direct(t, "high");
  f.data.sol.body = [[]];
  waits(f, /WAIT gate=sol reason=missing/);
});
for (const file of [
  "supabase/migrations/0042_add_table.sql",
  ".github/workflows/ci.yml",
  "package.json",
  "apps/web/.env.production",
  "src/auth/session.ts",
  "src/middleware.ts",
]) {
  test(`low risk is refused for ${file}`, (t) => {
    const f = direct(t, "low");
    f.data.files.body = [
      [{ filename: "src/styles/site.css" }, { filename: file }],
    ];
    waits(f, /WAIT gate=risk reason=not-low/);
  });
}
test("a rename out of a risky path is not low risk", (t) => {
  const f = direct(t, "low");
  f.data.files.body = [
    [
      {
        filename: "docs/old-ci.yml",
        previous_filename: ".github/workflows/ci.yml",
      },
    ],
  ];
  waits(f, /WAIT gate=risk reason=not-low/);
});
test("a direct merge waits without a risk line", (t) => {
  const f = direct(t);
  f.pr.body = described;
  waits(f, /WAIT gate=risk reason=missing/);
});
test("a risk line with no rank is malformed", (t) => {
  const f = direct(t);
  f.pr.body = `${described}\n**Risk:** probably fine`;
  waits(f, /WAIT gate=risk reason=malformed/);
});
test("a risk lowered during the reads waits", (t) => {
  const f = direct(t, "high");
  f.data.final = {
    body: {
      data: { repository: { pullRequest: { ...f.pr, body: ranked("low") } } },
    },
  };
  waits(f, /WAIT gate=description reason=changed-during-reads/);
});
