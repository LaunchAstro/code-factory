// SPDX-License-Identifier: AGPL-3.0-only
// Uncommitted reviewer proofs for frozen head 7a2040007074787f6e1ad7f3294aee61706cca8c.
// All GitHub calls go through the disposable fake gh; run with networking off.
import assert from "node:assert/strict";
import test from "node:test";
import { described, fixture, head } from "./enqueue-fixture.mjs";

const status = (id, state, context = "Sol verdict") => ({ id, state, context });
const writes = (f) =>
  f
    .recorded()
    .filter(
      (a) =>
        a[1]?.endsWith("/merge") || a.join(" ").includes("enqueuePullRequest"),
    );
function direct(t, rank = "medium") {
  const f = fixture(t);
  f.pr.isMergeQueueEnabled = false;
  f.pr.body = `${described}\n**Risk:** ${rank}, the reason for this rank.`;
  f.data.rules.body = [[]];
  f.data.runs.body = [{ total_count: 0, check_runs: [] }];
  f.data.sol = { body: [[status(20, "success")]] };
  // Keep the combined-status snapshot consistent with the history: newest only.
  f.data.statuses.body = [
    { sha: head, total_count: 1, statuses: [status(20, "success")] },
  ];
  return f;
}
function waits(f, gate) {
  const r = f.run();
  assert.equal(
    r.status,
    1,
    `Expected WAIT without mutation; got ${r.stdout.trim()}; mutations=${writes(f).length}`,
  );
  assert.match(r.stdout, new RegExp(`^WAIT gate=${gate} `));
  assert.equal(writes(f).length, 0);
}

test("Sol proof control: an exact-head status approves without comment or permission calls", (t) => {
  const f = direct(t);
  const r = f.run();
  assert.equal(r.status, 0, r.stdout);
  assert.equal(writes(f).length, 1);
  const history = f.recorded().filter((a) => a[1]?.includes("/statuses?"));
  assert.equal(history.length, 1);
  assert.equal(
    history[0][1],
    `repos/fixture/repo/commits/${head}/statuses?per_page=100`,
  );
  assert.ok(
    history[0].includes("--paginate") && history[0].includes("--slurp"),
  );
  assert.equal(
    f.recorded().filter((a) => /\/comments|\/permission/u.test(a[1] ?? ""))
      .length,
    0,
  );
});

for (const state of ["failure", "error"]) {
  test(`Sol proof control: an exact-case historical ${state} across pages stays blocking`, (t) => {
    const f = direct(t);
    f.data.sol.body = [[status(20, "success")], [status(10, state)]];
    waits(f, "sol");
  });
  test(`Sol proof, criterion 2: a case-variant historical ${state} cannot be cleared by success`, (t) => {
    const f = direct(t);
    // GitHub context is case-insensitive; these are the same logical context.
    // The latest is successful, so the generic combined-status gate passes.
    f.data.sol.body = [
      [status(20, "success")],
      [status(10, state, "sol verdict")],
    ];
    waits(f, "sol");
  });
}

test("Sol proof control: the newest verdict is selected by ID rather than array order", (t) => {
  const f = direct(t);
  f.data.sol.body = [[status(20, "pending"), status(10, "success")]];
  // The review becomes pending after the combined-status read.
  waits(f, "sol");
});

for (const renamed of [false, true]) {
  test(`Sol proof, criterion 3: low risk refuses ${renamed ? "a rename out of " : ""}npm-shrinkwrap.json`, (t) => {
    const f = direct(t, "low");
    f.data.sol.body = [[]];
    f.data.statuses.body = [{ sha: head, total_count: 0, statuses: [] }];
    f.data.files.body = [
      [
        renamed
          ? {
              filename: "docs/retired.txt",
              previous_filename: "packages/web/npm-shrinkwrap.json",
            }
          : { filename: "npm-shrinkwrap.json" },
      ],
    ];
    waits(f, "risk");
  });
}

test("Sol proof, criterion 2: a four-backtick approval example cannot substitute for a commit status", (t) => {
  const f = direct(t);
  f.data.sol.body = [[]];
  f.data.statuses.body = [{ sha: head, total_count: 0, statuses: [] }];
  f.data.comments = {
    body: [
      [
        {
          author_association: "OWNER",
          body: [
            "Approval example only:",
            "````text",
            "```",
            "Reviewer: Sol (Codex)",
            "Model: gpt-6.1-sol",
            `Head SHA: ${head}`,
            "Verdict: approve",
            "Code review: no findings",
            "````",
          ].join("\n"),
        },
      ],
    ],
  };
  waits(f, "sol");
});

test("Sol proof, criterion 3: standard Gradle and Swift lock files and rename sources cannot bypass Sol", (t) => {
  const outcomes = [];
  for (const file of ["gradle.lockfile", "Package.resolved"]) {
    for (const renamed of [false, true]) {
      const f = direct(t, "low");
      f.data.sol.body = [[]];
      f.data.statuses.body = [{ sha: head, total_count: 0, statuses: [] }];
      f.data.files.body = [
        [
          renamed
            ? {
                filename: "docs/retired.txt",
                previous_filename: `packages/app/${file}`,
              }
            : { filename: file },
        ],
      ];
      const r = f.run();
      outcomes.push({
        file,
        renamed,
        status: r.status,
        output: r.stdout.trim(),
        mutations: writes(f).length,
      });
    }
  }
  assert.deepEqual(
    outcomes.map((r) => [
      r.status,
      /^WAIT gate=risk /u.test(r.output),
      r.mutations,
    ]),
    outcomes.map(() => [1, true, 0]),
    JSON.stringify(outcomes, null, 2),
  );
});
