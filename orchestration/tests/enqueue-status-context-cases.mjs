// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, head } from "./enqueue-fixture.mjs";

function statusFixture(t, context, state, withCheck) {
  const f = fixture(t);
  Object.assign(f.data.rules.body[0][0].parameters.required_status_checks[0], {
    context: "ci",
    integration_id: null,
  });
  if (withCheck) f.data.runs.body[0].check_runs[0].name = "ci";
  else {
    f.data.runs.body[0].check_runs.shift();
    f.data.runs.body[0].total_count = 1;
  }
  f.data.statuses.body[0] = {
    sha: head,
    total_count: 1,
    statuses: [{ id: 50, context, state }],
  };
  return f;
}

function outcome(f, expectedStatus, pattern, expectedWrites) {
  const result = f.run();
  const writes = f
    .recorded()
    .filter((a) => a.join(" ").includes("enqueuePullRequest"));
  assert.equal(
    result.status,
    expectedStatus,
    `${result.stdout}writes=${writes.length}`,
  );
  assert.match(result.stdout, pattern);
  assert.equal(writes.length, expectedWrites);
}

test("a successful required commit status enqueues regardless of context capitalisation", (t) => {
  outcome(statusFixture(t, "CI", "success", false), 0, /ENQUEUED/, 1);
});

for (const state of ["pending", "failure", "error"]) {
  test(`a commit status reporting ${state} with different context capitalisation blocks its successful required check`, (t) => {
    outcome(
      statusFixture(t, "CI", state, true),
      1,
      new RegExp(`WAIT gate=ci reason=${state}`),
      0,
    );
  });
}

test("an exact-case successful required commit status enqueues", (t) => {
  outcome(statusFixture(t, "ci", "success", false), 0, /ENQUEUED/, 1);
});

test("an exact-case pending status blocks its successful required check", (t) => {
  outcome(
    statusFixture(t, "ci", "pending", true),
    1,
    /WAIT gate=ci reason=pending/,
    0,
  );
});

test("an unrelated pending status leaves the successful required check admissible", (t) => {
  outcome(statusFixture(t, "other", "pending", true), 0, /ENQUEUED/, 1);
});
